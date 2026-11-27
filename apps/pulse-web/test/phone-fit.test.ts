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
  it("pads the conversation by the open Voting drawer's measured height, never less than before (#528)", () => {
    const padding =
      /--conversation-dock-clearance:([^;]*);/.exec(
        rule("screens/Conversation.css", ".conversation__scroll"),
      )?.[1] ?? "";
    expect(padding).toMatch(/^\s*max\(/);
    expect(padding).toContain("env(safe-area-inset-bottom)");
    expect(padding).toContain("var(--dock-space");
    expect(rule("screens/Conversation.css", ".conversation__scroll")).toContain(
      "padding-bottom: var(--conversation-dock-clearance);",
    );
  });

  it("scrolls focused picture controls above the open phone voting sheet", () => {
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    expect(css.slice(css.indexOf("@media (max-width: 699px)"))).toMatch(
      /\.conversation__question:has\(\.conversation__dock \.vote-card\)\s+\.conversation__scroll \{\s*scroll-padding-bottom: var\(--conversation-dock-clearance\);/,
    );
  });

  it("gives the phone version thumb-sized targets and a full-width sheet (#482)", () => {
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    const phone = css.slice(css.indexOf("@media (max-width: 699px)"));
    expect(phone).toMatch(
      /\.conversation__dock \{[^}]*right: 0;[^}]*left: 0;[^}]*width: auto;/,
    );
    expect(phone).toMatch(
      /\.conversation button:not\(:where\(\.picture-management \*\)\) \{\s*min-height: var\(--touch\);/,
    );
    expect(phone).toMatch(
      /\.conversation__dock \.vote-card \{[\s\S]*padding-inline-start: max\([\s\S]*safe-area-inset-left/,
    );
    expect(phone).toMatch(
      /\.conversation__help \{[\s\S]*padding-inline-end: max\([\s\S]*safe-area-inset-right/,
    );
  });

  it("stacks the vote button under a full-width privacy note below 700 px", () => {
    const css = readFileSync(
      new URL("../src/components/VoteCard.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(
      /@media \(max-width: 699px\) \{\s*\.vote-card__foot \{[^}]*flex-direction: column;[^}]*\}\s*\.vote-card__foot > p \{[^}]*align-self: stretch;/,
    );
  });

  it("draws the sign-in frame's border inside its size", () => {
    expect(rule("components/ScreenFrame.css", ".screen")).toMatch(
      /box-sizing:\s*border-box/,
    );
  });

  it("draws the compact results card's edge inside its column (#575)", () => {
    // `.results` is `width: 100%`. With the card's padding and border
    // outside that width, a closed question's results at 375 ended 34px past
    // the column, clipping "Hide results", and spilled past it at 1280 too.
    expect(rule("components/ResultsPanel.css", ".results")).toMatch(
      /width:\s*100%/,
    );
    expect(rule("components/ResultsPanel.css", ".results--compact")).toMatch(
      /box-sizing:\s*border-box/,
    );
  });

  it("floats voting clear of the safe areas, scrolling rather than clipping", () => {
    const dock = rule("screens/Conversation.css", ".conversation__dock");
    expect(dock).toMatch(/position:\s*fixed/);
    // Never flush to the edge: the gutter is the floor even with no inset.
    expect(dock).toMatch(
      /right:\s*max\(var\(--gutter\),\s*env\(safe-area-inset-right\)\)/,
    );
    expect(dock).toMatch(
      /bottom:\s*max\(var\(--gutter\),\s*env\(safe-area-inset-bottom\)\)/,
    );
    expect(rule("screens/Conversation.css", ".conversation__scroll")).toMatch(
      /overflow-y:\s*auto/,
    );
    expect(
      rule("screens/Conversation.css", ".conversation__dock .vote-card"),
    ).toMatch(/overflow-y:\s*auto/);
  });

  it("sizes the floating voting button as Submit", () => {
    const button = rule(
      "screens/Conversation.css",
      ".conversation__help > button",
    );
    const submit = rule("components/VoteCard.css", ".vote-card button");
    for (const property of ["padding", "font-size"]) {
      const declaration = submit.match(new RegExp(`  ${property}: [^;]+;`))![0];
      expect(button).toContain(declaration);
    }
    expect(button).not.toMatch(/min-(height|width):/);
  });

  it("turns the voting reveal off for reduced motion", () => {
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    // Scoped to the voting reveal's own block: the #554 question slide has a
    // separate reduced-motion block that must not satisfy this check.
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.conversation__dock \.vote-card,\s*\.conversation__help > button \{\s*animation: none;/,
    );
  });

  it("keeps the shared touch target at least 44px", () => {
    const tokens = readFileSync(
      new URL("../src/styles/tokens.css", import.meta.url),
      "utf8",
    );
    const touch = tokens.match(/--touch:\s*(\d+)px;/);
    expect(Number(touch?.[1])).toBeGreaterThanOrEqual(44);
  });

  it("gives the closed voting button its own row on a phone, so it covers nothing (#527)", () => {
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    const phone = css.slice(css.indexOf("@media (max-width: 699px)"));
    // Measured in headless Chrome at 375x812: with the button floating, Next
    // under the results sat behind "Change my answer" until scrolled clear.
    expect(phone).toMatch(
      /\.conversation__dock:has\(\.conversation__help\) \{\s*position: static;/,
    );
    expect(phone).toMatch(
      /\.conversation__question:has\(\.conversation__help\) \.conversation__scroll \{\s*padding-bottom: var\(--gutter\);/,
    );
  });

  it("lets the chart's axis text overhang its drawing (#527)", () => {
    // At 375 the phone's 14px "100%" ran 5px past the SVG's left edge and
    // was clipped to "00%" (headless Chrome, 375x812).
    expect(rule("components/BarChart.css", ".bar-chart__plot svg")).toMatch(
      /overflow:\s*visible/,
    );
  });

  it("keeps the top bar's controls on one line", () => {
    expect(rule("components/TopBanner.css", ".banner__actions")).toMatch(
      /flex-wrap:\s*nowrap/,
    );
  });
});
