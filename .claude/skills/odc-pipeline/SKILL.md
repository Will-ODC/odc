---
name: odc-pipeline
description: CI/CD, git hooks, and branch discipline for the ODC monorepo. Use this skill whenever setting up or modifying CI, creating branches or PRs, configuring hooks, preparing a merge, or when the user mentions pipelines, CI, deployment, merging, or automation. Also consult before the first commit of any new service.
---

# ODC Pipeline & Branch Discipline

Free, simple equivalents of the commercial tools: GitHub Actions replaces
Buildkite; a scripted fresh-context Claude review (see `odc-code-review`)
replaces CodeRabbit; lefthook provides local hooks.

## CI (GitHub Actions)

One workflow per service, triggered by path filter
(`services/ledger/**` → ledger pipeline). Stages, in order, all required:

1. `lint` + `format --check`
2. `typecheck`
3. `unit` (fails fast)
4. `api-tests` (service + throwaway DB via docker-compose)
5. `golden-fixtures` (from `contracts/fixtures/`)
6. `build`

Plus one repo-wide workflow:
- `contracts-guard` — fails if any diff touches `contracts/` without a
  version bump and a `CONTRACTS-CHANGE.md` entry; fails on ANY edit to
  frozen hashing rules.
- `chain-smoke` — nightly: boot ledger, append events, export, run verifier,
  tamper, expect INVALID.

Merges to `main` require: green CI + one review + linear history.
No direct pushes to `main`, no exceptions, including the operator.

## Local hooks (lefthook)

- pre-commit: format + lint on staged files only (must run < 5s)
- pre-push: unit tests of changed services
- Never hook anything slower; slow hooks get bypassed and then trusted falsely.

## Why small branches (the point of all of this)

Small branches simulate a ticket/Jira pipeline for AI development: each branch
is one ticket-sized unit that a single agent session can produce, a fresh
session can review, and CI can test — independently and in parallel. Big
branches break every stage of that loop: they exceed one session's reliable
context, reviews degrade into skims, and failures stop isolating. The branch
IS the ticket.

## Ticket-shaped workflow

1. **Fable cuts issues** from the plan: each issue = one behavior, with
   3–5 acceptance bullets. If it can't be described that tightly, split it.
   Dependent issues are planned as an ordered stack up front.
2. **One issue = one branch = one PR = one Opus session.** The issue text is
   the session's prompt; branch name carries the issue number
   (`ledger/14-insert-only-guard`).
3. **Review in a fresh context** per `odc-code-review`; **CI green** per this
   skill; **squash-merge** so main reads as one commit per ticket, message
   referencing the issue.
4. Board columns = pipeline stages: Backlog → In progress (branch open) →
   Review (PR open) → Done (merged). GitHub Projects, nothing fancier.
5. WIP limit: one active branch per service — an agent should never
   conflict with its own unmerged work.

## Branch rules

- One branch = one reviewable idea. Target diff < 400 lines; hard ceiling 800
  (generated code and lockfiles exempt). Bigger? Split it or stack it.
- Stacked branches are encouraged; rebase stacks with `--update-refs`;
  push with `--force-with-lease` only, never `--force`.
- Branch names: `svc/short-description` (e.g. `ledger/insert-only-guard`).
- Commits: imperative subject ≤ 72 chars; body says WHY, not what.
- PR description: what changed, how it was tested, which contract version
  it targets. A reviewer should need nothing else to start. (The PR template
  in `.github/` mirrors these three fields.)

## Merge checklist (owned by odc-navigator, on main)

1. CI green, all required stages.
2. Review verdict recorded (APPROVE or APPROVE WITH NITS, per `odc-code-review`).
3. Squash-merge; message references the issue.
4. Update `memory/STATE.md` (done / next / blockers) — this happens HERE, on
   main at merge time, never on feature branches (parallel agents would conflict).
5. Move the board card to Done.
