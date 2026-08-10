# ADR-0009: Pin the Ed25519 verification predicate by canonical encoding

- **Status:** accepted; **superseded in part by ADR-0010**
- **Date:** 2026-08-08
- **Phase:** 0

> **Superseded in part by ADR-0010 (2026-08-08).** The canonical-encoding
> decision of this ADR (ET-4a/ET-4b) **stands** unchanged. Only the
> **prime-order exclusion** below — the "Why prime-order is excluded" section and
> the matching lines in Decision/Consequences — is **reversed**: a later
> measurement resolved both blockers it cited (the two audited libraries agree on
> the prime-order predicate, and a subgroup check is allowed one audited curve
> library), so a full prime-order subgroup check is **now required** as ET-4c. The
> rest of this document is left intact as the record of what was decided when.

## Context

ODC signs and verifies with Ed25519 (ADR-0002). RFC 8032 does **not** define a
single verification predicate: it leaves several cases underdetermined, and
conforming libraries legitimately differ on identical bytes. The open ones that
matter here are

- non-canonically encoded signature scalar `S` (`S ≥ L`),
- non-canonically encoded signature point `R` (encoded `y ≥ p`),
- non-canonically encoded verification key `A` (encoded `y ≥ p`),
- small-order / non-prime-order verification keys and points, and
- cofactored (permissive, `[8][S]B = [8]R + [8][k]A`) vs cofactorless
  (`[S]B = R + [k]A`) verification.

Nothing in `contracts/` pinned ours. The v1 architecture deliberately ships
**two** independent verifiers — the Go verifier (T7) and a second TypeScript
verifier (T7b) — precisely so a divergence in reading the contract surfaces as a
disagreement rather than as a silent per-library default. On this question that
architecture is a liability unless the contract pins the predicate: each verifier
would otherwise inherit its standard library's behavior, and Go `crypto/ed25519`
and Node `node:crypto` can disagree, both conformant. Both verifiers are
constrained to their language's **standard library only** (no third-party curve
code), which bounds what the contract can require of them.

The prior direction (`memory/OPEN-QUESTIONS.md`) was explicit: **measure, do not
reason from memory**, and prefer making the divergence **unreachable** (a format
check, like ET-14a capping `choice_count`) over adjudicating a predicate.

## Decision

**Pin the predicate at the encoding level. Reject non-canonical encodings of the
signature and the verification key on the raw decoded bytes, before the Ed25519
verification primitive is called, rejected and never reduced or repaired (D5).**
Three MUST checks, added to `event-types.md` as **ET-4a** (signature) and
**ET-4b** (verification key), with `L = 2^252 + 27742317777372353535851937790883648493`
and `p = 2^255 − 19`:

1. **Canonical `S`:** the signature's trailing 32 bytes, little-endian, MUST be `< L`.
2. **Canonical `R`:** the signature's leading 32 bytes, bit 255 (the x-sign bit,
   high bit of byte 31) masked off, little-endian, MUST be `< p`.
3. **Canonical `A`:** the 32 decoded key bytes, bit 255 masked off, little-endian,
   MUST be `< p` — for **every** verification key: `operator_pk` and
   `registrar_pk` (ET-8/ET-13/ET-17) and `participant_registered.pubkey` (ET-10).

These are additional to the existing hex-format rules (ES-31 for `sig`,
ET-9b/ID-3 for keys): a canonical 64/128-hex string can still decode to a
non-canonical point/scalar encoding, so hex-format is necessary but not
sufficient.

**Informative, not a new MUST:** the verification predicate v1 assumes is
**cofactorless** (`[S]B = R + [k]A`), which both reference standard libraries —
Go `crypto/ed25519` 1.24.7 and Node `node:crypto` v22 / OpenSSL 3 — satisfy.

**A full prime-order subgroup check on keys (`[L]A = 𝒪 ∧ [8]A ≠ 𝒪`) is
deliberately NOT required in v1.**

### Measurement

Per the "measure, do not reason from memory" direction, both libraries were run
in the session container (Go 1.24.7, Node 22.22.2 / OpenSSL 3) against all 15
authoritative ed25519-speccheck vectors plus constructed cases (`S + L`,
non-canonical `R`, non-canonical `A`, small-order `A`, small-order `R`, and the
cofactor discriminator). Findings:

- The two libraries returned the **identical accept/reject verdict on every
  input across all six edge classes.** There is no reachable divergence on these
  versions.
