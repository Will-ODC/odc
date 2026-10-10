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
                 # boundaries, ui, design, orchestration)
  agents/        # role definitions with model routing baked in
```

## Context protocol (read this order, every session)

**Exception:** a verifier build session reads only what its ticket lists
(`odc-verifier-builder`); that list overrides this protocol.

1. **`memory/INDEX.md`** — small on purpose. It names the two workstreams, says
   where each stands in one line, and routes you to the 20 KB you actually need
   instead of the 80 KB you do not. Read it before anything else.
2. The memory entry it points you at: `memory/STATE.md` (ODC core) or
   `memory/pulse.md` (pulse).
3. The governing documents for your task: for the ODC core, `docs/charter.md`
   and the current phase's section of `docs/implementation-plan.md`; then your
   GitHub issue (the work queue) and its design detail in
   `docs/plans/<workstream>.md` (`phase-0.md` for core tickets, `pulse.md` for
   pulse); then any ADR in `docs/decisions/` that the issue or plan cites.
4. Before touching any service or app: its `README.md`, `API.md`, and `CLAUDE.md`.
5. Skills auto-trigger by description; when in doubt, `odc-service-boundaries`
   before writing any endpoint and `odc-testing` before writing any code.

Memory entries are updated **on master at merge time** (merge checklist in
`odc-pipeline`, owned by `odc-navigator`) — never on feature branches, where
parallel agents would conflict. Log any architectural choice as an ADR in
`docs/decisions/` (copy `0000-template.md`). Everything else you learn — status,
handoffs, unsettled questions, traps — goes where `memory/INDEX.md`'s "Where
new information goes" table says, which is the one home for that rule. Add a row
there when you start a workstream it does not list.

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

**`.claude/skills/odc-orchestration` is the single home** for what that means:
the routing table, the simple-versus-complex line, how to write a subagent
brief, how to run parallel agents in one working tree, and when not to spawn at
all. Each `.claude/agents/*.md` carries its model in its `model:` field. Read the
skill before delegating. When in doubt between Opus and Sonnet, route Opus.

Default flow per unit of work: Opus plans → implement on a small branch (Opus,
or Sonnet for simple work per the skill) →
fresh-context review per `.claude/skills/odc-code-review` → merge on green CI.

The isolation and fresh-context rules are **unaffected by model choice** — they
are about what a context has _seen_, not which model it runs. Two Opus contexts
that saw the same thing are one context.

## Workflow

- One small branch per change (see `.claude/skills/odc-pipeline` for size limits).
- Write or update tests with the change, never after (see `.claude/skills/odc-testing`).
- The verifiers are special: never open either verifier's source
  (`services/verifier/`, `tools/verifier-ts/`) and ledger source in the same
  context. Independence is their entire purpose. Use `odc-verifier-builder`.
