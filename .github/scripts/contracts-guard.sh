#!/usr/bin/env bash
#
# contracts-guard (T2). Enforces the contracts/ change discipline on every PR
# that touches contracts/** (odc-service-boundaries, odc-contracts):
#
#   1. Freeze:   once the contracts-v1 tag exists, hashing.md is immutable and
#                no existing golden value may change. ADDING stays legal, and
#                the four kinds of file under fixtures/ get four rules — see
#                the note at the check, and ADR-0008.
#   2. Version:  any touched spec file must add/bump a `Version:` line.
#   3. Changelog: every contracts/ change must add a CONTRACTS-CHANGE.md entry.
#
# A "spec file" is contracts/*.md EXCEPT README.md and CONTRACTS-CHANGE.md.
#
# Run locally:  BASE=origin/master HEAD=HEAD bash .github/scripts/contracts-guard.sh
set -euo pipefail

# Resolve sibling scripts relative to THIS file, never the cwd: the guard is
# invoked from a repo root that may not be this repo (guards.test.sh replays
# scenarios in throwaway repos), and a cwd-relative path silently SKIPS the
# manifest check there instead of failing.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# 1. Freeze guard — after contracts-v1, hashing.md is immutable and no existing
# golden value may change. ADDING stays legal: evolution.md EV-5/EV-14 require
# every additive change to ship its own golden fixtures, so a blanket "nothing
# under contracts/fixtures/ may appear in the diff" rule would mean no
# post-freeze event type could ever ship.
#
# PR #9 made new *vector files* addable and stopped there. That was incomplete:
# adding one vector also rewrites the two AGGREGATE files that describe the set
# (index.json, MANIFEST.sha256) and the README that counts it, all of which are
# modifications. The deadlock therefore survived #9 one layer up, invisible
# because this whole branch is gated on a tag that does not exist yet. ADR-0008
# records the resolution: the four kinds of file in here get four rules, because
# only one of them holds golden values.
#
# --no-renames makes a rename surface as D + A rather than R, so the delete half
# is caught while a genuinely new file passes.
if git rev-parse -q --verify "refs/tags/contracts-v1" >/dev/null 2>&1; then
  while IFS=$'\t' read -r status path; do
    [[ -n "${path:-}" ]] || continue
    case "$path" in
    contracts/hashing.md)
      err "FROZEN: $path cannot change after the contracts-v1 tag. Hashing rules are permanent (odc-contracts)."
      ;;

    # (a) The register. Holds every vector's declared verdict — the entire
    # conformance assertion (evolution.md EV-17) — so it is as golden as the
    # vectors themselves, but it MUST be able to grow. Rule: the diff may add
    # lines and MUST NOT delete any. Editing a verdict, a `head`, an `export`
    # path or a note all rewrite a line, which is a delete plus an add, and are
    # blocked; appending an entry is a pure insertion and passes.
    #
    # Deliberately a line rule, not a JSON comparison: this check is the only
    # thing holding the freeze up, and a parser with a subtle bug would let the
    # freeze fail open with CI still green. Note prose is frozen too — corrections
    # must land before the tag (ADR-0008).
    #
    # It relies on index.json staying an append-formatted array, which .prettierignore
    # guarantees by keeping every formatter out of contracts/.
    contracts/fixtures/index.json)
      if [[ "$status" != "A" ]]; then
        deleted="$(git diff --numstat "$BASE...$HEAD" -- "$path" | awk '{print $2}')"
        if [[ "${deleted:-0}" != "0" ]]; then
          err "FROZEN: $path may only GAIN entries after the contracts-v1 tag; this diff deletes ${deleted} line(s). Changing an existing vector's verdict, head, export path or note is exactly what the freeze forbids (evolution.md EV-17, ADR-0008) — append a new vector instead (EV-5)."
        fi
      fi
      ;;

    # (b) Prose. Documents the record format and states the vector count, so it
    # necessarily changes whenever the set grows. Governed by review, the
    # Version-bump check below (which matches it — a bash `case` glob crosses
    # `/`) and the changelog check, not by byte-freezing.
    contracts/fixtures/README.md) ;;

    # (c) Derived integrity data. Not diff-policed at all: it is regenerated
    # output, and its digest of index.json MUST change whenever the register
    # grows, so an add-only rule is unsatisfiable here by construction. Its
    # CORRECTNESS is enforced instead, by fixtures-manifest.sh below — combined
    # with (d), every existing vector's digest is pinned transitively, because
    # the bytes it digests cannot change.
    contracts/fixtures/MANIFEST.sha256)
      # Modification is the normal case; DELETION is not. Losing the manifest
      # would silently disable the correctness check this rule leans on.
      if [[ "$status" != "A" && "$status" != "M" ]]; then
        err "FROZEN: $path may be regenerated but not deleted or renamed after the contracts-v1 tag; it is what pins every vector's bytes (ADR-0008)."
      fi
      ;;

    # (d) The golden values themselves. Add only — unchanged, and the real freeze.
    contracts/fixtures/*)
      if [[ "$status" != "A" ]]; then
        err "FROZEN: $path cannot be modified, deleted, or renamed after the contracts-v1 tag. Golden values never regenerate (odc-testing) — ship a NEW fixture alongside it instead (evolution.md EV-5)."
      fi
      ;;
    esac
  done < <(git diff --name-status --no-renames "$BASE...$HEAD" -- 'contracts/')

  # A no-deletion rule permits a pure addition that REUSES an existing id — two
  # entries, same id, contradictory verdicts over frozen bytes. Checked by
  # scanning id lines rather than parsing, keeping (a)'s no-parser property.
  if [[ -f contracts/fixtures/index.json ]]; then
    dupes="$(grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' contracts/fixtures/index.json |
      sort | uniq -d || true)"
    if [[ -n "$dupes" ]]; then
      err "Duplicate vector id(s) in contracts/fixtures/index.json: ${dupes//$'\n'/ }. An id names one frozen assertion and cannot be reused."
    fi
  fi

  # Rule (c) is only sound while this actually runs on the same HEAD. It lives in
  # a different workflow (repo.yml) that nothing freezes, so invoke it here too:
  # the freeze guarantee then lives in one script and fails closed.
  # Guarded on the manifest existing so this stays a no-op for a tree that has
  # no fixtures yet; the case above makes sure it cannot go missing later.
  if [[ -f "$HERE/fixtures-manifest.sh" && -f contracts/fixtures/MANIFEST.sha256 ]]; then
    if ! bash "$HERE/fixtures-manifest.sh"; then
      err "contracts/fixtures/ does not match its manifest. After the freeze the manifest is the only thing pinning vector bytes (ADR-0008)."
    fi
  fi
fi

# 1b. Structural integrity of the register — ALWAYS, not only after the tag.
#
# Rule (a) above is a line rule: it blocks any diff that deletes a line. A
# fresh-context review found that insufficient, with a working exploit. Adding a
# SECOND "expect" key to an existing entry, immediately after the first, is a
# pure insertion — zero deleted lines — so it passes rule (a), passes the id
# grep (the "id" line is untouched) and passes the manifest. But every JSON
# parser resolves a duplicate key to the LAST value, so the vector's verdict
# silently flips. `tools/fixtures-gen` itself parses this file, so those are the
# live semantics, not a theoretical ambiguity.
#
# So: no object anywhere in index.json may repeat a key. Note what this is and
# is not. It is a well-formedness assertion over ONE file, total and cheap to
# get right. It is NOT the semantic before/after comparator ADR-0008 rejected —
# that one had to decide which changes were legitimate, and would have failed
# open when it got that wrong. This one has no notion of "changed" at all.
#
# Ungated on the tag on purpose: a duplicate key is a defect whenever it
# appears, the generator can never legitimately emit one, and running it now
# means the check is exercised on the real file long before it has to hold.
# No `command -v python3` guard: a missing interpreter makes the invocation
# itself exit non-zero, which lands in the same error branch. An explicit
# "is python3 installed" arm would be unfalsifiable — no test in an environment
# that HAS python3 can make it fire, and an untestable branch guarding a
# permanent freeze is worth less than no branch at all.
if [[ -f contracts/fixtures/index.json ]]; then
  if ! python3 - contracts/fixtures/index.json <<'PYEOF'; then
import json, sys

def no_dupes(pairs):
    seen = set()
    for k, _ in pairs:
        if k in seen:
            raise ValueError(f"duplicate key {k!r} in one object")
        seen.add(k)
    return dict(pairs)

try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        json.load(fh, object_pairs_hook=no_dupes)
except Exception as exc:  # noqa: BLE001 — any failure here must fail the guard
    print(f"{exc}", file=sys.stderr)
    sys.exit(1)
PYEOF
    err "contracts/fixtures/index.json is not well-formed, an object in it repeats a key, or python3 is unavailable. A repeated key is resolved to its LAST value by every parser, so it silently rewrites a frozen verdict while adding only lines (ADR-0008)."
  fi
fi

# 2. Version bump — checked PER spec file: each touched spec must add a Version
# line in ITS OWN diff, so one spec's bump can't cover another's silent edit.
# The Version match is intentionally lenient (any added `Version:` line in the
# file's diff, header or not) — it's a tripwire for "you forgot to bump", not a
# strict header parser.
for f in "${changed[@]}"; do
  case "$f" in
  contracts/README.md | contracts/CONTRACTS-CHANGE.md) continue ;;
  contracts/*.md) : ;; # a spec file — check it below
  *) continue ;;        # non-spec (e.g. fixtures/) — no version line to bump
  esac
  added_version="$(git diff "$BASE...$HEAD" -- "$f" \
    | grep -E '^\+' | grep -Ei '^\+[[:space:]]*\*{0,2}version:\*{0,2}[[:space:]]*v?[0-9]+' || true)"
  if [[ -z "$added_version" ]]; then
    err "Spec $f has no added 'Version:' line. Bump its version — contracts/ is version-bumped, never edited in place (odc-service-boundaries)."
  fi
done

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
