---
name: odc-orchestration
description: How the orchestrator works for the operator in the ODC monorepo — which questions go to the operator and how they are asked, working toward a stated goal, wrapping up at 90% usage and handing off to Codex — and how to dispatch work — which model runs which task (Codex by default, Opus or Sonnet), how to write a subagent brief that works, how to run agents in parallel without corrupting one working tree, and how to run lead sessions that each own one feature and run their own implementers. Use this skill whenever delegating, starting or acting as a lead, spawning a subagent, planning a multi-step task, choosing between Codex, Opus and Sonnet, or deciding whether to do something yourself.
---

# ODC Orchestration

## The operator sets direction; the orchestrator settles the rest

The operator sets direction. The orchestrator turns it into work and decides
everything the operator has not kept for themself. Ask the operator only about:

- **Direction** — what to build next, what to drop, which workstream goes
  first.
- **User-facing features** — what a user should see or be able to do, and
  what "good enough" means for it.
- **Critical functionality** — what votes count, who may vote, what stays
  private, what is hashed or goes into `contracts/`, and charter rules. This
  covers what these do, not how they are coded; how they are coded is routed
  per the table: `contracts/` work and ADRs to Opus `odc-architect`, either
  verifier to `odc-verifier-builder`, other complex code to Codex by default
  with Opus as the Claude fallback.
- **Goals in tension** — when two goals pull apart and nothing written says
  which wins.
- **What the operator owns** — merging the PRs listed in "Merging", audits, deploys, spending, a charter
  conflict, and anything an ADR or memory entry reserves to the operator.

**Check the written goals before asking.** For the ODC core: `docs/charter.md`
and the current phase of `docs/implementation-plan.md`. For pulse:
`memory/pulse.md` and the epic or issue. For both: `docs/decisions/`. If one of
them answers the question, follow it and name it in the report; do not ask the
operator to decide it again. Everything else — how to build it, which model,
how to split PRs, names, test shape — the orchestrator decides and reports.

### Run automated loops toward a stated goal

What the operator wants from orchestration (2026-11-07): automated loops,
including critical reviews, and independent subagents that make ambiguous
design choices where appropriate. Overarching goals, and decisions on
user-facing features and critical functionality, still go to the operator.

**The loop,** for each unit of work: build → commit, push, open the PR → CI
green → the orchestrator starts the fresh-context reviews (a lead never does;
see "What a lead never does") → the owner fixes → review again until approved
→ the orchestrator merges it (see "Merging") → next unit. Audits are never part
of the loop. Stop a unit only for an open operator question on it, and keep
the other units moving. Start the next unit only within the WIP limit in `odc-pipeline`: a unit in a service that still
has an unmerged branch waits for the merge, or stacks on it as `odc-pipeline`
allows.

**Ambiguous design choices that are not the operator's** — internal structure,
a library, a data shape behind an API, error handling — go to a fresh
`odc-architect` started with the Agent tool (never `subagent_type: "fork"`,
which inherits what this context has seen). Brief it only with the goal, the
options and the constraints, with the git guardrails, and tell it to answer in
a few lines rather than write a plan. It picks one and gives the reason. Put
the choice and reason in the report, and in an ADR if it is architectural. If
the architect finds the choice affects a user-facing feature or critical
functionality, it is the operator's question.

**The goal.** Every run has a goal in the operator's words: a `/goal` text, or
the request itself. Ask for one only when the request does not say what done
looks like. Then:

- A brief opens with the goal, then the ticket and branch.
- Check each report and PR against it, and say in each relay how far the run
  has got toward it.
- Do work only if it serves the goal. Work that does not serve it is a
  question for the operator, not something to start.

### Keep session titles current

Session titles are how the operator finds work in the sidebar (operator,
2026-11-08). The orchestrator renames its own session
(`mcp__ccd_session_mgmt__set_session_title` with `"self"`) whenever its work
changes, naming the tickets and PRs in hand: "Orchestrator: #488 fixes, #493
merge rule". A lead does the same for its own session. The rename tool is
deferred, so load it with `ToolSearch` first; if the operator set the title,
the app asks them to approve a rename, so rename only titles the app or this
session set, never rename in a session the operator is not watching (such
as a Codex hand-off or a scheduled run), and remember that a subagent cannot
rename its own session. Codex (CLI 0.147, as of 2026-11-08)
has no command to set a title and labels a session by its first prompt line,
so every `codex exec` or interactive `codex` prompt starts with
`Title: <ticket or step> <a few words> (<branch>)`.

