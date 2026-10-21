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

  /*
   * With the question on the card, the space above it held only "Your
   * answers will appear here" and blank phone: it now takes its content's
   * height, so the card sits under it (review of #420; card top measured at
   * 127px instead of 501px on 375x812).
   */
  it("does not stretch the answers above the card on a phone", () => {
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(
      /@media \(max-width: 1099px\) \{\s*\.conversation__scroll \{\s*flex: 0 1 auto;/,
    );
  });

  it("keeps the top bar's controls on one line", () => {
    expect(rule("components/TopBanner.css", ".banner__actions")).toMatch(
      /flex-wrap:\s*nowrap/,
    );
  });
});
