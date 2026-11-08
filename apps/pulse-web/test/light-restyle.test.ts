import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Invariants of the light look (#482), not its taste: the values may change,
 * these rules should not.
 */
function css(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

/** Every declaration block for `selector` in `file`. */
function rules(file: string, selector: string): string[] {
  return css(file)
    .split(`\n${selector} {`)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf("}")));
}

describe("the light look's invariants (#482)", () => {
  it("has a real focus colour, and no ring on the results focused by script", () => {
    const focus = css("styles/tokens.css").match(/--focus:\s*([^;]+);/);
    expect(focus?.[1]).toBeDefined();
    expect(focus![1]).not.toMatch(/none|transparent/);
    expect(css("components/ResultsPanel.css")).toMatch(
      /\.results:focus \{\s*outline: none;/,
    );
  });

  it("edges every text field with --line-strong, the 3:1 control edge", () => {
    const fields: Array<readonly [string, string]> = [
      ["screens/SignIn.css", ".signin__field"],
      ["components/CopyLink.css", ".copy-link input"],
      ["components/PostedBanner.css", ".posted__field"],
      ["screens/ChatPreview.css", ".chatpreview__select"],
    ];
    for (const [file, selector] of fields) {
      const found = rules(file, selector);
      expect(found.length, `${file}: ${selector}`).toBeGreaterThan(0);
      expect(
        found.some((rule) => rule.includes("solid var(--line-strong)")),
        `${file}: ${selector}`,
      ).toBe(true);
    }
  });

  it("draws every secondary button with a visible edge", () => {
    const buttons: Array<readonly [string, string]> = [
      ["styles/utilities.css", ".button"],
      ["components/VoteCard.css", ".vote-card button"],
      ["components/TwoPress.css", ".two-press__action--secondary"],
      ["components/ResultsPanel.css", ".results__retry"],
      ["components/DecisionDialog.css", ".decision__close"],
      ["components/CopyLink.css", ".copy-link button"],
      ["components/TopBanner.css", ".banner__actions > .banner__sign-in"],
      ["screens/Conversation.css", ".conversation button"],
      ["screens/SignIn.css", ".signin__again"],
    ];
    for (const [file, selector] of buttons) {
      const found = rules(file, selector);
      expect(found.length, `${file}: ${selector}`).toBeGreaterThan(0);
      expect(
        found.some((rule) =>
          /border: var\(--hairline\) solid var\(--/.test(rule),
        ),
        `${file}: ${selector}`,
      ).toBe(true);
    }
  });
});
