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
root `CLAUDE.md` points here and carries no table of its own; `.claude/agents/*.md` carry
the same routing baked into each role's `model:` field. If any of the three
disagree, **this file wins and the other two get fixed in the same PR.** On
branches, PRs and merging, `odc-pipeline` is the source; this file follows it.

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
| Merge mechanics, once the operator says merge                 | **Sonnet** | `odc-navigator`         |

**The line between "simple" and "complex" implementation.** Simple means: the
change is fully specified before it starts, it touches one file or one obvious
set, and being wrong is _visible_ — a test fails, a build breaks. Complex means
anything where being wrong is _silent_: hashing, event schemas, storage grants,
privacy boundaries, anything under `contracts/`, anything a charter rule
touches. **When it is not obvious which, route Opus.** The cost of the wrong
Sonnet dispatch is a subtly wrong artifact that passes CI; the cost of the wrong
Opus dispatch is some tokens.

## Writing a brief that actually works

A subagent starts with nothing but the brief. **Start it with the ticket
number** (`#301`) and the branch, `<area>/<issue>-<short>` (`odc-pipeline`);
for a planned step with no ticket, the step's name and where it is written,
and a branch `<area>/<short>`.
The ticket is how the operator, the agent and its report refer to the work; a
brief without one has no handle. Then five sections, always:

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
5. **What to report back** — leading with the ticket (or planned step) and PR numbers
   (`#299 → PR #307`), then files created and why, files changed and why,
   anything stale it found but did not fix, anything needing an operator
   decision. **The report is the only thing you see.** An agent that writes its
   findings to a file you never read has done nothing.

## Parallel agents in one working tree

One tree, several agents, is where work gets lost. **Give an agent its own
tree** — `isolation: "worktree"` on the Agent tool — whenever it will edit
files while yours has uncommitted work, and always for a reviewer or a mutation
run. Its changes stay in its worktree for you to commit and bring in. A spawned
agent that shares your tree has already discarded another session's
uncommitted edit here. When agents do share one tree:

- **Partition by path, never by intent.** Two agents may both be "improving
  docs"; they must not both own `docs/`. Hand each a disjoint list.
- **Say who else is running and where.** An agent that knows `apps/**` is live
  under another agent will route around it; one that does not will "helpfully"
  fix a file mid-edit.
- **Commit before dispatching a review or mutation agent.** Its worktree starts
  from your last commit, so uncommitted work is invisible to it; in a shared
  tree, reviewers edit and restore files, and a dirty tree has already been
  clobbered once here.
- **Respect the WIP limit in `odc-pipeline`** (one active branch per service).
  An agent should never conflict with its own unmerged work.
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

- **Verifier independence.** `odc-verifier-builder` reads `contracts/`, the
  one verifier it is building (`services/verifier/` or `tools/verifier-ts/`),
  and `docs/charter.md` §4 — never `services/ledger/`, never the other
  verifier, never any other service's source, and never ledger details pasted
  into its context (the full read list is in `.claude/agents/odc-verifier-builder.md`).
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

### The orchestrator, before offering leads

1. **Fetch first.** `git fetch origin`, and branch every lead's worktree from
   `origin/master`, not the local `master`. The skills a session loads come
   from its own checkout; a stale checkout hands the lead stale rules.
