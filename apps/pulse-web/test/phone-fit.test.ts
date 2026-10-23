import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Layout that jsdom cannot measure, held by the rule that fixes it.
 *
 * Operator walkthrough, 2026-10-21, on a 375x812 phone: the sign-in screens
 * scrolled 2px sideways and 5px down (`scrollWidth` 377, `scrollHeight` 817),
 * because the frame's 1px border sat outside its `min(390px, 100vw)` width;
 * and the top bar wrapped onto two lines. Measured fixed in headless Chrome
 * at 375x812; these keep the rules from being dropped.
 */
function rule(file: string, selector: string): string {
  const css = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("fitting a phone", () => {
  it("draws the sign-in frame's border inside its size", () => {
    expect(rule("components/ScreenFrame.css", ".screen")).toMatch(
      /box-sizing:\s*border-box/,
    );
  });

  it("reserves a bottom drawer while the upper content scrolls independently", () => {
    expect(rule("screens/Conversation.css", ".conversation__scroll")).toMatch(
      /flex:\s*1;/,
    );
    expect(rule("screens/Conversation.css", ".conversation__scroll")).toMatch(
      /overflow-y:\s*auto/,
    );
    expect(rule("screens/Conversation.css", ".conversation__dock")).toMatch(
      /flex-shrink:\s*0/,
    );
    expect(rule("screens/Conversation.css", ".conversation__dock")).toContain(
      "env(safe-area-inset-bottom)",
    );
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    expect(css).not.toMatch(
      /\.conversation__vote\s*\{[^}]*position:\s*absolute/,
    );
  });

  it("keeps the top bar's controls on one line", () => {
    expect(rule("components/TopBanner.css", ".banner__actions")).toMatch(
      /flex-wrap:\s*nowrap/,
    );
  });
});
