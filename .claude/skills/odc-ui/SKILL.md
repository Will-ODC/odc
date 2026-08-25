---
name: odc-ui
description: How to build ODC user-facing code — where components live, the reuse rules, the four view states every view owes, design tokens, forms, the accessibility floor, UI tests, and the plain-language dictionary. Use this skill whenever building or modifying any page, screen, component, hook, form, or user-visible string — including error messages, empty states, and button labels — even for small tweaks, in apps/pulse-web or services/web. For which mockup is the design of record and how to author one, use odc-design.
---

# ODC UI — Implementation

Audience: an average citizen, not a developer. The implementation plan demands
that complexity stays inside while the surface speaks plain nouns and verbs;
the UI is where that promise is kept or broken.

Everything here applies to both clients **except** the last two sections
(plain-language dictionary, trust affordances), which are charter-side and
belong to `services/web` only.

| Surface          | What it is                                      | Status                                 |
| ---------------- | ----------------------------------------------- | -------------------------------------- |
| `apps/pulse-web` | Pulse's story client, charter-EXEMPT            | **Live** — where UI work happens today |
| `services/web`   | The charter-governed human client               | Phase 2, not started                   |
| `docs/mockups/`  | Hand-authored HTML decks — the design of record | See `odc-design`                       |

## The stack you are writing against (`apps/pulse-web`)

React 19 · Vite 7 · TypeScript · vitest 3. Three modules already exist, are
pure and tested, and decide things the screens only render:

| Module              | What it gives you                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/flow/story.ts` | `Step` union, `steps` / `nextStep` / `previousStep` / `progress`, `toggleChoice`, `isValidBallot`, `isCastable`, `castLabel` |
| `src/api/types.ts`  | `Poll`, `Ballot = number[]`, `Results`, `CastOutcome`, `Me`, `PulseApi`, `ApiError`                                          |
| `src/api/http.ts`   | `HttpPulseApi` — since #118 the only implementation of `PulseApi`                                                            |

Facts that will bite you if you assume otherwise:

- **There is no app yet.** No `index.html`, no `src/main.tsx`, no component of
  any kind; `build` is `tsc --noEmit` and nothing bundles. The first UI branch
  ships the runnable shell before it ships any screen.
- `tsconfig` is `strict` **plus** `exactOptionalPropertyTypes` (omit an
  optional prop, never pass `undefined`), `noUncheckedIndexedAccess`
  (`items[0]` is `T | undefined`), and `verbatimModuleSyntax` (`import type`).
- ESLint is **root flat config only** (`eslint.config.mjs`); a nested config
  under `apps/pulse-web` is silently ignored. React or a11y rules go in the
  root file.
- Dev is same-origin on purpose: vite proxies `/api` → `localhost:8080`
  (`apps/pulse/src/dev-server.ts`). The session cookie depends on it — never
  point the client at an absolute API origin.
- Component tests need `@testing-library/react` and `jsdom` added, and
  vitest's environment set to `jsdom`. Neither is installed today; the
  existing tests are pure-logic.

## Where code goes

```
src/
  main.tsx          entry — mounts <App>, nothing else
  App.tsx           picks the screen for the current Step; owns no screen markup
  screens/          one file per Step: Claim, Sent, Bite, Vote, Results, Action
  components/       reusable, screen-agnostic pieces
  hooks/            state + effects (use-poll.ts, use-cast-vote.ts)
  api/  flow/       already exist — pure, no React
  styles/tokens.css the one token file
