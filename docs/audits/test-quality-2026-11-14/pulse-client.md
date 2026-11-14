# Pulse client and integration test-quality audit — 2026-11-14

Audited detached `cf07079` in `/workspace/odc-audit-client`. Report only. Scope: every file in `apps/pulse-web/test/` (71 suites, 967 collected cases, three helpers) and `tests/pulse-integration/test/` (six suites, 51 collected cases): **80 files, 1,018 cases, 20,527 lines including helpers**. Collection counts are from Vitest `list`, including parameter expansion, not an estimate from `it(` occurrences. No skipped/only/todo declarations were found. No core/verifier source or API private implementation was read; integration setup imports and the documented HTTP contract were used.

The suite provides substantial protection for ordinary product behavior and several difficult ownership/scheduling cases. Four bounded gaps merit follow-up. Two are missing regression oracles demonstrated by surviving mutations; two are current robustness defects demonstrated by new failing probes. This is broader than the prior timing audit, not a repeat of #613/#614.

## Findings

### CQ1 — P2: incomplete successful vote responses are accepted by the adapter and can strand a send

**Evidence:** `apps/pulse-web/test/http.test.ts:449–452`, `apps/pulse-web/src/api/http.ts:181`, `apps/pulse-web/src/hooks/use-cast-vote.ts:75–98`.

The HTTP test for sending a ballot returns only `{status:"counted"}` and regards successful resolution as correct. That body is impossible under the documented contract: counted/changed require `ballot` and `results` (`apps/pulse/API.md:875`). The adapter treats any parseable JSON success as a typed `CastOutcome`. The hook's success callback spreads `outcome.ballot`; a successful `{}` response therefore throws `TypeError: outcome.ballot is not iterable` inside the fulfillment callback. Its sibling rejection callback does not catch an exception thrown by that fulfillment callback. The returned promise rejects and hook state remains `casting`; this bypasses the ordinary uncertain-send recovery.

A new probe using **the real HTTP adapter and real useCastVote hook** with `new Response("{}")` fails: it receives that TypeError instead of `{status:"failed",refused:false}`. This is a malformed-success robustness defect, not evidence that the current server normally emits this body. Existing HTML-200 and cut-off-body tests cover JSON parsing/transport failure, and hook tests manually inject `ApiError(200, ...)`; none joins this actual malformed-success seam.

**Contained fix:** make the request-shape test return a complete legal outcome; add a regression joining adapter→hook with empty JSON/missing ballot/missing results/unknown status (plus `closed`, counted and changed controls). Validate enough of the cast response at the adapter boundary to raise an `ApiError` with the successful status, preserving the unknown-write classification. Ensure a decoding failure settles the pending send and offers recovery; do not reinterpret it as a 4xx refusal.

### CQ2 — P2: the owner-read HTTP precondition can disappear with every profile test green

**Evidence:** `apps/pulse-web/test/http.test.ts:60–71`, `apps/pulse-web/test/profile-session.test.tsx:327`, `apps/pulse-web/src/api/http.ts:99–104`; public contract `apps/pulse/API.md:403`.

The profile session tests meaningfully verify `myProfile("a")`, stale responses and `409 account_changed`, but they replace the HTTP adapter with a mock. The adapter test calls only `myProfile()` and never verifies the `ownerAccountId` query. There is no real-HTTP profile read/save/share/hide suite; the integration file with “profile” in its name checks only display-name normalization parity.

**Surviving mutation:** replace the conditional owner URL with `"/me/profile"`, dropping the owner query on every call. `http.test.ts`, `Profile.test.tsx`, and `profile-session.test.tsx` all pass: **92/92 cases, zero skipped**. These are all existing suites that directly exercise the adapter's profile methods or the profile screens. No integration suite invokes the profile HTTP adapter methods. Production currently sends the parameter correctly; the finding is a demonstrated missing regression oracle, not a present ownership bypass.

Without that parameter, a recovery read made while the page still believes A is signed in can return B's private profile under B's changed cookie and fill A's editor. The server's documented refusal cannot help when the client stops sending its precondition.

**Contained fix:** add one adapter test using an escapable account id and assert the exact query plus returned envelope. Add a small in-memory HTTP profile lifecycle test with account A→B cookie replacement: A's owner read must return `409 account_changed` with no profile; hidden and visible profile reads should exercise the public projection. Keep the existing component timing tests, which cover a different layer.

### CQ3 — P2: the sign-in privacy tests do not protect query-safe access logging

**Evidence:** `apps/pulse-web/test/referrer-privacy.test.ts:17–21`, `apps/pulse-web/nginx.conf:17–20`.

The privacy suite verifies the early no-referrer meta tag and omission of `$http_referer` from one named log format. It never verifies that the request target excludes query strings, or that `access_log` actually selects the checked format.

**Surviving mutation:** change the active format from `"$request_method $uri $server_protocol"` to `"$request_method $request_uri $server_protocol"`. Both existing policy suites remain green: **7/7 cases** in `referrer-privacy.test.ts` and `security-headers.test.ts`. `$request_uri` includes the original query; loading `/sign-in?token=SECRET` would put the token in the access log. The current nginx configuration uses `$uri` correctly. This finding concerns a security regression that the named privacy tests would accept, not an observed current leak.

