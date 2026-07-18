# contracts/ — Phase 0

**Status: DRAFTING. Not frozen. No service code may be written until the
genesis rehearsal passes and this directory is frozen.**

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

**Exit gate — genesis rehearsal:** build a throwaway chain against the drafts,
export, verify, tamper-test. Only then freeze and declare genesis. A hashing
mistake found after real events exist is permanent.

Changes after freeze: additive-only, version-bumped, never retroactive.
