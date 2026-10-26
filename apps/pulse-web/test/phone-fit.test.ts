import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Layout that jsdom cannot measure, held by the rule that fixes it.
 *
 * Operator walkthrough, 2026-10-21, on a 375x812 phone: the sign-in screens
 * scrolled 2px sideways and 5px down (`scrollWidth` 377, `scrollHeight` 817),
 * because the frame's 1px border sat outside its `min(390px, 100vw)` width;
 * and the top bar wrapped onto two lines. Measured fixed in headless Chrome
 * at 375x812; these keep the rules from being dropped.
 */
function rule(file: string, selector: string): string {
  const css = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("fitting a phone", () => {
  it("draws the sign-in frame's border inside its size", () => {
    expect(rule("components/ScreenFrame.css", ".screen")).toMatch(
      /box-sizing:\s*border-box/,
    );
  });

  it("floats voting at the bottom right without reserving a full-width row", () => {
    const dock = rule("screens/Conversation.css", ".conversation__dock");
    expect(dock).toMatch(/position:\s*fixed/);
    expect(dock).toContain(
      "right: max(var(--gutter), env(safe-area-inset-right))",
    );
    expect(dock).toContain(
      "bottom: max(var(--gutter), env(safe-area-inset-bottom))",
    );
    expect(dock).toContain("env(safe-area-inset-right)");
    expect(dock).toContain("env(safe-area-inset-bottom)");
    expect(dock).toMatch(/width:\s*min\(/);
    expect(dock).not.toMatch(/border-top:/);
    expect(rule("screens/Conversation.css", ".conversation__scroll")).toMatch(
      /overflow-y:\s*auto/,
    );
    expect(rule("screens/Conversation.css", ".conversation__scroll")).toMatch(
      /padding-bottom:/,
    );
    expect(
      rule("screens/Conversation.css", ".conversation__dock .vote-card"),
    ).toMatch(/overflow-y:\s*auto/);
  });

  it("matches Submit sizing while keeping the floating button prominent", () => {
    const button = rule(
      "screens/Conversation.css",
      ".conversation__help > button",
    );
    expect(button).toContain("background: rgb(var(--side-b))");
    expect(button).toContain("color: var(--ballot-bg)");
    expect(button).toMatch(/font-weight:\s*700/);
    const submit = rule("components/VoteCard.css", ".vote-card button");
    for (const property of ["padding", "font-size"]) {
      const declaration = submit.match(new RegExp(`  ${property}: [^;]+;`))![0];
      expect(button).toContain(declaration);
    }
    expect(button).not.toMatch(/min-(height|width):/);
  });

  it("uses the same bottom-right reveal for the vote button and popout", () => {
    const css = readFileSync(
      new URL("../src/screens/Conversation.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(
      ".conversation__dock .vote-card,\n.conversation__help > button {",
    );
    expect(css).toContain("transform-origin: bottom right");
    expect(css).toContain(
      "animation: voting-reveal var(--motion-quick) ease-out",
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/,
    );
  });

  it("keeps the top bar's controls on one line", () => {
    expect(rule("components/TopBanner.css", ".banner__actions")).toMatch(
      /flex-wrap:\s*nowrap/,
    );
  });
});

it("aligns the communities disclosure with the navigation links", () => {
  expect(rule("components/TopBanner.css", ".banner__nav")).toMatch(
    /align-items:\s*center/,
  );
  const disclosure = rule(
    "components/TopBanner.css",
    ".banner__nav > .account-menu",
  );
  expect(disclosure).toMatch(/display:\s*flex/);
  expect(disclosure).toMatch(/align-items:\s*center/);
});
