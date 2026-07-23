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
  **master** (docs say master everywhere; do not assume `main`).
- **T2 — CI skeleton** (2026-07-19, PR #2, squash `fff12c4`). `repo.yml`
  (format/lint/typecheck + diff-size fail>800/warn>400 + guard-tests) and
  `contracts-guard.yml`. Guard enforces, on any `contracts/` touch, a
  `CONTRACTS-CHANGE.md` entry + a per-spec `Version:` bump; `hashing.md` and
  `fixtures/` hard-freeze once the `contracts-v1` tag exists. Guard runs on
  every PR (skips clean when no contracts change) so it is safe as a required
  check. Convention introduced: each `contracts/*.md` spec carries a `Version:`
  line — T3/T4 authors must include it. Reviewed APPROVE WITH NITS; both
  [SHOULD]s (per-file version check; guard-tests required) fixed pre-merge.
- **T3 — Draft: event schema, IDs, event types** (2026-07-21, PR #4, squash
  `c432cc5`). `contracts/event-schema.md` (ES-1…33), `ids.md` (ID-1…10),
  `event-types.md` (ET-1…22, four v1 types: `genesis` ·
  `participant_registered` · `issue_created` · `vote_cast`); ADRs 0002 (hash+sig)
  0003 (preimage & strict reject) 0004 (receipt-free ballots) 0005 (correction
  model, proposed). All DRAFTING, not frozen.
- **Phase-0 prep — ADR-0006 + T4 unblock** (2026-07-23, this branch). ADR-0006
  (verifier scope & forward-compat: two-stage verification, generic flat-payload
  preimage, exit codes 0/1/2) **accepted**; ADR-0005 item 1 (six-field envelope,
  no `supersedes`) **human-ratified**. Both T4 prerequisites in OPEN-QUESTIONS
  cleared. `docs/plans/phase-0.md` T4 ticket updated with the constraints
  ADR-0006 places on `hashing.md` (generic preimage) and `evolution.md`
  (two-stage/exit-code contract + re-scope of ES-9/ES-11/ET-1).

## Next

**T4 — Draft: hashing, export, read API, evolution** (`odc-implementer`, Opus,
fresh session; fresh-context review), per `docs/plans/phase-0.md`. Now
unblocked — both prerequisite decisions (ADR-0006, ADR-0005 ratification) are in.
`hashing.md` MUST use the generic flat-payload preimage (ADR-0006 item 4);
`evolution.md` MUST carry the two-stage/exit-code contract and the ADR-0005
correction template, and flip ADR-0005 `proposed` → `accepted`. Then T5–T10.
Each spec file must carry a `Version:` line or contracts-guard fails the PR.

Ticket discipline: one ticket = one branch = one PR = one session; fresh-context
review before merge; squash-merge. **STATE.md update note:** branch protection
now blocks direct pushes to master, so this file can no longer be committed
straight to master — update it in a small follow-up PR right after the ticket
merges (still separate from the feature branch, so parallel agents don't
conflict). Required checks to go green: `format / lint / typecheck`,
`diff-size`, `guard-tests`, `guard`.

## Blockers

- None for T3/T4 authoring. Branch protection is **ON** (2026-07-19, ruleset
  `protect-master`): PR required, four status checks strict, linear history, no
  bypass. Both Phase-0 user actions are complete — T2's documented rules are
  now actually enforced.
