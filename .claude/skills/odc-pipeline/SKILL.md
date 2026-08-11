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

Merges to `master` require: green CI + one review + linear history.
No direct pushes to `master`, no exceptions, including the operator.

## Local hooks (lefthook)

- pre-commit: format + lint on staged files only (must run < 5s)
- pre-push: unit tests of changed services
- Never hook anything slower; slow hooks get bypassed and then trusted falsely.

## Reproduce the guards locally before pushing

The CI guards are plain scripts — run the ones your diff touches **before** you
push, so a PR lands green on the first try instead of round-tripping through red
CI. This is the standing loop for every branch:

- `pnpm -s format:check` — prettier. Markdown is checked (docs, memory, skills);
  `contracts/` is excluded (`.prettierignore`). Fix with `prettier --write` and
  eyeball the diff (it is usually just `*em*` → `_em_`).
- `BASE=origin/master HEAD=HEAD bash .github/scripts/diff-size.sh` — the scripts
  are the source of truth for the ceiling and the exemptions.
- Touching `contracts/**`: `.github/scripts/contracts-guard.sh` (needs the touched
  spec's `Version:` bumped **and** a `CONTRACTS-CHANGE.md` entry). If fixtures
  changed, regenerate them and run `.github/scripts/fixtures-manifest.sh`. Note
  the guards diff `origin/master...HEAD`, so **commit first**, then run them.
- The changed unit's own tests (`go test ./...`, `pnpm --filter <pkg> test`, etc.).

**Fresh-clone caveat (Claude Code on the web).** lefthook's hooks are NOT
installed until `pnpm install` runs, so the pre-commit format/lint hook may not
fire on the first commits of a new session — run `format:check` by hand rather
than trusting the hook to catch it. Once `pnpm install` has run, the hooks are
live for the rest of the session.

## Why small branches (the point of all of this)

Small branches simulate a ticket/Jira pipeline for AI development: each branch
is one ticket-sized unit that a single agent session can produce, a fresh
session can review, and CI can test — independently and in parallel. Big
branches break every stage of that loop: they exceed one session's reliable
context, reviews degrade into skims, and failures stop isolating. The branch
IS the ticket.

## Ticket-shaped workflow

1. **The architect (`odc-architect`) cuts issues** from the plan: each issue = one behavior, with
   3–5 acceptance bullets. If it can't be described that tightly, split it.
   Dependent issues are planned as an ordered stack up front.
2. **One issue = one branch = one PR = one Opus session.** The issue text is
   the session's prompt; branch name carries the issue number
   (`ledger/14-insert-only-guard`).
3. **Review in a fresh context** per `odc-code-review`; **CI green** per this
   skill; **squash-merge** so master reads as one commit per ticket, message
   referencing the issue.
4. Board columns = pipeline stages: Backlog → In progress (branch open) →
   Review (PR open) → Done (merged). GitHub Projects, nothing fancier.
5. WIP limit: one active branch per service — an agent should never
   conflict with its own unmerged work.

## Branch rules

- One branch = one reviewable idea. Target diff < 400 lines (WARN); hard ceiling
  1000 (FAIL) — the live thresholds are in `.github/scripts/diff-size.sh`, the
  source of truth; markdown, generated code, and lockfiles are exempt. Bigger?
  Split it.
- **Do not stack PRs in this repo.** Squash-merge orphans a stack silently: when
  the base merges, its commit is replaced, so the child rebases onto a dead
  commit and the PR reports "merged" while delivering nothing (incident #11).
  One branch off `master`, merge, then branch the next. Force-push only with
  `--force-with-lease`, never `--force`.
- Branch names: `svc/short-description` (e.g. `ledger/insert-only-guard`).
- Commits: imperative subject ≤ 72 chars; body says WHY, not what.
- PR description: what changed, how it was tested, which contract version
  it targets. A reviewer should need nothing else to start. (The PR template
  in `.github/` mirrors these three fields.)

## Merge checklist (owned by odc-navigator, on master)

1. CI green, all required stages.
2. Review verdict recorded (APPROVE or APPROVE WITH NITS, per `odc-code-review`).
3. Squash-merge; message references the issue.
4. Update `memory/STATE.md` (done / next / blockers) — this happens HERE, on
   master at merge time, never on feature branches (parallel agents would conflict).
5. Move the board card to Done.
