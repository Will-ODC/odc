import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const nginx = read("../nginx.conf").replace(/#.*$/gm, "");
const include = "/etc/nginx/pulse-security-headers.conf";

describe("production security policy", () => {
  it("sends security headers even on errors", () => {
    const headers = read("../security-headers.conf");
    for (const [name, value] of [
      [
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      ],
      ["X-Content-Type-Options", "nosniff"],
      ["Referrer-Policy", "same-origin"],
      ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
    ]) {
      expect(headers).toContain(`add_header ${name} "${value}" always;`);
    }
  });

  it("allows a larger body on the picture upload route only", () => {
    const sizes = [...nginx.matchAll(/client_max_body_size\s+([^;]+);/g)];
    expect(sizes.map((match) => match[1])).toEqual(["10m"]);
    const upload = nginx.match(/location = \/api\/poll-images \{([^{}]*)\}/);
    expect(upload?.[1]).toContain("client_max_body_size 10m;");
    expect(upload?.[1]).toContain("proxy_pass http://api:8080;");
  });

  it("includes the policy at server level and in every location", () => {
    const locations = [...nginx.matchAll(/location\s+([^{}]+)\{([^{}]*)\}/g)];
    expect(locations.map((match) => match[1]?.trim())).toEqual([
      "= /index.html",
      "/assets/",
      "/api/",
      "= /api/poll-images",
      "/",
    ]);
    for (const location of locations) {
      expect(location[2]).toContain(`include ${include};`);
    }
    const server = nginx.replace(/location\s+[^{}]+\{[^{}]*\}/g, "");
    expect(server).toContain(`include ${include};`);
    expect(server).toContain("server_tokens off;");
    expect(nginx).not.toContain("Strict-Transport-Security");
    expect(nginx).not.toMatch(/listen[^;]*ssl/);
    expect(read("../Dockerfile")).toContain(
      `COPY apps/pulse-web/security-headers.conf ${include}`,
    );
  });

  it("loads only the used Inter weights locally and removes font hosts", () => {
    const main = read("../src/main.tsx");
    expect(
      [...main.matchAll(/@fontsource\/inter\/(\d+)\.css/g)].map((m) => m[1]),
    ).toEqual(["400", "500", "600", "700", "800"]);
    expect(read("../index.html")).not.toMatch(/https?:\/\//);
  });
});
