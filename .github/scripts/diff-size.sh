#!/usr/bin/env bash
#
# Diff-size guard (T2). Keeps branches ticket-sized (odc-pipeline: one branch =
# one reviewable idea). Warns above WARN changed lines, fails above FAIL.
# Lockfiles and generated output are exempt from the count. Markdown is exempt
# too: specs (contracts/), ADRs and plans (docs/), and prose notes are governed
# by review, not a code line-budget — the phase-0 plan makes spec tickets (T3,
# T4) exempt from line limits, and this is where that exemption lives. Code
# (.ts, .go, config, scripts) is still fully counted.
#
# Run locally:  BASE=origin/master HEAD=HEAD bash .github/scripts/diff-size.sh
set -euo pipefail

BASE="${BASE:?BASE (base sha/ref) required}"
HEAD="${HEAD:?HEAD (head sha/ref) required}"

WARN=400
FAIL=800

# added+deleted lines, excluding lockfiles, generated output, and markdown.
# Deletions count too (churn is churn) — a large legitimate removal can trip the
# ceiling and force a split; that's intended, keep removals on their own branch.
total=0
while IFS=$'\t' read -r add del _path; do
  # Binary files report '-' for both counts; skip them.
  [[ "$add" == "-" || "$del" == "-" ]] && continue
  total=$((total + add + del))
done < <(git diff --numstat "$BASE...$HEAD" -- . \
  ':(exclude)pnpm-lock.yaml' \
  ':(exclude)package-lock.json' \
  ':(exclude)yarn.lock' \
  ':(exclude,glob)**/dist/**' \
  ':(exclude,glob)**/.turbo/**' \
  ':(exclude,glob)**/*.md')

echo "Changed lines (excluding lockfiles/generated/markdown): $total"

if ((total > FAIL)); then
  echo "::error::Diff is $total changed lines (> $FAIL). Split or stack this branch (odc-pipeline)."
  exit 1
elif ((total > WARN)); then
  echo "::warning::Diff is $total changed lines (> $WARN). Target is < $WARN; consider splitting."
fi

echo "diff-size OK."
