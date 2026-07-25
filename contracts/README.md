# contracts/ — Phase 0

**Status: DRAFTING. Not frozen. No service code may be written until the
genesis rehearsal passes and this directory reaches RELEASE CANDIDATE.**

`contracts/` moves through three states (ADR-0007): **DRAFTING** → **RELEASE
CANDIDATE** (entered when the T9 audit passes; Phase 1 may build against it; no
tag, so changes stay possible) → **FROZEN** (the `contracts-v1` tag exists and
`hashing.md` + `fixtures/` become permanently immutable). The freeze is gated on
operational experience, not only on T9 — see ADR-0007 for the readiness signals.

The only shared surface between services. Everything not in here is a private
detail of some service. Deliverables (implementation-plan §Phase 0):

1. `event-schema.md` — `seq, type, version, payload, ts, prev_hash, hash`
2. `hashing.md` — canonical hashing rule: exactly which bytes, how. One page.
3. `export-format.md` — hash-chained NDJSON, one event per line
4. `ids.md` — participant_id, issue_id formats
5. `event-types.md` — v1 registry: participant_registered, issue_created,
   vote_cast. No free-text content in the log at MVP.
6. `read-api.md` — GET /events?since= pagination and limits
7. `evolution.md` — additive-only versions; hashing never changes retroactively
8. `fixtures/` — golden vectors: canonical events + precomputed hashes, one per
   normative rule plus adversarial cases. Produced by the rehearsal; consumed
   by every service's CI and the verifier. Hashes must be reproduced
   independently in TypeScript and Go before freeze.

**Exit gate — genesis rehearsal:** the full procedure lives in the
`odc-contracts` skill. Build a throwaway chain against the drafts, export,
verify with a fresh-context throwaway Go verifier, run the tamper matrix.
Only then freeze and declare genesis. A hashing mistake found after real
events exist is permanent.

**Freeze mechanics (all three, same day, or it isn't frozen):**
status flip in this README → git tag `contracts-v1` → `contracts-guard` CI
workflow active. Changes after freeze: additive-only, version-bumped, with a
`CONTRACTS-CHANGE.md` entry — never retroactive.
