import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// jsdom applies no :hover and evaluates no media query, so this reads the
// stylesheet. Whether the halves visibly light up is a real-browser check.
const css = readFileSync(
  new URL("../src/screens/SwipeBallot.css", import.meta.url),
  "utf8",
);

function hoverBlock(): string {
  const start = css.indexOf("@media (hover: hover)");
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

describe("the swipe ballot shows where to press under a pointer", () => {
  it("lights each half only behind a hover-capable media query", () => {
    const block = hoverBlock();
    expect(block).toContain(".ballot__half--left:hover");
    expect(block).toContain("--hover-left: 1");
    expect(block).toContain(".ballot__half--right:hover");
    expect(block).toContain("--hover-right: 1");
  });

  it("lights nothing on a disabled half", () => {
    const block = hoverBlock();
    expect(block).toContain(".ballot__half--left:hover:not(:disabled)");
    expect(block).toContain(".ballot__half--right:hover:not(:disabled)");
  });

  it("feeds the hover into each tint layer", () => {
    expect(css).toMatch(
      /\.ballot__tint-left \{[^}]*max\(var\(--lean-left\), var\(--hover-left\)\)/,
    );
    expect(css).toMatch(
      /\.ballot__tint-right \{[^}]*max\(var\(--lean-right\), var\(--hover-right\)\)/,
    );
  });

  it("rests at no hover", () => {
    expect(css).toMatch(
      /\.ballot \{[^}]*--hover-left: 0;[^}]*--hover-right: 0;/,
    );
  });
});
