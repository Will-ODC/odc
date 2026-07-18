---
name: odc-testing
description: Testing requirements for all ODC services. Use this skill whenever writing, modifying, or reviewing any code in the ODC monorepo — new endpoints, event handling, tally logic, bug fixes, or refactors — even if the user doesn't mention tests. No change merges without the tests this skill requires.
---

# ODC Testing Requirements

## The pyramid, per service

1. **Unit tests** — every pure function: hashing, signature checks, tally math,
   consent-set logic. No network, no DB. Fast enough to run on every save.
2. **API/contract tests** — every endpoint, exercised over HTTP against a real
   local instance (real DB, throwaway data). Required cases per endpoint:
   - happy path with schema-validated response body
   - each documented error (400 malformed, 401/403 unauthorized, 404, 409)
   - authorization failure: wrong key, missing signature, replayed request
3. **Integration tests** — only at real seams: identity→ledger registration
   ordering; tally rebuilt from a ledger export.

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
- Coverage is a smell detector, not a goal: unexplained drops block merge,
  but 100% is not the target — the required cases above are.