**Contained fix:** assert the active access-log format and reject query-carrying variables (`$request`, `$request_uri`, `$args`, `$query_string`, `$arg_token`) in that active format, while retaining the existing Referer check. A focused nginx request/log smoke test would strengthen this further if nginx is available; a giant snapshot of the whole config is unnecessary.

### CQ4 — P3: closed public results wait forever for the optional private ballot

**Evidence:** `apps/pulse-web/src/hooks/use-closed-results.ts:69–76`; nearest coverage `apps/pulse-web/test/Conversation.test.tsx:493` and `test/conversation-desktop.test.tsx:137`.

`useClosedResults` intentionally treats a rejected ballot lookup as optional, but places that promise in `Promise.all` with public results and supplies no deadline. A ballot request that never settles prevents perfectly available public results from rendering. Neither `HttpPulseApi.myBallot` nor `results` supplies a transport deadline. The extensive 5-second tests cover initial saved-answer restoration and uncertain-send checks, not the closed-results read.

Two new probes fail against unchanged source: a hook probe still has `{status:"loading"}` after 60 seconds of fake time despite successful results; a **Conversation screen probe** loads a closed question, presses See results, observes the results request, advances 60 seconds and still cannot see the available zero-voter result. Close remains available, so this is not a navigation trap, but reopening cannot recover the available public count while this endpoint stalls.

**Contained fix:** bound the optional ballot read and show available public results without “yours” if its deadline expires; bound the essential results read separately and offer retry on failure. Test resolving, rejecting, and never-settling optional reads; ensure a late ballot does not overwrite newer state after close/reopen or navigation. Keep the existing initial-restore deadline tests.

## Coverage map against built user flows and client contract

| Built flow / public seam                                                   | Meaningful existing coverage                                                                                                                                                                                                                                                       | Remaining limit / ownership                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, community browse, contributions filter, public navigation            | Browse/Contributions drive links, cursor progression, failures retaining rows, empty cursor-only pages, focus and no cast; route tests cover normalization/escaping; poll-creation HTTP verifies discovery                                                                         | Static CSS checks cannot prove layout. #605 owns existing Load more follow-ups; #427 owns future previews                                                                                                                    |
| Request email link, multi-community choice, redemption, return destination | SignIn tests form/keyboard, opt-in, field vs request errors and distinct 429/422 codes; Redeem covers StrictMode once-only, retry, terminal links and focus; App drives real URL/history; end-to-end covers real mail capture/cookies/origin/sign-out                              | Main app link-click sequence is composed across mocked UI + real adapter suites, not a browser mail round trip. #613/#614 already own initial subscription gaps                                                              |
| Guest and signed-in single/approval vote, change, closed poll              | VoteCard/Conversation plus real conversation HTTP test assert complete selections, stored ballot, one voter on replacement, closed results, no accidental casts                                                                                                                    | CQ1 and CQ4. Signed-in cross-browser “newer ballot moves here” is documented but no dedicated client real-HTTP UI test joins this merge to refreshed answer/rail                                                             |
| Lost reply, uncertain write, leave while sending, restore after reload     | Real HttpPulseApi-backed fetch simulator records a write then drops its reply; phone/desktop tests check actual recovery requests. Dedicated 4xx vs 0/200/5xx hook matrix. Conversation tests hold sends across routes, ordering, forget and timeout                               | Integration network retry injects failure **before** POST, so it alone proves retry, not write-then-lost-reply reconciliation. Fetch simulator covers that latter seam but cannot prove TCP/cookie behavior                  |
| My votes, rail, Previous/Next, history and swipe                           | Pure ordering logic; hook stale generations and stuck cursors; rail/pager delayed pages and failure fallback; real HTTP browser isolation and reload; phone/desktop response states                                                                                                | #591 owns known later-votes ref, dock cleanup and reload follow-ups. 5ms wall-clock sleep in my-votes-http and 50ms quiet window in navigation are bounded but less deterministic than deferred/injected time                |
| Email confirmation and truthful totals                                     | confirmed-status tests focus/storage/fresh numbers/errors, closed-poll restriction, stale revisits; ResultsPanel/BarChart count/share/approval semantics, accessible table and chunk failure fallback; Trust copy limits                                                           | The confirmation UI mocks its refreshed server results; API-level counted-vote correctness belongs to the API audit. No real-browser screen-reader or native-dialog proof                                                    |
| Post a question, settings, promise, retry/draft recovery                   | Pure limits/Unicode/request conversion; NewPoll keyboard, same-tick double submit, key stability across unknown failure/cancel, changed payload rotation, quota messages, 401 restore-once and draft privacy; poll-creation HTTP signs in, creates, replays, reads, browses, votes | UI uses injected keys such as `key-1`; real HTTP uses UUIDs, so the layer distinction is deliberate. Context/picture entry are future tickets #580/#296/#427, not missing tests for built UI                                 |
| Profile view/edit/hide/share and owner tools                               | Profile tests visibility changes, text escaping, validators, focus, distinct public/owner contribution endpoints; profile-session covers account changes and late replies, including commit-boundary regressions; name-parity tests 29 samples                                     | CQ2. Parity is not an independent specification; explicit expected name/bio tests provide the independent examples                                                                                                           |
| Contribution create/help/pledge/progress/private message                   | UI tests preserve/clear drafts by owner and expiry, retain request keys, expose inline errors, remove private inbox and reject late refusals; real HTTP tests permissions, idempotent retries, no private identity, closure, savings boundary and messaging                        | Browser-fetch shim ignores credentials modes in contributions integration. Unit adapter credential assertions compensate (mutation killed). Full UI+HTTP publication is split across layers, not exercised in a real browser |
| Styling, motion, breakpoints and production policy                         | Source guards retain known declarations; security policy/font and dev Host proxy tests; element-width and dock observer mocks exercise callbacks                                                                                                                                   | A passing regex does not prove cascade, overflow, viewport fit, actual safe-area behavior, touch behavior, focus-ring paint, nginx header execution or a browser cookie policy                                               |

