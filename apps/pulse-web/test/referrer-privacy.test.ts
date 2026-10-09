import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const nginx = readFileSync(new URL("../nginx.conf", import.meta.url), "utf8");

describe("sign-in link privacy during page load", () => {
  it("sets no-referrer before loading page resources", () => {
    const policy = html.indexOf(
      '<meta name="referrer" content="no-referrer" />',
    );
    const firstResource = html.indexOf('<link rel="preconnect"');
    expect(policy).toBeGreaterThan(0);
    expect(policy).toBeLessThan(firstResource);
  });

  it("does not write incoming referrers to the access log", () => {
    const format = nginx.match(/log_format pulse_no_query ([\s\S]*?);/)?.[1];
    expect(format).toBeDefined();
    expect(format).not.toContain("$http_referer");
  });
});
