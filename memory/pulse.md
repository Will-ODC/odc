# Pulse — Build State

> Session-to-session truth for the `apps/pulse` + `apps/pulse-web` workstream.
> Read `memory/INDEX.md` first. Agent rules are in `apps/pulse/CLAUDE.md`, the
> served API is in `apps/pulse/API.md`, and the work queue is GitHub
> issues (design detail an issue links to is in `docs/plans/pulse.md`). This file holds current state only, and history is in
> git. Slimmed 2026-10-10. The long ledger it replaced is in
> `git log -p -- memory/pulse.md`.
>
> The operator's development-feedback loop, the confirmed-voter requirement, the
> trust and reporting decisions, and the contained tickets #227-#238 are in
> **`memory/pulse-development.md`**. None of them is implemented yet.

## What pulse is

A community votes on something and sees the result. Someone signs in with an
emailed link, walks a short run of questions, votes, and is told what action
follows. The three MVP pillars, in build order, are **magic-link identity**, the
**one-screen story UI**, and the **path to action**.

## Charter exemption — do not "fix" this

**Pulse is exempt from `docs/charter.md`** by operator decision
(`apps/pulse/CLAUDE.md`). It has no keypairs, no signatures, no hash chain and no
verifier. Votes are a plain, **mutable** record. Do not flag this as a violation,
and do not import charter machinery into `apps/**`. Two boundaries still hold
absolutely:

- **No reads or writes into `services/` or `contracts/`.** Any future ledger
  publication goes through the ledger's public HTTP API.
- **Counting is never the subject.** UI copy never mentions hashes, chains,
  verification or how a tally is computed.

