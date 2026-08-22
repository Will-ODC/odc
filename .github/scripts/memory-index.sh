#!/usr/bin/env bash
#
# Memory-index guard. Fails when a top-level source directory has no row in
# memory/INDEX.md's workstream table.
#
# Why this exists: apps/pulse ran for nineteen PRs (#79-#97) without a single
# line of memory recording it, and memory/STATE.md — the file that called itself
# the single source of session-to-session truth — admitted so in its own blockers
# section. The fix was an index that routes, but an index nobody is required to
# update rots the same way. INDEX.md already states the checkable invariant:
# "a directory that agents commit to and that has no row in the workstream table
# is a bug in this file." This script is that sentence, enforced. It would have
# fired on apps/ at PR #79.
#
# It deliberately checks only for the directory NAME appearing somewhere in the
# index. It cannot tell whether the entry is any good — that is review's job.
# What it can do is make the omission loud instead of silent, which is the
# failure mode that actually happened.
#
# Run locally:  bash .github/scripts/memory-index.sh
set -euo pipefail

INDEX="${INDEX:-memory/INDEX.md}"
ROOT="${ROOT:-.}"

# Directories that hold work an agent commits to. Everything else at top level
# (node_modules, .git, .github, dot-dirs) is tooling, not a workstream.
WORKSTREAM_DIRS=(apps contracts services tools docs)

if [[ ! -f "$ROOT/$INDEX" ]]; then
  echo "::error::$INDEX not found — the memory index is required."
  exit 1
fi

missing=()
for dir in "${WORKSTREAM_DIRS[@]}"; do
  [[ -d "$ROOT/$dir" ]] || continue
  # A row mentioning the directory, in a table or a bullet, counts.
  if ! grep -q "\`$dir/" "$ROOT/$INDEX"; then
    missing+=("$dir")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "::error::These top-level directories have no row in $INDEX: ${missing[*]}"
  echo ""
  echo "A directory agents commit to that the memory index does not mention is"
  echo "how a whole workstream goes unrecorded (see apps/pulse, PRs #79-#97)."
  echo "Add a row naming the directory and its memory entry, in this same PR."
  exit 1
fi

echo "memory-index OK: every workstream directory is named in $INDEX."
