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
1. Draft contracts/ (odc-architect, with the `odc-contracts` skill): event
   schema, canonical hashing rule, export format, IDs, event type registry,
   read-API shape, evolution rule, golden fixtures.
2. Enforcement bootstrap — MUST exist before freeze or the freeze is
   honor-system: `.github/workflows/` (contracts-guard + lint/typecheck/test
   per service + diff-size check), lefthook config, PR template
   (what changed / how tested / contract version).
3. Genesis rehearsal per `odc-contracts`: throwaway chain → export →
   fresh-context throwaway Go verifier → tamper matrix → cross-language
   fixture check. Rerun until clean.
4. Freeze contracts/ (README flip + tag `contracts-v1` + contracts-guard
   live), declare genesis. Security audit gate (odc-security-auditor) before
   freeze. Then Phase 1 in parallel: ledger · verifier (fresh context) · identity.

## Blockers
- None.
