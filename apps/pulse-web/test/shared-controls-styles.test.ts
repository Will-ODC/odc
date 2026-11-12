import { readFileSync, readdirSync } from "node:fs";
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

// #534 part 2: Browse, AccountMenu and ResultsPanel draw their buttons with the
// shared Button and rely on the shared ring (`.btn:focus-visible`, App.css).
const part2 = [
  ["screens/Browse.tsx", "screens/Browse.css"],
  ["components/AccountMenu.tsx", "components/AccountMenu.css"],
  ["components/ResultsPanel.tsx", "components/ResultsPanel.css"],
] as const;

it.each(part2)("%s builds no button of its own", (tsx) => {
  const source = read(`../src/${tsx}`);
  expect(source).not.toMatch(/<button[\s>]/);
  expect(source).toMatch(/<Button\b/);
});

it.each(part2)("%s's stylesheet copies no focus ring", (_tsx, css) => {
  const sheet = read(`../src/${css}`);
  // Any rule for a :focus-visible state that sets any outline property,
  // offset included: an offset-only rule is still a local copy of the ring.
  const copies = [...sheet.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /outline(-[a-z]+)?\s*:/.test(body!))
    .map(([, selector]) => selector!.trim());
  expect(copies).toEqual([]);
  expect(sheet).not.toMatch(/outline:\s*\d+px/);
});

it("keeps the account trigger plain text in the banner, not an underlined quiet button", () => {
  const css = read("../src/components/AccountMenu.css");
  const rule = /\.banner \.account-menu__button \{([^}]*)\}/.exec(css)?.[1];
  expect(rule).toBeDefined();
  // Two classes outrank `.btn--quiet`; `font: inherit` resets its weight.
  expect(rule).toContain("font: inherit;");
  expect(rule).toContain("font-size: var(--t-small);");
  expect(rule).toContain("color: var(--ink-soft);");
  expect(rule).toContain("text-decoration: none;");
});

it("keeps screen retry and shared Load more controls aligned under their lists", () => {
  const browse = read("../src/screens/Browse.css");
  expect(browse).not.toMatch(/\.btn\.browse__action/);
  expect(browse).toMatch(
    /\.browse__main > \.browse__action \{\s*display: block;\s*margin: calc\(var\(--step\) \* 2\) auto 0;\s*\}/,
  );
  const myVotes = read("../src/screens/MyVotes.css");
  expect(myVotes).toMatch(
    /\.my-votes__action \{\s*display: block;\s*margin: calc\(var\(--step\) \* 2\) 0 0;\s*\}/,
  );
  const loadMore = read("../src/components/LoadMore.css");
  expect(loadMore).toMatch(
    /\.load-more \{\s*margin: calc\(var\(--step\) \* 2\) auto 0;\s*text-align: center;/,
  );
  expect(loadMore).toMatch(
    /\.load-more > \.load-more__button \{\s*display: flex;\s*margin-inline: auto;/,
  );
});

it("keeps the results toggle borderless and ClosedResults' Close small", () => {
  const css = read("../src/components/ResultsPanel.css");
  const toggle = /\.results \.results__toggle \{([^}]*)\}/.exec(css)?.[1];
  expect(toggle).toBeDefined();
  expect(toggle).toContain("border: none;");
  expect(toggle).toContain("background: none;");
  expect(toggle).toContain("text-decoration: none;");
  expect(toggle).toContain("font-size: var(--t-small);");
  // ResultsPanel's own Close went in #569; ClosedResults' plain one remains.
  expect(css).not.toContain(".btn.results__close");
  expect(css).toMatch(
    /\n\.results__close \{\s*position: absolute;[^}]*padding: var\(--step\);/,
  );
});

// #569: one small secondary button. Explore, My votes, the rail and the
// account menu use the shared Button's small size, and the `.button` utility
// (with its own focus ring) is gone.
it("draws the small secondary size from tokens, after the rules it overrides", () => {
  const css = read("../src/components/Button.css");
  const small = /\.btn--small \{([^}]*)\}/.exec(css)?.[1];
  expect(small).toBeDefined();
  expect(small).toContain("font-size: var(--t-small);");
  expect(small).toContain("padding: var(--step) calc(var(--step) * 2);");
  expect(small).not.toMatch(/\d+px/);
  expect(css).toMatch(
    /\.btn--small:hover:not\(:disabled\) \{\s*background: var\(--hover\);\s*\}/,
  );
  // Muted text while loading, not the shared variant's faded button.
  expect(css).toMatch(
    /\.btn--small:disabled \{\s*opacity: 1;\s*color: var\(--muted\);\s*\}/,
  );
  // Same specificity as what they override, so they must come later.
  const at = (s: string) => css.indexOf(s);
  expect(at(".btn--small {")).toBeGreaterThan(at(".btn--secondary {"));
  expect(at(".btn--small:disabled")).toBeGreaterThan(at(".btn:disabled"));
  // The 44px phone target is the secondary variant's, which small always is.
  expect(phoneRules(css)).toMatch(
    /\.btn--secondary \{[^}]*min-height: var\(--touch\);/,
  );
});

const small = [
  "screens/Browse.tsx",
  "screens/MyVotes.tsx",
  "components/LoadMore.tsx",
  "components/AnsweredRail.tsx",
  "components/SiteBanner.tsx",
] as const;

it.each(small)(
  "%s uses the small shared Button, not the old utility",
  (tsx) => {
    const source = read(`../src/${tsx}`);
    expect(source).not.toMatch(/<button[\s>]/);
    expect(source).not.toMatch(/className=["'{`][^"'}`]*\bbutton\b/);
    expect(source).toMatch(/<Button\b[^>]*\bsize="small"/);
  },
);

it("has no `.button` utility left, focus ring included", () => {
  const css = read("../src/styles/utilities.css");
  expect(css).not.toMatch(/\.button\b/);
  expect(css).not.toContain(":focus-visible");
  // Nowhere in the app: no stylesheet rule for it, no element wearing it.
  const files = readdirSync(new URL("../src/", import.meta.url), {
    recursive: true,
  })
    .map(String)
    .filter((file) => /\.(css|tsx?)$/.test(file));
  expect(files).toContain("screens/MyVotes.tsx");
  const users = files.filter((file) =>
    /\.button(?![-\w])|className=["'`][^"'`]*(?<![-\w])button(?![-\w])/.test(
      read(`../src/${file}`),
    ),
  );
  expect(users).toEqual([]);
});
