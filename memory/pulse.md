# Pulse — Build State

> Session-to-session truth for the `apps/pulse` + `apps/pulse-web` workstream.
> Read `memory/INDEX.md` first. Agent rules are in `apps/pulse/CLAUDE.md`, the
> served API is in `apps/pulse/API.md`, and the work queue is GitHub
> issues (design detail an issue links to is in `docs/plans/pulse.md`). This file holds current state only, and history is in
> git. Slimmed 2026-10-10, refreshed 2026-10-21. The long ledger it replaced is in
> `git log -p -- memory/pulse.md`.
>
> The operator's development-feedback loop, the trust and reporting decisions,
> and the contained tickets #227-#238 are in **`memory/pulse-development.md`**.
> Of those, the confirmed-voter requirement is now built (#360, ADR-0040).

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

- **No reads or writes into `services/` or `contracts/`.** Pulse votes will reach
  the core ledger only through the ledger's public HTTP API, once it exists;
  there will be no separate pulse chain (operator, 2026-10-12).
- **Never claim more than is built (ADR-0039).** Pulse may explain how votes are
  counted (the old "counting is never the subject" rule is dropped), but no copy
  may say or imply pulse votes are on a hash chain or ledger before they are.

Repo discipline still applies: tests ship with the change, there is one small
branch per change, named for its ticket (`pulse/<issue>-<short>`, #310), and
the same CI runs.

## Where it stands (2026-10-21)

- **Pillar 1 (identity) is built.** Magic-link sign-in and redeem (#81-#87,
  #116, #149). Open sign-up lets anyone sign in, and community is an optional
  label (#182/#183, ADR-0030). The person picks their community when an address
  matches several (P2, #215). Identity is a credential (P8 slice 1, #213,
  ADR-0033). Sessions are revoked across instances by a shared generation (#200,
  ADR-0031). Community labels are real keys, registered atomically (#358,
  migration 006). Sign-out (#344) and "Forget my votes here" for someone who
  never signed in (#349) both clear the ballot cookie.
- **Confirmed votes are built** (#360, ADR-0040, migration 007). A vote cast while
  signed in, or by a browser that signs in later, is confirmed. Results carry
  all votes plus confirmed votes counted once per email account. A confirmed vote stores
  only an HMAC code under `PULSE_CONFIRMATION_KEY`, never the account or address.
  **The UI is built** (#353, PR #386): confirmed status, both result numbers,
  cross-tab refresh after sign-in and accurate `/trust` wording.
- **Pillar 2 (story UI):** the vote page is a **conversation** (epic #303,
  ADR-0035): #299/PR #307 vote card, #301/PR #313 page, #302/PR #322 made it the
  default and retired the swipe ballot, `Run` and `ChoiceBallot`. Around it:
  welcome at `/`, progress at `/start`, four starting questions at `/questions`
  (#341/PR #347); the optional "Show me how" tutorial (#342/PR #363); the trust
  page at `/trust` (#351/PR #357, ADR-0039); a plain sign-in heading and no focus
  box on headings (PR #373). The starting questions need published poll IDs
  (`VITE_PULSE_*_POLL_ID`); until then they show Coming soon.
- **MCP public reads are built** (#300 read slice, PR #323): `get_poll` and
  `get_results` at `/api/mcp`. ADR-0036 (voting from AI apps) is still marked
  proposed; no casting, sign-in or own-answer tools exist.
- **Public poll listing is built** (#259 / PR #419, merged 2026-10-21).
  `GET /api/polls?community=ID` needs no sign-in and returns open and closed
  question summaries, excluding hidden polls and legacy polls without a
  community. Newest-first creation time and UTF-8 poll ID ordering use
  community-bound cursor pagination (20 by default, maximum 100).
  Migration 008 adds the visible-community listing index. PR validation passed
  606 API tests with PostgreSQL required and zero skips, independent review
  returned APPROVE with no findings, and CI passed. **No browser list or MCP
  discovery consumer is built yet** (#260/#291); existing MCP tools still read
  individual polls/results only.
- **Poll creation is built, including the form.** ADR-0037
  (#340) settles the policy and API. Built: migration 005 (#346), the Postgres publication store with
  quotas, safe retries and owner-only posting grants (#354), and an in-memory
  equivalent with one shared conformance suite (#367). PR #389 serves creation
  context, publication and owner posting-permission routes, with startup wiring
  and optional `PULSE_OWNER_EMAIL`. Public GET and MCP attribution merged in
  #387; legacy polls gain no invented author. PR #393 merged the creation form,
  first-post purpose promise, date and attribution controls, explicit posting
  confirmation and sign-in recovery. Ordinary visits clear abandoned drafts;
  an expired recovered closing time opens and focuses its validation error.
- **Demo feedback is merged:** #401 / PR #403 opens each question's vote card
  by default; #400 / PR #404 adds space around tutorial highlights; #402 /
  PR #405 shortens the trust link/title to "How votes count" and the page from
  roughly 976 to 294 words. All three final PR CI runs passed.
- **Pillar 3 (path to action) is not started.** `proofEmailsOptIn` is collected
  and leads nowhere. #331-#333 plan it.
- **Infrastructure is built.** Postgres storage (ADR-0020, ADR-0021, ADR-0023),
  Resend mail (#164, ADR-0027), two images on one origin (#165, ADR-0028), built
  in CI (#212). Dependabot alerts are on.

## What stands between this and a usable deploy

1. **Reporting, review and the automatic-hide threshold** remain broad-launch
   prerequisites. Poll creation itself is merged, including the browser form.
2. **Published starting questions** for `/questions`, and comments (#297).
   The explainer video (#339) comes later.
3. **A host and a domain.** The domain is `onlinedemocracy.org` (owned); the
   host is not chosen.
4. **A sending domain verified with Resend** (SPF/DKIM). DNS work, not code.
5. **A container-image scan** in `pulse-images.yml` before the first deploy
   (deferred by the operator, 2026-10-11; #315's other items are done).

## Current operator plan (2026-10-21)

1. Finish #260: welcome's Explore questions opens a public, community-scoped
   browse list, while Start voting retains the existing guided introduction.
   Show open/closed questions, newest first, with pagination and recoverable
   errors. Implementation is in flight on `pulse/260-browse`; not merged.
2. Refine poll creation next. The operator expects substantial improvement;
   the particular form/content/workflow changes still need to be scoped.
   Reuse the built creation flow rather than creating a second authoring system.
3. Prepare a small invited pilot once browsing and the agreed creation
   refinements are ready, with a chosen host, persistent database, verified
   sending domain and the deferred container-image scan. This is a plan,
   not a claim of deployment or authorisation to deploy.
4. Broad launch still needs the recorded reporting/moderation prerequisites
   and published starting questions. Continue toward discussion, related votes
   and documented action through #303 and its linked tickets.

## Browse handoff (2026-10-21, awaiting merge)

- #260 is implemented in PR #426 on `pulse/260-browse`, not yet merged.
  Welcome offers Explore questions alongside the unchanged guided Start voting
  path. The public list supports communities, open/closed questions, cursor
  pagination and recoverable failures; browsing never casts a vote.
- Current layout: centered main column with space for columns on both sides
  on desktop, full width on phones, and quiet top text navigation with subtle
  separators. General is public; Your community uses the existing email-linked
  community label, not a new membership or social-confirmation system.
- Independent implementation and layout reviews returned APPROVE. The latest
  local web suite has 490 passing tests; CI reruns after pushes. No merge or
  public deployment has been performed by this chat.
- Later browse thumbnails and a few context lines per entry are #427, dependent
  on #296 image/context fields; #397 owns the richer mixed feed. Reuse these
  issues rather than creating duplicates. Side-column contents remain #331.
- **Next selected work remains poll-creation refinement**, with specific
  changes still to be scoped. Longer work stays in its existing issues:
  #422 bottom vote drawer, #297/#423 discussion, #424 opinion-diversity
  prototype and #425 related-vote continuation. Invited-pilot prerequisites
  remain the current plan above.

## Next / not built

- **The authoring and demo-feedback slices are complete** (#393/#403–#405).
  The operator selected #260 browsing next, followed by poll-creation
  refinement; see the current plan above. A local demo is available, but there is no claim of a public deploy.
- Open feature issues: #296 photo and summary, #297 comments, #336 suggestions in
  the conversation page, #331-#333 desktop side columns and action follow-through,
  #329 a "My votes" page, #314 browser-extension prototype (idea only), #186 a
  closed first question leaves nothing to press.
- P8 slice 2 (the guest upgrade path) and P9-P11 are unstarted. Email assurance
  does not prove social confirmation or a unique human.
- **ADR-0025 (related polls) is accepted but NOT built.**
  `GET /api/polls/:id/related` is "Planned, not served". P10's declinable gate
  depends on it.
- P3, the subject browser / home screen, is blocked on a decision. The operator
  described it (2026-09-06) as "a home screen that browses all polls and batches
  of related polls, story-style". It is also ADR-0022's route back to a question
  from outside a run.
  Its listing API prerequisite is now delivered (#259 / PR #419). The minimal
  browser list (#260) still needs its layout and entry route accepted; MCP
  discovery (#291) remains a separate consumer.
- **Authorised moderator access is not built.** The merged creation form and
  public byline use ADR-0037's interim anonymity disclosure (#393); do not claim
  the later moderator-access model exists.
- **Core integration is deferred** by William (2026-10-20), tracked as bounded
  future epic #398. ADR-0039 chooses public core APIs, but no integration is
  built and no migration implementation is authorized now.
- `@fastify/rate-limit` uses an in-memory store, so N instances means N times the
  limit. This is the first thing that breaks when pulse scales out.
  (`trustProxy: 1` is a different fix.)

## Open decisions (operator)

- **Pulse/core compatibility (#398, deferred):** which responsibilities stay
  with Pulse; how eligibility and identity cross the API boundary; how mutable
  recasts and approval choices map to core's v1 ballot rules; what the UI says
  during batched publication; and how rollout preserves existing polls. These
  require an accepted integration ADR before implementation tickets are cut.
- **P2: should a later community pick move a returning voter?** Today it does
  not (ADR-0030 writes community once). `claim.test.ts` pins the current answer.
- **Signing out clears the ballot cookie**, so a person who votes, signs out,
  signs back in and votes again is counted twice in the full totals. Confirmed
  totals count each account once (ADR-0040). That cost is accepted.
- **How long `pending_claim` rows are kept, and what a mail-provider error may
  write to logs.** Both from #315; filed in `memory/OPEN-QUESTIONS.md` under
  "Pulse sign-in data: retention and logging (2026-10-11)".
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
  Closed results are shown to non-voters. NEXT stays beside the results panel. A suggestion that matches a choice answers
  `on_ballot`. Sign-out clears the ballot cookie. The work queue lives in
  `docs/plans/pulse.md`.
- **A re-cast is an upsert** (`voting/pg-store.ts`). Any "stamped once" rule
  describes the answer currently standing.
- **ADR-0035:** the vote page is a conversation. Mockup
  `docs/mockups/pulse-screens/09-chat-vote.html` is the design of record; the
  built panel sits top right on desktop and above the composer on phone.
- **ADR-0037:** poll creation: closes after seven days unless the poster picks a
  later time; suggestions off (#336); five publications per rolling hour per
  account; Owner and narrow grants; community or General posting; anonymous by
  default, naming optional. General is posting-only and never an account's community.
- **ADR-0039:** pulse may explain counting, on `/trust`, and never claims more
  than is built.
- **ADR-0040:** confirmed votes store a keyed code only. "Most recent" means most
  recently cast; signing in does not confirm votes on closed polls. Rotating
  `PULSE_CONFIRMATION_KEY` makes earlier confirmations unrecognisable.

## Live cautions — do not reintroduce

**Migrations and storage**

- Migrations are forward-only and checksummed. Never edit an applied file, even
  to fix a number in a comment (ADR-0033 explains migration 004's stale
  reference). **Drain old API instances before applying 004, 006 or 007**
  (README "Upgrading").
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
- The client image builds with source-only `tsconfig.build.json`; browser tests
  stay in the app and real-HTTP cross-app suites live in
  `tests/pulse-integration/` (ADR-0041). Static import boundaries are enforced by
  lint (ADR-0042); run `pnpm test:boundaries` for the focused guard suite.
- The root `just up` starts nothing, by design. `just pulse-up` is pulse's
  command. `pnpm dev` invents a session secret and a confirmation key each run,
  so a restart signs everyone out and forgets confirmations. That is deliberate.
  `src/main.ts` refuses to start without `PULSE_CONFIRMATION_KEY` (32+ chars,
  not equal to the session secret).

**Client**

- **Local demo handoff (2026-10-20):** API `http://127.0.0.1:8080`, web
  `http://localhost:5173`, served from the attached
  `repo-guidance-cleanup/odc` worktree, now detached at merged master. The old
  local-only `codex/demo-ui-feedback` branch is an earlier combined preview,
  not the canonical source. Data is in memory and lost on API stop. Console
  mail prints sign-in links without sending email; request a fresh link for
  `demo@example.test` when needed and never save tokens in memory. The
  blue-halo pointer reported during the demo is from Codex browser control,
  not a Pulse tutorial graphic.
- **Never index `results.choices` by `yourChoice`.** Match on
  `ChoiceResult.index` (ADR-0021).
- **Every way of casting must check `poll.open`** (through `locked` plus
  `disabled`). A new gesture or ballot type that forgets it reopens the "worst of
  both worlds" ADR-0022 prevents.
- A tap is `pointerdown`, `pointerup`, then `click`, so test the whole sequence.
  NEXT follows `poll.next`, not whether the preview loaded.
- State that was safe only because a component remounted breaks when something
  resets it in place, so audit every ref.
- `findByRole("status")` resolves on "Sending…". Wait on the settled words
  instead. Focus tests flake the same way: #211 fixed `ResultsPanel`. Wait
  for focus, as #211 does.
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
