# ODC Monorepo — Agent Guide

Public infrastructure for community deliberation, voting, and funded action.
Two documents govern the ODC core: `docs/charter.md` (principles) and
`docs/implementation-plan.md` (services and build order). When code and
charter conflict, the charter wins; stop and flag it.

**One deliberate exception:** `apps/pulse` and `apps/pulse-web` are
**charter-exempt** by operator decision — see `apps/pulse/CLAUDE.md` and
`memory/pulse.md`. Do not apply charter rules there, and do not relax them
anywhere else.

## Repo map

```
contracts/       # Event schema, hashing, export, IDs. DRAFTING → RELEASE
                 # CANDIDATE → FROZEN; the freeze is deferred (ADR-0007).
services/        # charter-governed core
  ledger/        # append-only hash-chained event log — the only truth
  identity/      # registration + private linkage map (own DB, never exposed)
  tally/         # derived views; holds no truth; rebuildable from export
  verifier/      # Go CLI; built from contracts/ ONLY, in a fresh context
  web/           # human client (Phase 2, not started)
  mcp/           # thin protocol wrapper (Phase 3)
apps/            # charter-EXEMPT product workstream
  pulse/         # server: magic-link identity + voting core
  pulse-web/     # one-screen story client
tools/           # fixtures-gen, rehearsal, verifier-ts (second verifier)
docs/            # charter.md, implementation-plan.md, plans/, mockups/,
                 # decisions/ (ADRs), security/
memory/          # INDEX.md (read first), STATE.md, pulse.md, OPEN-QUESTIONS(-archive).md
.claude/
  skills/        # odc-* skills (contracts, storage, review, testing, pipeline,
                 # boundaries, ui, orchestration)
  agents/        # role definitions with model routing baked in
```

## Context protocol (read this order, every session)

1. **`memory/INDEX.md`** — small on purpose. It names the two workstreams, says
   where each stands in one line, and routes you to the 20 KB you actually need
   instead of the 80 KB you do not. Read it before anything else.
2. The memory entry it points you at: `memory/STATE.md` (ODC core) or
   `memory/pulse.md` (pulse).
3. The current phase's section of `docs/implementation-plan.md`, or your ticket
   in `docs/plans/phase-0.md`.
4. Before touching any service or app: its `README.md`, `API.md`, and `CLAUDE.md`.
5. Skills auto-trigger by description; when in doubt, `odc-service-boundaries`
   before writing any endpoint and `odc-testing` before writing any code.

Memory entries are updated **on master at merge time** (merge checklist in
`odc-pipeline`, owned by `odc-navigator`) — never on feature branches, where
parallel agents would conflict. Log any architectural choice as an ADR in
`docs/decisions/` (copy `0000-template.md`). Unresolved design questions go
in `memory/OPEN-QUESTIONS.md`, not in your head. `memory/INDEX.md` has the full
"where does this fact go" table — use it, and add a row when you start a
workstream it does not list.

## Non-negotiable rules (from the implementation plan)

1. Every service owns its storage. Never read another service's tables.
2. Public APIs are the only interfaces between services.
3. `contracts/` changes are additive-only, version-bumped, never retroactive.
4. Event tables are INSERT-only. Any UPDATE/DELETE on them is a bug, full stop.
5. No free-text content in the log (MVP). Titles only.
6. The private linkage map (identity) never appears in any API response, log line, or export.
7. Ballot events and sentiment events never share a store or a pipe.

## Model routing

The operator's standing instruction, verbatim: **"using opus as an orchestrator
and for complex implementation, and sonnet for routine exploration and simple
implementation."**

| Model      | Work                                                                                                                                    | Agents                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Opus**   | Orchestration, architecture, `contracts/`, ADRs, complex implementation, review, security audit                                         | `odc-architect`, `odc-implementer`, `odc-verifier-builder`, `odc-reviewer`, `odc-security-auditor` |
| **Sonnet** | Exploration, inventory, lookups, renames, verifying cited facts, running tests, formatting, merge mechanics, simple one-behaviour fixes | `odc-navigator`                                                                                    |

**`.claude/skills/odc-orchestration` is the single source of truth** for the
full decision table, how to write a subagent brief, how to run parallel agents
in one working tree, and when not to spawn at all. Read it before delegating.
When in doubt between Opus and Sonnet, route Opus.

Default flow per unit of work: Opus plans → Opus implements on a small branch →
fresh-context review per `.claude/skills/odc-code-review` → merge on green CI.

The isolation and fresh-context rules are **unaffected by model choice** — they
are about what a context has _seen_, not which model it runs. Two Opus contexts
that saw the same thing are one context.

## Workflow

- One small branch per change (see `.claude/skills/odc-pipeline` for size limits).
- Write or update tests with the change, never after (see `.claude/skills/odc-testing`).
- The verifier service is special: never open its source and ledger source in
  the same context. Independence is its entire purpose. Use `odc-verifier-builder`.
