import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function css(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
}

it("keeps focus green without framing the scripted results target (#482)", () => {
  expect(css("styles/tokens.css")).toContain("--focus: var(--green);");
  expect(css("components/ResultsPanel.css")).toMatch(
    /\.results:focus \{\s*outline: none;/,
  );
});

it("draws secondary buttons with the light separator (#482)", () => {
  const rules: Array<readonly [string, string]> = [
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

  for (const [file, selector] of rules) {
    const source = css(file);
    const declarations = source
      .split(`${selector} {`)
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf("}")));
    expect(declarations.length, `${file}: ${selector}`).toBeGreaterThan(0);
    expect(
      declarations.some((rule) =>
        rule.includes("border: var(--hairline) solid var(--line);"),
      ),
      `${file}: ${selector}`,
    ).toBe(true);
  }
});

it("leaves the rail's Try again its shared outlined look (#488)", () => {
  // The rail's rows are links now; old rules for rail buttons turned its only
  // button, Try again, into borderless text.
  expect(css("screens/Conversation.css")).not.toMatch(
    /\.conversation__sidebar button/,
  );
});

it("shows rail questions as unavailable while an answer is sent (#488)", () => {
  expect(css("components/AnsweredList.css")).toMatch(
    /\.answered a\[aria-disabled="true"\] \{[^}]*cursor: not-allowed;/,
  );
});

it("makes the My votes rail heading a visible, padded link (#488)", () => {
  expect(css("screens/Conversation.css")).toMatch(
    /\.conversation__sidebar h2 a \{[^}]*display: inline-flex;[^}]*min-height: calc\(var\(--step\) \* 3\);[^}]*padding-block: calc\(var\(--step\) \/ 2\);[^}]*text-decoration: underline;/s,
  );
});

it("left-aligns My votes messages with their heading and note (#488)", () => {
  expect(css("screens/Browse.css")).toMatch(
    /\.welcome\.browse \.browse__main--message \.viewstate \{[^}]*align-items: flex-start;[^}]*text-align: left;/s,
  );
});
