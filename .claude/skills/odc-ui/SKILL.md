---
name: odc-ui
description: How to build ODC user-facing code — where components live, the reuse rules, the four view states every view owes, design tokens, forms, the accessibility floor, UI tests, and what Pulse copy may claim. Use this skill whenever building or modifying any page, screen, component, hook, form, or user-visible string — including error messages, empty states, and button labels — even for small tweaks, in apps/pulse-web or services/web (whose plain-language dictionary and trust rules are in services-web.md here). For which mockup is the design of record and how to author one, use odc-design.
---

# ODC UI — Implementation

Audience: an average citizen, not a developer. Complexity stays inside; the
surface speaks plain nouns and verbs.

| Surface          | What it is                                      | Status                                 |
| ---------------- | ----------------------------------------------- | -------------------------------------- |
| `apps/pulse-web` | Pulse's conversation client, charter-EXEMPT     | **Live** — where UI work happens today |
| `services/web`   | The charter-governed human client               | Phase 2, not started                   |
| `docs/mockups/`  | Hand-authored HTML decks — the design of record | See `odc-design`                       |

Building `services/web`? Read `services-web.md` in this folder.

## The stack (`apps/pulse-web`)

React 19 · Vite 7 · TypeScript · vitest 4. Read the existing screens before
adding one — most of what a new screen needs is already a component. These
pure, tested modules decide things the screens only render:

| Module                     | What it gives you                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `src/flow/route.ts`        | `Route` union and `routeFrom` / `pathOf` — current URL routing                      |
| `src/flow/conversation.ts` | Conversation state, saved answers and next-question decisions                       |
| `src/api/types.ts`         | `Poll`, `Ballot = number[]`, `Results`, `CastOutcome`, `Me`, `PulseApi`, `ApiError` |
| `src/api/http.ts`          | `HttpPulseApi` — the only implementation of `PulseApi`                              |

Facts that will bite you:

- `tsconfig` is `strict` **plus** `exactOptionalPropertyTypes` (omit an
  optional prop, never pass `undefined`), `noUncheckedIndexedAccess`
  (`items[0]` is `T | undefined`), and `verbatimModuleSyntax` (`import type`).
- ESLint is **root flat config only** (`eslint.config.mjs`); a nested config
  under `apps/pulse-web` is silently ignored.
- Dev is same-origin on purpose: vite proxies `/api` → `localhost:8080`. The
  session cookie depends on it — never point the client at an absolute API
  origin.
- Component tests use `@testing-library/react` + `user-event` under `jsdom`.
  `test/stub-api.tsx` gives you a `PulseApi` stub and poll/results fixtures —
  use it rather than hand-rolling another.

## Where code goes

```
src/
  main.tsx          entry — mounts <App>, nothing else
  App.tsx           picks the screen for the current Route; owns no screen markup
  screens/          one file per screen; route.ts defines the current routes
  components/       reusable, screen-agnostic pieces
  hooks/            state + effects, including all fetching
  api/  flow/       pure, no React
  styles/tokens.css the one token file
```

Names: components `PascalCase.tsx`, hooks `use-kebab-case.ts`; tests in
`apps/pulse-web/test/` as `Thing.test.tsx` or `thing.test.ts`. Cross-package
real-HTTP suites live in `tests/pulse-integration/` and grant production code
no permission to import the server. Imports run one way: screens import
components; **components never import screens** (nor a stylesheet from
`screens/`).

## Reusable components — the rules

