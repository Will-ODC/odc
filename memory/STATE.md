# ODC Build State

> Single source of session-to-session truth. Read first, update last, keep short.
> History belongs in git and ADRs, not here.

## Current phase

**Phase 0 — Contracts.** Nothing may be implemented in services/ until
contracts/ passes the genesis rehearsal and is frozen.

## Done

- Charter and implementation plan finalized (docs/).
- Monorepo scaffolded: skills, agents, memory, toolchain stubs (2026-07-18).
- **T1 — local hooks + PR template + workspace hygiene** (2026-07-19, PR #1,
  squash `874bb4f`). lefthook (pre-commit format+lint on staged files,
  check-mode blocking ~1.6s; pre-push tests of changed services), prettier +
  eslint (typescript-eslint) flat config at root, `format`/`format:check`/
  `typecheck` scripts. `contracts/`, the Go verifier, and mockups excluded from
  both tools. Reviewed APPROVE WITH NITS; both [SHOULD]s fixed pre-merge.
- Repo is public at github.com/Will-ODC/odc, remote set, default branch
  **master** (docs say master everywhere; do not assume `main`). This
  satisfies T2's prereq #1.

## Next

**T2 — CI skeleton: contracts-guard + repo checks** (`odc-implementer`), per
`docs/plans/phase-0.md`. Its user prereq (public repo pushed) is already done;
the remaining user action is enabling branch protection after T2 lands (plan
§"User actions" #2). Then T3/T4 (contract drafts) → T5–T10.

Ticket discipline: one ticket = one branch = one PR = one session; fresh-context
review before merge; squash-merge; update this file on master at merge time.

## Blockers

- None. (Branch protection not yet enabled — not a blocker for T2 authoring,
  but must be turned on before/at T2 merge so the rules it documents are real.)
