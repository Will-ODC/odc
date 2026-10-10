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
branch per change (`pulse/<n>-<short>`), and the same CI runs.

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

## Next / not built

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
  deferred until polls can be created) and #205 (approval polls can only be
  answered with one choice; needs a decision about ADR-0022's one-press cast).

## Open decisions (operator)

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