2. **Name the branches.** A new feature has an issue and uses
   `<area>/<issue>-<short>`; a step already planned in memory or an ADR gets no
   ticket and uses `<area>/<short>` (`odc-pipeline`, "Planned steps get no
   ticket"). Never guess "the next free number".
3. **Ask the operator's questions now,** as multiple-choice popups
   (`AskUserQuestion`, recommended option first), and put the answers in the
   brief. Re-issuing a lead's card with the answers in it is cheaper than
   relaying them afterwards.

### The lead's brief

The five sections above, plus:

- the goal in the operator's words, and every answer the operator has given;
- its tickets, if any, and branch names;
- the folders it owns, and the folders other leads own right now;
- **how a go reaches it** — the operator answering in the lead's own session,
  or the orchestrator relaying a go that quotes the operator. Name one or both.
  In the pilot a relayed go was ignored because the brief did not say;
- if it will check screens in the browser, that it may add a temporary
  `.claude/launch.json` entry (see step 3 below), since that file sits outside
  its folders;
- the orchestrator's session name to report to.

### What a lead does, in order

1. **Read** what the brief names, then **send a synopsis and stop.** It is for
   the operator, so it is a few lines in plain words, no jargon: what will be
   built, what a user will notice, which folders change, and how the work will
   split into PRs. Write each decision as one sentence of context plus two or
   three options, the recommended one first, so it can be asked as a popup.
   Show it in the lead's own session and send it to the orchestrator. **Build
   nothing until a go arrives by the channel the brief names. Silence is not a
   yes:** never write "my pick goes ahead unless told otherwise".
2. **Build the whole feature** on one local branch, with implementer and helper
   subagents. The lead is the one context in its worktree that commits, and it
   commits as it goes; its subagents get the git guardrails above.
3. **Check it itself:** the unit's tests, `pnpm -s format:check`, and for any
   screen, the real browser — green jsdom tests are not proof a screen works.
   `preview_start` reads `.claude/launch.json` from the checkout the session
   was opened in, and its entries `cd` by relative path, so as written they
   start that checkout's servers, not the lead's worktree. Add a temporary
   entry that `cd`s to the worktree's absolute path, use it, then restore the
   file. Never commit that entry.
4. **Bring it up to date with `origin/master`,** then split it into small PRs.
   The operator allowed a lead to deliver one feature as several PRs at once
   (2026-10-08); that is the one exception to the WIP limit in `odc-pipeline`.
   Everything else there holds: a PR that does not need another branches off
   `master`, and only a PR that needs an unmerged one stacks on it, two or
   three deep at most. Push; get CI green.
5. **Report to the orchestrator and stop,** in a few lines: the PRs
   (`#301 → PR #307`), how they fit together, anything stale it saw, and any
   decision, written as options the way step 1 says.

**What a lead never does:** merge anything, or start a reviewer or auditor. The
orchestrator starts reviews (below); audits stay the operator's call. A lead
also stops and sends the question up — rather than deciding — on a charter
conflict, any change under `contracts/`, a file in another lead's folders, or
anything the operator owns. After a restart it re-reads its brief and does not
go past it.

### The orchestrator, while leads run

- **After offering `spawn_task` cards, check every one is still pending.** A new
  card can silently push an older one off the list.
- **Relay short, ask in popups** (operator, 2026-10-20: "faster and simpler").
  Cut each synopsis or report to two or three lines and put every decision into
  `AskUserQuestion` — up to four per popup, across leads, recommended option
  first. Do not paste a lead's full text or a prose list of decisions.
- **Keep one list of open questions.** The operator may answer inside a lead's
  session; update the list from what leads report as answered.
- **Do not wait for a message.** A lead with no commits may have built
  everything, and a lead may finish without reporting. Check `gh pr list` and
  the lead's worktree.
- **Grant cross-folder edits narrowly.** They tend to appear at the end, when
  CI runs another folder's tests. Grant one only when no other lead holds those
  files, and say it is one-off.
- **After any lead restarts, re-check the open PRs for overlap.** A restarted
  lead in the pilot edited a plan file beyond what was approved.
- **Review every PR you recommend** (operator, 2026-10-20: "confirm you have been
  doing code review on all PRs?", then "do it"). Once a PR's CI is green, start
  a fresh-context `odc-reviewer` on it, routed by the table above, in its own
  review worktree with the PR's diff at the root as `REVIEW.diff`. For a PR that
  touches either verifier, the review worktree is sparse: only `contracts/`,
  that verifier, `docs/charter.md` and `.claude/`, so the reviewer never sees
  `services/ledger/`, the other verifier, or (for the TS one)
  `tools/fixtures-gen/` and `tools/rehearsal/`. For the TS verifier, run
  `pnpm install` before narrowing so `node_modules` exists, and keep
  `.github/`, because the eslint config imports `.github/scripts/`. Send each
  finding to the lead that owns the PR, and review the fix again. A PR the
  orchestrator wrote itself needs a reviewer that did not write it either.
  **This covers every PR the orchestrator will recommend for merging,** not
  only lead PRs: one from Codex or another session that lands during the run
  is reviewed the same way (operator, 2026-10-20; #399 and #403–#406 were
  reviewed only because the operator asked).
- **Re-check a PR after `master` is merged into it.** Whoever merges `master`
  in (the orchestrator, or the lead that owns the PR) runs the unit's tests,
  lint, typecheck and `pnpm -s format:check` on the merged result before
  pushing. If resolving the conflict changed code or tests, not only prose,
  the orchestrator has a fresh `odc-reviewer` review that merge commit. In the
  2026-10-20 run, merging `master` into an approved PR broke three tests from a
  PR merged an hour earlier.
- **When the leads report,** check their PRs do not collide — settle a clash
  between two leads by message — and tell the operator which PRs are ready to
  merge, in what order, with each review's verdict. Merging stays the
  operator's call.

Diff size: `apps/pulse*` is exempt from the `diff-size.sh` ceiling (the script
lists every exemption), so a pulse feature can arrive as large PRs.

**Where these rules came from.** The first pilot (2026-10-09): two pulse leads
shipped open sign-up and two screen bugs in about two hours. The rules on
tickets, answers in the brief, the go channel, silence, pending cards, checking
`gh pr list`, one-off edits, restarts and `launch.json` are what it taught.

## After the fan-out

You own reconciliation. Read every report; resolve contradictions between them
yourself rather than forwarding them; run `pnpm -s format:check` over the merged
result; and record what landed per `memory/INDEX.md` — **at merge time on
master**, never on the feature branch.
