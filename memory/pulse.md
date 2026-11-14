# Pulse — Build State

> Session-to-session truth for `apps/pulse`, `apps/pulse-web` and
> `tests/pulse-integration`. Read `memory/INDEX.md` first. Agent rules are in
> `apps/pulse/CLAUDE.md`, the served API is in `apps/pulse/API.md`, the work
> queue is GitHub issues, and design detail they link to is in
> `docs/plans/pulse.md`. Current state only; history is in git
> (`git log -p -- memory/pulse.md`). Audited 2026-11-14.
>
> The development-feedback loop, trust and reporting decisions and tickets
> #227-#238 are in **`memory/pulse-development.md`**. Note: ADR-0040's
> "confirmed vote" means signed in with email; the social confirmation that
> development votes require is not built.

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

## Where it stands (2026-11-14)

Per-PR history is in `git log origin/master -- apps/pulse apps/pulse-web`.
**Open Pulse PRs: none.** Next migration: **018**.

- **Sign-in (pillar 1) is built.** Magic-link sign-in and redeem; open sign-up
  with community as an optional label (ADR-0030); a community picker when an
  address matches several (P2, #215); identity as a credential (P8 slice 1,
  ADR-0033); cross-instance session revocation (ADR-0031); sign-out and
  "Forget my votes here" clear the ballot cookie. Used links keep only a hash
  replay marker; expired rows are swept on link request, at startup and on
  redeem (#550, migrations 010/012). Sign-in, redeem and sign-out check the
  request origin (auth audit 2026-11-11, PR #551; no passwords exist).
- **Votes.** Confirmed votes (#360, ADR-0040) store only an HMAC code under
  `PULSE_CONFIRMATION_KEY`; results show all votes and confirmed votes. One
  ballot per signed-in person (ADR-0046, operator 2026-11-11): a new vote
  replaces the earlier one, and on sign-in the newer answer moves to that
  browser.
- **Story UI (pillar 2).** The vote page is a conversation (epic #303, ADR-0035). Home is
  the General poll browser at `/`; the introduction is at `/about`, progress at
  `/start`, four starting questions at `/questions` (Coming soon until
  `VITE_PULSE_*_POLL_ID` are set), "How votes count" at `/trust`. Desktop votes
  under the question, phones use a bottom sheet (ADR-0044); results sit below
  the saved answer; Previous/Next follow My votes and update the address; the
  Answered rail sits beside Explore. White-and-green style (#482), compact
  results charts (ADR-0045), shared Button/Field/Choice with focus-ring tokens
  (#534 parts 1-2).
- **Browse and authoring.** Public listing `GET /api/polls?community=ID`
  (#259) with the browser list (#260); one shared paged-list hook (#535). Poll
  creation and its form are built (ADR-0037). Plain-text poll context (#581,
  migration 017).
- **Contributions** (#246, PR #572, migrations 013/014): mixed into Home,
  "Contributions only" on Explore, detail page with offers, pledges, private
  messages, organizer inbox and updates. Writes refuse another account with
  409 `account_changed` (#603). The form is a short first pass; the remaining
  API fields reach it in #598.
- **Profiles:** opt-in public profiles at `/u/<id>` (#576, migration 015),
  linked from contribution organizers (#577).
- **Poll pictures (P12, ADR-0047): step 1 only.** #593 (#579, migration 016)
  stores pictures in neutral `image`/`image_bytes` keyed by
  `owner_kind`/`owner_id` and serves them; nginx answers uploads over 10 MiB
  with the API's JSON 413; #594 checks sharp loads in the API image. Not
  built: #580, #427, #296, then #586 after #427.
- **MCP:** public reads `get_poll`/`get_results` at `/api/mcp` (PR #323).
  ADR-0036 (voting from AI apps) is proposed only; discovery (#291) unbuilt.
- **Infrastructure:** Postgres (ADR-0020/0021/0023), Resend mail (ADR-0027),
  two images on one origin (ADR-0028), Trivy-scanned in CI and weekly,
  Dependabot on, security headers and self-hosted Inter (#520), fault logs
  without personal data (#503), configurable proxy hops (#549).
  `apps/pulse/DEPLOY.md` is the host-neutral runbook.
- **Not started:** pillar 3, the path to action (#331-#333;
  `proofEmailsOptIn` is collected and leads nowhere); comments (#297);
  abuse reporting (#233-#237); P8 slice 2 and P9-P11; related polls
  (ADR-0025 accepted, `GET /api/polls/:id/related` "Planned, not served";
  P10's declinable gate depends on it); moderator access (the byline uses
  ADR-0037's interim anonymity disclosure); core integration (deferred by the
  operator 2026-10-20, epic #398).

## What stands between this and a usable deploy

1. **Reporting, review and the automatic-hide threshold** remain broad-launch
   prerequisites.
2. **Published starting questions** for `/questions`, and comments (#297).
   The explainer video (#339) comes later.
3. **A host and DNS.** The host is not chosen; DNS for `onlinedemocracy.org`
   still needs configuring.
4. **A sending domain verified with Resend** (SPF/DKIM). DNS work, not code.
5. **The proxy-hop and rate-limit prerequisites** in `apps/pulse/DEPLOY.md`.
6. **A memory floor for picture decoding.** `apps/pulse/DEPLOY.md` states none
   for 40 MP uploads (#593); add one before deploy.

A small invited pilot comes only after 3-6. None of this authorizes a deploy.

## Current operator direction and next work (2026-11-14)

1. **Handoff.** Codex completed both requested audits. No open Pulse product
   PRs. The next feature still awaits the operator's answer below.
2. **Next: #580, a picture in the posting form.** Waiting on the operator's
   answer to "mockup first, or build from the plan and review screenshots?".
   Then #427 (thumbnails and context excerpt length), #296 (picture on the
   question page), #586 after #427.
3. **Pulse test audit complete (2026-11-14)** at `0bf9c61`, authorized by the
   operator after the #592 profile timing regressions. Fresh Codex audit,
   report only, merged in #615: [report](../docs/audits/pulse-tests-2026-11-14.md).
   Six suspect client suites passed all 30 runs each (6,630 test executions).
   Controlled probes exposed missed session-return and startup-history events
   (#613, #614); their 30/30 failures are separate from ordinary flake rates.
   All six privacy/account/migration guard mutations were caught and restored.
   Full baselines passed 967 client and 919 API tests, with no API skips.
   The missing required image check remains with #612. Product fixes are
   tracked in those issues; this audit changed no application code.
4. **`pulse-images` is not a required check**, so a red picture-package check
   (#594) only warns. Do not require it as is (it runs only on Pulse paths);
   #612 has the order of steps.
5. **Verbosity and unnecessary complexity audit complete (2026-11-14):**
   [report](../docs/audits/pulse-simplicity-2026-11-14.md). #616 corrects stale
   posting/browsing status in the server README and links API details instead
   of repeating them. No additional runtime refactor was justified beyond the
   existing owners below. Obsolete routing-history comments are an optional
   cleanup for a future edit; no product behavior changed.
6. **Open follow-ups:** #533 ViewState Try again; #536 Conversation logic into
   flow/ and hooks; #537 VoteCard split; #538 CSS encapsulation and tokens;
   #534 part 3 (Conversation); #539 step 2 (one session provider; operator
   decision); review nits #557, #560, #589, #591, #599, #610; #596 Suggested
   votes reshuffle; #597 contribution threads; #598 creation-form fields;
   #499 dark mode and #500 compact posted notice (mockups merged in #521, not
   built).

## Issue owners (reuse these, do not duplicate)

- #457 readable community paths (proposed `/c/<community-name>`, old links
  kept); #458 one linked thread on community creation, suspension, banning,
  restoration and dissolution; #440 multiple verified memberships. URL work and
  lifecycle deliberation authorize no enforcement or deletion.
- #425 related/closed-question onward navigation, including former #186 (its
  closed-first-question/no-saved-ballot regression is retained, not fixed) and
  #464. A simple slice only after its semantics are agreed.
- #427 previews and thumbnails; #397 posts and the mixed feed (P3, the
  operator's 2026-09-06 "home screen that browses all polls and batches of
  related polls, story-style"; ADR-0022's route back to a question); #291 MCP
  discovery in the existing adapter; #297/#423 discussion; #424
  opinion-diversity prototype; #332 action progress and evidence; #331 side
  columns; #336 suggestions in the conversation; #314 browser-extension idea.
- Reporting: #233 shared submission, duplicates and limits; #234 review; #235
  user, #236 poll, #237 private-message reports; public-comment reports belong
  to #297 on #233's foundation. Policy prerequisites are in
  `memory/pulse-development.md`.
- Poll-creation refinements are an open operator request still to be scoped;
  reuse the built flow.

## Open decisions (operator)

- **#580:** mockup first, or build from the plan and review screenshots?
- **Continuation (#425):** define relevance and explicit story/thread order,
  precedence with answer-selected Next and related alternatives, source-feed
  scope/order, Previous/history behavior, pagination and end-of-feed fallback.
  Preserve saved answers, discard another question's unsent choices, block
  navigation while casting and never cast automatically. Later algorithmic
  feed ordering needs its own accepted policy and implementation scope
  (clarified 2026-10-23).
- **Community lifecycle (#458):** governing/protected rules, creation and
  moderation authority, eligible voters, decision thresholds, appeals,
  state semantics and retention remain open (`memory/pulse-development.md`);
  no lifecycle rule is adopted.
- **Pulse/core compatibility (#398, deferred 2026-10-20):** which
  responsibilities stay with Pulse; how eligibility and identity cross the API
  boundary; how mutable recasts and approval choices map to core's v1 ballot
  rules; what the UI says during batched publication; how rollout preserves
  existing polls. Needs an accepted integration ADR before tickets.
- **#539 step 2:** one session provider.
- **P2: should a later community pick move a returning voter?** Today it does
  not (ADR-0030 writes community once). `claim.test.ts` pins the current answer.
- **Contribution create without an Idempotency-Key or `accountId`** returns a
  misleading "20% savings" error. Whether to file a bug is the operator's call;
  none is filed.
- `polls` is the only plural table, inherited from ADR-0021. Renaming it needs a
  new migration, never an edit to `001`. No decision has been taken.
- `diff-size.sh` says the 400-line WARN "still fires for pulse", but it excludes
  `apps/pulse/**` entirely and reports 0. Whether the comment or the exclusion is
  wrong is still a decision. **Count pulse diffs by hand.**

## Standing decisions — one line each, read the ADR before touching

- **ADR-0020:** Postgres, chosen for the high-traffic, many-process goal; do not
  re-derive the case.
- **ADR-0021:** votes are `(choice, value)` pairs and `method` is text, so a new
  vote type is never a migration. `poll_choice.id` is stable, `position` is
  display-only. Timestamps come from the app, no `DEFAULT now()`.
- **ADR-0022:** one press casts, bought with **reversibility** ("Change my
  answer", gated on `poll.open`). Never extend it to anything final; pillar 3
  commitments still confirm. Never let a double-tap cast twice.
- **ADR-0023:** no `is_entry_point`; a domain may serve several communities and
  the person picks.
- **ADR-0024:** questions are crowdsourced and navigation is computed. Posting
  requires sign-in, voting does not (load-bearing). Duplicates warn rather than
  refuse; removal hides, never deletes; auto-hide after enough flags (count
  unchosen).
- **ADR-0027:** Resend, no SDK. `MailSendError` is a retryable 503,
  `MailRejectedError` stays 500. `ConsoleMailer` in `pnpm dev` is deliberate.
- **ADR-0028:** two processes, **one origin**, nginx forwards `/api`. Splitting
  origins means `SameSite=None` and hand-built cross-site protection. Never make
  `dev-server.ts` production-capable.
- **ADR-0030:** anyone signs in; community is `null` when no domain matches. The
  allowlist only labels; no anti-abuse replaces it, by decision.
- **ADR-0033:** identity is a credential (accepted 2026-10-10; upgrade path
  open).
- **ADR-0035 / ADR-0044:** the vote page is a conversation; voting under the
  question on desktop, a bottom sheet on phones; Next stays with results.
- **ADR-0037:** closes after seven days unless the poster picks later;
  suggestions off (#336); five publications per rolling hour per account; Owner
  and narrow grants; community or General posting (General is never an
  account's community); anonymous by default, naming optional.
- **ADR-0039:** pulse may explain counting, on `/trust`, never claiming more than
  is built.
- **ADR-0040 / ADR-0046:** confirmed votes store a keyed code only. "Most recent"
  means most recently cast; signing in does not confirm votes on closed polls.
  Rotating `PULSE_CONFIRMATION_KEY` makes earlier confirmations unrecognisable.
- **ADR-0047:** pictures in neutral storage; purging a poll tombstones its
  creation replay row (amends ADR-0037 for purged polls only; its broad-posting
  launch gate is unchanged).
- **Product:** a closed poll is a lasting record, shown greyed out; closed
  results are shown to non-voters; a suggestion matching a choice answers
  `on_ballot`; a re-cast is an upsert (`voting/pg-store.ts`), so any "stamped
  once" rule describes the standing answer.

## Live cautions — do not reintroduce

**Migrations and storage**

- Both identity stores keep `discard(tokenHash)` and
  `liveFor(kind, subject, now)` (#213/#215); keep them in step.
- Migrations are forward-only and checksummed. Never edit an applied file, even
  to fix a number in a comment (migration 004 says ADR-0032; it means
  ADR-0033). **Drain old API instances before applying 004, 006 or 007**
  (README "Upgrading").
- Check `apps/pulse/migrations/` before numbering, since open branches may
  claim the next number.
- `vote_choice` can name a choice from another poll, and only the store stops
  it. Any new store must refuse a cross-poll pair too.
- Env vars are `PULSE_DATABASE_URL` and `PULSE_REQUIRE_DATABASE`, **never
  `DATABASE_URL` or `CI`** (they aim at the wrong database and misread
  `CI=false`). turbo 2 strips undeclared env vars, so declare them under the
  task's `env`, and put the must-not-skip guard inside the test. A green tick is
  not evidence a test ran: `gh run view <id> --log | grep -c '# SKIP'`.
- Do not map host port 5432. A local Postgres wins the race, and the error looks
  like a credentials bug.
- `@fastify/rate-limit` uses an in-memory store, so N instances means N times
  the limit — the first thing that breaks on scale-out.

**Serving and secrets**

- **A sign-in token in a log is a sign-in token given away.** Redeem carries it
  in the query string. `SERVED_LOGGER` and nginx `pulse_no_query` strip it, and
  #184 keeps it out of referrers. Check any new log line that includes a URL.
  Never save sign-in tokens in memory.
- `trustProxy` is a hop count, never `true`: `PULSE_TRUSTED_PROXY_HOPS`
  (default 1, allowed 1-4, 0 refused).
- `.dockerignore` patterns need `**/`.
- Compose interpolates the whole file before profiles filter it, so a `${VAR:?}`
  on a profiled service breaks `up db`.
- The client image builds with source-only `tsconfig.build.json`; browser tests
  stay in the app and real-HTTP cross-app suites live in
  `tests/pulse-integration/` (ADR-0041). Import boundaries are enforced by lint
  (ADR-0042); `pnpm test:boundaries` runs the focused suite.
- The root `just up` starts nothing, by design; `just pulse-up` is pulse's.
  `pnpm dev` invents a session secret and confirmation key each run (a restart
  signs everyone out; deliberate) and console mail prints sign-in links.
  `src/main.ts` refuses to start without `PULSE_CONFIRMATION_KEY` (32+ chars,
  not equal to the session secret).
- **Dependencies (#608):** the root `pnpm.overrides` are exact pins, not
  floors. Still open on purpose: minimatch (moderate, needs a major) and
  fastify 5.12.6 (low).

**Client**

- **Poll context allows bidi and zero-width characters** (#607). Handle them
  when #427 renders the excerpt.
- **Never index `results.choices` by `yourChoice`.** Match on
  `ChoiceResult.index` (ADR-0021).
- **Every way of casting must check `poll.open`** (through `locked` plus
  `disabled`). A new gesture or ballot type that forgets it reopens what
  ADR-0022 prevents.
- A tap is `pointerdown`, `pointerup`, then `click`, so test the whole sequence.
  NEXT follows `poll.next`, not whether the preview loaded.
- State that was safe only because a component remounted breaks when something
  resets it in place, so audit every ref. Passive `useEffect` gaps hid real bugs
  behind flaky tests on 2026-11-14 (next-work item 3).
- `findByRole("status")` resolves on "Sending…". Wait on the settled words
  instead, and wait for focus, as #211 does.
- `[hidden]` loses to an author `display`, and jsdom cannot see it. Check
  selector specificity when a class "does nothing".
- **Ask of every guard: which test goes red if I hardcode this?** This file has
  recorded "tests that could not fail" four times.
- To screen-check a closed poll, use a throwaway proxy that rewrites
  `"open":true`. Do not edit the seed. The README's demo details drift, so check
  `dev-server.ts` and `API.md`.
- Mockups are `docs/mockups/pulse-screens/` ("Civic Glass"; `odc-design`
  decides); the #482 restyle follows `docs/mockups/pulse-light-v1.html`.
  `hub-feed-v*.html` is **not** the reference.

**Git and process**

- Use `origin/master...HEAD` (three dots) to see what a branch changes. A
  two-dot `D` usually means the branch is stale, so rebase.
- Stacked-PR rules live in `.claude/skills/odc-pipeline`. Do not copy them here.
- Two agents in one worktree will destroy each other's work. Use
  `isolation: "worktree"`.
- Fresh-context review has returned REQUEST CHANGES on almost every pulse PR,
  with findings the author could not see. Budget for it.