- Both are **cofactorless**.
- Both are **lenient only on a non-canonical `A` encoding**: they accept the
  non-canonical key at decode and proceed to verify. With the identity point
  encoded as `y = 1 + p` and a degenerate self-signature (`R` = canonical
  identity, `S = 0`), the cofactorless equation collapses to `𝒪 = 𝒪` for any
  message, so **both libraries accept** it. This is the single case where the
  canonical-`A` check changes a verdict today.
- Both already **reject** `S ≥ L` and a non-canonical `R` inside the primitive,
  so the canonical-`S` and canonical-`R` checks are non-discriminating on current
  versions — they pin the agreed verdict and guard against future drift.

### Why prime-order is excluded

A full prime-order check **(a)** closes no measured divergence — the two
libraries never disagree on current versions, including on small-order and
cofactor cases — and **(b)** requires curve scalar multiplication that is **not**
in either language's standard library, conflicting with T7/T7b's stdlib-only
constraint. The canonical-encoding checks 1–3 are, by contrast, cheap standard
integer comparisons and are worth doing as defense-in-depth: RFC 8032 is
underdetermined and the wider ecosystem does split on these inputs, even though
these two libraries currently do not. A prime-order check stays additively
addable before the freeze if the operator later decides the residual risk
warrants the non-stdlib dependency. The result is **version-bound**; the T10
re-audit must re-measure.

## Consequences

- `event-types.md` v4 → v5: ET-4a, ET-4b, and the informative cofactorless /
  no-prime-order note, between ET-4 and ET-5; rule-index and acid-test updated.
- Three golden fixtures under EV-5 (`078`–`080`), each isolating one rule
  (`INVALID` at line 2). `078-noncanonical-a` is **discriminating** — a verifier
  that omits ET-4b accepts it, because the degenerate self-signature verifies in
  both libraries — while `079-noncanonical-s` and `080-noncanonical-r` are
  non-discriminating today and pin the verdict against drift. Isolation was
  confirmed by feeding each committed vector's line-2 signing preimage through
  both Go and Node and by a from-spec reimplementation of the three checks in
  `tools/fixtures-gen/test/canonical-ed25519.test.ts`.
- T7 and T7b MUST implement ET-4a/ET-4b as pre-verification byte checks. Because
  they are integer comparisons, both can do so with the standard library alone.
- **T10 re-audit obligation:** re-measure Go and Node behavior; the exclusion of
  the prime-order check and the cofactorless assumption are correct for the
  measured versions only.
- No `hashing.md` change: HA-16 still governs what `sig` covers; ET-4a/ET-4b
  govern how the decoded `sig`/key bytes must be encoded before verification.
- Landing pre-freeze is required: `evolution.md` EV-1 forbids altering a frozen
  `(type, version)` schema, so ET-4a/ET-4b (which bind `genesis`, `participant_registered`,
  `issue_created`, and `vote_cast` v1) are unaddable after the `contracts-v1` tag.

### Documents reconciled

Every document outside `contracts/` that stated the thing this ADR changes, and
its disposition in this PR:

- `memory/OPEN-QUESTIONS.md` — carried the live ⚠️ entry "Ed25519 verification is
  NOT one predicate, and nothing pins ours." **Converted in this PR** to a DECIDED
  stub pointing at ADR-0009 and ET-4a/ET-4b.
- `memory/STATE.md` — its "Next #1" names the Ed25519 predicate as the pre-T7
  gate. **Deliberately not edited here:** per the context protocol, `STATE.md` is
  updated on master at merge time on its own follow-up PR, so feature branches do
  not conflict.
- No other document outside `contracts/` stated the predicate: the T7/T7b tickets
  in `docs/plans/phase-0.md` and `.claude/agents/*` describe verifier scope and
  isolation but not the Ed25519 edge-case behavior, and need no change.

## Charter check

- **P1 (an append-only public record everyone can verify):** strengthened. A
  pinned, byte-level predicate is what lets two independent verifiers reach the
  same verdict on every input; without it "everyone can verify" quietly means
  "each library decides." No rule, format, or logic is concealed (charter §9) —
  the checks are integer comparisons stated in the open.
- **P2 (one verified human, one voice):** untouched. This is a signature-encoding
  rule; eligibility and uniqueness remain registrar policy (ET-20).
- **P3 (the platform characterizes, never weighs):** untouched. No interpretation
  of ballots is added.
- **P4 (equal access):** neutral. The rule rejects malformed cryptographic
  material identically for all keys and all event types.
