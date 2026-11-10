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

/** The declaration blocks of every rule whose selector list names `selector`. */
function blocksFor(source: string, selector: string): string[] {
  const blocks: string[] = [];
  const rule = /([^{}]+)\{([^}]*)\}/g;
  for (let match = rule.exec(source); match; match = rule.exec(source)) {
    const selectors = match[1]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((one) => one.trim());
    if (selectors.includes(selector)) blocks.push(match[2]!);
  }
  return blocks;
}

it("keeps the closing note and empty thread note small and muted (#488)", () => {
  const source = css("screens/Conversation.css");
  for (const selector of [
    ".conversation__hero > p",
    ".conversation__empty",
    ".conversation__sidebar p",
  ]) {
    const blocks = blocksFor(source, selector);
    expect(blocks.length, selector).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block, selector).toContain("font-size: var(--t-small);");
      expect(block, selector).toContain("color: var(--muted);");
      expect(block, selector).toContain("line-height: 1.5;");
      expect(block, selector).not.toContain("margin");
    }
  }
});

it("spaces the rail's status line only when it shows something (#488)", () => {
  const source = css("screens/Conversation.css");
  // A region holding only the visually hidden "Your votes are loaded." is
  // not empty, so `:not(:empty)` alone would still open a gap.
  const selector =
    ".conversation__sidebar .viewstate--compact:has(> :not(.visually-hidden))";
  const blocks = blocksFor(source, selector);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toContain("margin-block: var(--step);");
  expect(source).not.toMatch(/viewstate--compact:not\(:empty\)/);
});
