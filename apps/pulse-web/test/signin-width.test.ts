import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * #508: the sign-in column keeps a readable width on every desktop window,
 * not only at 1100px and up. jsdom does not apply media queries, so this reads
 * the stylesheet; the real-browser check is in the PR.
 */
const shell = readFileSync(
  new URL("../src/components/AppShell.css", import.meta.url),
  "utf8",
);

/** The body of every `@media (<query>) { ... }` block, braces balanced. */
function mediaBlocks(css: string, query: string): string[] {
  const head = `@media (${query}) {`;
  const blocks: string[] = [];
  let at = css.indexOf(head);
  while (at !== -1) {
    let depth = 1;
    let i = at + head.length;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(at + head.length, i - 1));
    at = css.indexOf(head, i);
  }
  return blocks;
}

describe("the sign-in column's width (#508)", () => {
  it("is limited from the 700px desktop breakpoint up", () => {
    const desktop = mediaBlocks(shell, "min-width: 700px");
    expect(
      desktop.some((block) => /--screen-measure:\s*400px;/.test(block)),
    ).toBe(true);
  });

  it("is set once, so the 1100px layout cannot widen it again", () => {
    expect(shell.match(/--screen-measure:/g)).toHaveLength(1);
  });
});