```

Names: components `PascalCase.tsx`, hooks `use-kebab-case.ts`, tests beside
the unit as `Thing.test.tsx`. Direction of imports is one-way: screens import
components; **components never import screens**, and nothing in `components/`
imports from `api/`.

## Reusable components — the rules

1. **One purpose per file.** If the name needs an "and", it is two components.
2. **Presentational by default.** Anything in `components/` takes props and
   returns markup. It does not fetch, does not touch `PulseApi`, does not read
   global state. Data enters at the screen, which gets it from a hook.
3. **No logic in JSX.** Past a single ternary, it moves — pure decisions to
   `flow/`, stateful ones to a hook. `story.ts` is the precedent: the screen
   renders the decision, it does not make it.
4. **Name for what it is, not where it sits.** `<ChoiceRow>`, never
   `<VoteScreenChoiceRow>` — a screen-specific name is a promise that you will
   copy it next time instead of reusing it.
5. **Compose; do not accumulate flags.** Two booleans that can't both be true
   are one `variant` union. A third boolean that changes layout means you want
   `children` or a slot prop, not another flag.
6. **Props are a public API.** Explicit unions, no `any`, no spreading unknown
   props onto DOM nodes. Callbacks are named for the person's act — `onPick`,
   `onCast`, `onChangeVote` — never `onClick2`.
7. **Controlled, not clever.** A component holds no state its parent needs to
   know about. If the parent must react to it, it is a prop plus a callback.
8. **Tokens only.** No hex, no magic pixels, no one-off font sizes inside a
   component (see below).
9. **Extract on the second use.** One use with a plausible second is a
   candidate, not a component — do not abstract a shape you have seen once.
   Two uses is a component, and the second use is what proves the prop API.

The seven pulse screens share these seams; build them as components the first
time a second screen needs one, and check here before inventing a new name:

| Component       | Used by                                      |
| --------------- | -------------------------------------------- |
| `ScreenFrame`   | every screen — the phone-sized pane          |
| `Chip`          | "Official Ballot · Closes Friday", "Counted" |
| `PrimaryButton` | Continue / Cast / Change it                  |
| `ChoiceRow`     | vote, already-voted, closed states           |
| `ResultBar`     | results (count · %)                          |
| `StatPair`      | bite 2, results                              |
| `SwipeDeck`     | the left/right vote container                |
| `FinePrint`     | "reactions are opinion, not a vote"          |

## Every view owes four states — no exceptions

`loading` · `empty` (with a next step, never a blank) · `error` (one plain
sentence: what happened and what to do) · `content`.

Write them **once**: a hook returns a discriminated union
(`{ status: "loading" } | { status: "error"; message } | …`) and one shared
component renders the three non-content branches around `children`. Four
hand-rolled `isLoading &&` ladders in four screens is the failure this rule
exists to prevent. A component PR without all four states is incomplete.

## Design tokens

One file, `src/styles/tokens.css`, seeded once from the `:root` block in
`docs/mockups/pulse-screens/_screens.css` (colors, radii, shadow, type scale)
and thereafter the source for the app. Components reference `var(--…)` only.
Changing a value is a token edit, never a component edit.

The palette question is genuinely open: mockup screen 1 (`01-claim.html`) is
dark and carries its own page chrome, screens 2–7 are the light Civic Glass
set from `_screens.css`, and nothing in the repo records whether the whole deck
goes dark. Do not silently pick one — see `odc-design`, and record the answer
before building screens in a palette that isn't decided.

## Forms and binding actions

- Label every field. Validate inline on blur, not on every keystroke.
- Error text sits beside its field and says what to do next.
- Disable submit while pending; never let a double-tap cast twice.
- **Always confirm a destructive or binding action** — "You're voting YES
  on… — confirm?" Picking and casting are separate presses.
- A vote is changeable until close: `changed` is a normal outcome, not an
  error, and the UI says so plainly rather than treating it as a correction.

## Accessibility floor

Semantic HTML first, visible focus states, 4.5:1 contrast, alt text, full
keyboard operability. **Keyboard-only pass before merging any interactive
component** — no exceptions for "it's just a card".

Gestures are an addition, never the only path: every swipe or drag has an
equivalent tap target and an arrow-key path (`01-claim.html` already wires
pointer drag, tap-a-half, and ←/→). Animation respects
`prefers-reduced-motion`.

## Testing UI

`odc-testing` governs; this is the UI-specific part of it.

- Test behavior through the rendered output — what a person sees and can do.
  No snapshot tests of markup, no testing React itself.
- Every screen test covers the four states and the keyboard path.
- Stub the API with a plain object typed to `PulseApi` (private fields make it
  nominally typed, so a plain object satisfies it) or drive the real
  `HttpPulseApi` with a fake `fetch`. Pick one per suite and stay consistent —
  whether `PulseApi` survives as an interface depends on which one wins.
- Pure decisions stay in `flow/` where they are cheap to test exhaustively;
  a screen test should not be re-testing `isCastable`.

## Plain-language dictionary (`services/web` only)

| Never show                     | Show instead                 |
| ------------------------------ | ---------------------------- |
| keypair, public key, signature | "your account" / "signed in" |
| event, event log, append       | "the public record"          |
| hash chain, hash, NDJSON       | "tamper-proof record"        |
| participant_id, pseudonym      | "your voting name"           |
| tally derivation               | "results"                    |
| verify the export              | "check the record yourself"  |

Keys are generated, stored and used invisibly: "Sign up" creates a keypair,
"Vote" signs an event, and the user is told neither unless they open an
"Advanced" section, where export-your-key lives for the curious.

**Pulse goes further, not less far.** Its rule is that the counting is never
the subject at all — it does not translate "hash chain" into "tamper-proof
record", it never raises the topic. Do not port the trust affordances or the
"check the record yourself" link into pulse: there is no verifier there and
saying otherwise would be a lie. See `apps/pulse/CLAUDE.md`.

## Trust affordances (`services/web` only — product requirements, not decoration)

- Results pages always link "check the record yourself" → export download,
  plus a one-paragraph plain explanation of what the verifier proves.
- Anything monetizable (future sentiment instruments) is visually
  unmistakable from governance, with the consent sentence at the point of
  action — per the charter, never buried in settings.

## Hub feed rules (post-MVP — do not build a feed before it is planned)

- Three lanes, unmistakable at a glance: Opinion (quiet neutral chip), Ballot
  (accent border — the only emphasized card class), Action (success-tinted
  chip). One-tap interaction exists ONLY on opinion cards.
- **Binding actions never execute from feed context.** Ballot and action cards
  are navigational doors only ("Read briefing and vote", "View on board");
  voting and claiming happen on their own pages, with confirmation, in slow
  mode.
- Ballots are surfaced deterministically (pinned open-ballots bar, deadline
  reminders), never left to feed ranking. Sentiment-lane sort orders are
  user-selectable and transparent; no engagement-optimized default.
- Opinion cards state their nature in fine print: reactions are opinion, not a
  vote.

## Before you open a PR

- [ ] Four states present in every view the diff touches.
- [ ] No hex, no magic pixels, no inline font sizes — tokens only.
- [ ] Nothing in `components/` fetches, imports `api/`, or names a screen.
- [ ] Logic lives in `flow/` or a hook; JSX renders.
- [ ] Keyboard-only pass done; gestures have a key and tap equivalent.
- [ ] Binding actions confirm; submit disables while pending.
- [ ] Copy passes the dictionary (`services/web`) or never mentions counting
      machinery (pulse).
- [ ] Tests per `odc-testing`: behavior, four states, keyboard path.
