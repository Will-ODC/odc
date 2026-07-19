# ODC Monorepo — Agent Guide

Public infrastructure for community deliberation, voting, and funded action.
Two documents govern everything: `docs/charter.md` (principles) and
`docs/implementation-plan.md` (services and build order). When code and
charter conflict, the charter wins; stop and flag it.

## Repo map

```
contracts/       # FROZEN after genesis rehearsal. Event schema, hashing, export, IDs.
services/
  ledger/        # append-only hash-chained event log — the only truth
  identity/      # registration + private linkage map (own DB, never exposed)
  tally/         # derived views; holds no truth; rebuildable from export
  verifier/      # Go CLI; built from contracts/ ONLY, in a fresh context
  web/           # human client
  mcp/           # thin protocol wrapper (Phase 3)
docs/            # charter.md, implementation-plan.md, mockups/, decisions/ (ADRs)
memory/          # STATE.md (phase progress, next steps), OPEN-QUESTIONS.md
.claude/
  skills/        # odc-* skills (contracts, storage, review, testing, pipeline, boundaries, ui)
  agents/        # role definitions with model routing baked in
```

## Context protocol (read this order, every session)

1. `memory/STATE.md` — current phase, what's done, what's next, blockers.
2. The current phase's section of `docs/implementation-plan.md`.
3. Before touching any service: its `README.md`, `API.md`, and `CLAUDE.md`.
4. Skills auto-trigger by description; when in doubt, `odc-service-boundaries`
   before writing any endpoint and `odc-testing` before writing any code.

`memory/STATE.md` is updated **on master at merge time** (merge checklist in
`odc-pipeline`, owned by `odc-navigator`) — never on feature branches, where
parallel agents would conflict. Log any architectural choice as an ADR in
`docs/decisions/` (copy `0000-template.md`). Unresolved design questions go
in `memory/OPEN-QUESTIONS.md`, not in your head.

## Non-negotiable rules (from the implementation plan)

1. Every service owns its storage. Never read another service's tables.
2. Public APIs are the only interfaces between services.
3. `contracts/` changes are additive-only, version-bumped, never retroactive.
4. Event tables are INSERT-only. Any UPDATE/DELETE on them is a bug, full stop.
5. No free-text content in the log (MVP). Titles only.
6. The private linkage map (identity) never appears in any API response, log line, or export.
7. Ballot events and sentiment events never share a store or a pipe.

## Model routing

| Task                                                                       | Model      | Agent                  |
| -------------------------------------------------------------------------- | ---------- | ---------------------- |
| Architecture, cross-service planning, contracts drafting                   | **Fable**  | `odc-architect`        |
| Implementing a service, feature, or fix                                    | **Opus**   | `odc-implementer`      |
| Building the verifier (contracts-only context, incl. Phase 0 rehearsal)    | **Opus**   | `odc-verifier-builder` |
| Pre-merge review (fresh context)                                           | **Opus**   | `odc-reviewer`         |
| Security audit at phase gates (fresh context, never the designing context) | **Opus**   | `odc-security-auditor` |
| Navigation, lookups, renames, tests, merge mechanics                       | **Sonnet** | `odc-navigator`        |

Default flow per unit of work: Fable plans → Opus implements on a small branch →
fresh-context review per `.claude/skills/odc-code-review` → merge on green CI.

## Workflow

- One small branch per change (see `.claude/skills/odc-pipeline` for size limits).
- Write or update tests with the change, never after (see `.claude/skills/odc-testing`).
- The verifier service is special: never open its source and ledger source in
  the same context. Independence is its entire purpose. Use `odc-verifier-builder`.
