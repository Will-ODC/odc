import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// jsdom cannot lay out media queries or paint outlines; assert the rules (#534).
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

// The body of the phone media block, found by brace matching so a later block
// or a trailing rule cannot leak in or be cut off.
const phoneRules = (css: string) => {
  const start = css.indexOf("@media (max-width: 699px)");
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unclosed phone media block");
};

it("gives only the boxed buttons a full-height touch target on a phone", () => {
  const phone = phoneRules(read("../src/components/Button.css"));
  expect(phone).toMatch(
    /\.btn--primary,\s*\.btn--secondary \{\s*display: flex;[^}]*min-height: var\(--touch\);/,
  );
  // A quiet button sits inside a sentence ("… Change") and must stay inline.
  expect(phone).not.toMatch(/(^|[\s,{])\.btn\s*[,{]/);
  expect(phone).not.toContain(".btn--quiet");
});

it("draws a quiet button's focus ring square, as the text links it replaced", () => {
  expect(read("../src/components/Button.css")).toMatch(
    /\.btn--quiet \{[^}]*border-radius: 0;/,
  );
});

it("keeps the new-poll community name and promise row as before", () => {
  const css = read("../src/screens/NewPoll.css");
  expect(css).toMatch(
    /\.post__lede b \{\s*color: var\(--ink-soft\);\s*font-weight: 600;/,
  );
  expect(css).toMatch(/\.post__title:focus \{\s*outline: none;/);
  expect(phoneRules(css)).toMatch(
    /\.post__optin \{\s*min-height: var\(--touch\);\s*align-items: center;/,
  );
});

it("styles the info button above the shared secondary variant, whatever the import order", () => {
  const css = read("../src/screens/NewPoll.css");
  // Bare `.post__info` ties with `.btn--secondary`; the pair must outrank it.
  expect(css).not.toMatch(/(^|\n)\.post__info(\s|:|,|\{)/);
  expect(css).toMatch(/\.btn\.post__info \{/);
});
