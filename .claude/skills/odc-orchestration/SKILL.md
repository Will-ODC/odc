---
name: odc-orchestration
description: How to dispatch work in the ODC monorepo — which model runs which task, how to write a subagent brief that works, how to run agents in parallel without corrupting one working tree, and how to run lead sessions that each own one feature and run their own implementers. Use this skill whenever delegating, starting or acting as a lead, spawning a subagent, planning a multi-step task, choosing between Opus and Sonnet, or deciding whether to do something yourself.
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

## Leads: one level between the orchestrator and the implementers

Decided by the operator 2026-10-08. Use this when an initiative has two or more
whole features that live in **separate folders** and the operator's direction
is broad rather than step by step. One feature, or features that share files:
stay flat and use the sections above.

**Three levels.** The **orchestrator** is the session the operator talks to. It
turns the operator's direction into one goal per lead. A **lead** owns one
feature and one set of folders, and decides how to build it. **Implementers**
and helpers are subagents the lead starts, routed by the table above.

**A lead must be its own session, not a subagent.** A subagent cannot start
subagents, so a lead started with the Agent tool could not run implementers.
The orchestrator offers each lead with `spawn_task`; the operator starting it
is the go-ahead. Each lead works in its own worktree. The two sessions talk with
`SendMessage` (find the other with `ListAgents`).

**The lead's brief** is the five sections above, plus: the goal in the
operator's words, the folders it owns, the folders other leads own right now,
and the orchestrator's session name to report to.

**What a lead does, in order:**

1. **Read** what the brief names, then **send a synopsis and stop.** It is for
   the operator, so it is short and in plain words, no jargon: what will be
   built, what a user will notice, which folders change, how the work will split
   into PRs, and any decision the lead needs. Show it in the lead's own session
   and send it to the orchestrator. Build nothing until the operator says go.
2. **Build the whole feature** on one local branch, with implementer and helper
   subagents. The lead is the one context in its worktree that commits; its
   subagents get the git guardrails above.
3. **Check it itself:** the unit's tests, `pnpm -s format:check`, and for any
   screen, the real browser — green jsdom tests are not proof a screen works.
4. **Bring it up to date with master,** then split it into small PRs in a
   sensible order (stacked, two or three deep, per `odc-pipeline`). Push; get CI
   green.
5. **Report to the orchestrator and stop:** the PRs, how they fit together,
   anything stale it saw, any decision it needs.

**What a lead never does:** merge anything, or start a reviewer or auditor.
Every review is the operator's call. A lead also stops and sends the question up
— rather than deciding — on a charter conflict, any change under `contracts/`,
a file in another lead's folders, or anything the operator owns.

**The orchestrator then** checks the leads' PRs do not collide, and tells the
operator which are ready for review, in what order.

Diff size: `apps/pulse*` is exempt from the hard ceiling, so a pulse feature
can arrive as large PRs; everywhere else the `diff-size.sh` ceiling applies.

### What the first pilot taught (2026-10-09)

Two pulse leads shipped open sign-up and two screen bugs in about two hours.
These held, or broke, and are now rules:

- **Put the operator's answers in the brief.** Re-issuing a lead's card with the
  answers in it was cheaper than relaying them afterwards.
- **Give each lead its branch numbers.** Both leads guessed "the next free
  `pulse/N`" and could have collided.
- **Name `.claude/launch.json` in the brief if the lead needs the browser.** It
  sits outside a lead's folders. Its entries `cd` by relative path, so the
  preview starts the dev servers of the checkout the session was opened in, not
  the lead's worktree: a lead checking its own screens runs its worktree's
  servers directly.
- **Say which channel a go comes through.** Either the operator answers in the
  lead's own session, or a go the orchestrator relays, quoting the operator,
  counts. In the pilot a relayed go was ignored because neither was said. The operator may also answer inside
  a lead's session, so the orchestrator keeps its list of open questions in step
  with what the leads report as answered.
- **Silence is not a yes.** Leads recommend an option and wait; do not proceed
  until told. Never write "my pick goes ahead unless told otherwise".
- **After offering `spawn_task` cards, check every one is still pending.** A new
  card can silently push an older one off the list.
- **No commits does not mean an idle lead.** One lead had built everything
  without committing. A lead may also finish without reporting: check
  `gh pr list` and the lead's worktree rather than waiting for a message.
- **Cross-folder needs show up at the end,** when CI runs another folder's tests
  (one lead's server change broke a client end-to-end test). The orchestrator
  grants a narrow, **one-off** edit when no other lead holds those files, and says
  it is one-off.
- **A restarted lead can widen its own scope.** One edited a plan file beyond
  what was approved. After any restart, re-check the open PRs for overlap.
- What worked: a lead **can** `SendMessage` the orchestrator, the synopses were
  short and plain, and the orchestrator caught a clash between two leads (a
  migration number against an ADR's columns) and settled it by message.

## After the fan-out

You own reconciliation. Read every report; resolve contradictions between them
yourself rather than forwarding them; run `pnpm -s format:check` over the merged
result; and record what landed per `memory/INDEX.md` — **at merge time on
master**, never on the feature branch.