## Accuracy, usefulness, mocks, duplication and excess

- **Useful rather than merely green:** most screen tests assert semantic roles/labels, user actions, retained values, actual API calls and forbidden writes. Deferred promises actively reverse response order. The vote unknown-write tests do not “recover” using a guessed rail answer; they assert real read-back requests. Two sensitivity controls below confirm meaningful failure discrimination.
- **Avoid expanding everything into a Cartesian matrix:** 81 cases in header-votes exercise shared header behavior across routes. Some route fan-out is valuable because screen wiring has differed historically, but future additions should keep a route smoke matrix and put detailed retries/focus/forget state transitions on the shared owner. Do not add the same 10 recovery variants to every route unless routing differs. No evidence supports deleting these existing regressions wholesale.
- **Static CSS tests have real but limited value:** phone-fit, light-restyle, shared-controls, header-focus, signin-width, question-motion and profile-styles encode known fixes. They also lock exact selector spelling, token formulas, declaration order and formatting; equivalent valid refactors can fail, while a later overriding rule can pass. Retain high-value layout/accessibility invariants, consolidate duplicate token/class-string checks as #534/#538 evolves, and prefer a small browser overflow/focus/viewport smoke suite for claims about rendered geometry. No new UI change was made, so no product browser review was performed in this audit.
- **Model realism:** the `pulse-server.ts` simulator is appropriately stateful: it stores the ballot before simulating a dropped reply and uses a TypeError network failure. `stub-api.tsx` is convenient but not a server: default `cast` always reports ballot `[1]` even if submitted picks differ, and `as PulseApi` weakens future interface-completeness checks. `session-changes.test.tsx` additionally casts a contribution with null benefit/needs as the string-based interface. Custom tests usually override these seams, so these are fixture debt, not proved present defects. Prefer complete shared builders and echo submitted ballots when testing outcome behavior; keep unexpected calls observable. CQ1's impossible HTTP response is the concrete harmful case.
- **Test-only browser emulation:** three integration files use fuller named-cookie maps; conversation/my-votes use a single joined cookie string replaced wholesale when Set-Cookie occurs. The latter can discard an unrelated retained cookie if a future response updates only one cookie. These are adequate for their present guest flows, not reusable browser simulators for account migration. All ignore real SameSite/Secure/path/expiry/CORS enforcement and do not model navigation network loads.
- **No orphan removal recommended:** ChatPreview/decision/dialog tests cover the explicitly served `/preview/chat` prototype, whose confirmed-only rule is separate from live guest voting. They are not proof of live voting eligibility, but remain purposeful. Noncompact ResultsPanel assertions exercise count/label rendering also used by the compact chart failure fallback. Pure vs component vs HTTP overlap is generally a useful separation, not automatically duplication.
- **Timing and cleanup:** most fake clocks are restored in finally, globals are unstubbed where installed, cleanup unmounts screens, servers close in finally/afterEach, and no external DB is used here. A few helpers restore prototype mocks only at a successful test end, and browser-history/global setup is duplicated; move restorations to afterEach during normal maintenance. The dialog polyfill intentionally lacks background inertness and native focus behavior; successful keyboard tests verify component logic, not browser dialog modality. No new natural flake was established; controlled failures below are not flake statistics.
- **Separation from existing tickets:** #591, #599, #610, #533, #534, #536–#539, #613 and #614 retain their owners. The issue inventory also includes #605, #596, #589, #560 and #557; this report does not refile their known UI/recovery/style follow-ups. Future features listed in API/roadmap are not counted as regression holes for absent UI.

## Unproven follow-ups (not additional findings)

- Most non-list HttpPulseApi methods trust decoded JSON shapes. CQ1 proves the cast consequence only; this audit does not claim a demonstrated failure or privacy leak for every other envelope. A small boundary-decoding matrix would establish which other malformed successes deserve handling.
- SuggestedVotesRail has only two direct component cases. Offline discovery, failed older-ballot checks, candidate exhaustion and viewport/source changes deserve targeted probes before broadening the feature. #596 and #529 remain the relevant existing product owners; absence of a case is not evidence of a present defect.
- Existing static CSS tests can survive a later cascade override, and mock-cookie transport can overlook browser policy differences. These are known capabilities of the test methods, not measurements of current browser breakage. No visual or native-browser conclusion follows from this audit.