1. **One purpose per file.** If the name needs an "and", it is two components.
2. **Presentational by default.** Components may `import type` from
   `api/types`; they never call the API or receive `api` as a prop — fetching
   lives in `hooks/`. Components never import a stylesheet from `screens/`.
   Data enters at the screen, which gets it from a hook. (Current exceptions
   are being removed under #653.)
3. **No logic in JSX.** Past a single ternary, it moves — pure decisions to
   `flow/`, stateful ones to a hook.
4. **Name for what it is, not where it sits.** `<ChoiceRow>`, never
   `<VoteScreenChoiceRow>`.
5. **Compose; do not accumulate flags.** Two booleans that can't both be true
   are one `variant` union. A third boolean that changes layout means you want
   `children` or a slot prop.
6. **Props are a public API.** Explicit unions, no `any`, no spreading unknown
   props onto DOM nodes. Callbacks are named for the person's act — `onPick`,
   `onCast`, `onChangeVote`.
7. **Controlled, not clever.** A component holds no state its parent needs to
   know about; that is a prop plus a callback.
8. **Tokens only.** No hex, no magic pixels, no one-off font sizes.
9. **Extract on the second use.** One use is a candidate, not a component; the
   second use is what proves the prop API.

Inspect `src/components/` before adding a shared piece (`ScreenFrame`,
`ViewState`, `VoteCard`, `ResultsPanel`, `CopyLink`, `BarChart`, …).

**Charts (ADR-0045):** draw every chart with `BarChart` (or a sibling beside
it), the only file that imports Recharts. It takes plain data, so map domain
data to it in `flow/` (e.g. `flow/results-chart.ts`); colours come from the
`--chart-*` tokens, and it renders a hidden data table for screen readers. Read
the `dataviz` skill before adding a chart or a series colour.

## Every view owes four states — no exceptions

`loading` · `empty` (with a next step, never a blank) · `error` (one plain
sentence: what happened and what to do) · content.

Write them **once**: a hook returns `ViewData<T>` (`src/hooks/view-data.ts`;
the content branch is `status: "ready"`) and `<ViewState>` renders the three
non-content branches around `children`. Hand-rolled `isLoading &&` ladders are
the failure this rule exists to prevent. A component PR without all four
states is incomplete.

## Design tokens

`src/styles/tokens.css` is the app's token source. Components reference
`var(--…)` only; changing a value is a token edit, never a component edit. For
visual direction, see `odc-design`.

## Forms and binding actions

- Label every field. Validate inline on blur, not on every keystroke.
- Error text sits beside its field and says what to do next.
- Disable submit while pending; never let a double-tap cast twice.
- **Always confirm a destructive or binding action.** Picking and casting are
  separate presses: Pulse's card uses pick-then-Submit (ADR-0035). ADR-0022's
  one-press exception described the retired swipe ballot; do not apply it to
  the conversation card or AI-app voting.
- A vote is changeable until close: `changed` is a normal outcome, not an
  error, and the UI says so plainly.

## Accessibility floor

Semantic HTML first, visible focus states, 4.5:1 contrast, alt text, full
keyboard operability. **Keyboard-only pass before merging any interactive
component** — no exceptions for "it's just a card".

Gestures are an addition, never the only path: every swipe or drag has a tap
target and an arrow-key path (the current card supports numbered keys and
ordinary form controls). Animation respects `prefers-reduced-motion`.

## Testing UI

`odc-testing` governs; this is the UI-specific part.

- Test behavior through the rendered output — what a person sees and can do.
  No snapshot tests of markup, no testing React itself.
- Every screen test covers the four states and the keyboard path.
- Stub the API with a plain object typed to `PulseApi` (`test/stub-api.tsx`) or
  drive the real `HttpPulseApi` with a fake `fetch`. Pick one per suite.
- Pure decisions stay in `flow/` where they are cheap to test exhaustively; a
  screen test should not re-test `isCastable`.

## Pulse copy: explain, never claim more than is built

Since 2026-10-12 (ADR-0039) pulse may explain how votes are counted, in plain
language, on its "Why you can trust your vote" page (`/trust`), where each term
such as "hash" is explained in a sentence where it first appears. What it must
never do is say or imply that pulse votes are on a hash chain or ledger before
they are. Do not port the trust affordances or the "check the record yourself"
link into pulse until pulse votes are on the ledger: today there is nothing to
check, and saying otherwise would be a lie. See `apps/pulse/CLAUDE.md`.

## Before you open a PR

- [ ] Four states present in every view the diff touches.
- [ ] No hex, no magic pixels, no inline font sizes — tokens only.
- [ ] Nothing in `components/` calls the API, takes `api` as a prop, imports a
      `screens/` stylesheet, or names a screen.
- [ ] Logic lives in `flow/` or a hook; JSX renders.
- [ ] Keyboard-only pass done; gestures have a key and tap equivalent.
- [ ] Binding actions confirm; submit disables while pending.
- [ ] Copy passes the dictionary in `services-web.md` (`services/web`) or never
      claims a hash chain, ledger or check that pulse does not have yet (pulse).
- [ ] Tests per `odc-testing`: behavior, four states, keyboard path.
