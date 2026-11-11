import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom cannot measure layout or paint outlines; retain the rules that do so.
it("reserves the same account width before and after the first read at all widths", () => {
  const css = readFileSync(
    new URL("../src/components/AccountMenu.css", import.meta.url),
    "utf8",
  );
  expect(css).toMatch(
    /\.banner__actions > \.account-menu,\s*\.banner__actions > \.banner__sign-in,\s*\.banner__actions > \.banner__account-space \{\s*box-sizing: border-box;\s*inline-size: calc\(var\(--step\) \* 10\);\s*flex: none;/,
  );
  expect(css).not.toContain("@media");
});

it("shows the system ring when the saved answer receives programmatic focus", () => {
  const css = readFileSync(
    new URL("../src/components/VoteCard.css", import.meta.url),
    "utf8",
  );
  expect(css).toMatch(
    /\.vote-card__yours\[tabindex="-1"\]:focus \{\s*outline: calc\(var\(--hairline\) \* 2\) solid var\(--focus\);\s*outline-offset: calc\(var\(--hairline\) \* 2\);/,
  );
  expect(css).not.toMatch(
    /\.vote-card--page \.vote-card__yours:focus\s*\{\s*outline: none/,
  );
});

it("draws Next question as quiet text with the standard focus ring, not a green block (#554)", () => {
  const css = readFileSync(
    new URL("../src/components/VoteCard.css", import.meta.url),
    "utf8",
  );
  const rule = /\.vote-card button\.vote-card__next \{([^}]*)\}/.exec(css)?.[1];
  expect(rule).toBeDefined();
  expect(rule).toContain("margin-inline-start: auto;");
  expect(rule).toContain("background: transparent;");
  expect(rule).toContain("white-space: nowrap;");
  expect(rule).not.toMatch(/#[0-9a-f]{3,6}|\d+px/i);
  expect(rule).not.toContain("var(--on-accent)");
  // The old full-width green Next, and the green last button in the row, are gone.
  expect(css).not.toMatch(/\.vote-card__next > button/);
  expect(css).not.toMatch(/\.vote-card__actions > button:last-child/);
  expect(css).toMatch(
    /\.vote-card button:focus-visible \{\s*outline: calc\(var\(--hairline\) \* 2\) solid var\(--focus\);/,
  );
});