## Execution evidence and reproducibility

Node 20 / pnpm environment: `source /workspace/.local/bin/odc-env`. Vitest 4.1.12. No broad suite rerun: the supplied earlier 967-pass client baseline remains context, not a new measurement. `vitest list --json=...` collected the complete inventory without running test bodies.

| Experiment                                                             |                   Existing/new cases | Result                                                                | Evidence                                    |
| ---------------------------------------------------------------------- | -----------------------------------: | --------------------------------------------------------------------- | ------------------------------------------- |
| Unmodified HTTP adapter + malformed `{}` cast → useCastVote            |                                1 new | Fails with TypeError; expected unknown failure state                  | `/tmp/audit-client-probes.log`              |
| Unmodified closed-results optional ballot never settles                | 2 new (hook and Conversation screen) | Both fail after 60s fake time; available public results remain hidden | Same log                                    |
| Optional ballot explicitly rejects (probe control)                     |                                1 new | Passes: public results render without yours                           | `/tmp/audit-client-probes.log`              |
| `$uri` → `$request_uri` in active nginx format                         |                           7 existing | All pass: mutation survives                                           | `/tmp/audit-client-query-log.log`           |
| Drop myProfile owner query                                             |                          92 existing | All pass: mutation survives                                           | `/tmp/audit-client-owner-query.log`         |
| Contributions credentials `same-origin` → `omit` (sensitivity control) |                          59 existing | 2 fail / 57 pass: mutation killed                                     | `/tmp/audit-client-credentials-control.log` |
| Vote refusal predicate → `false` (sensitivity control)                 |                          15 existing | 6 fail / 9 pass: mutation killed                                      | `/tmp/audit-client-refusal-control.log`     |
| Unmodified end-to-end + contributions real HTTP adapter suites         |                          16 existing | 16 pass, zero skipped                                                 | `/tmp/audit-client-http-focused.log`        |
| Restored focused client baseline                                       |                         139 existing | 139 pass, zero skipped                                                | `/tmp/audit-client-focused-baseline.log`    |

Reproduction runners are preserved outside the worktree:

```sh
python3 /tmp/audit-client-mutations.py  # the two surviving mutations, sequentially
python3 /tmp/audit-client-controls.py  # the two killed sensitivity controls
python3 /tmp/audit-client-probes.py    # temporary test: 3 failing regressions + 1 passing control; removes it
```

Each mutation runner saves the exact source bytes and restores them in `finally` before the next mutation. The probe runner removes its temporary test in `finally`. No git commit/push/checkout/stash/reset was performed. Complete source for the probe and exact mutation substitutions are in those runners, not hidden inside changed product files. JSON inventories: `/tmp/audit-client-test-list.json` and `/tmp/audit-integration-test-list.json`; assertion-focused indices for the large suites: `/tmp/audit-major-assertions.txt`, `/tmp/audit-navigation-assertions.txt`, `/tmp/audit-controls-assertions.txt`.

Review method: read the governing root/app/integration guides, Pulse memory, testing/review skills, API contract, prior audit and current issue inventory; inventory every test/helper; inspect setup, behavior names and assertion oracles across all files, using assertion-focused AST indices for the largest suites plus direct full-section reads for suspicious paths. Follow client implementation into the adapter, state hooks, profile ownership, results and display composition where needed. This is a file-level comprehensive audit with selected deep probes, not exhaustive mutation testing or a claim to prove every interleaving. The six previous 30× timing repeats were not repeated here.

## Complete file inventory

Counts are expanded collected tests. Helper rows have zero tests. Paths below are relative to the audited repository.

