---
name: odc-orchestration
description: How to dispatch work in the ODC monorepo — which model runs which task, how to write a subagent brief that works, and how to run agents in parallel without corrupting one working tree. Use this skill whenever delegating, spawning a subagent, planning a multi-step task, choosing between Opus and Sonnet, or deciding whether to do something yourself.
---

# ODC Orchestration

## The standing instruction

The operator's rule, verbatim:

> **"using opus as an orchestrator and for complex implementation, and sonnet
> for routine exploration and simple implementation."**

This skill is the single source of truth for what that means in practice. The
table in the root `CLAUDE.md` is a pointer to here; `.claude/agents/*.md` carry
the same routing baked into each role's `model:` field. If any of the three
disagree, **this file wins and the other two get fixed in the same PR.**

## Routing table

| Work                                                          | Model      | Agent                   |
| ------------------------------------------------------------- | ---------- | ----------------------- |
| Orchestrating a multi-agent task; deciding what to dispatch   | **Opus**   | (you)                   |
| Architecture, cross-service planning, phase planning          | **Opus**   | `odc-architect`         |
| Drafting or editing anything in `contracts/`; writing an ADR  | **Opus**   | `odc-architect`         |
| Complex implementation — a service, endpoint, or real feature | **Opus**   | `odc-implementer`       |
| Building either verifier (contracts-only, fresh context)      | **Opus**   | `odc-verifier-builder`  |
| Pre-merge review (fresh context)                              | **Opus**   | `odc-reviewer`          |
| Phase-gate security audit (fresh context)                     | **Opus**   | `odc-security-auditor`  |
| Resolving a contradiction between two documents               | **Opus**   | (judgement — see below) |
| Exploration, inventory, "where does X live"                   | **Sonnet** | `odc-navigator`         |
| Verifying cited facts: does this path/commit/PR/line resolve? | **Sonnet** | `odc-navigator`         |
| Renames, mechanical find-and-replace, formatting              | **Sonnet** | `odc-navigator`         |
| Running tests or guards and reporting the output              | **Sonnet** | `odc-navigator`         |
| Simple implementation: a one-behaviour fix with a clear spec  | **Sonnet** | `odc-navigator`         |
| Merge mechanics (the `odc-pipeline` merge checklist)          | **Sonnet** | `odc-navigator`         |

**The line between "simple" and "complex" implementation.** Simple means: the
change is fully specified before it starts, it touches one file or one obvious
set, and being wrong is _visible_ — a test fails, a build breaks. Complex means
anything where being wrong is _silent_: hashing, event schemas, storage grants,
privacy boundaries, anything under `contracts/`, anything a charter rule
touches. **When it is not obvious which, route Opus.** The cost of the wrong
Sonnet dispatch is a subtly wrong artifact that passes CI; the cost of the wrong
Opus dispatch is some tokens.

## Writing a brief that actually works

A subagent starts with nothing but the brief. Five sections, always:

1. **Paths you own** — an explicit allow-list, and an explicit "do not touch"
   list naming anything another agent is editing right now. "Be careful" is not
   a boundary; a path list is.
2. **Git guardrails** — for any agent that is not doing merge mechanics:
   _do not run `git commit`, `git push`, `git checkout`, `git stash`, or
   `git reset`; leave changes in the working tree._ The orchestrator commits.
   Without this, parallel agents rewrite each other's index.
3. **What to read first** — name the files. `memory/INDEX.md` always, then the
   workstream entry, then the two or three documents the task actually needs.
   Do not tell an agent to "get up to speed"; that is how a 25 KB read becomes a
   80 KB read.
4. **What "done" looks like** — the acceptance bullets, and which guard to run
   (`pnpm -s format:check`, `diff-size.sh`, the unit's own tests).
5. **What to report back** — files created and why, files changed and why,
   anything stale it found but did not fix, anything needing an operator
   decision. **The report is the only thing you see.** An agent that writes its
   findings to a file you never read has done nothing.

## Parallel agents in one working tree

One tree, several agents, is the default here and it is where work gets lost.

- **Partition by path, never by intent.** Two agents may both be "improving
  docs"; they must not both own `docs/`. Hand each a disjoint list.
- **Say who else is running and where.** An agent that knows `apps/**` is live
  under another agent will route around it; one that does not will "helpfully"
  fix a file mid-edit.
- **Commit before dispatching a review or mutation agent.** Reviewers edit and
  restore the tree; a dirty tree has already been clobbered once here.
- **One active branch per unit of work** (`odc-pipeline`). An agent should never
  conflict with its own unmerged work.
- Genuinely independent work fans out. Sequential work does not — do not spawn
  three agents where the second needs the first's answer.

## When not to spawn at all

Spawning costs a context, a brief, and a report you must read and reconcile.
**Do the work yourself when:**

- It is a handful of `git`/`grep`/`ls` commands. Verifying that ten cited
  commits resolve is one command, not one agent.
- You would have to explain the task in more detail than doing it takes.
- You need the _result in your own head_ to make the next decision — a report
  round-trip buys nothing over reading the file.
- The work is a single edit to a file you already have open.

Spawn when the work is genuinely separable, genuinely parallel, or genuinely
needs a context that has **not** seen what yours has seen.

## Isolation is about what a context has SEEN, not which model it runs

Model routing does not touch, weaken, or substitute for any isolation rule.
These are unchanged and non-negotiable:

- **Verifier independence.** `odc-verifier-builder` reads `contracts/`,
  `services/verifier/`, and `docs/charter.md` §4 — never `services/ledger/` or
  any other service's source, and never ledger details pasted into its context.
  Never open verifier source and ledger source in one context, whatever the
  model. If a task needs both, refuse and split it.
- **Fresh-context review.** `odc-reviewer` must not be the context that wrote
  the code. Re-running the authoring context on Opus is not a review.
- **Fresh-context audit.** `odc-security-auditor` must never be the context that
  designed or implemented the area, nor the one that wrote the previous audit.

"Both are Opus" is not independence. Two Opus contexts that saw the same thing
are one context. Conversely a Sonnet dispatch does **not** earn an exemption
from isolation because it is cheap — an isolated build is an Opus job
(`odc-verifier-builder`) regardless.

## After the fan-out

You own reconciliation. Read every report; resolve contradictions between them
yourself rather than forwarding them; run `pnpm -s format:check` over the merged
result; and record what landed per `memory/INDEX.md` — **at merge time on
master**, never on the feature branch.
