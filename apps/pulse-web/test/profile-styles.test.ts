import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom cannot lay out text; assert the rules a real browser needs (#576).
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
// Every declaration block whose selector list names `selector` exactly.
const rule = (css: string, selector: string) => {
  const bodies = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) =>
      (selectors ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .some((one) => one.trim() === selector),
    )
    .map(([, , body]) => body);
  expect(bodies.length, selector).toBeGreaterThan(0);
  return bodies.join("\n");
};

it("wraps a long unbroken profile name or bio instead of widening the page", () => {
  const css = read("../src/screens/Profile.css");
  expect(rule(css, ".profile")).toMatch(/min-inline-size: 0;/);
  expect(rule(css, ".profile__title")).toMatch(/overflow-wrap: anywhere;/);
  expect(rule(css, ".profile__bio")).toMatch(/overflow-wrap: anywhere;/);
});

it("keeps a contribution's status beside a title that wraps", () => {
  const css = read("../src/screens/Profile.css");
  expect(rule(css, ".profile__contribution-list > li")).toMatch(
    /grid-template-columns: minmax\(0, 1fr\)/,
  );
  expect(rule(css, ".profile__contribution-title")).toMatch(
    /overflow-wrap: anywhere;/,
  );
  expect(rule(css, ".profile__contribution-status")).toMatch(
    /white-space: nowrap;/,
  );
});