| File                                                       | Lines | Cases | Purpose / assessment                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----: | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/pulse-web/test/AccountMenu.test.tsx`                 |   138 |     7 | Disclosure keyboard/outside/focus closing; pending error after reopen. Retain.                                                                                                                                                                 |
| `apps/pulse-web/test/App.test.tsx`                         |   475 |    19 | Real URL routing, token redemption/return storage/history, prototype split and posted notice. Retain; CQ2 is below its mocks.                                                                                                                  |
| `apps/pulse-web/test/AppShell.test.tsx`                    |    46 |     3 | Main/banner/side-rail slots and absence of empty rail. Small structural smoke coverage.                                                                                                                                                        |
| `apps/pulse-web/test/BarChart.test.tsx`                    |   134 |     7 | Accessible table, chart orientation, highlighting, pattern and legend; jsdom width fallback. Retain.                                                                                                                                           |
| `apps/pulse-web/test/Browse.test.tsx`                      |   477 |    15 | Public discovery/pagination, failed/stuck/empty pages, source changes, route links, rail and keyboard focus. Retain.                                                                                                                           |
| `apps/pulse-web/test/Button.test.tsx`                      |    86 |     5 | Shared variants/secondary-small type restriction, disabled input and banner retry wiring. Runtime type-test assertion is scaffolding; typecheck supplies the real oracle.                                                                      |
| `apps/pulse-web/test/ChatPreview.test.tsx`                 |   416 |    20 | Prototype dialog selection/send/retry/reset, stale sends, keyboard and focus. Intentional preview coverage, not obsolete live-vote tests.                                                                                                      |
| `apps/pulse-web/test/Contributions.test.tsx`               |  2186 |    59 | Mixed feed, create/detail/entry/message/progress, ownership/expiry, private inbox, idempotency, adapter validation and per-field focus. Broad meaningful suite; fixture and layer limits discussed above.                                      |
| `apps/pulse-web/test/Conversation.test.tsx`                |  2379 |    75 | Live voting, restoration/history/rail, uncertain sends, navigation while sending, forgetting, deadlines, results and focus. Strong deep coverage; CQ1/CQ4 seams missing.                                                                       |
| `apps/pulse-web/test/CopyLink.test.tsx`                    |    67 |     3 | Clipboard success, absent/rejected API fallback and repeated manual selection. Retain.                                                                                                                                                         |
| `apps/pulse-web/test/DecisionDialog.test.tsx`              |   152 |     7 | Prototype dialog semantics, selected id, Close/Escape, focus return and pending state. Native modality not modeled.                                                                                                                            |
| `apps/pulse-web/test/LoadBoundary.test.tsx`                |    38 |     2 | Lazy-child failure fallback plus intact sibling/normal child. Complements chart failure seam.                                                                                                                                                  |
| `apps/pulse-web/test/MyVotes.test.tsx`                     |   208 |    10 | Saved-answer list, pagination/cursor-only empties, read errors/retry, labels, focus and forgetting. Retain.                                                                                                                                    |
| `apps/pulse-web/test/NewContribution.test.tsx`             |   651 |    21 | Publication validation/focus, owner-bound drafts, expiry, deliberate sign-out and late account refusals. Retain.                                                                                                                               |
| `apps/pulse-web/test/NewPoll.test.tsx`                     |   783 |    34 | Context/first-post promise/dialog, settings, attribution/choices, keyboard posting, repeated sends/keys, expiry/draft recovery and quota. Retain.                                                                                              |
| `apps/pulse-web/test/PostedBanner.test.tsx`                |    87 |     5 | Just-published link copy/status repetition/fallback/dismiss. Overlaps CopyLink through separate screen wiring; small smoke checks suffice long term.                                                                                           |
| `apps/pulse-web/test/Profile.test.tsx`                     |   670 |    18 | Public unavailable/error/text escaping, own/public contribution list, editor create/hide/reshare, limits and focus. Retain; CQ2 HTTP seam absent.                                                                                              |
| `apps/pulse-web/test/Redeem.test.tsx`                      |   321 |    16 | Work/terminal/refused/retry states, StrictMode single-use promise, callback dedupe and announced focus. Retain.                                                                                                                                |
| `apps/pulse-web/test/ResultsPanel.test.tsx`                |   467 |    34 | Counts, confirmation denominators, own labels/index ordering, approval shares, fallback bars, compact chart/toggle and truthful language. Retain; reduce exact class formatting only during refactor.                                          |
| `apps/pulse-web/test/SignIn.test.tsx`                      |   681 |    35 | Email/opt-in keyboard request, pending repeat prevention, sent/error/field states, community choice, distinct 429 handling and local mailbox. Retain.                                                                                          |
| `apps/pulse-web/test/SignedIn.test.tsx`                    |   190 |     8 | Sign-out confirmation/cancel/pending/failure and keyboard focus. Complements actual hook/HTTP side effects.                                                                                                                                    |
| `apps/pulse-web/test/SuggestedVotesRail.test.tsx`          |   143 |     2 | Skip current/answered/closed, older-ballot check, navigation without casts. Only two happy-path-oriented cases; errors/source/breakpoint changes remain useful future probes, with #596/#529 ownership retained.                               |
| `apps/pulse-web/test/TopBanner.test.tsx`                   |    65 |     5 | One account control, sign-in omission, home/post links, narrow-label part. Structural smoke coverage.                                                                                                                                          |
| `apps/pulse-web/test/Trust.test.tsx`                       |   228 |    11 | Current counting/privacy limits and plan truthfulness, links and keyboard order. Useful ADR-0039 copy invariants; not protocol validation.                                                                                                     |
| `apps/pulse-web/test/VoteCard.test.tsx`                    |   467 |    40 | Single/approval and indexed keyboard picks, disabled/status/retry, focus, results/change/navigation and checking. Strong component coverage; malformed HTTP outcome lives outside this layer.                                                  |
| `apps/pulse-web/test/answered.test.ts`                     |   246 |    17 | Pure local/server list merge/order, closure and My votes neighbors. Retain.                                                                                                                                                                    |
| `apps/pulse-web/test/bar-chart-layout.test.ts`             |   156 |    11 | Pure label wrapping, columns/rows, paired spacing and bounded thickness. Expected geometry independent of jsdom; browser rendering still unproved.                                                                                             |
| `apps/pulse-web/test/chat-preview.test.ts`                 |   112 |    13 | Pure sample/scenario/access definitions and injectable pretend-send behavior. Intentional prototype tests.                                                                                                                                     |
| `apps/pulse-web/test/confirmed-status.test.tsx`            |   469 |    16 | Confirmation note, sign-in link/focus, refresh on focus/storage, retry, revisits and closed-poll limits. Retain.                                                                                                                               |
| `apps/pulse-web/test/contribution-flow.test.ts`            |    24 |     3 | Poll-id extraction from link/bare input and invalid/length boundary. Retain.                                                                                                                                                                   |
| `apps/pulse-web/test/conversation-desktop.test.tsx`        |   522 |    13 | In-page choices/results, change/Close, uncertain-send read-back, 5s pending/check and late replies. Distinct desktop path warrants retention.                                                                                                  |
| `apps/pulse-web/test/conversation-dock.test.tsx`           |    97 |     2 | Resize observer measured space and closed pager row. Strong callback wiring; cleanup follow-up already #591.                                                                                                                                   |
| `apps/pulse-web/test/conversation-flow.test.ts`            |    38 |     3 | Pure steering choice, closed-state precedence and valid closing copy. Retain.                                                                                                                                                                  |
| `apps/pulse-web/test/decision.test.ts`                     |   164 |    21 | Pure prototype decision shape/default/duplicate choices, access precedence, selected id, submit eligibility and language. Retain intentional preview contract.                                                                                 |
| `apps/pulse-web/test/dev-proxy.test.ts`                    |    43 |     1 | Real Vite proxy preserves browser Host for mailbox access. One valuable real-socket config seam; elevated local bind needed.                                                                                                                   |
| `apps/pulse-web/test/dialog-polyfill.ts`                   |    35 |     0 | Helper: showModal/close/Escape model. No inertness/native browser focus; intentional limitation.                                                                                                                                               |
| `apps/pulse-web/test/draft-keeping.test.tsx`               |   172 |     6 | App-level sign-in restoration path, ordinary-visit/other-person privacy and deliberate sign-out. Retain.                                                                                                                                       |
| `apps/pulse-web/test/draft-store.test.ts`                  |    81 |     5 | Pure serialization, expiry boundary, promise never persisted/restored, corrupt shapes and unavailable storage. Retain.                                                                                                                         |
| `apps/pulse-web/test/email.test.ts`                        |    54 |    10 | Pure trim/shape/length examples before sending; independent expected verdicts. Some trivial valid-address examples can be table-driven.                                                                                                        |
| `apps/pulse-web/test/foundation-entry.test.tsx`            |   125 |     4 | Guided introduction/progress/question list, configuration and independent question opening without casts. Retain static-page wiring coverage.                                                                                                  |
| `apps/pulse-web/test/header-focus-styles.test.ts`          |    47 |     3 | Source guards for neutral account width, saved-answer and Next focus rules. CSS cascade/paint limit; consolidate with style ownership work.                                                                                                    |
| `apps/pulse-web/test/header-votes.test.tsx`                |   421 |    81 | 81 route-expanded shared-header cases: neutral first read, hold/forget/retry/focus and stale responses. Useful routing smoke coverage; avoid expanding all transitions per route further.                                                      |
| `apps/pulse-web/test/http.test.ts`                         |   648 |    58 | Adapter methods/envelopes/escaping/credentials, refusals, community shape, retry-after, pages/time bounds and cut-off reply. CQ1 impossible successful cast fixture; CQ2 missing owner query assertion.                                        |
| `apps/pulse-web/test/light-restyle.test.ts`                |   195 |    11 | Source guards for tokens/menu/edges/rail/message layouts and focus. Retain high-value invariants; brittle syntax/cascade coverage.                                                                                                             |
| `apps/pulse-web/test/my-votes-navigation.test.tsx`         |   703 |    18 | Pager neighbors/endpoints/later reads, history/swipe, errors and shared pending reads, forget and closed polls. Retain; 50ms quiet wait and #591 limits documented.                                                                            |
| `apps/pulse-web/test/new-poll.test.ts`                     |   172 |    13 | Pure limits/Unicode/trim/request/defaults/close/name and summary copy. Retain.                                                                                                                                                                 |
| `apps/pulse-web/test/phone-fit.test.ts`                    |   174 |    11 | Source guards for viewport-sizing/dock space/safe areas/touch targets/overflow/motion/banner. Does not itself measure phone fit.                                                                                                               |
| `apps/pulse-web/test/posted-by.test.tsx`                   |    82 |     6 | Byline absence/anonymity/literal text, persistent main-page node and posting entry. Retain security/user-flow checks.                                                                                                                          |
| `apps/pulse-web/test/profile-name.test.ts`                 |    35 |     3 | Explicit expected visible names, hidden-format refusal, code-point limits and bio. Independent oracle supplements parity suite.                                                                                                                |
| `apps/pulse-web/test/profile-session.test.tsx`             |   413 |    16 | Owner drafts/late reads/saves/account-cookie preconditions/expiry/recovery, including immediate commit-boundary input/return. Strong mock-level coverage; CQ2 missing adapter connection.                                                      |
| `apps/pulse-web/test/profile-styles.test.ts`               |    77 |     6 | Source guards for wrapping, title/status grid, legend/error and profile menu layout. Geometry remains browser-only.                                                                                                                            |
| `apps/pulse-web/test/pulse-server.ts`                      |    76 |     0 | Helper: stateful fetch simulator stores ballot, drops selected reply, models offline and returns actual HTTP adapter. Useful lost-write-reply seam; no real sockets/cookies.                                                                   |
| `apps/pulse-web/test/question-address.test.tsx`            |    71 |     2 | App URL/Back/Forward restores answers and same-question navigation avoids duplicate history. Retain.                                                                                                                                           |
| `apps/pulse-web/test/question-motion.test.ts`              |    25 |     2 | Source guards for touch-action absence, loaded-only slide/reduced motion. Does not execute motion or browser panning.                                                                                                                          |
| `apps/pulse-web/test/referrer-privacy.test.ts`             |    22 |     2 | Early meta policy and no logged Referer. CQ3 query-log variable and active format assertions missing.                                                                                                                                          |
| `apps/pulse-web/test/results-chart-fallback.test.tsx`      |    42 |     1 | Failed lazy module falls back to complete per-answer figures. Retain real chunk-error composition check.                                                                                                                                       |
| `apps/pulse-web/test/results-chart.test.ts`                |    59 |     3 | Pure shares/denominator labels/own highlight/confirmation-series omission. Retain.                                                                                                                                                             |
| `apps/pulse-web/test/route.test.ts`                        |   276 |    39 | Pure URL paths, escaping/case/trailing slash and parse/write round trips. Retain; hook subscription timing remains #614.                                                                                                                       |
| `apps/pulse-web/test/security-headers.test.ts`             |    81 |     5 | Source policy/location inheritance, image-upload limit/JSON error and local fonts. Does not execute nginx; CQ3 missing query-safe log check.                                                                                                   |
| `apps/pulse-web/test/session-changes.test.tsx`             |   254 |    10 | Deferred identity generations, sign-out/expiry, stale focus results and same-account vote reload. Retain; #613 is separate initial commit gap.                                                                                                 |
| `apps/pulse-web/test/shared-controls-styles.test.ts`       |   196 |    21 | Source guards for Button sizing/focus/tokens, shared control adoption and obsolete utility absence. Many exact formatting/class constraints; consolidate during #534/#538.                                                                     |
| `apps/pulse-web/test/sign-in-return.test.ts`               |   109 |    10 | Pure return storage read-once/expiry/invalid/future/bounded ids and unavailable storage. Retain.                                                                                                                                               |
| `apps/pulse-web/test/signin-width.test.ts`                 |    44 |     2 | Source guards for desktop sign-in measure and no later widening. Does not measure browser width.                                                                                                                                               |
| `apps/pulse-web/test/site-banner.test.tsx`                 |    96 |     9 | Route smoke matrix verifies shared navigation/community/account state and Home current mark. Retain concise wiring checks.                                                                                                                     |
| `apps/pulse-web/test/stub-api.tsx`                         |   138 |     0 | Helper: legal poll/results builders, API doubles and poll graph. Default cast ignores submitted ballot; interface cast weakens future completeness checks. Fixture debt discussed above.                                                       |
| `apps/pulse-web/test/swipe-next.test.tsx`                  |    68 |     2 | Loaded-wrapper placement and unanswered/short/answered swipe navigation + focus. Distinct screen composition check.                                                                                                                            |
| `apps/pulse-web/test/use-cast-vote.test.tsx`               |   164 |    15 | Full ballots, copying immutable submission, unknown/refused status matrix and settlement after unmount. Mutation killed; CQ1 actual decode exception bypasses injected rejection cases.                                                        |
| `apps/pulse-web/test/use-element-width.test.tsx`           |    49 |     2 | Fallback/initial/resize widths and observer disconnect. Retain; move restoreAllMocks into afterEach for failure-safe cleanup.                                                                                                                  |
| `apps/pulse-web/test/use-paged-list.test.tsx`              |   188 |     8 | Stuck/duplicate cursor rows, stale generation, stable retry, disabled/re-enabled and clear-on-inflight. Retain shared-hook coverage.                                                                                                           |
| `apps/pulse-web/test/use-swipe.test.tsx`                   |   114 |     9 | Pure threshold/direction plus touch cancel/multi-touch/zoom/mouse suppression and optional handler. Retain; no browser gesture engine emulation.                                                                                               |
| `apps/pulse-web/test/vote-card-checking.test.tsx`          |    79 |     4 | Both layouts keep Close focusable/inert and retry blocked during reconciliation, then restore action. Retain.                                                                                                                                  |
| `apps/pulse-web/test/vote-card.test.ts`                    |    32 |     3 | Pure selection immutability/cardinality/distinctness/index membership and numeric shortcut mapping. Retain.                                                                                                                                    |
| `apps/pulse-web/test/vote-help.test.tsx`                   |    38 |     1 | Live vote opens/closes unsent choice and changes without tutorial controls. Mostly overlaps Conversation; retain a small removed-control smoke check rather than growing a second flow suite.                                                  |
| `apps/pulse-web/test/welcome.test.tsx`                     |   109 |     5 | About/guided entry, configured/direct/closed/unavailable polls, keyboard and no accidental casts. Some overlap with foundation-entry/App; keep entry-point contract smoke, avoid duplicating deeper vote cases.                                |
| `tests/pulse-integration/test/contributions-http.test.ts`  |   327 |     5 | Real adapter + in-memory HTTP: publish/discover/help/progress, permissions/identity projection, retry keys, private messages, optional group-buy fields and savings boundary. Five broad meaningful seams; credentials shim limitation above.  |
| `tests/pulse-integration/test/conversation-http.test.tsx`  |   164 |     1 | One long React+HTTP guest flow: guided entry, single→approval, replacement, pre-POST network retry and closed result. Valuable composition; 30s timeout prevents known CI duration flake. It does not simulate a reply lost after write.       |
| `tests/pulse-integration/test/end-to-end.test.ts`          |   376 |    11 | Real adapter auth/mail/cookie/origin/sign-out and replayed session, guest isolation/replacement, multi-community selection and suggestions. Eleven useful HTTP seams; no UI or profile lifecycle.                                              |
| `tests/pulse-integration/test/my-votes-http.test.tsx`      |   185 |     2 | Two React+HTTP saved-answer/isolation/reload scenarios, including sorted approval labels and replacement ordering. Retain; 5ms clock wait and simplified jar limitations above.                                                                |
| `tests/pulse-integration/test/poll-creation-http.test.ts`  |   219 |     2 | Two real auth/publish/replay/read/browse/vote seams with request keys, no private identity, auth/origin refusals. Retain; UI validation covered separately.                                                                                    |
| `tests/pulse-integration/test/profile-name-parity.test.ts` |    66 |    30 | 29 Unicode/length/visibility name samples + both-verdict check across separately implemented validators. Valuable drift guard; direct normalization helper import is permitted test setup/assertion exception, not real HTTP profile coverage. |

## Self-contained regression probe appendix

Temporarily place this at `apps/pulse-web/test/audit-quality-probe.test.tsx`, run the command below from the repository root, and remove the temporary file. It intentionally expects the repaired behavior, so three cases fail on the audited revision; the explicit-rejection control passes. Fake time is advanced inside `act`; initial work is flushed at 0 before the screen's 5s restoration deadline.

```sh
source /workspace/.local/bin/odc-env
pnpm --filter @odc/pulse-web exec vitest run test/audit-quality-probe.test.tsx --reporter=verbose
```

```tsx
// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Conversation } from "../src/screens/Conversation.js";
import { HttpPulseApi } from "../src/api/http.js";
import { useCastVote } from "../src/hooks/use-cast-vote.js";
import { useClosedResults } from "../src/hooks/use-closed-results.js";
import { poll, results, stubApi } from "./stub-api.js";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("unreadable successful cast settles as unknown failure rather than rejecting and staying casting", async () => {
  const api = new HttpPulseApi("/api", async () => new Response("{}"));
  const { result } = renderHook(() => useCastVote(api, "p"));
  let settled: unknown;
  await act(async () => {
    settled = await result.current.cast([0]).catch((error) => error);
  });
  expect(settled).toMatchObject({ status: "failed", refused: false });
  expect(result.current.state.status).toBe("failed");
});
it("closed public results render without yours when the optional ballot explicitly rejects", async () => {
  const api = stubApi({
    results: async () => results(),
    myBallot: async () => {
      throw new TypeError("offline");
    },
  });
  const { result } = renderHook(() => useClosedResults(api, "p"));
  await act(async () => result.current.open());
  expect(result.current.data).toMatchObject({
    status: "ready",
    value: { yourChoices: [] },
  });
});
it("closed public results do not wait forever for an optional private ballot", async () => {
  vi.useFakeTimers();
  const api = stubApi({
    results: async () => results(),
    myBallot: () => new Promise(() => {}),
  });
  const { result } = renderHook(() => useClosedResults(api, "p"));
  await act(async () => result.current.open());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(result.current.data).toMatchObject({
    status: "ready",
    value: { yourChoices: [] },
  });
});
it("closed question results stay readable when the optional ballot endpoint hangs", async () => {
  vi.useFakeTimers();
  const readResults = vi.fn(async () => results());
  render(
    <Conversation
      api={stubApi({
        poll: async () => poll({ open: false }),
        results: readResults,
        myBallot: () => new Promise(() => {}),
      })}
      pollId="ads-free"
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  fireEvent.click(screen.getByRole("button", { name: "See results" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(readResults).toHaveBeenCalled();
  expect(screen.queryByText("Nobody answered this one.")).not.toBeNull();
});
```

## Final verification

The restored focused client suites passed **139/139** (five files), and the two selected real-HTTP suites passed **16/16**. The temporary test was removed. All four mutated source/config files were restored byte-for-byte by finally blocks. `git diff --exit-code` and `git status --short` were clean; only this report and reproduction evidence outside the worktree were retained. Collection artifacts describe 80 original files and 1,018 original cases; the four temporary probe cases are not included in those totals. No database, deployment, external message, issue or lasting source change was made.
