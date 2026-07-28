# contracts/fixtures/ — golden vectors

**Version:** 5
**Status:** DRAFTING (Phase 0 · T5). Not frozen.

**73 vectors** — 9 `VALID`, 4 `PARTIAL`, 60 `INVALID`. They are numbered in
category order: `VALID` (`001`–`007`), `PARTIAL` (`008`–`011`), then `INVALID` —
the envelope and Stage A checks (`012`–`042`), the export framing and canonical
line form (`043`–`052`), `--head` (`053`–`054`), the Stage B type semantics
(`055`–`068`), and verdict precedence (`069`–`070`). `071`–`073` are appended
after that scheme rather than inserted into it, because **ids never change once
shipped**: renumbering to keep the categories contiguous would silently
invalidate a conformance run that cites them. They cover scalar values above
U+FFFF — `071` that a title above the BMP is stored as literal UTF-8, `072`/`073`
that `event-types.md` ET-14 counts **scalar values**, not UTF-16 code units and
not bytes.

Conformance test data for every implementation that touches events: the Go
verifier (T7), and later every service's CI. This file documents the record
format. It lives inside `fixtures/` on purpose — T7 runs in a context permitted
to read `contracts/` and nothing else, so anything T7 needs must be here.

> **Once `contracts-v1` is tagged, these files are frozen** (`contracts-guard`).
> Existing vectors may not be modified, deleted, or renamed; new ones may be
> added alongside. A wrong vector after the freeze is permanent, so hand-review
> against the cited spec sentences is the gate — not the fact that the generator
> produced it.

## Layout

```
index.json                        every vector, in order — start here
vectors/<id>.ndjson               the input bytes of one vector
preimages/001-genesis-only.hex    the 607-octet hash preimage of vector 001
preimages/002-four-types-seq3.hex the hash preimage of line 3 of vector 002
derivations.json                  participant_id / chain_id / keypair anchors
MANIFEST.sha256                   sha256 of every file above (sha256sum -c)
```

Both `preimages/*.hex` files are the exact octets fed to SHA-256 for one event,
so an implementer can diff their own construction against a golden one before
they ever reach a digest. They are a matched pair: `001`'s payload is four
strings, so it shows only the `0x73` tag, while `002`'s line 3 has an integer
`choice_count` sorting ahead of `sig` and `title` — the `0x69` tag, an `ENC_INT`
payload value, and the `0x69`/`0x73` adjacency (`hashing.md` HA-4, HA-7, HA-9).
With `001` alone, a swapped tag constant or a wrong integer width shows up only
as a digest mismatch, with nothing to compare.

## What a vector is

One entry of `index.json`:

```json
{
  "id": "037-hash-mismatch",
  "export": "vectors/037-hash-mismatch.ndjson",
  "expect": { "verdict": "INVALID", "line": 2 },
  "cites": ["ES-28", "HA-14"],
  "note": "Tamper matrix: a byte flipped in the stored hash…"
}
```

- **`export`** — the file to feed the verifier, read as **raw bytes**. Several
  vectors are deliberately not valid UTF-8-clean NDJSON (a BOM, a `CR`, a missing
  final `LF`, a zero-length file); reading them as text will destroy what they
  test.
- **`head`** — present only when the vector MUST be run with `--head <value>`.
  Absent means run without `--head`.

  **This distinction is load-bearing, and two sets of vectors are byte-identical
  on purpose because of it.** A runner that keys vectors by content hash, or that
  ignores the `head` field, will silently collapse them and report success while
  testing nothing:

  | Same bytes | `head` | Verdict | What only this combination shows |
  | --- | --- | --- | --- |
  | `002` | absent | `VALID` | the four v1 types link, sign and hash |
  | `003` | true head | `VALID` | a matching `--head` accepts (EX-15) |
  | `054` | wrong head | `INVALID` line 4 | a `--head` naming another chain rejects |
  | `004` | absent | `VALID` | a prefix of a valid chain IS a valid chain |
  | `053` | true head | `INVALID` line 2 | end-truncation, detectable ONLY here |

  The `004`/`053` pair is the sharper of the two: `export-format.md` EX-16 makes
  end-truncation undetectable from the export alone, so those identical bytes are
  the *only* thing pinning the rule. Running either vector without its `head`
  field, or both with it, tests nothing.
- **`expect`** — the verdict, and nothing else. See below.
- **`cites`** and **`note`** — **advisory**. For the human reviewing the vector.

## What conformance means (`evolution.md` EV-17)

**A vector asserts the verdict token and the line number(s) only.** Nothing else
in this directory is conformance-bearing.

| `expect.verdict` | additional field           |
| ---------------- | -------------------------- |
| `VALID`          | none                       |
| `INVALID`        | `line` (1-based)           |
| `PARTIAL`        | `lines` (1-based, ascending) |

An implementation is conforming when, for every vector, it reports that verdict
and that line. It is **not** required to produce any particular reason text, and
it is **not** required to exit with any particular status — `cites` names the
sentence a vector was written against, but a verifier that fails a line for a
different sentence on the same line still conforms. That is deliberate: one
tampered line usually violates several sentences at once, so pinning reason codes
would silently freeze a total precedence order over every check. There is **no
reason-code registry** and none will be defined for v1.

Line attribution for failures with no offending event — an empty export, a
`--head` mismatch, a framing violation — is fixed by `export-format.md`
EX-18–EX-20.

## Verifying the bytes

```sh
cd contracts/fixtures && sha256sum -c MANIFEST.sha256
```

CI runs this plus an unlisted-file check (`.github/scripts/fixtures-manifest.sh`),
and `.gitattributes` sets `contracts/fixtures/** -text` so git never rewrites a
line ending in here.

## Where these values come from

Generated by `tools/fixtures-gen` (TypeScript). **The generator does not decide
verdicts** — every expected verdict is asserted by the vector's author from the
spec text. A generator that ran a verifier to compute its own expectations would
be marking its own homework, and T7 would then be checked against this tool's
reading of the spec rather than against the spec.

The one value in here that does **not** come from the generator is vector
**`001-genesis-only`**: it reproduces the worked example of `hashing.md` §6,
which was derived by hand before this code existed. It is the calibration point.
If the generator and vector 001 ever disagree, the generator is wrong.

Independent reproduction is what actually validates these bytes — T7 builds a Go
verifier from the specs alone, and T8 compares the two languages' digests. Until
then, treat the non-001 values as "self-consistent", not "known correct".

`derivations.json` also pins the keypairs: the operator and registrar keys come
from 32-octet Ed25519 seeds of one repeated byte (`0x01…01` and `0x02…02`, per
`hashing.md` §6), so every signature in every vector is reproducible from the
seed alone.

## Regenerating

```sh
pnpm --filter @odc/fixtures-gen build && pnpm --filter @odc/fixtures-gen generate
```

**Never regenerate a golden value to make a failing test pass** (`odc-testing`).
A mismatch means the code is wrong or the contract changed illegally. Before the
freeze, a spec change may legitimately require regeneration — that is a
deliberate act, reviewed as a spec change, recorded in `CONTRACTS-CHANGE.md`.
