import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

function render(settings: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pulse-nginx-"));
  try {
    mkdirSync(join(dir, "conf.d"));
    writeFileSync(
      join(dir, "pulse-nginx.conf.template"),
      read("../nginx.conf"),
    );
    writeFileSync(
      join(dir, "entrypoint.sh"),
      read("../40-pulse-config.sh").replaceAll("/etc/nginx/", `${dir}/`),
    );
    // envsubst comes from the nginx image, not the JS workspace. This test
    // double enforces the exact substitution allowlist used by the real hook.
    writeFileSync(
      join(dir, "envsubst"),
      `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] !== '\${PULSE_API_UPSTREAM} \${PULSE_DNS_RESOLVER}') process.exit(1);
process.stdout.write(fs.readFileSync(0, "utf8").replace(
  /\\$\\{(PULSE_API_UPSTREAM|PULSE_DNS_RESOLVER)\\}/g,
  (_, name) => process.env[name],
));
`,
      { mode: 0o755 },
    );
    execFileSync("sh", [join(dir, "entrypoint.sh")], {
      env: {
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        ...settings,
      },
      stdio: "pipe",
    });
    return {
      config: readFileSync(join(dir, "conf.d/default.conf"), "utf8"),
      mode: readFileSync(join(dir, "pulse-proxy-mode.conf"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("nginx runtime settings", () => {
  it("keeps compose defaults and ignores caller-supplied forwarding headers", () => {
    const { config, mode } = render();
    expect(config).toContain('set $pulse_api_upstream "api:8080";');
    expect(config).toContain("resolver 127.0.0.11 valid=10s;");
    expect(mode).not.toMatch(/real_ip_header|set_real_ip_from|\$http_/);
    expect(mode).toContain("default $scheme;");
    expect(render({ PULSE_REAL_IP_HEADER: "" })).toEqual({ config, mode });
    expect(render({ PULSE_API_UPSTREAM: "", PULSE_DNS_RESOLVER: "" })).toEqual({
      config,
      mode,
    });
  });

  it("resolves the configured upstream at request time for both API locations", () => {
    const { config } = render({
      PULSE_API_UPSTREAM: "pulse-api.railway.internal:8080",
      PULSE_DNS_RESOLVER: "[fd12::10]",
    });
    expect(config).toContain(
      'set $pulse_api_upstream "pulse-api.railway.internal:8080";',
    );
    expect(config).toContain("resolver [fd12::10] valid=10s;");
    expect(config).not.toMatch(/\$\{PULSE_|ipv6=off|proxy_pass http:\/\/api:/);
    for (const location of ["/api/", "= /api/poll-images"]) {
      expect(config).toContain(`location ${location} {`);
      const block = config
        .slice(config.indexOf(`location ${location} {`))
        .split("\n    }")[0];
      expect(block).toContain("proxy_pass http://$pulse_api_upstream;");
      // No URI suffix: nginx must preserve the complete API path and query.
      expect(block).toContain("proxy_set_header X-Real-IP $remote_addr;");
      expect(block).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
      expect(block).toContain(
        "proxy_set_header X-Forwarded-Proto $pulse_forwarded_proto;",
      );
    }
    expect(config).not.toContain("$proxy_add_x_forwarded_for");
    expect(config).toContain("listen 8080;");
    expect(config).toContain("listen [::]:8080;");
    expect(config).toContain("try_files $uri $uri/ /index.html;");
  });

  it("trusts Railway's overwritten real-IP header only when explicitly enabled", () => {
    const { mode } = render({ PULSE_REAL_IP_HEADER: "X-Real-IP" });
    expect(mode).toContain("real_ip_header X-Real-IP;");
    expect(mode).toContain("set_real_ip_from 0.0.0.0/0;");
    expect(mode).toContain("set_real_ip_from ::/0;");
    expect(mode).toContain("real_ip_recursive off;");
    expect(mode).toContain(
      "map $http_x_forwarded_proto $pulse_forwarded_proto",
    );
    expect(mode).toContain("http http;");
    expect(mode).toContain("https https;");
    expect(mode).toContain("default $scheme;");
  });

  it("rejects unsupported trust modes and nginx directive injection", () => {
    for (const settings of [
      { PULSE_REAL_IP_HEADER: "X-Forwarded-For" },
      { PULSE_REAL_IP_HEADER: "false" },
      { PULSE_API_UPSTREAM: 'api:8080"; include bad;' },
      { PULSE_API_UPSTREAM: "api:8080\nmalicious:8080" },
      { PULSE_DNS_RESOLVER: "127.0.0.11; error_log /tmp/unsafe debug" },
      { PULSE_DNS_RESOLVER: "127.0.0.11\nmalicious" },
    ]) {
      expect(() => render(settings)).toThrow();
    }
  });

  it("suppresses request-bearing upstream errors on every route", () => {
    const { config } = render();
    const directives = config.replace(/#.*$/gm, "");
    expect(
      [...directives.matchAll(/\berror_log\s+([^;]+);/g)].map((m) => m[1]),
    ).toEqual(["/var/log/nginx/error.log crit"]);
    expect(directives.indexOf("error_log")).toBeLessThan(
      directives.indexOf("server {"),
    );
  });

  it("installs the template and executable startup hook in the nginx image", () => {
    const dockerfile = read("../Dockerfile");
    expect(dockerfile).toContain(
      "COPY apps/pulse-web/nginx.conf /etc/nginx/pulse-nginx.conf.template",
    );
    expect(dockerfile).toContain(
      "COPY --chmod=755 apps/pulse-web/40-pulse-config.sh /docker-entrypoint.d/40-pulse-config.sh",
    );
  });
});
