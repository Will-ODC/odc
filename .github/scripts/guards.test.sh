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

# --- Scenario 7c: FREEZE — ADDING a new fixture after contracts-v1 → PASS.
# evolution.md EV-5/EV-14 require every additive change to ship golden fixtures,
# so the freeze must not block additions or no post-freeze type could ever ship.
R="$TMP/s7c"
new_repo "$R"
mkdir -p "$R/contracts/fixtures"
printf '{"seq":1}\n' >"$R/contracts/fixtures/001.json"
git -C "$R" add -A && git -C "$R" commit -qm "add fixture"
git -C "$R" tag contracts-v1
git -C "$R" checkout -q -b work
printf '{"seq":9}\n' >"$R/contracts/fixtures/042-new-type.json" # untouched: 001.json
printf '## fixtures — v2 — 2026-01-01 — X\n- new type vector\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 0 "$(run_guard "$R")" "NEW fixture added after contracts-v1 → pass"

# --- Scenario 7d: FREEZE — DELETING an existing fixture after the tag → FAIL
R="$TMP/s7d"
new_repo "$R"
mkdir -p "$R/contracts/fixtures"
printf '{"seq":1}\n' >"$R/contracts/fixtures/001.json"
git -C "$R" add -A && git -C "$R" commit -qm "add fixture"
git -C "$R" tag contracts-v1
git -C "$R" checkout -q -b work
git -C "$R" rm -q "contracts/fixtures/001.json"
printf '## fixtures — v2 — 2026-01-01 — X\n- drop vector\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 1 "$(run_guard "$R")" "existing fixture deleted after contracts-v1 → fail"

# --- Scenario 7e: FREEZE — RENAMING an existing fixture after the tag → FAIL.
# Guards against rename detection laundering a delete into an allowed add.
R="$TMP/s7e"
new_repo "$R"
mkdir -p "$R/contracts/fixtures"
printf '{"seq":1}\n' >"$R/contracts/fixtures/001.json"
git -C "$R" add -A && git -C "$R" commit -qm "add fixture"
git -C "$R" tag contracts-v1
git -C "$R" checkout -q -b work
git -C "$R" mv "contracts/fixtures/001.json" "contracts/fixtures/001-renamed.json"
printf '## fixtures — v2 — 2026-01-01 — X\n- rename vector\n' >"$R/contracts/CONTRACTS-CHANGE.md"
git -C "$R" add -A && git -C "$R" commit -qm change
assert 1 "$(run_guard "$R")" "existing fixture renamed after contracts-v1 → fail"

# --- Scenarios 7f-7l: FREEZE, the aggregate files (ADR-0008).
#
# PR #9 made new vector FILES addable but left the files that DESCRIBE the set
# frozen, so adding a vector was still impossible after the tag — it rewrites
# index.json, MANIFEST.sha256 and the README. These scenarios pin the four
# rules that replaced the blanket one. Every repo below is tagged, because the
# whole freeze branch is dormant until contracts-v1 exists.

# frozen_repo <dir>: a tagged repo holding a one-entry register, a matching
# manifest, and one vector. The register is formatted like the real one so that
# appending an entry is a pure insertion with no deleted line.
frozen_repo() {
  local d="$1"
  new_repo "$d"
  mkdir -p "$d/contracts/fixtures/vectors"
  printf '{"seq":1}\n' >"$d/contracts/fixtures/vectors/001.ndjson"
  cat >"$d/contracts/fixtures/index.json" <<'JSON'
{
  "vectors": [
    {
      "id": "001-first",
      "export": "vectors/001.ndjson",
      "expect": {
        "verdict": "VALID"
      },
      "note": "the first one"
    }
  ]
}
JSON
  remanifest "$d"
  git -C "$d" add -A && git -C "$d" commit -qm fixtures
  git -C "$d" tag -f contracts-v1 >/dev/null 2>&1
  git -C "$d" checkout -q -b work
  printf '## fixtures — v2 — 2026-01-01 — X\n- change\n' >"$d/contracts/CONTRACTS-CHANGE.md"
}

# remanifest <dir>: regenerate the manifest, so each scenario tests one rule.
remanifest() {
  (cd "$1/contracts/fixtures" && find . -type f ! -name 'MANIFEST.sha256' ! -path './README.md' |
    sed 's|^\./||' | sort | xargs sha256sum >MANIFEST.sha256)
}

# append_entry <dir> <id> <verdict>: append an entry, as a pure insertion.
append_entry() {
  awk -v id="$2" -v verdict="$3" '
    /"note": "the first one"/ {
      print
      print "    },"
      print "    {"
      print "      \"id\": \"" id "\","
      print "      \"export\": \"vectors/002.ndjson\","
      print "      \"expect\": {"
      print "        \"verdict\": \"" verdict "\""
      print "      },"
      print "      \"note\": \"appended\""
      next
    }
    { print }
  ' "$1/contracts/fixtures/index.json" >"$1/idx.tmp"
  mv "$1/idx.tmp" "$1/contracts/fixtures/index.json"
}

