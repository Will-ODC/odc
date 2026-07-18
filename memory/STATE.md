# ODC Build State

> Single source of session-to-session truth. Read first, update last, keep short.
> History belongs in git and ADRs, not here.

## Current phase
**Phase 0 — Contracts.** Nothing may be implemented in services/ until
contracts/ passes the genesis rehearsal and is frozen.

## Done
- Charter and implementation plan finalized (docs/).
- Monorepo scaffolded: skills, agents, memory, toolchain stubs (2026-07-18).

## Next
1. Draft contracts/ (odc-architect): event schema, canonical hashing rule,
   export format, ID formats, event type registry, read-API shape, evolution rule.
2. Genesis rehearsal: throwaway chain → export → verify → tamper-test.
3. Freeze contracts/, declare genesis. Then Phase 1 in parallel:
   ledger · verifier (fresh context) · identity.

## Blockers
- None.
