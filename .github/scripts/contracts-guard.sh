#!/usr/bin/env bash
#
# contracts-guard (T2). Enforces the contracts/ change discipline on every PR
# that touches contracts/** (odc-service-boundaries, odc-contracts):
#
#   1. Freeze:   once the contracts-v1 tag exists, hashing.md and fixtures/
#                are immutable — any edit hard-fails.
#   2. Version:  any touched spec file must add/bump a `Version:` line.
#   3. Changelog: every contracts/ change must add a CONTRACTS-CHANGE.md entry.
#
# A "spec file" is contracts/*.md EXCEPT README.md and CONTRACTS-CHANGE.md.
#
# Run locally:  BASE=origin/master HEAD=HEAD bash .github/scripts/contracts-guard.sh
set -euo pipefail

BASE="${BASE:?BASE (base sha/ref) required}"
HEAD="${HEAD:?HEAD (head sha/ref) required}"

# Portable array fill (no mapfile — keep it runnable on bash 3.2 too).
changed=()
while IFS= read -r line; do
  [[ -n "$line" ]] && changed+=("$line")
done < <(git diff --name-only "$BASE...$HEAD" -- 'contracts/')

if ((${#changed[@]} == 0)); then
  echo "No contracts/ changes; contracts-guard passes."
  exit 0
fi

echo "contracts/ files changed:"
printf '  %s\n' "${changed[@]}"

fail=0
err() {
  echo "::error::$1"
  fail=1
}

# 1. Freeze guard — hashing.md and fixtures/ are permanent after contracts-v1.
if git rev-parse -q --verify "refs/tags/contracts-v1" >/dev/null 2>&1; then
  for f in "${changed[@]}"; do
    if [[ "$f" == "contracts/hashing.md" || "$f" == contracts/fixtures/* ]]; then
      err "FROZEN: $f cannot change after the contracts-v1 tag. Hashing rules and golden fixtures are permanent (odc-contracts)."
    fi
  done
fi

# 2. Version bump — required only when an actual spec file is touched.
spec_touched=0
for f in "${changed[@]}"; do
  case "$f" in
  contracts/README.md | contracts/CONTRACTS-CHANGE.md) : ;;
  contracts/*.md) spec_touched=1 ;;
  esac
done

if ((spec_touched)); then
  added_version="$(git diff "$BASE...$HEAD" -- 'contracts/*.md' \
    ':(exclude)contracts/README.md' ':(exclude)contracts/CONTRACTS-CHANGE.md' \
    | grep -E '^\+' | grep -Ei '^\+[[:space:]]*\*{0,2}version:\*{0,2}[[:space:]]*v?[0-9]+' || true)"
  if [[ -z "$added_version" ]]; then
    err "A touched spec has no added 'Version:' line. Bump the spec's version — contracts/ is version-bumped, never edited in place (odc-service-boundaries)."
  fi
fi

# 3. Changelog entry — every contracts/ change must be logged.
added_changelog="$(git diff "$BASE...$HEAD" -- 'contracts/CONTRACTS-CHANGE.md' \
  | grep -E '^\+' | grep -vE '^\+\+\+' | grep -vE '^\+[[:space:]]*(#|$)' || true)"
if [[ -z "$added_changelog" ]]; then
  err "No new contracts/CONTRACTS-CHANGE.md entry. Every contracts/ change must be logged there."
fi

if ((fail)); then
  echo "contracts-guard FAILED."
  exit 1
fi
echo "contracts-guard passed."
