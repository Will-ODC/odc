import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const nginx = readFileSync(new URL("../nginx.conf", import.meta.url), "utf8");

describe("sign-in link privacy during page load", () => {
  it("sets no-referrer before loading page resources", () => {
    const policy = html.indexOf(
      '<meta name="referrer" content="no-referrer" />',
    );
    const firstResource = html.search(/<(?:link|script)\b/);
    expect(policy).toBeGreaterThan(0);
    expect(policy).toBeLessThan(firstResource);
  });

  it("does not write incoming referrers to the access log", () => {
    const format = nginx.match(/log_format pulse_no_query ([\s\S]*?);/)?.[1];
    expect(format).toBeDefined();
    expect(format).not.toContain("$http_referer");
  });

  it("logs with the query-free format and no query-bearing variable", () => {
    // Every access_log line in the file, so a second one cannot slip past.
    const logs = [...nginx.matchAll(/^\s*access_log\s+([^;]*);/gm)];
    expect(logs.length).toBeGreaterThan(0);
    for (const [, args] of logs) expect(args).toMatch(/\spulse_no_query$/);
    const format = nginx.match(/log_format pulse_no_query ([\s\S]*?);/)?.[1];
    // `\b` so `$request_method` (which carries no query) still passes.
    for (const name of ["request", "request_uri", "args", "query_string"])
      expect(format).not.toMatch(new RegExp(`\\$${name}\\b`));
  });
});
