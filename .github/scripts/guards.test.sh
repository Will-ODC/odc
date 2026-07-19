#!/usr/bin/env bash
#
# Tests for the CI guard scripts (T2). Builds throwaway git repos, replays each
# scenario the guards must catch, and asserts the exit code. No network, no deps
# beyond git + bash. Run: bash .github/scripts/guards.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/contracts-guard.sh"
DIFFSIZE="$HERE/diff-size.sh"

pass=0
fail=0
note() { printf '  %s\n' "$1"; }
ok() {
  pass=$((pass + 1))
  echo "PASS: $1"
}
bad() {
  fail=$((fail + 1))
  echo "FAIL: $1"
}

# new_repo <dir>: init a repo with an initial commit; leaves HEAD on `base`.
new_repo() {
  local d="$1"
  rm -rf "$d"
  mkdir -p "$d/contracts"
  git -C "$d" init -q -b base
  git -C "$d" config user.email t@t.t
  git -C "$d" config user.name t
  printf '# readme\n' >"$d/contracts/README.md"
  git -C "$d" add -A
  git -C "$d" commit -qm init
}

# run_guard <dir>: run contracts-guard against base..HEAD in <dir>. Echoes exit.
run_guard() {
  (cd "$1" && BASE=base HEAD=HEAD bash "$GUARD" >/dev/null 2>&1)
  echo $?
}

# assert <expected-exit> <actual-exit> <label>
assert() {
  if [[ "$1" == "$2" ]]; then ok "$3"; else
    bad "$3 (expected exit $1, got $2)"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- Scenario 1: contracts/ touched, changelog entry, no spec → PASS (exit 0)
R="$TMP/s1"
new_repo "$R"
git -C "$R" checkout -q -b work
printf '## x — n/a — 2026-01-01 — T2\n- seeded\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 0 "$(run_guard "$R")" "changelog entry, no spec touched → pass"

# --- Scenario 2: spec touched WITHOUT version bump → FAIL (exit 1)
R="$TMP/s2"
new_repo "$R"
git -C "$R" checkout -q -b work
printf '# Event Schema\n\nSome normative text.\n' >"$R/contracts/event-schema.md"
printf '## event-schema — v1 — 2026-01-01 — T3\n- draft\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 1 "$(run_guard "$R")" "spec touched, no Version line → fail"

# --- Scenario 3: spec touched WITH version bump + changelog → PASS
R="$TMP/s3"
new_repo "$R"
git -C "$R" checkout -q -b work
printf '# Event Schema\n\n**Version:** v1\n\nSome normative text.\n' >"$R/contracts/event-schema.md"
printf '## event-schema — v1 — 2026-01-01 — T3\n- draft\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 0 "$(run_guard "$R")" "spec touched with Version + changelog → pass"

# --- Scenario 4: spec touched, version bump, but NO changelog entry → FAIL
R="$TMP/s4"
new_repo "$R"
git -C "$R" checkout -q -b work
printf '# Event Schema\n\n**Version:** v1\n\ntext\n' >"$R/contracts/event-schema.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 1 "$(run_guard "$R")" "spec + version but no changelog → fail"

# --- Scenario 5: no contracts/ change at all → PASS (guard is a no-op)
R="$TMP/s5"
new_repo "$R"
git -C "$R" checkout -q -b work
printf 'root\n' >"$R/README.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 0 "$(run_guard "$R")" "no contracts/ change → pass (no-op)"

# --- Scenario 6: FREEZE — contracts-v1 tag exists, edit hashing.md → FAIL
R="$TMP/s6"
new_repo "$R"
printf '# Hashing\n\n**Version:** v1\nrules\n' >"$R/contracts/hashing.md"
git -C "$R" add -A && git -C "$R" commit -qm "add hashing"
git -C "$R" tag contracts-v1
git -C "$R" checkout -q -b work
printf '# Hashing\n\n**Version:** v1\nrules changed\n' >"$R/contracts/hashing.md"
printf '## hashing — v2 — 2026-01-01 — X\n- tweak\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
# base for this scenario is the tagged commit's parent chain; diff base..HEAD.
assert 1 "$(run_guard "$R")" "frozen hashing.md edited after contracts-v1 → fail"

# --- Scenario 7: FREEZE — contracts-v1 tag exists, edit a fixture → FAIL
R="$TMP/s7"
new_repo "$R"
mkdir -p "$R/contracts/fixtures"
printf '{"seq":1}\n' >"$R/contracts/fixtures/001.json"
git -C "$R" add -A && git -C "$R" commit -qm "add fixture"
git -C "$R" tag contracts-v1
git -C "$R" checkout -q -b work
printf '{"seq":2}\n' >"$R/contracts/fixtures/001.json"
printf '## fixtures — v2 — 2026-01-01 — X\n- tweak\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 1 "$(run_guard "$R")" "frozen fixture edited after contracts-v1 → fail"

# --- Scenario 7b: per-file version check — spec A edited unbumped while spec B
# is added WITH a Version line must still FAIL (B's bump can't cover A).
R="$TMP/s7b"
new_repo "$R"
printf '# Spec A\n\n**Version:** v1\n\noriginal text\n' >"$R/contracts/a.md"
git -C "$R" add -A && git -C "$R" commit -qm "add spec a"
git -C "$R" checkout -q -b work
printf '# Spec A\n\n**Version:** v1\n\nEDITED text, no bump\n' >"$R/contracts/a.md"
printf '# Spec B\n\n**Version:** v1\n\nnew spec\n' >"$R/contracts/b.md"
printf '## specs — v1 — 2026-01-01 — T4\n- add b, edit a\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 1 "$(run_guard "$R")" "spec A edited unbumped, spec B added bumped → fail"

# --- Scenario 8: diff-size fails past the hard ceiling (>800 changed lines)
R="$TMP/s8"
new_repo "$R"
git -C "$R" checkout -q -b work
# 900 lines added in a non-exempt file.
seq 1 900 >"$R/big.txt"
git -C "$R" add -A && git -C "$R" commit -qm big
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 1 "$ds" "diff-size >800 changed lines → fail"

# --- Scenario 9: diff-size ignores exempt lockfile churn
R="$TMP/s9"
new_repo "$R"
git -C "$R" checkout -q -b work
seq 1 900 >"$R/pnpm-lock.yaml"
git -C "$R" add -A && git -C "$R" commit -qm lock
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size ignores lockfile churn → pass"

echo
echo "guards.test.sh: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
