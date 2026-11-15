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
    /\.btn--primary,\s*\.btn--secondary \{[^}]*min-height: var\(--touch\);/,
  );
  // A quiet button sits inside a sentence ("… Change") and must stay inline.
  expect(phone).not.toMatch(/(^|[\s,{])\.btn\s*[,{]/);
  expect(phone).not.toContain(".btn--quiet");
});

it("gives the new-poll promise row a full touch target on a phone", () => {
  expect(phoneRules(read("../src/screens/NewPoll.css"))).toMatch(
    /\.post__optin \{[^}]*min-height: var\(--touch\);/,
  );
});

it("styles the info button above the shared secondary variant, whatever the import order", () => {
  const css = read("../src/screens/NewPoll.css");
  // Bare `.post__info` ties with `.btn--secondary`; the pair must outrank it.
  expect(css).not.toMatch(/(^|\n)\.post__info(\s|:|,|\{)/);
  expect(css).toMatch(/\.btn\.post__info \{/);
});

// #534 part 2: Browse, AccountMenu and ResultsPanel draw their buttons with the
// shared Button and rely on the shared ring (`:focus-visible`, App.css).
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
  expect(rule).toContain("text-decoration: none;");
});

it("keeps Browse free of My votes' copies of the retry styles", () => {
  const browse = read("../src/screens/Browse.css");
  expect(browse).not.toMatch(/\.btn\.browse__action/);
  // My votes keeps its own copies in MyVotes.css; Browse holds none of them.
  expect(browse).not.toMatch(/browse__main--message/);
});

