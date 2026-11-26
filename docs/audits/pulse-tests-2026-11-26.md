# Pulse test audit, 2026-11-26

Asked by the operator (2026-11-26): are the Pulse tests effective, reasonable,
and sustainable as they grow, and which changes to testing methods and
structure would clearly help with little downside. Run by Codex
(gpt-6.2-sol), read-only, over `apps/pulse`, `apps/pulse-web`,
`tests/pulse-integration` and the CI and hook wiring. The ODC core was out of
scope (its independence rules keep the ledger and verifiers in separate
contexts). It builds on `pulse-tests-2026-11-14.md`.

**Operator decision (2026-11-26):** do improvements 1, 2 and 4 now, 3 later.
Item 4 is the `odc-testing` change in the PR that adds this file.

## Verdict

**Effective.** The suites exercise real failure modes in session revocation, vote replacement, public-vote privacy and uploads. Prior mutation checks showed that removing important guards made tests fail.  
**Reasonable today.** All 2,192 cases passed in CI for `d77d069`. The Pulse test step took 1m47s.  
**Sustainable with targeted maintenance.** The first pressures are slow, large UI files, repeated Postgres setup and fixtures that simulate too much of the API. Keep the current test runners and layers.

## Numbers

| Suite       |         Files / passed | CI wall time | Slowest files                                                                                         |
| ----------- | ---------------------: | -----------: | ----------------------------------------------------------------------------------------------------- |
| Pulse API   | 55 / 1,071, zero skips |       101.9s | `pg-voting-store` ~34s, `contributions-http` 28.2s, `pg-identity-stores` ~17.7s, summed TAP durations |
| Pulse web   |             79 / 1,063 |       105.4s | `Conversation` 28.3s, `NewPoll` 23.9s, `Contributions` 21.0s                                          |
| Integration |                 7 / 58 |        17.7s | `conversation-http` 4.8s, `my-votes-http` 3.1s                                                        |

The suites overlapped. The repo check took **3m26s**, including roughly 23s before checkout for container setup. The image job took **61s** in parallel, including **7.5s** for proxy smoke. CI selects both Pulse apps and integration for this web change. Typecheck populated both build caches before the test step. [Repo CI log](https://github.com/Will-ODC/odc/actions/runs/45842994342/job/139989276974), [image CI log](https://github.com/Will-ODC/odc/actions/runs/45842994392/job/139989276384)

The API needs compiled `dist/`. Local no-emit typecheck took 5.0s. The pre-push dry run took **0.47s** and found four cache hits for this branch: web and integration tests plus both builds. A cold push would execute those tasks. (`apps/pulse/package.json:8`, `turbo.json:15`, `lefthook.yml:18`)

## Effective

- Sessions test stolen-cookie revocation and same-millisecond issuance. Votes test the latest ballot winning across browsers. Public-vote tests assert refusal **and no write** for missing acknowledgement, exact public projection, cursor tampering and removal ordering. Uploads cover size limits, metadata stripping, indistinguishable 404s and log redaction. (`http-session.test.ts:148`, `http-voting.test.ts:956`, `http-public-votes.test.ts:276,526,611,787`, `http-images.test.ts:377,423,491,833`)
- The November 14 audit’s incomplete cast fixture, owner-query omission and nginx format gaps have direct checks now. The new public-vote UI uses a stub, and the socket suite handwrites its successful POST and DELETE. The adapter’s mock-fetch checks help, but a real adapter round trip would cover the composition. The deployed proxy smoke also leaves query/referrer log redaction to static checks. (`pulse-web/test/http.test.ts:94,477,489`, `public-votes-http.test.ts:144,252`, `referrer-privacy.test.ts:17`, `public-proxy-smoke.sh:127`)
- #711 fires two focus events against a mutable session mock and polls for copy to disappear. Startup fault cases went **30/30** in ten isolated repeats, with the full-load failure still unexplained. The dev proxy’s bind promise has no error handler, so a denied bind can surface as a timeout. (`Contributions.test.tsx:1731`, `main.test.ts:953`, `dev-proxy.test.ts:12`)

## Sustainable

Since November 14, API/web/integration grew by **152/96/7 cases**. `Conversation` and `Contributions` alone span **4,681 lines** and consume **49.4s** of file time. Across web tests I counted 532 text or DOM-detail matches, including legitimate user-facing assertions. `PictureField.test.tsx:544` illustrates fragile sibling-order checks. `stubApi` serves **37 files** and can return ballot `[1]` regardless of input (`stub-api.tsx:94`). Six socket files implement cookie handling. Postgres isolation is sound, but **22 files** reference the migrated-schema helper, which reruns migrations for each fresh schema (`support/database.ts:37,65`).

## Ranked improvements

| #   | Change                                                                                                                                                                                              | Benefit                                                                | Cost                                  | Risk       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- | ---------- |
| 1   | Make #711 wait for controlled session replies. Surface child timeout and bind errors directly.                                                                                                      | Clearer failures across all three known trouble spots                  | 40–80 lines, 2–4h                     | Low        |
| 2   | Route the existing public-vote success path through the real adapter. Add a fake query/referrer marker to the nginx log smoke.                                                                      | Covers client/server composition and deployed privacy                  | 30–60 lines, 2–3h                     | Low        |
| 3   | Split the two largest UI files by behavior. Type-check the stub and require explicit cast outcomes where relevant.                                                                                  | Smaller fixtures, better worker balance, fewer misleading defaults     | 100–200 helper lines plus moves, 4–8h | Low–medium |
| 4   | Clarify the `odc-testing` pyramid (items 1-2, at master d77d069) with risk-based cases and which seams require sockets, schemas or real Postgres. Define owner and expiry for any flake quarantine. | Keeps coverage reviewable without duplicating every case across layers | 20–40 lines, 1–2h                     | Low        |

Only #4 changes the testing rules. Keep the real-browser and forced-overlap requirements (the `odc-testing` real-browser and forced-overlap rules).

## Things to leave alone

Keep shared memory/Postgres conformance, isolated schemas, database lock barriers, and CI’s required-DB guard. Preserve the image and real-socket smoke tests. Defer sharding until another timing sample shows a persistent bottleneck.

## What you could not check

Local API took 1.5–3.2s with 233 skips and 34 failures under socket/filesystem restrictions, including a 500 where the unreachable-DB case expects 503. Local Vitest could not create temporary directories. Cold pre-push time, real-browser behavior and the causes of the reported flakes remain unverified. No files changed.