# 7f: APPENDING a vector — the case #9 left broken. Touches all three aggregates.
R="$TMP/s7f"
frozen_repo "$R"
printf '{"seq":9}\n' >"$R/contracts/fixtures/vectors/002.ndjson"
append_entry "$R" "002-second" "VALID"
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm append
assert 0 "$(run_guard "$R")" "FREEZE: appending a vector (register+manifest+file) → pass"

# 7g: editing an existing verdict — the thing the freeze exists to stop.
R="$TMP/s7g"
frozen_repo "$R"
sed -i 's/"verdict": "VALID"/"verdict": "INVALID"/' "$R/contracts/fixtures/index.json"
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm flip
assert 1 "$(run_guard "$R")" "FREEZE: existing verdict edited in the register → fail"

# 7h: editing an existing NOTE. Frozen too — prose is what a verifier author
# reads and implements from, so corrections must land before the tag.
R="$TMP/s7h"
frozen_repo "$R"
sed -i 's/"note": "the first one"/"note": "reworded"/' "$R/contracts/fixtures/index.json"
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm renote
assert 1 "$(run_guard "$R")" "FREEZE: existing note edited in the register → fail"

# 7i: removing an entry. The vector FILE survives, so rule (d) never fires —
# only the no-deletion rule catches it. Silently un-runs a frozen vector.
R="$TMP/s7i"
frozen_repo "$R"
printf '{\n  "vectors": [\n  ]\n}\n' >"$R/contracts/fixtures/index.json"
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm drop
assert 1 "$(run_guard "$R")" "FREEZE: register entry removed while its vector stays → fail"

# 7j: a pure ADDITION reusing an existing id — two contradictory assertions over
# frozen bytes. It passes the no-deletion rule, so it needs its own check.
R="$TMP/s7j"
frozen_repo "$R"
printf '{"seq":9}\n' >"$R/contracts/fixtures/vectors/002.ndjson"
append_entry "$R" "001-first" "INVALID"
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm dupe
assert 1 "$(run_guard "$R")" "FREEZE: appended entry reusing an existing id → fail"

# 7k: a stale manifest. Rule (c) does not diff the manifest, so its correctness
# is the only thing pinning vector bytes — the guard must run that check itself
# rather than trust a different workflow file that nothing freezes.
R="$TMP/s7k"
frozen_repo "$R"
printf '{"seq":9}\n' >"$R/contracts/fixtures/vectors/002.ndjson" # added, NOT manifested
git -C "$R" add -A && git -C "$R" commit -qm unmanifested
assert 1 "$(run_guard "$R")" "FREEZE: vector added without a manifest entry → fail"

# 7l: deleting the manifest, which would disable 7k's check entirely.
R="$TMP/s7l"
frozen_repo "$R"
git -C "$R" rm -q "contracts/fixtures/MANIFEST.sha256"
git -C "$R" add -A && git -C "$R" commit -qm demanifest
assert 1 "$(run_guard "$R")" "FREEZE: manifest deleted after contracts-v1 → fail"

# --- Scenarios 7m-7o: the duplicate-key exploit against rule (a).
#
# Found by fresh-context review of the rule (a) design. Adding a SECOND key to
# an existing entry is a PURE INSERTION — zero deleted lines — so it passes the
# no-deletion rule and the id grep, while every JSON parser takes the LAST
# value and the frozen verdict silently flips. 7n/7o cover the fields a
# key-by-key fix would have left exploitable.

# dup_key <dir> <after-line-substring> <inserted-json-lines>
dup_key() {
  awk -v marker="$2" -v ins="$3" '
    index($0, marker) && !done { print; printf "%s\n", ins; done = 1; next }
    { print }
  ' "$1/contracts/fixtures/index.json" >"$1/idx.tmp"
  mv "$1/idx.tmp" "$1/contracts/fixtures/index.json"
}

# 7m: a second "expect", flipping VALID -> INVALID by pure insertion.
R="$TMP/s7m"
frozen_repo "$R"
dup_key "$R" '      },' '      "expect": {\n        "verdict": "INVALID"\n      },'
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm dupkey
# Prove the premise: the diff really does delete nothing, so rule (a) is happy.
del="$(git -C "$R" diff --numstat base HEAD -- contracts/fixtures/index.json | awk '{print $2}')"
assert 0 "$del" "FREEZE: the duplicate-key attack really is a pure insertion"
assert 1 "$(run_guard "$R")" "FREEZE: duplicate expect key flipping a verdict → fail"

# 7n: a second "export", repointing a frozen id at another vector's bytes.
R="$TMP/s7n"
frozen_repo "$R"
dup_key "$R" '"export": "vectors/001.ndjson",' '      "export": "vectors/002.ndjson",'
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm dupexport
assert 1 "$(run_guard "$R")" "FREEZE: duplicate export key repointing a vector → fail"

# 7o: a malformed register. json.load failing must fail the guard, not be
# swallowed — otherwise the check disappears exactly when the file is worst.
R="$TMP/s7o"
frozen_repo "$R"
printf '{ "vectors": [ {,, ] }\n' >"$R/contracts/fixtures/index.json"
remanifest "$R"
git -C "$R" add -A && git -C "$R" commit -qm malformed
assert 1 "$(run_guard "$R")" "FREEZE: unparseable index.json → fail"

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

