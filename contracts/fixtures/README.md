# contracts/fixtures/ — golden vectors

**Version:** 12
**Status:** DRAFTING (Phase 0 · T5, T5j, ADR-0009, ADR-0010, ADR-0011). Not
frozen.

**98 vectors** — 15 `VALID`, 4 `PARTIAL`, 79 `INVALID`. They are numbered in
category order: `VALID` (`001`–`007`), `PARTIAL` (`008`–`011`), then `INVALID` —
the envelope and Stage A checks (`012`–`042`), the export framing and canonical
line form (`043`–`052`), `--head` (`053`–`054`), the Stage B type semantics
(`055`–`068`), and verdict precedence (`069`–`070`). `071`–`098` are appended
after that scheme rather than inserted into it, because **ids never change once
shipped**: renumbering to keep the categories contiguous would silently
invalidate a conformance run that cites them.

`071`–`073` cover scalar values above U+FFFF — `071` that a title above the BMP
is stored as literal UTF-8, `072`/`073` that `event-types.md` ET-14 counts
**scalar values**, not UTF-16 code units and not bytes. `074`/`075` pin ET-14's
control-character clause at both edges: `074` that **U+007F is forbidden**
(named by ET-14 separately from the C0 block, so an implementation testing
`c < 0x20` alone misses it), and `075` that the **C1 block U+0080–U+009F is
legal** (so an implementation reaching for Go's `unicode.IsControl`, true across
U+007F–U+009F, over-rejects a conforming title). Both characters are stored as
their literal UTF-8 octets: EX-9 escapes only U+0000–U+001F.

`076`/`077` pin `event-types.md` ET-9b — the genesis key format. Each is a
`genesis` whose `operator_pk` (`076`) or `registrar_pk` (`077`) is **uppercase
hex**, `INVALID` at line 1. The uppercase key decodes to the same 32 bytes, so
`chain_id` still derives (ET-7), the self-signature still verifies (ET-8) and the
`hash` still matches — **only the case is wrong**, the same isolation `033` and
`036` have for `prev_hash`/`hash`. Before these, no vector asserted `INVALID` on a
malformed genesis key, so a verifier omitting the format check passed every vector
with no signal. Two vectors, not one, because `registrar_pk` — unused until a
ballot arrives — is the key an implementation is likelier to skip.

`078`–`080` pin `event-types.md` ET-4a/ET-4b — the Ed25519 canonical-encoding
predicate (ADR-0009). Each is a chain whose line-2 `participant_registered` is
`INVALID` for exactly one canonical-encoding rule, hash and chain link
otherwise intact. **`078-noncanonical-a` is the discriminating one:** its
`pubkey` is the non-canonical identity-point encoding `y = 1 + p`
(`ee ff…ff 7f`, still 64 lowercase hex, so ES-31/ID-3 hex-format passes) and its
`sig` is the degenerate identity self-signature `R = 0100…00`, `S = 0`. Measured
in **both** Go 1.24.7 and Node 22 / OpenSSL 3, the non-canonical key is accepted
by the decoder and the degenerate signature **verifies** under it, so ET-10
passes and only the new canonical-A check (ET-4b) rejects it — a verifier lacking
that check wrongly reports `VALID`. `079-noncanonical-s` (`S` replaced by
`S + L`) and `080-noncanonical-r` (`R` replaced by a non-canonical encoding),
both with the `hash` **recomputed over the mutated `sig`** to isolate the
encoding fault, are **non-discriminating** on current libraries: both Go and Node
already reject `S ≥ L` and a non-canonical `R` inside the primitive, so a verifier
lacking the explicit ET-4a check still returns `INVALID`. They pin the agreed
verdict and guard against future library drift; only `078` catches a missing
check today.

`081`–`082` pin `event-types.md` ET-4c — the prime-order subgroup requirement
(ADR-0010, which reverses ADR-0009's prime-order exclusion). Each is a chain whose
line-2 `participant_registered` carries a **canonically-encoded** key (so
ET-4a/ET-4b and ID-3 all pass) that is **not** in the prime-order subgroup, with a
self-signature that **verifies** in both Go 1.24.7 and Node 22 / OpenSSL 3 (so
ET-10 passes) — leaving ET-4c as the sole fault. Both are **discriminating**: a
verifier omitting ET-4c wrongly reports `VALID`. **`081-smallorder-key`** is the
canonical identity key `0100…00` (a small-order key, order 1) with the degenerate
identity self-sig `R = 0100…00`, `S = 0`; it is the case where `@noble/curves`'
`isTorsionFree()` returns **true**, so it pins the load-bearing `A != 𝒪` clause —
a subgroup check written as `isTorsionFree()` alone wrongly accepts it.
**`082-mixedorder-key`** is a canonically-encoded **mixed-order** key `A = P + T`
(`T` an order-8 torsion point), self-signed honestly under `P` with the challenge
ground to `k ≡ 0 (mod 8)` so `[k]T = 𝒪` and the signature verifies under `A`;
because `A` is neither prime-order **nor** small-order, `082` distinguishes a full
prime-order check from a small-order-blocklist-only verifier, which `081` cannot.
ET-4c is exact curve arithmetic (not RFC-8032-underdetermined), so a verifier may
use one audited curve library for it alone (`filippo.io/edwards25519` for Go,
`@noble/curves` for TS; ADR-0010).

`083` pins `event-types.md` ET-9c — **when** the ET-4b/ET-4c checks apply to
`registrar_pk` (ADR-0011). It reuses `081`'s small-order identity key, but on
`registrar_pk` at **genesis** rather than a participant `pubkey` at line 2. This
is the one key where declaration and first use differ: genesis is
operator-self-signed (ET-8), so `registrar_pk` is declared here but not used to
verify until the first `vote_cast` (ET-17), and `083` carries **no** `vote_cast`.
The genesis is well-formed in every other respect (operator self-sig verifies,
`chain_id` derives, the hash matches), so a verifier that defers the `registrar_pk`
checks to first use reports `VALID`, while ET-9c requires them at the declaration
line — **`INVALID` at line 1**. `078`–`082` cannot pin this: all place the bad key
on a self-signed `participant_registered`, where declaration and use coincide. This
was the single point two independent verifiers could otherwise diverge (found by
the T7 review); `083` forces both to agree by `contracts/`.

Conformance test data for every implementation that touches events: the Go
verifier (T7), and later every service's CI. This file documents the record
format. It lives inside `fixtures/` on purpose — T7 runs in a context permitted
to read `contracts/` and nothing else, so anything T7 needs must be here.

> **Once `contracts-v1` is tagged, these files are frozen** (`contracts-guard`),
> under four rules — one per kind of file, because only some of them hold golden
> values (ADR-0008):
>
> - `vectors/`, `preimages/`, `derivations.json` — **additions only.**
> - `index.json` — **may gain entries, may never lose a line.** Appending is a
>   pure insertion and passes; editing any existing `expect`, `head`, `export`
>   **or `note`** rewrites a line and fails. Ids must stay unique, and no object
>   may repeat a key — a second `"expect"` added after the first is a pure
>   insertion that every parser resolves to the LAST value. Note prose is frozen
>   too, so **corrections must land before the tag.**
> - `MANIFEST.sha256` — regenerable, not deletable; its correctness is checked
>   on every PR instead of its diff.
> - this README — exempt; it is prose that states a count.
>
> A wrong vector after the freeze is permanent, and the freeze does not make a
> new vector correct — only review does. Hand-review against the cited spec
> sentences is the gate, not the fact that the generator produced it.

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