### Merging

The orchestrator merges a PR once it is properly reviewed (operator,
2026-11-07). **The operator merges** — the orchestrator reports it ready — any
PR whose diff touches one of these (operator, 2026-11-07):

- `contracts/`, `docs/charter.md`, `services/verifier/`, `tools/verifier-ts/`;
- the merge and review rules: `.claude/skills/odc-orchestration/`,
  `.claude/skills/odc-pipeline/`, `.claude/skills/odc-code-review/`,
  `.claude/skills/lead/`, `.claude/agents/odc-reviewer.md`,
  `.claude/agents/odc-ui-reviewer.md`, `.claude/agents/odc-navigator.md`, and
  root `CLAUDE.md`;
- CI and guards: `.github/` and `lefthook.yml`.

Check it with one command, which prints nothing when the orchestrator may merge:
`gh pr diff <N> --name-only | grep -E '^(contracts/|docs/charter\.md$|services/verifier/|tools/verifier-ts/|\.claude/skills/(odc-(orchestration|pipeline|code-review)|lead)/|\.claude/agents/odc-(ui-reviewer|reviewer|navigator)\.md$|CLAUDE\.md$|\.github/|lefthook\.yml$)'`

**Properly reviewed** means all of these:

- a fresh-context `odc-reviewer` verdict of APPROVE or APPROVE WITH NITS that
  names the sha it reviewed, and that sha is the PR's current head. Any later
  commit needs a fresh `odc-reviewer` on the new head. When the only new commit
  is a `master` merge whose conflict resolution changed no code or tests, a
  short review of `git diff <approved-sha> <head>` is enough;
- for a **UI PR** — one that touches `apps/pulse-web/**`, `services/web/**`,
  `docs/mockups/**`, or user-visible strings in `apps/pulse/**` — also an
  APPROVE or APPROVE WITH NITS from a fresh `odc-ui-reviewer` (a senior UI and
  design reviewer that checks the screens in the real browser) on the same
  sha. Start it in a review worktree at the PR head, like `odc-reviewer`, and
  tell it the worktree's absolute path for its `launch.json` entry;
- every CI check green;
- no blocking or should-fix finding left open, and no open operator question
  on it. Nits may stay if the report lists them.

GitHub does not enforce any of this: the `protect-master` ruleset requires no
approving reviews, only green checks and an up-to-date branch. The rule above is
the gate.

**The same gate whoever orchestrates** (operator, 2026-11-08). When Codex is
the orchestrator it may merge too, on the same list and the same gate. It meets
the `odc-reviewer` requirement with an independent reviewer: a separate, fresh
Codex process that did not write or orchestrate the change. To start one:

1. Make a review worktree at the PR head and run
   `pnpm install --frozen-lockfile` in it (the Codex sandbox has no network).
   For a PR that touches either verifier, make the worktree sparse exactly as
   "Review every PR you recommend" describes; never give the reviewer a full
   checkout. Write `git diff <base>...HEAD` to `REVIEW.diff` at its root.
   `<base>` is the PR's base branch: the parent branch for a stacked PR,
   otherwise `origin/master`. The reviewer has no network, so it cannot run
   `gh`; beside `REVIEW.diff`, also write `gh pr view <N> --json title,body`
   to `PR.json`, and the ticket to `TICKET.md`: `gh issue view <M>`, or, for a
   planned step, the plan or ADR step the PR names.
2. Run `codex exec -c model="<slug>" -s workspace-write -C <worktree> "<brief>" < /dev/null`.
   The brief starts with the `Title:` line from "Keep session titles current".
   Then it gives the text of `.claude/agents/odc-reviewer.md`, the PR number,
   the base and the head sha. It says the diff is at `REVIEW.diff`, the PR
   description is in `PR.json` and the ticket is in `TICKET.md`, and that the
   verdict line must name that sha. For a verifier PR it also says: read
   nothing outside this worktree, and do not use git to read other paths.

