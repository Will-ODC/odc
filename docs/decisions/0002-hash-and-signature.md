# ADR-0002: Hash and signature primitives

- **Status:** accepted
- **Date:** 2026-07-21
- **Phase:** 0

## Context

The event log is a transparency log (charter §4): one writer, many verifiers,
per-event hash chaining, with a standalone verifier a stranger can reimplement
"in an afternoon" in a different language (Go) from the ledger's (TypeScript).
Two primitives must be pinned before any event exists, because a mistake is
permanent by the project's own definition: the **digest** that chains events,
and the **signature scheme** that authenticates authorship. Both must be
stdlib-available in TypeScript and Go so `contracts/` stays language-neutral
(ADR-0001). These were pinned as decisions D1 and D2 in
`docs/plans/phase-0.md`; this ADR records them.

## Decision

**Digest (D1):** event hashing uses **SHA-256**, output as **lowercase
hexadecimal** (64 characters). This governs `hash`, `prev_hash`, the
content-addressed identifiers in `ids.md`, and `chain_id`. Lineage: RFC 6962 /
Certificate Transparency, so the planned Merkle-tree upgrade (charter §4) stays
drop-in. Available as `crypto/sha256` (Go) and `node:crypto` (TypeScript).

**Signatures (D2):** authorship uses **Ed25519** (RFC 8032). Public keys are
the 32-byte raw form, carried and referenced as 64 lowercase hex; signatures
are 64 bytes, carried as 128 lowercase hex. Deterministic signing, small keys
and signatures, and stdlib support in both languages (`crypto/ed25519` in Go,
`node:crypto` in TypeScript). Signed event types and their signing keys are
fixed in `event-types.md`; a signature covers the event's signing preimage
(ADR-0003) and is itself covered by the event `hash`.

Hex is always **lowercase**; a mixed- or upper-case digest, key, or signature
is rejected, never normalized (see ADR-0003 / D5).

## Consequences

- `contracts/hashing.md` (T4) spells the byte-exact preimage fed to SHA-256; it
  does not revisit the algorithm choice — that is settled here.
- Both languages can implement every hash and signature check with no
  third-party dependency, keeping the verifier's independence real.
- No floats enter any hashed payload (D4), so the digest input is free of
  cross-language number-formatting hazards (ADR-0003 carries this further).
- Future stronger schemes (e.g. a new key algorithm) enter additively via a
  contracts version bump (`evolution.md`); the derivation `sha256(pubkey_bytes)`
  for identifiers keeps the id space fixed-length across such a change.

## Charter check

- **P1 (log is the only truth; recomputable by anyone):** SHA-256 in lowercase
  hex and Ed25519, both stdlib in two languages, make "anyone can recompute and
  verify" real from the first event — the core promise of the transparency log.
- **P3 (characterize, never weigh):** these are integrity/authenticity
  primitives only; they record who signed what, and weigh nothing.
