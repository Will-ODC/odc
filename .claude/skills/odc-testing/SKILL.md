---
name: odc-testing
description: Testing requirements for all ODC code — services/, tools/, and apps/ alike. Use this skill whenever writing, modifying, or reviewing any code in the ODC monorepo — new endpoints, event handling, tally logic, bug fixes, or refactors — even if the user doesn't mention tests. No change merges without the tests this skill requires.
---

# ODC Testing Requirements

Applies to everything in the repo, `apps/pulse`, `apps/pulse-web`, and the
`@odc/pulse-integration` test workspace included — the charter exemption covers
what pulse must guarantee, never how we work. The "ODC-specific required
tests" below are charter-side and apply to `services/` only; the pyramid and
the rules apply everywhere.

Pulse cross-package suites live in `tests/pulse-integration/`
([ADR-0041](../../../docs/decisions/0041-pulse-integration-test-workspace.md));
import-boundary rules are in [`odc-service-boundaries`](../odc-service-boundaries/SKILL.md).

## The pyramid, per service or app

1. **Unit tests** — every pure function: hashing, signature checks, tally math,
   consent-set logic. No network, no DB. Fast enough to run on every save.
2. **API/contract tests** — every endpoint, exercised over HTTP against a
   real local instance (real DB, throwaway data; a Pulse HTTP test may use the
   memory store when the same storage behavior also runs on Postgres in the
   storage tests).
   Required cases per endpoint:
   - happy path with a schema-validated response body
   - each documented error (400 malformed, 401/403 unauthorized, 404, 409)
   - for a signed endpoint, all three authorization failures: wrong key,
     missing signature, replayed request

   Beyond the required cases in this skill (these and the ODC-specific ones
   below), choose further cases by risk, and run each
   only at the lowest layer that can catch the failure.

3. **Storage tests** — check behavior that depends on Postgres (constraints,
   locks, grants, SQL) against real Postgres in an isolated schema. Where a
   service or app has both a memory and a Postgres store, run the same tests against
   both.
4. **Integration tests** — only at real seams: identity→ledger registration
   ordering; tally rebuilt from a ledger export.

Beyond the API/contract tests above, use real sockets only when testing
behavior across the socket: proxy behavior,
cookies, origin and host checks, the dev proxy, the browser client's HTTP
adapter end to end, and service-to-service calls at an integration seam.

## ODC-specific required tests

- **Chain property test (ledger):** append N random events → export → verify
  passes. Then flip one byte at a random position → verify reports
  `INVALID at line N` with the correct N. Run with multiple seeds.
- **Insert-only guard test (ledger):** attempt UPDATE and DELETE on event
  tables as the app's own DB role → both must fail at the storage layer.
- **Rebuild test (tally):** compute tallies from live API, then from a cold
  export replay → results must be identical. This test is the proof that
  tally holds no truth.
- **Golden fixtures:** `contracts/fixtures/` holds canonical events with
  precomputed hashes. Every service that touches events must pass them.
  Never regenerate golden hashes to make a failing test pass — a hash
  mismatch means the code is wrong or the contract changed illegally.
- **Linkage leak test (identity):** every API response and log line is
  scanned in tests for linkage-map fields. Zero tolerance.

## Rules

- Bug fix = failing regression test written FIRST, then the fix.
- Test names state behavior: `rejects_vote_with_unregistered_key`, not `test4`.
- Use builders/factories for test events; no copy-pasted JSON blobs.
- Don't test the framework, getters, or other services' internals.
- Pointer, focus, layout and CSS changes need a real-browser check; jsdom
  tests can pass while the real browser is broken.
- A concurrency test must force overlap with a database barrier (hold a
  conflicting lock from another connection, confirm with `pg_blocking_pids`,
  release); `Promise.all` alone may serialize and pass with the guard removed.
- Coverage is a smell detector, not a goal: unexplained drops block merge,
  but 100% is not the target — the required cases above are.

## Flaky tests

A flaky test found outside the PR in hand gets an issue the day it is seen
(one the PR in hand added or made flaky is fixed on its branch). Quarantine it (skip or
retry) only with a named owner, a linked issue, and an expiry date in a comment
at the skip or retry. Remove the quarantine or fix the test by that date.

Never quarantine a privacy, auth or vote-counting test, any ODC-specific
required test above, or a forced-overlap concurrency test: retrying one until
it passes hides the failure it exists to catch.