A UI PR also needs the `odc-ui-reviewer` review, which checks the screens in
a real browser with the Claude desktop browser tools. Codex has no equivalent
here, so a UI PR waits for a Claude session to run that review. Any PR whose
reviews Codex cannot run stays open and is marked unreviewed in the hand-off
for the next Claude session. Every report names the model and sha of each
review. After a Codex merge, Codex walks the `odc-pipeline` merge checklist
itself (memory on `master` included), since it cannot start `odc-navigator`;
if it cannot, it lists the owed memory update in the hand-off for the next
Claude session.

**To merge:** `gh pr merge <N> --squash --match-head-commit <sha>`, with the
head sha the latest review approved, so a commit pushed after the review cannot
slip in. Then follow the merge checklist in `odc-pipeline` (memory on
`master`). Stacked PRs follow `odc-pipeline`'s stack rules. Tell the operator
what was merged in one line per PR.

### Use Codex where it helps

When Claude orchestrates, Codex (the `codex` CLI) is a different model that has
seen nothing of this run, so it adds independence (operator, 2026-11-07). Use
it where the CLI is installed (`command -v codex`), as `codex review` or
`codex exec`.

#### Delegate to Codex by default

To spread token usage, a Claude orchestrator delegates to Codex by default
with
`codex exec -c model="<slug>" -s workspace-write -C <worktree> "<brief>" < /dev/null`.
Keep the `< /dev/null`: run in the background without it, `codex exec` waits
for input forever. The prompt starts with a `Title:` line, Codex gets its own
worktree (run `pnpm install --frozen-lockfile` in it first: the sandbox has
no network), and the brief includes the git guardrails from "Writing a brief
that actually works". Codex does not load `CLAUDE.md` or `.claude/agents/`,
so the brief also gives the text of the role it stands in for:
`.claude/agents/odc-implementer.md` for implementation, fixes and tests,
`.claude/agents/odc-navigator.md` for lookups, test runs and simple fixes. Use this route for implementation and fixes, writing tests,
running tests and guards, and second reviews. Lookups and inventory use the
same command with `-s read-only`.

Claude keeps orchestration decisions; the required fresh `odc-reviewer` and
`odc-ui-reviewer` reviews while Claude orchestrates; anything in `contracts/`
and every ADR, which stay with Opus `odc-architect`; the merge checklist in
`odc-pipeline`, memory included, which stays with `odc-navigator`; and any
step the Codex sandbox cannot do. After Codex finishes, the orchestrator runs
steps that need network access, `git push`, or tests that open ports.

Any work that touches `services/verifier/` or `tools/verifier-ts/` — a
build, a fix, a test, a rename — goes to `odc-verifier-builder`, never to
Codex. The only Codex exception is a review in a sparse worktree, as
"Merging" and the second-review bullet below describe.

When Codex hits its usage limit, the orchestrator falls back to Claude
routing (Opus or Sonnet, per the table) and tells the operator (operator,
2026-11-08: "claude carry on work").

Other Codex routes and fallbacks:

- **A second review** on UI PRs and on complex PRs. In a review worktree
  checked out at the PR head (sparse for a verifier PR, as "Review every PR
  you recommend" describes), run
  `git fetch origin && codex review --base <the PR's base branch>`. Use the
  parent branch for a stacked PR and `origin/master` otherwise. It takes no
  custom instructions together with `--base`. The orchestrator triages its
  findings into [BLOCKING] / [SHOULD] / [NIT] and sends them to the owner like
  any other finding. `codex review` follows no ODC checklist, so it adds to the
  required reviews and never counts as one.
- **If Codex rejects its configured model** ("not supported when using Codex
  with a ChatGPT account"), pass a listed one with `-c model="<slug>"`. This
  lists them:
  `codex debug models | jq -r '.models[] | select(.visibility != "hide") | .slug'`. Do not edit the operator's `~/.codex/config.toml`.
- **Taking over as orchestrator** at 90% usage (below).

### Wrap up at 90% usage

Check usage (`mcp__ccd_session_mgmt__get_usage`, a deferred tool: load it with
`ToolSearch` first) at each checkpoint of a long run: a push, a PR, CI going
green, a lead's report. At about 90% (operator, 2026-10-20):

1. Tell every lead and subagent to stop starting new work, finish or park the
   current step, and report.
2. Bring in any changes left in subagent worktrees, then commit the work in
   progress to its branch. Only the orchestrator or the lead commits, and
   subagents keep their git guardrails. Push it.
3. Update memory so the next session can continue: the goal, sessions,
   branches, PRs, open questions, merge order and the next step. Use the
   Claude memory directory. Each lead writes its own memory file; only the
   orchestrator edits the `MEMORY.md` index line. Repo `memory/` changes only
   at merge time on `master`.
4. **Hand off to Codex if it can continue** (operator, 2026-11-07). See below.
5. Tell the operator in two or three lines where the work stopped and what
   the next session starts with. Then stop.

### Hand off to Codex as the next orchestrator

When Claude usage is running out and Codex has more left, Codex can take over
as orchestrator. This works only where the `codex` CLI is installed and signed
in, and the session has the terminal tools (the operator's Mac). If
`command -v codex` finds nothing, or the terminal tools are missing (any cloud
session), skip this step.

- **Ask the operator in one popup** (Claude cannot see how much Codex usage is
  left): "Claude usage is at about 90%. Codex can carry on as the orchestrator
  from the hand-off notes." Options: "Hand off to Codex (Recommended): Codex
  continues in a terminal tab." / "Stop here: the next Claude session
  continues."
- **Write the hand-off** in the memory file from step 3: the goal, the
  operator's answers so far, open questions, branches and PRs with their
  state, and the next step.
- **Start Codex in a terminal tab the operator can talk to,** not with
  `codex exec`, which cannot ask the operator anything. Open the tab with
  `mcp__terminal__open_terminal_tab` (deferred: load it with `ToolSearch`), cd
  to the repo, and run `codex "<prompt>"`, which starts an interactive session
  with that prompt. The prompt tells Codex to read, in order: root
  `CLAUDE.md`, this skill, `memory/INDEX.md`, and the hand-off file by its
  absolute path. It also tells Codex that writing the hand-off file (outside
  the repo) and `git push` may need the operator's approval in Codex's
  sandbox; the operator approves them in the tab.
- **Codex runs flat.** It does not start or talk to Claude lead sessions.
  Leads stopped in step 1 stay stopped; their state is in the hand-off, and
  the next Claude session resumes them.
- **Codex follows the same rules:** operator questions as this skill says (in
  plain text, one at a time, with numbered options, the recommended one
  first), merging only as "Merging" allows, and the git guardrails for
  anything it spawns. It runs each required review as "Merging" describes for
  a Codex orchestrator, or leaves the PR open and marked unreviewed for the
  next Claude session.
- **Tell the operator** which terminal tab Codex is running in.

### How every question is asked

This covers every question that reaches the operator, from any session: the
orchestrator, a lead, or a subagent's report passed up. No exceptions.

- **One question per popup** (`AskUserQuestion`), one at a time; wait for the
  answer before asking the next (operator, 2026-10-21).
- **Short and plain.** One or two sentences of context, then the question.
  Plain words, no jargon, no analogies. Define a term before using it. Name a
  file or PR only when the answer depends on it.
- **Two or three options,** the recommended one first and marked
  "(Recommended)". Each option says in one line what happens if it is picked.
- **Say what is already decided,** and where, so the question covers only the
  open part.
- If an answer is unclear or does not arrive, say so and ask again. Never
  guess.

## The standing instruction

The operator's rule, verbatim:

> **"using opus as an orchestrator and for complex implementation, and sonnet
> for routine exploration and simple implementation."**

One exception (operator, 2026-11-07): when Claude usage is running out and
Codex has more left, Codex may take over as orchestrator (see "Hand off to
Codex as the next orchestrator").

A second instruction, verbatim (operator, 2026-11-08):

> **"ensure codex is used consistently for spread out token usage, by
> delegating appropriately"**

Where the two conflict, the 2026-11-08 instruction wins: Codex is the default
for delegated implementation and lookups, except the merge checklist, which
stays with `odc-navigator`; `contracts/` work
and ADRs, which stay with Opus `odc-architect`, and either verifier, which
stays with `odc-verifier-builder`.

This skill is the single source of truth for what that means in practice. The
root `CLAUDE.md` points here and carries no table of its own; `.claude/agents/*.md` carry
the same routing baked into each role's `model:` field. If any of the three
disagree, **this file wins and the other two get fixed in the same PR.** On
branches, PRs and merging, `odc-pipeline` is the source; this file follows it.

## Routing table

| Work                                                           | Model                                | Agent                            |
| -------------------------------------------------------------- | ------------------------------------ | -------------------------------- |
| Orchestrating a multi-agent task; deciding what to dispatch    | **Opus**                             | (you)                            |
| Architecture, cross-service planning, phase planning           | **Opus**                             | `odc-architect`                  |
| Drafting or editing anything in `contracts/`; writing an ADR   | **Opus**                             | `odc-architect`                  |
| Complex implementation outside `contracts/` (service, feature) | **Codex** (default) / Opus           | `codex exec` / `odc-implementer` |
| Building either verifier (contracts-only, fresh context)       | **Opus**                             | `odc-verifier-builder`           |
| Pre-merge review (fresh context)                               | **Opus**                             | `odc-reviewer`                   |
| Pre-merge review when Codex orchestrates ("Merging")           | **Codex**                            | fresh `codex exec`               |
| UI and design review of a UI PR (fresh context)                | **Opus**                             | `odc-ui-reviewer`                |
| Second, independent review of a UI or complex PR               | **Codex**                            | `codex review`                   |
| Phase-gate security audit (fresh context)                      | **Opus**                             | `odc-security-auditor`           |
| Resolving a contradiction between two documents                | **Opus**                             | (judgement — see below)          |
| Exploration, inventory, "where does X live"                    | **Codex** (default) / Sonnet         | `codex exec` / `odc-navigator`   |
| Verifying cited facts: does this path/commit/PR/line resolve?  | **Codex** (default) / Sonnet         | `codex exec` / `odc-navigator`   |
| Renames, mechanical find-and-replace, formatting               | **Codex** (default) / Sonnet         | `codex exec` / `odc-navigator`   |
| Writing tests for delegated implementation                     | **Codex** (default) / Opus or Sonnet | `codex exec` / `odc-implementer` |
| Running tests or guards and reporting the output               | **Codex** (default) / Sonnet         | `codex exec` / `odc-navigator`   |
| Simple implementation: a one-behaviour fix with a clear spec   | **Codex** (default) / Sonnet         | `codex exec` / `odc-navigator`   |
| Merge mechanics and the merge checklist, memory included       | **Sonnet** (Claude orchestrator)     | `odc-navigator`                  |
| Taking over as orchestrator when Claude usage runs out         | **Codex**                            | (hand-off — see above)           |

**The line between "simple" and "complex" implementation.** Codex is the
default for both, with one exception: `contracts/` work and ADRs are never
the Codex default; they go to Opus `odc-architect`. Otherwise this line
chooses the Claude fallback when Codex cannot do the step. Simple means: the
change is fully specified before it starts, it touches one file or one
obvious set, and being wrong is _visible_ — a test fails, a build breaks.
Complex means anything where being wrong is _silent_: hashing, event schemas,
storage grants, privacy boundaries, anything a charter rule touches.
**When the Claude fallback is not obvious, route Opus.** The cost of the
wrong Sonnet fallback is a subtly wrong artifact that passes CI; the cost of
the wrong Opus fallback is some tokens.

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
- **Fresh-context review.** `odc-reviewer` must not be the context that
  wrote or orchestrated the change. Re-running the authoring context on Opus
  is not a review.
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
3. **Ask the operator's questions now,** per "How every question is asked",
   and put the answers in the brief. Re-issuing a lead's card with the
   answers in it is cheaper than relaying them afterwards.

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
   split into PRs. Write each decision the way "How every question is asked"
   says, so it can be asked as a popup.
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
  `AskUserQuestion`, one per popup, per "How every question is asked". Do not
  paste a lead's full text or a prose list of decisions.
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
  pushing. What review the merged head then needs is set in "Merging". In the
  2026-10-20 run, merging `master` into an approved PR broke three tests from a
  PR merged an hour earlier.
- **When the leads report,** check their PRs do not collide — settle a clash
  between two leads by message — and tell the operator which PRs are ready to
  merge, in what order, with each review's verdict. Merge them per
  "Merging"; a PR in the operator's exception list waits for the operator.

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