Repo discipline still applies: tests ship with the change, there is one small
branch per change, named for its ticket (`pulse/<issue>-<short>`, #310), and
the same CI runs.

## Where it stands (2026-10-10)

- **Pillar 1 (identity) is built.** Magic-link sign-in and redeem (#81-#87,
  #116, #149). Open sign-up lets anyone sign in, and community is an optional
  label (#182/#183, ADR-0030). The person picks their community when an address
  matches several (P2, #215). Identity is a credential (P8 slice 1, #213,
  ADR-0033). A failed send frees the live-link cap (P4a, #207). A person's
  community is fixed when they ask for a link, and #208 has a test for it.
  Sessions are revoked across instances by a shared generation (#200, ADR-0031).
- **Pillar 2 (story UI) is partly built.** The ballot run, suggestions and Back
  (#128-#135). A results panel (#140). Answers can be changed (#146, ADR-0022).
  A closed poll stays readable and shows its results (#174, #175, #187).
  Approval polls mark every answer of yours (#206), and server errors read as
  words (#204). **The middle of the story (bite, case and action screens) is not
  built.** `flow/story.ts` lists steps the app does not render.
- **Pillar 3 (path to action) is not started.** `proofEmailsOptIn` is collected
  and leads nowhere.
- **Infrastructure is built.** Postgres storage (#150, #156-#160; ADR-0020,
  ADR-0021, ADR-0023), Resend mail (#164, ADR-0027), and two images on one origin
  (#165, ADR-0028). The images were first built and smoke-tested 2026-10-09
  (`just pulse-up`), and CI now builds both on every relevant PR (#212).
  Dependency advisories are resolved (#199).

## What stands between this and a usable deploy

1. **Poll creation (P6).** There is no `POST /api/polls`. Polls are the `SEED`
   literal in `dev-server.ts`, so a served deployment has **nothing to vote on**.
   The rules are settled in ADR-0024 §3. What blocks it is ADR-0024 §5's
   **values**: a first "post a question" slice needs the default `closesAt` and
   `acceptsSuggestions`. Moderation still needs flagging eligibility, an
   auto-hide threshold and a manual-removal authority.
2. **A host and a domain.** These are operator decisions, and none is chosen.
3. **A sending domain verified with Resend** (SPF/DKIM). This is DNS work, not code.

## UI options and implementation checkpoint

**UI candidates and current work (operator update, 2026-10-11).** See
`docs/mockups/CANDIDATE_CONTEXT.md` for the candidate index. These are Pulse
options; the older charter-side ODC candidates are separate.

- **Current swipe UI:** the existing `Run` / `SwipeBallot` / `ChoiceBallot`
  frontend remains the default. The operator's existing demo is on localhost
  5173 with API 8080. #302 will switch the default and retire these screens
  after #301; that switch has not landed.
- **Three-column desktop:** `docs/mockups/pulse-screens/08-desktop-vote.html`
  (#298) is the kept alternative, not the chosen conversation layout.
- **Conversation with voting above the composer:**
  `docs/mockups/pulse-screens/09-chat-vote.html` (#298) is the design of record
  for epic #303 / ADR-0035. A run of questions is one conversation, with a
  desktop left column. The reusable vote card (#299, PR #307) is merged.
- **Compact top-right vote panel:** #301 / merged
  [PR #313](https://github.com/Will-ODC/odc/pull/313) implements the conversation
  page with an operator-requested placement experiment. A small **Vote** tab
  opens a narrow top-right panel on desktop; phone opens above the composer.
  The expanded card has one **Close** control; the redundant Hide control was
  removed at the operator's request. Results replace the ballot in the card,
  with Change my answer and Next when available. The public VoteCard interface
  is unchanged. This variant has not replaced mockup 09 or the default route.
  The local demo is `/conversation` on localhost 5182 with its own disposable
  in-memory API on 8081, in `~/Desktop/odc-conversation`, branch
  `pulse/301-conversation-page`. It does not change the 5173/8080 stack. Local
  processes may need restarting; demo URLs are not deployed services. Voting
  uses the real local API; the assistant is disabled, not implemented. PR #313 merged as `c26127d`; its final 428 tests, package checks, browser
  checks and six CI checks passed after fresh review. #302 is now implemented
  in open PR #322, with 283 remaining tests after retiring old screens; the
  default switch is not merged yet. No agent approved or merged it.
- **Browser extension:** [issue #314](https://github.com/Will-ODC/odc/issues/314)
  tracks a possible client with small expandable assistant and voting tabs on
  other websites. Idea only, not built or selected as a replacement. The first
  prototype uses sample data: assistant opens from the bottom, voting compares
  bottom/corner placement, and content-to-poll selection is explicit. Browser
  choice and content-access rules need Will; live AI/voting and arbitrary
  content association remain dependencies listed in the issue.

Photo/summary (#296), comments (#297), the AI assistant (#280–#284), and browse
(#259/#260) remain separate work. #300 concerns voting from AI chat apps through
MCP/API and its own identity/confirmation decisions; it is not the extension.
The original split story screens, `pulse-story-mobile-v1.html` and
`pulse-vote-states-v1.html` remain earlier references; `hub-feed-v*.html` is not
Pulse's reference. GitHub issues/PRs determine live implementation status; this
entry records the checked state above, not a claim that open work has merged.

## Next / not built

- **NEXT: the vote page becomes a conversation (epic #303, ADR-0035, decided
  2026-10-11).** Design of record: `docs/mockups/pulse-screens/09-chat-vote.html`
  (#298); 08 (three columns) is the kept alternative. **#299 is DONE** (PR #307:
  `VoteCard`, used by `DecisionDialog`; it also made `useCastVote.cast` take a
  whole ballot, so approval polls send every pick). **#301 merged in PR #313**. #302 is implemented in open PR #322 and
  switches the default and retires `SwipeBallot`, `ChoiceBallot` and `Run`.
  **#300 runs in parallel: voting from any AI chat app through MCP/API**; no
  local text matching. Will selected OAuth via magic-link sign-in, one stable
  account-scoped AI ballot across apps (browser ballots stay separate),
  mandatory Pulse exact-answer confirmation with browser fallback, per-poll
  immediate submission/no batches, and an in-process adapter over public HTTP.
  Delegated limits: 10 attempts/minute and 300/hour per account across apps,
  plus separate traffic protection; atomic account/poll deduplication prevents
  duplicate AI ballots, quotas do not. Multiple accounts and browser/AI double
  counting remain gaps. **PR #309 is merged; ADR-0036 records these choices but remains marked
  proposed.** Will gave implementation go in the #300 session; the public read slice is
  pushed in open PR #323, fresh review APPROVE, pipeline pending; later storage/auth scope and the optional
  Pulse answer-check page require coordination. No runtime MCP casting is built. Photo/summary (#296),
  comments (#297), the assistant (#280-#284), browse (#259/#260) and vote
  validity are labelled gaps until their own work lands.

- P6 poll authoring, once (1) above has values. `polls.community` and
  `created_by` go in **migration 005 or later**, because 001-004 are taken.
  Authorship cannot be backfilled, only defaulted.
- P8 slice 2 (the guest upgrade path) and P9-P11 are unstarted. Email assurance
  does not prove social confirmation or a unique human.
- **ADR-0025 (related polls) is accepted but NOT built.**
  `GET /api/polls/:id/related` is "Planned, not served". P10's declinable gate
  depends on it.
- P3, the subject browser / home screen, is blocked on a decision. The operator
  described it (2026-09-06) as "a home screen that browses all polls and batches
  of related polls, story-style". It is also ADR-0022's route back to a question
  from outside a run.
- **No anonymity indicator exists** anywhere in the client or the mockups.
  Showing anonymity would be new UI.
- `@fastify/rate-limit` uses an in-memory store, so N instances means N times the
  limit. This is the first thing that breaks when pulse scales out.
  (`trustProxy: 1` is a different fix.)
- Open feature issues: #186 (a closed first question leaves nothing to press;
  deferred until polls can be created). #205 (approval polls answered with one
  choice) is closed into #299 (selection) and #301 (sending the ballot).

## Open decisions (operator)

- **Vote validity: should pulse show how a vote is counted?** The rule "counting
  is never the subject" (`apps/pulse/CLAUDE.md:33`) was written by an agent in
  #79, not by the operator, who is reconsidering it (2026-10-11). The chat page
  keeps a labelled slot; nothing is designed.

- **P2: should a later community pick move a returning voter?** Today it does
  not (ADR-0030 writes community once). `claim.test.ts` pins the current answer.
- **The sign-in heading still reads "Your campus is deciding something."**
  (`SignIn.tsx`). The operator has been asked for new wording.
- **Signing out clears the ballot cookie**, so a person who votes, signs out,
  signs back in and votes again is counted twice. That cost is accepted. Tying a
  ballot to a voter is unscoped. See `pulse-development.md` (#214's options).
- `polls` is the only plural table, inherited from ADR-0021. Renaming it needs a
  new migration, never an edit to `001`. No decision has been taken.
- `diff-size.sh` says the 400-line WARN "still fires for pulse", but it excludes
  `apps/pulse/**` entirely and reports 0. Whether the comment or the exclusion is
  wrong is still a decision. **Count pulse diffs by hand.**

## Standing decisions — one line each, read the ADR before touching

- **ADR-0020:** Postgres, chosen for the high-traffic, many-process goal. SQLite
  was technically favoured, so do not re-derive the case.
- **ADR-0021:** votes are `(choice, value)` pairs, and `method` is text, so a new
  vote type is never a migration. `poll_choice.id` is stable and `position` is
  display-only. Timestamps come from the app, with no `DEFAULT now()`.
- **ADR-0022:** one press casts. It is bought with **reversibility**: "You can
  change your answer…" and "Change my answer" ship together, gated on
  `poll.open`. Never extend it to anything final, because pillar 3 commitments
  still confirm. "Never let a double-tap cast twice" still holds.
- **ADR-0023:** no `is_entry_point`. A domain may serve several communities, and
  the person picks (built in #215).
- **ADR-0024:** questions are crowdsourced and navigation is computed. Posting
  requires sign-in and voting does not, and that asymmetry is load-bearing.
  Duplicates warn rather than refuse, and removal hides instead of deleting.
- **ADR-0027:** Resend, with no SDK. `MailSendError` (an outage) becomes a
  retryable 503. `MailRejectedError` (bad key or domain) stays 500.
  `ConsoleMailer` in `pnpm dev` is deliberate.
- **ADR-0028:** two processes, **one origin**, and nginx forwards `/api`.
  Splitting origins means `SameSite=None` and rebuilding cross-site protection by
  hand. `src/main.ts` is a sibling of `dev-server.ts`. Never make dev-server
  production-capable.
- **ADR-0030:** anyone signs in, and community is `null` when no domain matches.
  The allowlist only labels. No anti-abuse replaces it, by decision.
- **Product decisions:** a closed poll is a lasting record, shown greyed out.
  Closed results are shown to non-voters. The swipe hints stay on a closed poll.
  NEXT stays beside the results panel. A suggestion that matches a choice answers
  `on_ballot`. Sign-out clears the ballot cookie. The work queue lives in
  `docs/plans/pulse.md`.
- **A re-cast is an upsert** (`voting/pg-store.ts`). Any "stamped once" rule
  describes the answer currently standing.

## Live cautions — do not reintroduce

**Migrations and storage**

- Migrations are forward-only and checksummed. Never edit an applied file, even
  to fix a number in a comment (ADR-0033 explains migration 004's stale
  reference). **Drain old API instances before applying 004.**
- `vote_choice` can name a choice from another poll, and only the store stops
  it. The Postgres test exists. Any new store must refuse a cross-poll pair too.
- Env vars are `PULSE_DATABASE_URL` and `PULSE_REQUIRE_DATABASE`, **never
  `DATABASE_URL` or `CI`** (they aim at the wrong database and misread
  `CI=false`). turbo 2 strips undeclared env vars, so declare them under the
  task's `env`, and put the must-not-skip guard inside the test. A green tick is
  not evidence a test ran: `gh run view <id> --log | grep -c '# SKIP'`.
- Do not map host port 5432. A local Postgres wins the race, and the error looks
  like a credentials bug.

**Serving and secrets**

- **A sign-in token in a log is a sign-in token given away.** Redeem carries it
  in the query string. `SERVED_LOGGER` and nginx `pulse_no_query` strip it, and
  #184 keeps it out of referrers. Check any new log line that includes a URL.
- `trustProxy` is the hop count `1`, never `true`.
- `.dockerignore` patterns need `**/`.
- Compose interpolates the whole file before profiles filter it, so a `${VAR:?}`
  on a profiled service breaks `up db`.
- The client image builds with `tsconfig.build.json`, because the default config
  includes `test/**`, which imports server source.
- The root `just up` starts nothing, by design. `just pulse-up` is pulse's
  command. `pnpm dev` uses an ephemeral session secret, so a restart signs
  everyone out. That is deliberate.

**Client**

- **Never index `results.choices` by `yourChoice`.** Match on
  `ChoiceResult.index` (ADR-0021).
- **Every way of casting must check `poll.open`** (through `locked` plus
  `disabled`). A new gesture or ballot type that forgets it reopens the "worst of
  both worlds" ADR-0022 prevents.
- A tap is `pointerdown`, `pointerup`, then `click`, so test the whole sequence.
  Any focusable control inside the swipe `<section>` receives arrow keys as
  answers. NEXT follows `poll.next`, not whether the preview loaded.
- State that was safe only because a component remounted breaks when something
  resets it in place, so audit every ref.
- `findByRole("status")` resolves on "Sending…". Wait on the settled words
  instead. Focus tests flake the same way: #211 fixed `ResultsPanel`, and
  `SwipeBallot`'s focus tests still flake. Wait for focus, as #211 does.
- `[hidden]` loses to an author `display`, and jsdom cannot see it. Check
  selector specificity when a class "does nothing".
- **Ask of every guard: which test goes red if I hardcode this?** This file has
  recorded "tests that could not fail" four times.
- To screen-check a closed poll, use a throwaway proxy that rewrites
  `"open":true`. Do not edit the seed. The README's demo details drift, so check
  `dev-server.ts` and `API.md`.
- Mockups are `docs/mockups/pulse-screens/` ("Civic Glass"). `hub-feed-v*.html`
  is **not** the reference.

**Git and process**

- Use `origin/master...HEAD` (three dots) to see what a branch changes. A
  two-dot `D` usually means the branch is stale, so rebase.
- Stacked-PR rules (no `--delete-branch` under a child, `rebase --onto` after a
  squash) live in `.claude/skills/odc-pipeline`. Do not copy them back here.
- Two agents in one worktree will destroy each other's work. Use
  `isolation: "worktree"`.
- Fresh-context review has returned REQUEST CHANGES on almost every pulse PR,
  with findings the author could not see. Budget for it.

## Epic #303 coordination checkpoint — 2026-10-11

- “Implement Vote Card” owns #301 / PR #313 and #302 after #301 merges.
  “Design AI app pulse voting” owns #300 / PR #309 and MCP/API work. Separate
  worktrees; agree optional answer-check page interfaces before #300 touches
  pulse-web. This session owns epic memory/candidate tracking.
- PR #313 merged after fresh review and six passing checks. #302 / PR #322
  is pushed with fresh review and local checks passed; its pipeline is running.
  It branched from master after #313 landed, without stacking.
- Operator choices for #300 are recorded in merged PR #309; later persistence/auth
  scope and the optional check page need coordination. Neither #301 nor MCP
  read tools implement the assistant.
- At each logical checkpoint: test, fresh review, push, green pipeline, then
  update context. Will retains approval/merge authority. Check shared usage
  limits and save a concise handoff before approaching them.

### Design merge checkpoint

PR #309 merged as `c618450` on 2026-10-11. ADR-0036 still says proposed and
requires an explicit implementation go; Will subsequently gave that go in
the #300 session. Public read tools are pushed in open PR #323, not merged.
PR #313 has merged; #302 / PR #322 is now open.

### Implementation checkpoint

- #302 / PR #322: `pulse/302-conversation-default`, `/private/tmp/odc-302-default`.
  Default URL and sign-in landing become Conversation; `/conversation` aliases
  and sample `/preview/chat` survive. Removed retired screens and exclusive
  helpers/tests; suggestions API survives but its old form/preview rail retire.
  283 tests in 21 files, type/lint/format/build and browser1440/390 pass; fresh
  review APPROVE. Pushed/unmerged, CI pending. Demo5183 proxies isolated8081.
- #300 read slice / PR #323: `pulse/300-mcp-reads`, `~/Desktop/odc-ai-voting`.
  `get_poll`/`get_results` at `/api/mcp`, no casting/auth/own-answer tools. Author
  reports416 fresh tests with required disposable Postgres, zero skips, plus
  package gates. Pushed/unmerged, fresh review APPROVE; CI underway. Existing `?poll`
  link compatibility still needs Will's answer; production origin wiring is
  explicitly deferred. No demo ports or frontend edits.
- Latest shared usage checkpoint:47% five-hour,20% weekly used. Finish these
  checkpoints before starting further protected voting or check-page scope.
