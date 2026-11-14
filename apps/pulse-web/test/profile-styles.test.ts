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

it("lines the visibility legend up with the field labels", () => {
  expect(
    rule(read("../src/screens/Profile.css"), ".profile__visibility legend"),
  ).toMatch(/padding: 0;/);
});

it("draws a refused save in the error colour", () => {
  expect(
    rule(read("../src/screens/Profile.css"), ".profile__status--error"),
  ).toMatch(/color: var\(--red\);/);
});

it("gives Your profile its own row, styled as the Sign out link", () => {
  const css = read("../src/components/SignedIn.css");
  expect(rule(css, ".signed-in__row")).toMatch(/flex-basis: 100%;/);
  const link = rule(css, ".signed-in__profile");
  expect(link).toMatch(/color: var\(--muted\);/);
  expect(link).toMatch(/text-decoration: underline;/);
  expect(link).not.toMatch(/font-weight|--green/);
});

it("sizes profile list headings as contribution section headings", () => {
  const heading = /font-size: var\(--t-brand\);/;
  expect(
    rule(read("../src/screens/Contributions.css"), ".contributions-page h2"),
  ).toMatch(heading);
  expect(
    rule(read("../src/screens/Profile.css"), ".profile__contributions h2"),
  ).toMatch(heading);
});

it("keeps a contribution's status beside a title that wraps", () => {
  const css = read("../src/screens/Profile.css");
  const row = rule(css, ".profile__contribution-list > li");
  expect(row).toMatch(/display: grid;/);
  expect(row).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto;/);
  expect(rule(css, ".profile__contribution-title")).toMatch(
    /overflow-wrap: anywhere;/,
  );
  expect(rule(css, ".profile__contribution-status")).toMatch(
    /white-space: nowrap;/,
  );
  expect(rule(css, ".profile__manage-links")).toMatch(/grid-column: 1 \/ -1;/);
  // The manage links are small secondary buttons, which take the full touch
  // height at phone width; no smaller text size is set on them here.
  expect(rule(css, ".profile__manage-links")).not.toMatch(/font-size/);
  expect(read("../src/components/Button.css")).toMatch(
    /@media \(max-width: 699px\)\s*\{\s*\.btn--primary,\s*\.btn--secondary\s*\{[^}]*min-height: var\(--touch\);/,
  );
});