# --- Scenario 8: diff-size fails past the hard ceiling (>1000 changed lines)
R="$TMP/s8"
new_repo "$R"
git -C "$R" checkout -q -b work
# 1100 lines added in a non-exempt file.
seq 1 1100 >"$R/big.txt"
git -C "$R" add -A && git -C "$R" commit -qm big
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 1 "$ds" "diff-size >1000 changed lines → fail"

# --- Scenario 8a: the ceiling really is 1000, not 600. An 800-line diff would
# have failed under the old FAIL=600, so this is the scenario that pins the
# change; Scenario 8's 1100 lines fail under either value and prove nothing
# about it.
R="$TMP/s8a"
new_repo "$R"
git -C "$R" checkout -q -b work
seq 1 800 >"$R/big.txt"
git -C "$R" add -A && git -C "$R" commit -qm big800
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size 800 changed lines → pass (ceiling is 1000, not 600)"

# --- Scenario 8b: and a diff comfortably under the ceiling still passes.
R="$TMP/s8b"
new_repo "$R"
git -C "$R" checkout -q -b work
seq 1 500 >"$R/big.txt"
git -C "$R" add -A && git -C "$R" commit -qm big500
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size 500 changed lines → pass"

# --- Scenario 9: diff-size ignores exempt lockfile churn
R="$TMP/s9"
new_repo "$R"
git -C "$R" checkout -q -b work
seq 1 900 >"$R/pnpm-lock.yaml"
git -C "$R" add -A && git -C "$R" commit -qm lock
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size ignores lockfile churn → pass"

# --- Scenario 10: diff-size ignores markdown churn (specs/docs exempt)
R="$TMP/s10"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/contracts" "$R/docs"
seq 1 600 >"$R/contracts/event-schema.md"
seq 1 600 >"$R/docs/some-adr.md"
git -C "$R" add -A && git -C "$R" commit -qm specs
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size ignores markdown churn (1200 md lines) → pass"

# --- Scenario 11: markdown exemption does not mask non-exempt code churn
R="$TMP/s11"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/contracts" "$R/src"
seq 1 900 >"$R/contracts/spec.md" # exempt
seq 1 1100 >"$R/src/big.ts"       # counted → over the 1000 ceiling
git -C "$R" add -A && git -C "$R" commit -qm mixed
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 1 "$ds" "diff-size still counts code alongside exempt markdown → fail"

# --- Scenario 12: diff-size ignores docs/mockups churn (hand-authored HTML decks)
R="$TMP/s12"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/docs/mockups"
seq 1 1200 >"$R/docs/mockups/deck.html"
git -C "$R" add -A && git -C "$R" commit -qm mockup
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size ignores docs/mockups churn (1200 html lines) → pass"

# --- Scenario 13: mockups exemption does not mask non-exempt code churn
R="$TMP/s13"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/docs/mockups" "$R/src"
seq 1 900 >"$R/docs/mockups/deck.html" # exempt
seq 1 1100 >"$R/src/big.ts"            # counted → over the 1000 ceiling
git -C "$R" add -A && git -C "$R" commit -qm mixed
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 1 "$ds" "diff-size still counts code alongside exempt mockups → fail"

# --- Scenario 14: diff-size ignores pulse churn (charter-exempt product epic)
R="$TMP/s14"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/apps/pulse/src" "$R/apps/pulse-web/src"
seq 1 900 >"$R/apps/pulse/src/big.ts"      # exempt
seq 1 900 >"$R/apps/pulse-web/src/big.ts"  # exempt
git -C "$R" add -A && git -C "$R" commit -qm pulse
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 0 "$ds" "diff-size ignores pulse churn (1800 ts lines) → pass"

# --- Scenario 15: the pulse exemption is dir-scoped, not an apps/ blanket
R="$TMP/s15"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/apps/pulse/src" "$R/services/ledger"
seq 1 900 >"$R/apps/pulse/src/big.ts"       # exempt
seq 1 1100 >"$R/services/ledger/big.ts"     # counted → over the 1000 ceiling
git -C "$R" add -A && git -C "$R" commit -qm mixed
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 1 "$ds" "diff-size still counts services/ alongside exempt pulse → fail"

# --- Scenario 16: a sibling app is NOT exempt; only the two pulse packages are
R="$TMP/s16"
new_repo "$R"
git -C "$R" checkout -q -b work
mkdir -p "$R/apps/other/src"
seq 1 1100 >"$R/apps/other/src/big.ts" # counted → over the ceiling
git -C "$R" add -A && git -C "$R" commit -qm other
ds=$( (cd "$R" && BASE=base HEAD=HEAD bash "$DIFFSIZE" >/dev/null 2>&1)
  echo $?)
assert 1 "$ds" "diff-size counts a non-pulse app under apps/ → fail"

echo
echo "guards.test.sh: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
