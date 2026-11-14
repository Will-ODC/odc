import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const nginx = read("../nginx.conf").replace(/#.*$/gm, "");
// Quoted strings (the JSON 413 body) may hold braces; blank them before
// matching location blocks by brace.
const blocks = nginx.replace(/'[^']*'/g, "''");
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
    const sizes = [...blocks.matchAll(/client_max_body_size\s+([^;]+);/g)];
    expect(sizes.map((match) => match[1])).toEqual(["10m"]);
    const upload = blocks.match(/location = \/api\/poll-images \{([^{}]*)\}/);
    expect(upload?.[1]).toContain("client_max_body_size 10m;");
    expect(upload?.[1]).toContain("proxy_pass http://api:8080;");
    expect(upload?.[1]).toContain("error_page 413 = @image_too_large;");
  });

  it("answers an oversized upload with the API's JSON refusal, not nginx's page", () => {
    const refusal = blocks.match(/location @image_too_large \{([^{}]*)\}/)?.[1];
    expect(refusal).toContain("default_type application/json;");
    expect(refusal).toContain('add_header Cache-Control "no-store" always;');
    expect(refusal).toContain("return 413 '';");
    const body = nginx.match(
      /location @image_too_large \{[^']*return 413 '([^']*)';/,
    )?.[1];
    expect(JSON.parse(body ?? "null")).toEqual({
      error: "image_too_large",
      message: "That picture is over 10 MB. Choose a smaller one.",
    });
  });

  it("includes the policy at server level and in every location", () => {
    const locations = [...blocks.matchAll(/location\s+([^{}]+)\{([^{}]*)\}/g)];
    expect(locations.map((match) => match[1]?.trim())).toEqual([
      "= /index.html",
      "/assets/",
      "/api/",
      "= /api/poll-images",
      "@image_too_large",
      "/",
    ]);
    for (const location of locations) {
      expect(location[2]).toContain(`include ${include};`);
    }
    const server = blocks.replace(/location\s+[^{}]+\{[^{}]*\}/g, "");
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
