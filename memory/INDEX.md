# ODC Memory Index

> **Read this file first, every session. It is deliberately small.**
> It tells you which of the long documents you actually need, so you can read
> 2 KB instead of 80 KB. Nothing normative lives here — this file only routes.
> If you find yourself adding an argument, a decision, or a caveat here, it
> belongs in the document this file points at.

## Two workstreams, different rules

| Workstream                         | Lives in                            | Governed by                                  | Memory entry      |
| ---------------------------------- | ----------------------------------- | -------------------------------------------- | ----------------- |
| **ODC core** (deliberation ledger) | `contracts/`, `services/`, `tools/` | `docs/charter.md` — the charter wins, always | `memory/STATE.md` |
| **Pulse** (community vote product) | `apps/pulse/`, `apps/pulse-web/`    | **Charter-exempt** by operator decision      | `memory/pulse.md` |

The exemption is real and deliberate, not an oversight: see `apps/pulse/CLAUDE.md`.
Do not apply charter rules to `apps/**`, and do not relax them anywhere else.

## Where things stand right now (one line each — detail behind the link)

> These two lines duplicate the status sections they link to, which is the one
> place this file repeats itself. **If a line here disagrees with the workstream
> entry, the entry wins — and fix the line.** You read this file first and it is
> smaller, so on a divergence you would otherwise trust the wrong one.

- **ODC core:** Phase 0, ticket T9. The security-audit gate is **closed**; the
  fixture/verifier conformance work runs in four phases. **Phase 1 done. Phase 2:
  both verifiers are rebuilt, reviewed and green in PRs #123/#124 (#109/#110
  closed, superseded); the twelve vectors are the remaining owed work and are the
  critical path.** Five `contracts/` contradictions are open for an operator
  decision. → `memory/STATE.md`
- **Pulse:** MVP pillar 1 (magic-link identity) and the voting core are built and
  served over HTTP; the story UI and the path to action are not. → `memory/pulse.md`

## Load order

1. **This file.**
2. The memory entry for the workstream you are touching (above).
3. Only then the deeper document your task actually needs, from the table below.

Do not read `memory/OPEN-QUESTIONS.md` end to end. It is a topic-indexed
reference, not a briefing; open the entry you need. Settled questions live in
`memory/OPEN-QUESTIONS-archive.md` — open that only when you need the reasoning
behind a decision, or one of the few deferred entries its index names.

## Topic → document

| If your task is about…                          | Read                                                   |
| ----------------------------------------------- | ------------------------------------------------------ |
| Why the project exists; what it may never do    | `docs/charter.md`                                      |
| Which service does what, and in which phase     | `docs/implementation-plan.md`                          |
| The current Phase 0 ticket text and acceptance  | `docs/plans/phase-0.md` (your ticket only)             |
| A settled decision and its reasoning            | `docs/decisions/` — one ADR per decision; `ls` it      |
| An **un**settled design question                | `memory/OPEN-QUESTIONS.md` (its index, then one entry) |
| Event schema, hashing, export, IDs, fixtures    | `contracts/` + `.claude/skills/odc-contracts`          |
| Adding an endpoint or consuming another service | `.claude/skills/odc-service-boundaries`                |
| Any schema, migration, or grant                 | `.claude/skills/odc-storage`                           |
| Writing code of any kind                        | `.claude/skills/odc-testing`                           |
| Branches, CI, guards, merging                   | `.claude/skills/odc-pipeline`                          |
| Reviewing a diff                                | `.claude/skills/odc-code-review`                       |
| User-facing screens or copy                     | `.claude/skills/odc-ui`                                |
| Which model to dispatch, and how to brief it    | `.claude/skills/odc-orchestration`                     |
| Threat models and phase-gate audits             | `docs/security/README.md`, then the dated audit        |
| What the UI is supposed to look like            | `docs/mockups/` (+ `CANDIDATE_CONTEXT.md`)             |

## Where new information goes — decide this before you write it down

This project once ran a **whole workstream for nineteen PRs without a single
line of memory recording it** (pulse, PRs #79–#97). That is the failure this
index exists to prevent, and the fix is not diligence, it is having an obvious
destination for every kind of fact.

| The thing you learned                         | Goes in                                                        |
| --------------------------------------------- | -------------------------------------------------------------- |
| A ticket landed / a phase moved               | The workstream's memory entry, **at merge time on master**     |
| A choice with alternatives and consequences   | A new ADR in `docs/decisions/` (copy `0000-template.md`)       |
| A question you could not settle               | `memory/OPEN-QUESTIONS.md`, under a dated heading              |
| A trap the next session will otherwise re-hit | "Blockers & live cautions" in the workstream's memory entry    |
| A rule about how we work                      | The matching `.claude/skills/odc-*` skill — **one place only** |
| A **new workstream**                          | A new `memory/<name>.md` **and a row in the two tables above** |

**The rule that keeps this file honest, and the CI job that enforces it:** a
directory that agents commit to and that has no row in the workstream table above
is a bug in this file. Fix it in the same PR that creates the directory —
`.github/scripts/memory-index.sh` fails the build if you do not, and it would have
fired on `apps/` at PR #79.

That guard checks only that the directory is **named** here. It cannot tell
whether the entry is any good; that is review's job. What it removes is the
silent failure — a workstream existing that this file has never heard of.

Memory entries are updated **on master at merge time**, never on feature
branches — parallel agents conflict there. The merge checklist in
`.claude/skills/odc-pipeline` owns this step.
