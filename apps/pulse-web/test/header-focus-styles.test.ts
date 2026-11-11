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
    /\.vote-card__yours\[tabindex="-1"\]:focus \{\s*outline: var\(--focus-ring-width\) solid var\(--focus\);\s*outline-offset: var\(--focus-ring-offset\);/,
  );
  expect(css).not.toMatch(
    /\.vote-card--page \.vote-card__yours:focus\s*\{\s*outline: none/,
  );
});
