# Pulse — Build State

> Session-to-session truth for the `apps/pulse` + `apps/pulse-web` workstream.
> Read `memory/INDEX.md` first. Agent rules are in `apps/pulse/CLAUDE.md`, the
> served API is in `apps/pulse/API.md`, and the work queue is GitHub
> issues (design detail an issue links to is in `docs/plans/pulse.md`). This file holds current state only, and history is in
> git. Slimmed 2026-10-10, refreshed 2026-11-10. The long ledger it replaced is in
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
  the core ledger only through the ledger's public HTTP API;
  there will be no separate pulse chain (operator, 2026-10-12).
- **Never claim more than is built (ADR-0039).** Pulse may explain how votes are
  counted (the old "counting is never the subject" rule is dropped), but no copy
  may say or imply pulse votes are on a hash chain or ledger before they are.

Repo discipline still applies: tests ship with the change, there is one small
branch per change, named for its ticket (`pulse/<issue>-<short>`, #310), and
the same CI runs.

## Where it stands (2026-11-12)

- **Merged since 2026-11-10:** #521 mockups for dark mode and the compact
  posted notice (#499/#500); #522 steady header width, focus after Forget and
  the You picked ring (#518); #524 and #545 CI-flaky tests wait on the asserted
  state (#517, #540); #525 security headers, no-store on account routes and
  self-hosted Inter (#520); #526 a late Close reply is ignored after the answer
  is sent again (#519); #531 the Answered rail beside Explore on Home (#498);
  #543 banner components move to `components/` and current links come from
  `pathOf` (#539 step 1); #544 a lost connection while voting asks the server
  on Close, on phone and desktop (#527); #546 shared Button, Field and Choice
  with focus-ring tokens (#534, which stays open for AccountMenu, Browse,
  Conversation and ResultsPanel); #553 menu width tokens, with the communities
  menu centred on phones (#530); #555 a quiet "Next question" link, left swipe
  on phones and a subtle slide (#554).
- **Merged 2026-11-11 (later):** #562 the Trust page "Today" list splits the
  confirm step into its own bullet (#558, `49d9fae`); #563 shared-controls
  follow-ups: unused `post__change` removed, `.btn.post__info`, phone-rules
  test (#559, `4c387a2`); #564 the Account panel keeps a fixed width (menu
  max) so Forget's question does not widen it (#561, `224cd94`); #565 expired
  sign-in rows are purged at startup and on redeem as well as on link request,
  and `used_claim` markers are kept 20 minutes (15 + 5) via migration 012
  (`used_at`); the startup and redeem sweeps are best-effort (#550,
  `307847c`); #567 `PULSE_TRUSTED_PROXY_HOPS` sets the trusted proxy hop
  count (default 1, allowed 1-4, 0 refused) (#549, `f4cc0c5`); #568
  AccountMenu, Explore and ResultsPanel controls use the shared Button, copied
  focus rings removed (#534 part 2, `51d0c9f`; #534 stays open for part 3,
  Conversation); #571 docs say a failed sweep never fails startup or
  redemption, while a link-request sweep failure fails that request (#570,
  `fabb23c`).
- **Merged 2026-11-12:** #574 small size for the shared Button, `.button`
  utility retired (#569, `28bfee3`); #566 Previous and Next follow the My votes
  list (#528, `9ff9678`; nits left: render-time ref write in `useLaterVotes`,
  suggest `useLayoutEffect`; no cleanup test for `useDockSpace`; later pages
  re-read after reload); #578 closed-question fixes: compact results fit the
  column, rail says Closed, one "Sending…" (#575, `429465b`; UI nits in #589);
  #587 ADR-0047 poll pictures accepted and plan P12 (`aa97cf6`).
- **Poll pictures are planned, not built** (ADR-0047, P12 in
  `docs/plans/pulse.md`, READY TO BUILD; tickets #579-#586). Neutral
  `image`/`image_bytes` storage keyed by `owner_kind`/`owner_id`. Migrations
  take 015+, after Contributions #572 lands; #427, #585 and #586 wait for
  #572. Purging a poll tombstones its replay rows (an ADR-0037 amendment for
  purged polls only); ADR-0037's broad-posting launch gate is unchanged.
- **Open PRs 2026-11-12:** Contributions #246 is PR #572. #535 is PR #588,
  held until #572 merges (they conflict in Browse files).
- **New tickets:** #557, #560 review nits and #589 closed-question UI nits
  (open).
- **One ballot per signed-in person** (#532 / PR #552, ADR-0046, migration
  011). Operator decision 2026-11-11: a signed-in person's new vote replaces
  their earlier vote on a poll, and on sign-in the newer answer moves to that
  browser.
- **Auth audit 2026-11-11:** Pulse has no passwords. Findings were filed as
  #548-#550 or fixed in PR #551 (sign-in, redeem and sign-out check the request
  origin; the session secret must be 32 characters; closes #548).
- **Pillar 1 (identity) is built.** Magic-link sign-in and redeem (#81-#87,
  #116, #149). Open sign-up lets anyone sign in, and community is an optional
  label (#182/#183, ADR-0030). The person picks their community when an address
  matches several (P2, #215). Identity is a credential (P8 slice 1, #213,
  ADR-0033). Sessions are revoked across instances by a shared generation (#200,
  ADR-0031). Community labels are real keys, registered atomically (#358,
  migration 006). Sign-out (#344) and "Forget my votes here" for someone who
  never signed in (#349) both clear the ballot cookie. Used sign-in links
  delete their pending personal data atomically, retaining only a hash replay
  marker; expired unused links are swept on the next link write (#507 / PR #512,
  migration 010), and also at startup and on redeem (#550 / PR #565,
  migration 012).
- **Confirmed votes are built** (#360, ADR-0040, migration 007). A vote cast while
  signed in, or by a browser that signs in later, is confirmed. Results carry
  all votes plus confirmed votes counted once per email account. A confirmed vote stores
  only an HMAC code under `PULSE_CONFIRMATION_KEY`, never the account or address.
  **The UI is built** (#353, PR #386): confirmed status, both result numbers,
  cross-tab refresh after sign-in and accurate `/trust` wording.
- **Pillar 2 (story UI):** the vote page is a **conversation** (epic #303,
  ADR-0035): #299/PR #307 vote card, #301/PR #313 page, #302/PR #322 made it the
  default and retired the swipe ballot, `Run` and `ChoiceBallot`. Around it:
  Home is the General poll browser at `/`; the introduction and Start voting
  are at `/about` (#449 / PR #452, `1570690`). Progress remains at `/start`,
  with four starting questions at `/questions` (#341/PR #347). At 700px and
  wider, voting sits under the question and folds into the saved answer after
  Submit; Change my answer reopens it in place (#490 / PR #492, ADR-0044).
  Phones retain the bottom sheet. Results stay below the saved answer.
  The live tutorial was removed.
  The trust page remains at `/trust` (#351/PR #357, ADR-0039); sign-in has a
  plain heading with no focus box (PR #373). The starting questions need published poll IDs
  (`VITE_PULSE_*_POLL_ID`); until then they show Coming soon.
  #453 / PR #468 adds compact results charts. #482 / PR #485 restyles the web
  app in white and green and adds a phone layout below 700px; the approved
  mockup is `docs/mockups/pulse-light-v1.html`.
  The Answered rail shares My votes rows, stays in sync and restores saved
  answers on reload (#484 / PR #488). The saved answer leads a single results
  card with Hide/Show results and a short sign-in confirmation offer
  (#478/#480 / PR #489). Next updates the address and browser history
  (#502 / PR #511). Headers share saved-vote state and history-error recovery
  across pages (#487 / PR #513). The sign-in column stays 400px wide from
  the 700px breakpoint (#508 / PR #509).
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
  returned APPROVE with no findings, and CI passed. **The browser list is merged** (#260 / PR #426); MCP
  discovery (#291) remains unbuilt, and existing MCP tools still read
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
  Real-HTTP integration coverage publishes through `HttpPulseApi.createPoll`
  with a browser-like Origin, then checks replay, read and vote (PR #506).
- **Demo feedback is merged:** #401 / PR #403 opens each question's vote card
  by default; #400 / PR #404 adds space around tutorial highlights; #402 /
  PR #405 shortens the trust link/title to "How votes count" and the page from
  roughly 976 to 294 words. All three final PR CI runs passed.
- **Pillar 3 (path to action) is not started.** `proofEmailsOptIn` is collected
  and leads nowhere. #331-#333 plan it.
- **Infrastructure is built.** Postgres storage (ADR-0020, ADR-0021, ADR-0023),
  Resend mail (#164, ADR-0027), and two images on one origin (#165, ADR-0028),
  built and scanned in CI with a sha-pinned Trivy action (#212, PR #491).
  Dependabot alerts are on. `apps/pulse/DEPLOY.md` is the host-neutral deployment runbook (#491).
  The API image excludes package managers and image scanning also runs weekly
  and on manual dispatch (PR #495).
- **Test audit follow-ups are merged:** forced-lock Postgres sign-out overlap
  and full 413 responses on all seven body-taking routes (PR #496); fake
  timers and call assertions replace the unrelated-storage-event sleep
  (PR #505).
- **Fault logs exclude personal data** (#503 / PR #514): unexpected faults
  use generic responses and log only error class, valid SQLSTATE and mail
  HTTP status where applicable, including startup/background faults.

## What stands between this and a usable deploy

1. **Reporting, review and the automatic-hide threshold** remain broad-launch
   prerequisites. Poll creation itself is merged, including the browser form.
2. **Published starting questions** for `/questions`, and comments (#297).
   The explainer video (#339) comes later.
3. **A host and DNS.** The host is not chosen; DNS for `onlinedemocracy.org`
   still needs configuring.
4. **A sending domain verified with Resend** (SPF/DKIM). DNS work, not code.
5. **The proxy-hop and rate-limit prerequisites** in `apps/pulse/DEPLOY.md`
   must be satisfied before go-live.

## Current operator direction and next work (2026-11-12)

1. The recent Answered, results, desktop voting, sign-in and header changes
   are merged; there is no remaining UI stack awaiting merge.
2. Open follow-ups: #533 ViewState Try again, #535 one paged-list hook
   (PR #588, held for #572), #536 Conversation logic into flow/ and
   hooks, #537 VoteCard split, #538 CSS encapsulation and tokens, #557,
   #560 and #589 review nits, #534 part 3 (Conversation), P12 poll pictures
   (#579-#586, ADR-0047),
   #539 step 2 (one session provider; operator decision), and #499 dark mode
   and #500 compact posted notice (mockups merged in #521, not built).
3. Prepare a small invited pilot only after choosing a host, configuring DNS,
   verifying a sending domain and satisfying `apps/pulse/DEPLOY.md`'s
   proxy-hop and rate-limit prerequisites. This is not authorization to deploy.

## Browse (merged, updated 2026-10-23)

- #260 merged in PR #426 (`ad4288f`), confirmed on GitHub.
  #449 / PR #452 now puts the General list at Home (`/`), with the former
  welcome at `/about`. Its Start voting path remains unchanged, and Explore
  questions returns to Home. Existing community and explicit poll links work.
  All seven local seed questions appear in General. The public list supports communities, open/closed questions, cursor
  pagination and recoverable failures; browsing never casts a vote.
- Current layout: centered main column with space for columns on both sides
  on desktop, full width on phones, and quiet top text navigation with subtle
  separators. General is public; Your community uses the existing email-linked
  community label, not a new membership or social-confirmation system.
- Independent implementation and layout reviews of #426 returned APPROVE.
  Validation of the later #451/#452 layout is recorded above; no public
  deployment has been performed by this chat.
- Later browse thumbnails and a few context lines per entry are #427, dependent
  on #296 image/context fields; #397 owns the richer mixed feed. Reuse these
  issues rather than creating duplicates. Side-column contents remain #331.
- #453's results presentation is merged in PR #468; #297/#423 own discussion,
  #424 the opinion-diversity prototype and #425 related-question continuation.
  Invited-pilot prerequisites remain the current plan above.

## Backlog ownership (reviewed 2026-10-23)

- New community direction: #457 owns readable community paths (proposed
  `/c/<community-name>`, with old links preserved). #458 owns a linked
  discussion/voting thread on creation, suspension, banning, restoration and
  destruction/dissolution under constitutional and foundational rules.
  These are unbuilt requests; policy questions are recorded once in
  `memory/pulse-development.md`, "Community paths and lifecycle deliberation".
  #440 still owns multiple verified memberships. URL work and lifecycle
  deliberation do not authorize new enforcement or deletion behavior.
- Reviewed all 73 then-open issues. #186 was closed as a duplicate of #425;
  its closed-first-question/no-saved-ballot regression is explicitly retained
  there. This is consolidation, not a claim the defect is fixed. Related order
  and terminal fallback still need accepted decisions.
- **Continuation clarification (2026-10-23): #425** now owns left/right page
  chevrons, with Next following the current thread/story when relevant and
  otherwise continuing to the next poll in the main feed. #464's brief
  feed-only navigation ticket was consolidated into #425. The unfinished
  feed-only edits were removed; no continuation implementation is in progress.
  This is likely future work; a simple slice is possible only after its
  navigation semantics are agreed. Feed order may later be algorithmic, but
  no algorithm, personalization or inferred relationship rule is selected.
- #453's open/closed poll chart presentation is merged in PR #468; #332 owns
  linked action progress and evidence, reusing the same results. #303 and #297
  reflect the results-before-comments layout and current voting placement.
- #291 owns discovery/listing in the existing public MCP adapter, not another
  implementation of PR #323's get_poll/get_results. #397 owns posts,
  post-to-poll relationships and the mixed feed; reuse #427's poll previews.
- Abuse reporting already has separate owners: #233 shared submission,
  duplicates and limits; #234 review; #235 user reports; #236 poll reports;
  #237 private-message reports. Public-comment reporting belongs to #297
  using #233's shared foundation. These are distinct outcomes, not duplicates.
  Reporting access, reasons/limits, review authority and enforcement rules
  remain prerequisites; see `memory/pulse-development.md`.

## Next / not built

- **The authoring and demo-feedback slices are complete** (#393/#403–#405).
  Browse #260, the #451/#452 layout, #453 / PR #468 results charts and #482 /
  PR #485 light restyle are merged, as are the later UI refinements above.
  #457/#458 add community paths and lifecycle
  deliberation. Poll-creation refinements are an open operator request whose particular
  changes still need scoping; reuse the built creation flow. A local demo is
  available, but there is no public deploy.
- Open feature issues: #296 photo and summary, #297 comments, #336 suggestions in
  the conversation page, #331-#333 desktop side columns and action follow-through,
  #314 browser-extension prototype (idea only), and #425 related/closed-question
  onward navigation (including former #186).
- P8 slice 2 (the guest upgrade path) and P9-P11 are unstarted. Email assurance
  does not prove social confirmation or a unique human.
- **ADR-0025 (related polls) is accepted but NOT built.**
  `GET /api/polls/:id/related` is "Planned, not served". P10's declinable gate
  depends on it.
- P3's richer feed and related-question grouping remain future work. The operator
  described it (2026-09-06) as "a home screen that browses all polls and batches
  of related polls, story-style". It is also ADR-0022's route back to a question
  from outside a run.
  Its listing API (#259 / PR #419) and minimal browser (#260 / PR #426) are
  merged, and #452 makes the General browser Home. Richer previews (#427), the mixed feed (#397) and related-vote
  navigation (#425) remain separate; MCP discovery (#291) is still unbuilt.
- **Authorised moderator access is not built.** The merged creation form and
  public byline use ADR-0037's interim anonymity disclosure (#393); do not claim
  the later moderator-access model exists.
- **Core integration is deferred** by William (2026-10-20), tracked as bounded
  future epic #398. ADR-0039 chooses public core APIs, but no integration is
  built and no migration implementation is authorized now.
- `@fastify/rate-limit` uses an in-memory store, so N instances means N times the
  limit. This is the first thing that breaks when pulse scales out.
  (`trustProxy` hops, now `PULSE_TRUSTED_PROXY_HOPS`, is a different fix.)

## Open decisions (operator)

- **Continuation (#425):** define relevance and explicit story/thread order,
  precedence with answer-selected Next and related alternatives, source-feed
  scope/order, Previous/history behavior, pagination and end-of-feed fallback.
  Preserve saved answers, discard another question's unsent choices, block
  navigation while casting and never cast automatically. Later algorithmic
  feed ordering needs its own accepted policy and implementation scope.
- **Community lifecycle (#458):** governing/protected rules, creation and
  moderation authority, eligible voters, decision thresholds, appeals,
  state semantics and retention remain open. See the community deliberation
  section in `memory/pulse-development.md`; no lifecycle rule is adopted.
- **Pulse/core compatibility (#398, deferred):** which responsibilities stay
  with Pulse; how eligibility and identity cross the API boundary; how mutable
  recasts and approval choices map to core's v1 ballot rules; what the UI says
  during batched publication; and how rollout preserves existing polls. These
  require an accepted integration ADR before implementation tickets are cut.
- **P2: should a later community pick move a returning voter?** Today it does
  not (ADR-0030 writes community once). `claim.test.ts` pins the current answer.
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
- **ADR-0035 / ADR-0044:** the vote page is a conversation; ADR-0044
  records voting under the question on desktop and a bottom sheet on phones,
  with results beneath the saved answer. Next stays with results.
- **ADR-0037:** poll creation: closes after seven days unless the poster picks a
  later time; suggestions off (#336); five publications per rolling hour per
  account; Owner and narrow grants; community or General posting; anonymous by
  default, naming optional. General is posting-only and never an account's community.
- **ADR-0047:** poll pictures: neutral `image`/`image_bytes` storage with
  `owner_kind`/`owner_id`; purging a poll tombstones its replay rows (amends
  ADR-0037 for purged polls only). Planned as P12; not built.
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
- `trustProxy` is a hop count, never `true`: `PULSE_TRUSTED_PROXY_HOPS`
  (default 1, allowed 1-4, 0 refused; #549 / PR #567).
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
