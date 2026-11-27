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

## Where it stands (2026-11-27)

Per-PR history is in `git log origin/master -- apps/pulse apps/pulse-web`.
**Open Pulse-related PRs (2026-11-27):** #734 (#701 HTTP tests, based on master; needs a master sync and review), #730 (test-audit item 3), and drafts #739/#740 (#685 step 4b server/web, built, unreviewed, held until 4a is live per ADR-0048; operator approved their extra copy 2026-11-27). Codex ran out of usage 2026-11-27; Claude took over its units. #738, #736 and #732 merged 2026-11-27 (#701 is done apart from #734's tests). PR #718 (orchestration skill) merged as `76517a6`. Next Pulse order: #734, #730, the #739/#740 reviews, the fifth #714 nit and the #727 web nits, then #582. Next migration: **021** (020 merged in #728). Future, no ticket to build yet: #729 (epic, smart-contract milestone payouts for contributions; blocked on an ADR for chain, currency, key custody, refund rule and legal position). New ticket #707 (open polls from the main page without a reload; no urgency). #711 (`Contributions.test.tsx` "forgets a sign-in error once the same person has signed in again" flaky in CI) is fixed and closed in #723. #425 Next/Previous is on hold (operator, 2026-11-19).

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
  with the API's JSON 413; #594 checks sharp loads in the API image. #296
  (2026-11-26, #727, `89742bd`): the question page shows the poll's picture
  under the question (description as alt), plain-text context, then the
  byline; a poll with no upload shows the small default tile (ADR-0047 §6).
  #733 (2026-11-27, #735, `ae51df6`): test-only fix; `public-vote-card.test.tsx`
  waits for focus inside `vi.waitFor` after "Load more votes" (the check ran
  before LoadMore's focus effect on slow CI). Component unchanged.
  #738 (`c16a678`, 2026-11-27, part of #685): four of the five #714 nits.
  VoteCard moves focus after the session-check Try again (to "Sign in with
  email to vote", else the first choice; focus elsewhere is left alone); a
  test that the header shows neither Sign in nor Account while the session
  loads (no code change; the header keeps "Sign in" when the check fails,
  "unknown"); comments on `PublicVotes` key and `use-session`.
  #701 server precondition (#736, `03152e0`, no migration): DELETE
  `/api/contributions/:id/image` takes optional `expectedImageId`; a mismatch
  returns 409 `image_changed` ("The picture changed, so it wasn't removed.
  Check it and try again."), with no picture or audit change; legacy requests
  are unchanged.
  #701 web half (#732, `23855fb`, closes #701): picture field on the
  new-contribution form; picture on the contribution page (description as
  alt, tile fallback); organizer replace/remove with removal bound to the
  shown upload; after a 409, removal stays hidden and "Reload picture" shows
  until a newer picture loads. Shared `ItemPicture` (renamed from the
  question picture; token `--item-picture-tile-size`). Leftover #732 nits:
  TwoPress confirm/cancel are 22 px tall, 8 px apart (make 44 px, style
  confirm as destructive); split the seven-way it.each in
  `Contributions.test.tsx`; the PUT/DELETE 401 fieldError hide has no test;
  typing in Picture description clears `uploadRefused`, so "Choose your
  picture again" can vanish while the picture is gone.
  #701 server half (#728, `e6cd870`, migration 020): `image` on every
  contribution body and row (tile fallback until #586); poster-only
  PUT/DELETE `/api/contributions/:id/image`, signalled by `canManage`; the
  picture routes have their own 400 and 401 messages. Not built (shared field
  #700 merged in #717; poll form #580 merged in #720): #427,
  then #586 after #427. Pictures now
  extend to every main-page item (operator 2026-11-18; ADR-0049).
- **MCP:** public reads `get_poll`/`get_results` at `/api/mcp` (PR #323); #710 (`3e6bf64`) adds `get_public_votes`, passes `votePrivacy` through, and makes MCP work through nginx (production `publicOrigin` = `PULSE_WEB_ORIGIN`; nginx forwards `$http_host` and blanks `X-Pulse-Internal`). MCP does not work through the 5173 Vite proxy; `apps/pulse/README.md` should say so (small nit, not ticketed).
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
3. **Railway and DNS.** Railway is the chosen host. Configure the Railway
   services and DNS for `onlinedemocracy.org` before the pilot.
4. **A sending domain verified with Resend** (SPF/DKIM). DNS work, not code.
5. **The proxy-hop and rate-limit prerequisites** in `apps/pulse/DEPLOY.md`.
6. **A memory floor for picture decoding.** `apps/pulse/DEPLOY.md` states none
   for 40 MP uploads (#593); add one before deploy.

All pre-pilot code fixes (#681-#684, #691) are merged; no Railway deploy has
happened. The pilot waits for 3-6 above: the operator's Railway setup, DNS and
the live checks in `apps/pulse/DEPLOY.md` (HSTS, client rate limits) on the
public hostname, before inviting anyone.

## Current operator direction and next work (2026-11-15)

0. **Deploy on Railway (operator, 2026-11-15); work split 50/50 Codex/Claude.**
   Auth audit `docs/audits/pulse-auth-2026-11-15.md` (Codex, read-only,
   FIX-BEFORE-PILOT; no passwords exist). All pre-pilot fixes merged
   (2026-11-18 unless noted): #682 nginx for Railway in #688 (`6c48a1e`,
   2026-11-15) and #683 `__Host-` cookies and Origin checks in #687
   (`f4a27fd`, 2026-11-15); #684 Railway
   section of `apps/pulse/DEPLOY.md` in #689 (`ad5b15d`); #691 nginx sends HSTS
   in real-IP mode when the edge reports https in #693 (`0cb347e`); #681 sign-in only after a click naming the account, with lost-answer
   recovery via `/api/me` and a GET-only Try again, in #695 (`9e17d8d`); #692
   flaky `Profile.test.tsx` in #694 (`eaa5f88`). After the pilot: #678 ballot
   revocation, #679 atomic link limit, #680 idle timeout and owner re-sign-in.
   #697 (home list spans the width between rails) merged in #699 (`bb8f265`).
   Skill PR #698 (keep a healthy queued backlog) merged in `d4c051a` (2026-11-19).
   **Per-poll anonymous or visible votes (#685, operator 2026-11-15):** chosen
   once at creation, clearly shown, simple. ADR-0048 (#690, `3289d74`) decided
   it; the build follows its decision 14 ship order. Step 1 (migration 018 +
   both stores) merged in #703 (`2a7b644`, 2026-11-18). Step 2 merged
   2026-11-19 in two PRs: #706 (`592681c`) public-vote casting, `/ballot` and
   `/my-votes` private no-store, `votePrivacy` on reads, and a structural
   "Verified voter" rule (app plus migration 019, locale-free, shown on the
   profile name field); #708 (`1939bac`) the public vote list (sealed
   cursor, hidden filter, live names, capped per-address limiter) and
   removing your own public vote. Creation still refuses `"public"`. Step 3
   merged in #710 (`3e6bf64`, 2026-11-19): MCP `get_public_votes` and
   `votePrivacy`, nginx `$http_host`, and a public-proxy smoke test in the
   `pulse-images` CI job. Step 4a merged in #714 (`789c567`, 2026-11-25): the
   vote card says "Votes are public." or "Votes are anonymous."; public polls
   need email sign-in to vote (choices disabled while signed out); the public
   vote list shows the profile name or "Verified voter"; you can change or
   remove your own public vote while the poll is open (with an account
   recheck); My votes has a Public tag; `/trust` copy covers public votes (it
   does not claim creators can choose yet); `/api/my-votes` rows carry
   `votePrivacy` (additive, both stores, `API.md`); two server messages
   reworded; ADR-0048 decision 4 quote updated; the dev server seeds a public
   poll at `?poll=public-vote-demo`. Production creation still refuses
   `"public"`. **Next: step 4b** (the API accepts `"public"` at creation and
   the creation form shows the option; UI review). ADR-0048 says 4b deploys
   only after 4a is live in production. Pulse has no production deploy yet
   (Railway setup is the operator's), so 4b's code may be built but its deploy
   waits on 4a being live.
   **Leftover #714 nit (the other four closed in #738):** keep `role="status"`
   mounted on the account-changed region in `screens/Conversation.tsx`.
   Watch item, no ticket: `main.test.ts`
   `unexpected_startup_database_fault_does_not_log_personal_message_or_cause_28P01`
   failed once locally in a full run and passed alone. Since #723 a failure
   reports exit code, signal and stderr tail, so it is diagnosable; the cause
   was not reproduced.
   **Leftover #723 nits:** the `main.test` failure output could strip the
   injected test markers from the stderr tail; the #711 test needs a comment
   on why it no longer uses `switchableMe`.
   Rules (operator, 2026-11-15): the poll's setting decides and the voter
   never chooses; anonymous polls show nobody's details; visible polls need
   an email sign-in to vote and show the voter's profile name, which hiding
   the profile later does not remove; a voter with no profile name shows as
   an unnamed verified voter, with no prompt for a name.

1. **Next: pictures on every main-page item.** Operator direction
   2026-11-18: "All polls, posts, questions or whatever goes on main page
   should take images as well, like Rediit." ADR-0047 covered polls only, so
   ADR-0049 (#704, `b614808`, accepted) extends it to contributions and
   discussion topics. Operator answers E1-E3 (2026-11-18): no upload shows the
   community default, then a tile; one picture per item; site-owner soft
   delete covers topics. Order: #700 (one shared picture field; done: mockup `docs/mockups/pulse-picture-field-v1.html` merged in #713 (`53de813`), approved by the operator 2026-11-25, registered in `docs/mockups/CANDIDATE_CONTEXT.md`; component merged in #717 (`5885d9c`, 2026-11-26): `components/PictureField.tsx`, `hooks/use-picture-field.ts`, `hooks/picture-upload-errors.ts`, `uploadPicture` on `PulseApi`, and the `--red-wash` light token in `tokens.css`; the issue's acceptance looks met, so it is ready to close, the operator closes it; the poll form adopted it in #720) → #580 (poll form) and #701 (contributions take a
   picture) → #427 (thumbnails for every item in the main list), #296
   (picture on the question page; done in #727), #586 after #427. #541 topics use #700.
   **#580 merged in #720 (`f18804e`, 2026-11-26):** the poll form (`/new`)
   uses the shared picture field: an optional picture under the question,
   sent as `image { id, alt }` with `POST /api/polls`. Post and the
   confirmation check the question and picture together. An expired picture
   or session keeps the draft and the description (the draft store keeps only
   the description string); the signed-out notice asks the person to choose
   the picture again. The production CSP now has `img-src 'self' blob:`. The
   question page shows the picture since #727 (#296). Leftover
   #720 nits: the "choose your picture again" line keys off the description,
   not whether a picture existed (a 401 during upload before typing misses
   it); the question error has no warning icon while the picture errors do
   (unify the Field problem style); not checked on a device: the hidden file
   input on iOS Safari. Leftover #727 nits (web, next Pulse web branch): the picture-to-context gap is 8 px (match the hero gap); the tile is aria-labelled and repeats the community name (consider aria-hidden); tile colours borrow `--hover`/`--chip`/`--green-wash` (add dedicated tile tokens); the stub `poll()` in `test/stub-api.tsx` omits `image` though the API always sends it; the tile hash moves to a shared module when #427 lands; the `Conversation.css` byline comment is stale. Leftover #728 nits (the pending_limit copy in `images.ts` was fixed in #732): a malformed `image` on `POST /api/contributions` still returns the offer-pricing catch-all (the web form validates the description client-side); `API.md` PUT/DELETE says "poster" while the code says "organizer"; the picture-message choice compares route URL strings (prefer per-route config); add a test that signed-out `POST /api/contributions` still says "Sign in to contribute."; the retry fingerprint is an unkeyed SHA-256 of [id, alt]. Leftover #717 nits still open (the size, file-name, stub and hostile-JPEG ones were fixed in #720): a Replace that finishes in the background always takes focus (the mockup asks for it); EXIF-rotated JPEGs may say "wide" for a tall photo; #499 must add a dark `--red-wash`.
2. **Audits 2026-11-14 are complete; none changed product code:**
   [targeted tests](../docs/audits/pulse-tests-2026-11-14.md) → #613/#614;
   [simplicity](../docs/audits/pulse-simplicity-2026-11-14.md) → #616;
   [broader quality](../docs/audits/test-quality-2026-11-14/README.md) → #621-#629.
   All of #613, #614, #621, #622, #624-#629 merged in #657 (2026-11-15), which
   also made `SessionSigner.verify` refuse empty timestamp fields. The review
   nits #557, #560, #589, #591, #599, #605 merged in #659; #596 (the open
   question stays highlighted in Suggested votes until voted on, operator
   2026-11-15) and #610 merged in #661. #533 (ViewState `onRetry` renders the
   shared Try again) and #653 (`use-suggested-votes` and `use-page-banner` own
   fetching; `PageBanner` removed; no component calls the API or imports a
   screen stylesheet) merged in #667.
   A Claude review found the findings real but most tickets over-scoped; the
   operator-approved narrowed scope now heads each ticket body (2026-11-14),
   and the shared verifier gaps moved to contracts ticket #645.
   **Pulse test audit 2026-11-26** (`docs/audits/pulse-tests-2026-11-26.md`;
   operator approved items 1, 2 and 4 now, 3 later): item 4 is merged in #721
   (`9882ed7`), which adds to `odc-testing` risk-based cases beyond the
   required ones, a storage-test layer, real-socket scope and flaky-test
   quarantine rules. Item 1 is merged in #723 (`084217d`): the #711 flaky test now
   defers session replies in order, the `main.test` startup cases report exit
   code, signal and stderr tail (30 s allowance), and `dev-proxy.test.ts`
   rejects with the bind error. Item 2 is merged in #725 (`03a4cbc`): the
   integration suite casts, lists and removes public votes through the real
   `HttpPulseApi` adapter, and `apps/pulse-web/test/public-proxy-smoke.sh` (run
   in the `pulse-images` CI job) sends random fake query and Referer markers
   through nginx and fails if either reaches the access log, after checking the
   marked request was logged. Item 3 (later): split the Conversation and
   Contributions tests and add a typed stub API. Items 1, 2 and 4 are done.
   **Leftover #725 nits:** the cookie check after a cast compares the jar rather
   than asserting no Set-Cookie at all.
3. **CI selection #619 merged (0d2828c).** `pulse-images` is not a
   required check yet. #612 merged in #671 (5afc07d, 2026-11-15): it reports
   on every PR ("no Pulse changes" in seconds otherwise) and runs the server's
   own `processImage()` in the image (demos on #612). Owed by the operator:
   add `pulse-images` to the protect-master ruleset.
4. **Open follow-ups:** #536 Conversation logic into
   flow/ and hooks; #537 VoteCard split; #538 CSS encapsulation and tokens;
   #534 rest (one shared focus ring and the `aria-disabled` ring fix merged
   in #672, 2026-11-15; left: screens' own button styles, the 375px nav row
   hiding the ring's bottom edge, optionally a wider ring on a focused invalid
   checkbox); #539 step 2 (one session provider; operator decision); #597 contribution threads; #598 creation-form fields;
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

- **Rich-text contribution descriptions with images, or the single picture of
  #701:** operator (2026-11-26): decide after #701's web half is built and the
  two can be compared. Rich text would sit on top of the single picture (the
  main-page thumbnail still needs one chosen picture); it needs server-side
  cleaning of stored rich text, per-image reporting and removal (#583 assumes
  one picture per item), and its own upload limits. No ticket until decided.
- **Cross-device vote history:** let a signed-in account see its own votes
  from every device (server computes the ADR-0040 code per poll)? Reverses
  ADR-0040's "accepted limit" wording; owner-only versus public was asked and
  not answered. Separate from #685, whose rules are settled.
- **Continuation (#425):** operator direction 2026-11-15: Next and Previous
  move through Suggested votes (detail on the issue). Still open: do answered
  questions keep My votes Previous/Next, what Next does on a phone (no rail),
  and the end of the list. Older open points: define relevance and explicit story/thread order,
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
- **2026-11-25: ADR-0048 has drifted.** Decision 8's reserved-name rule
  describes whitespace collapsing only, but `API.md` and the code use NFKC
  normalization and ignore marks, punctuation and blank filler characters.
  Needs an architect update to the ADR.
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

- A `Promise.all` concurrency test can serialize by chance and pass with the
  guard removed. Hold a conflicting lock from a separate connection, confirm
  the queue with `pg_blocking_pids`, then release; mutation-check the lock mode.
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
