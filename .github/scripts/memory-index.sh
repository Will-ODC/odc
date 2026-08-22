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
# The directory list is DISCOVERED, never hardcoded, and that is the whole point.
# A hardcoded list can only catch a directory someone already thought to list,
# which is precisely the case that does not need catching — the failure is a
# workstream nobody was thinking about. `git ls-tree` is the right source: it
# names exactly the directories that hold committed work, so an untracked or
# gitignored directory (node_modules) never trips it, and a brand-new `packages/`
# trips it the moment it is committed. Dot-directories (.github, .claude) are
# tooling, not workstreams, and are skipped.
#
# Run locally:  bash .github/scripts/memory-index.sh
set -euo pipefail

INDEX="${INDEX:-memory/INDEX.md}"
ROOT="${ROOT:-.}"

cd "$ROOT"

if [[ ! -f "$INDEX" ]]; then
  echo "::error::$INDEX not found — the memory index is required."
  exit 1
fi

# Every top-level directory holding committed work, discovered not assumed.
mapfile -t tracked < <(git ls-tree -d --name-only HEAD)

missing=()
for dir in "${tracked[@]}"; do
  # Dot-directories are tooling (.github, .claude), not workstreams.
  [[ "$dir" == .* ]] && continue
  # A row mentioning the directory, in a table or a bullet, counts.
  if ! grep -q "\`$dir/" "$INDEX"; then
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