// #569: one small secondary button. Explore, My votes, the rail and the
// account menu use the shared Button's small size, and the `.button` utility
// (with its own focus ring) is gone.
it("draws the small secondary size without fixed pixels, after the rules it overrides", () => {
  const css = read("../src/components/Button.css");
  const small = /\.btn--small \{([^}]*)\}/.exec(css)?.[1];
  expect(small).toBeDefined();
  expect(small).not.toMatch(/\d+px/);
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
    expect(source).toMatch(
      /<Button\b[^>]*\bsize="small"|<ViewState\b[^>]*\bonRetry=/,
    );
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

it("defines the focus ring once, including choice wrappers and saved-answer focus", () => {
  const app = read("../src/App.css");
  expect(app).toContain(":focus-visible,");
  expect(app).toContain(".choice:has(input:focus-visible)");
  expect(app).toContain(".vote-card__choice:has(input:focus-visible)");
  expect(app).toContain('.vote-card__yours[tabindex="-1"]:focus');
  const files = readdirSync(new URL("../src/", import.meta.url), {
    recursive: true,
  })
    .map(String)
    .filter((file) => file.endsWith(".css"));
  const rings = files.filter((file) =>
    /outline:\s*var\(--focus-ring-width\) solid var\(--focus\)/.test(
      read(`../src/${file}`),
    ),
  );
  expect(rings).toEqual(["App.css"]);
  // Even a non-focus selector can outrank the shared :focus-visible rule.
  // Only these announcement targets and unfocused validation rings may own
  // outlines outside App.css, each in its own file. Check each selector in a
  // grouped rule.
  const allowed = new Set([
    "components/IntroPage.css: .welcome h1:focus",
    "components/VoteCard.css: .vote-card__note:focus",
    "screens/SignIn.css: .signin__title:focus",
    "screens/NewPoll.css: .post__title:focus",
    "screens/Conversation.css: .conversation__hero h1:focus",
    "components/ResultsPanel.css: .results:focus",
    'screens/NewPoll.css: .post__promise input[aria-invalid="true"]:not(:focus-visible)',
    'screens/Contributions.css: .contribution-check input[aria-invalid="true"]:not(:focus-visible)',
  ]);
  const sharedSelectors = new Set([
    ":focus-visible",
    ".choice:has(input:focus-visible)",
    ".vote-card__choice:has(input:focus-visible)",
    '.vote-card__yours[tabindex="-1"]:focus',
    ".choice input:focus-visible",
    ".vote-card__choice input:focus-visible",
  ]);
  const overrides = files.flatMap((file) =>
    [
      ...read(`../src/${file}`)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ]
      .filter(([, , body]) => /(?:^|;)\s*outline(?:-[a-z-]+)?\s*:/.test(body!))
      .flatMap(([, selectors]) =>
        selectors!.split(",").map((selector) => selector.trim()),
      )
      .filter((selector) =>
        file === "App.css"
          ? !sharedSelectors.has(selector)
          : !allowed.has(`${file}: ${selector}`),
      )
      .map((selector) => `${file}: ${selector}`),
  );
  expect(overrides).toEqual([]);
});

it.each([
  ["components/Button.css", '.btn[aria-disabled="true"]:focus-visible'],
  [
    "components/VoteCard.css",
    '.vote-card button[aria-disabled="true"]:focus-visible',
  ],
  [
    "components/TwoPress.css",
    '.two-press__action--primary[aria-disabled="true"]:focus-visible',
  ],
])(
  "%s keeps a keyboard-focused unavailable button's ring at full strength",
  (file, selector) => {
    const css = read(`../src/${file}`);
    const body = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    expect(body).toContain("opacity: 1;");
  },
);

it.each(["close", "dismiss"])(
  "mutes the unavailable .vote-card__%s without fading its focus ring",
  (name) => {
    const css = read("../src/components/VoteCard.css");
    const selector = `.vote-card button.vote-card__${name}[aria-disabled="true"]`;
    const body = [
      ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ].find(([, selectors]) =>
      selectors!
        .split(",")
        .map((s) => s.trim())
        .includes(selector),
    )?.[2];
    expect(body).toContain("color: var(--muted);");
    expect(body).not.toContain("opacity:");
  },
);

it.each([
  ["screens/NewPoll.css", '.post__promise input[aria-invalid="true"]'],
  [
    "screens/Contributions.css",
    '.contribution-check input[aria-invalid="true"]',
  ],
])(
  "%s visibly separates focused invalid checkboxes from unfocused errors",
  (file, selector) => {
    const css = read(`../src/${file}`);
    const body = (state: string) => {
      const start = `${selector}${state} {`;
      expect(css).toContain(start);
      return css.slice(css.indexOf(start) + start.length).split("}")[0];
    };
    const focused = body(":focus-visible");
    const unfocused = body(":not(:focus-visible)");
    // Keep the shared red ring, but double its gap when keyboard focus arrives.
    expect(focused).toContain("--focus: var(--red);");
    expect(focused).toContain(
      "--focus-ring-offset: calc(var(--hairline) * 4);",
    );
    expect(unfocused).toContain("outline-offset: var(--focus-ring-offset);");
    expect(unfocused).not.toContain("--focus-ring-offset:");
    expect(read("../src/styles/tokens.css")).toContain(
      "--focus-ring-offset: calc(var(--hairline) * 2);",
    );
  },
);

it("draws one ring around a focused choice, without a second ring on its input", () => {
  const app = read("../src/App.css");
  expect(app).toMatch(
    /\.choice input:focus-visible,\s*\.vote-card__choice input:focus-visible \{\s*outline: none;\s*\}/,
  );
});

it.each([
  [
    "screens/NewPoll.css",
    '.post__promise input[aria-invalid="true"]:focus-visible',
  ],
  [
    "screens/Contributions.css",
    '.contribution-check input[aria-invalid="true"]:focus-visible',
  ],
  [
    "components/Field.css",
    '.field__control[aria-invalid="true"]:focus-visible',
  ],
])("%s keeps invalid controls' focused rings red", (file, selector) => {
  const css = read(`../src/${file}`);
  const body = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
  expect(css).toContain(`${selector} {`);
  expect(body).toContain("--focus: var(--red);");
});
