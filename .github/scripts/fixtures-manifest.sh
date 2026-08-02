#!/usr/bin/env bash
#
# Verifies contracts/fixtures/ against its SHA-256 manifest (T5).
#
# The golden vectors are byte-exact artifacts consumed by every service's CI and
# by the verifier. Nothing else in the repo would notice if one were corrupted —
# a flipped byte in a tamper vector still looks like a plausible tamper vector.
# This is the detection half of that problem; `contracts/fixtures/** -text` in
# .gitattributes is the prevention half.
#
# Three checks, because each alone leaves a hole:
#   1. every file the manifest lists still hashes to its recorded digest;
#   2. every file present is listed, so a vector cannot be added without
#      appearing in the manifest (and therefore in review);
#   3. every file is a REGULAR file, so bytes cannot be smuggled in by symlink
#      to somewhere the freeze does not reach.
#
# Run locally:  bash .github/scripts/fixtures-manifest.sh
set -euo pipefail

dir="contracts/fixtures"
manifest="$dir/MANIFEST.sha256"

if [[ ! -d "$dir" ]]; then
  echo "No $dir yet; nothing to verify."
  exit 0
fi

if [[ ! -f "$manifest" ]]; then
  echo "::error::$dir exists but $manifest is missing. Regenerate with: pnpm --filter @odc/fixtures-gen generate"
  exit 1
fi

echo "Verifying recorded digests..."
(cd "$dir" && sha256sum -c --quiet MANIFEST.sha256)

# Reject anything that is not a regular file BEFORE listing. `find -type f`
# skips symlinks, so a vector committed as a symlink would never appear in the
# present-file list, never be digested, and never be pinned — its bytes would
# live outside contracts/ and stay mutable after the freeze. It also passes the
# guard's add-only rule, since a new symlink is still status A.
echo "Checking for non-regular files..."
irregular="$(find "$dir" ! -type d ! -type f)"
if [[ -n "$irregular" ]]; then
  echo "::error::$dir contains non-regular file(s); every fixture must be a real file whose bytes are digested here:"
  printf '  %s\n' $irregular
  exit 1
fi

echo "Checking for unlisted files..."
listed="$(mktemp)"
present="$(mktemp)"
trap 'rm -f "$listed" "$present"' EXIT

# Only the top-level README.md is excluded: it documents the record format and is
# prose governed by review, not a byte-exact artifact (the same stance diff-size
# takes on *.md). The exclusion is by exact PATH, not by extension — a bare
# `! -name '*.md'` would exempt any .md at any depth, so dropping
# vectors/009-sneaky.md would slip past the unlisted-file check this half exists
# to enforce.
awk '{ $1=""; sub(/^  */, ""); print }' "$manifest" | sort >"$listed"
(cd "$dir" && find . -type f ! -name 'MANIFEST.sha256' ! -path './README.md' |
  sed 's|^\./||' | sort) >"$present"

if ! diff -u "$listed" "$present"; then
  echo "::error::$dir contents do not match $manifest (see diff above: < listed, > present). Regenerate with: pnpm --filter @odc/fixtures-gen generate"
  exit 1
fi

echo "fixtures-manifest OK ($(wc -l <"$present" | tr -d ' ') files)."
