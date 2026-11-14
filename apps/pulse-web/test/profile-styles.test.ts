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
