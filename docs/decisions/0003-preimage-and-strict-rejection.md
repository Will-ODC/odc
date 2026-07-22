# ADR-0003: Explicit-byte preimage and strict rejection

- **Status:** accepted
- **Date:** 2026-07-21
- **Phase:** 0

## Context

The event `hash` and every signature are computed over some sequence of bytes
derived from an event's fields. _How_ those fields become bytes is the single
most dangerous degree of freedom in the whole project: if two conforming
implementations can serialize "the same event" into different bytes, they
compute different hashes, and the verifier's independence — the entire point of
charter §4 — silently breaks. This ADR records decisions D3, D4, D5, and D7
from `docs/plans/phase-0.md`: the _approach_ to the preimage and to
non-canonical input. The byte-exact layout itself is written in
`contracts/hashing.md` (T4); this ADR fixes the principles that layout must obey.

## Decision

**D3 — Explicit byte-string preimage, not canonical-JSON.** The hash/signing
preimage is an **explicitly specified byte-string construction with a fixed
field order**, spelled out field-by-field in `hashing.md`. It is NOT
"canonicalize the JSON then hash it" (JCS / RFC 8785). Rationale: JCS mandates
ECMAScript number serialization, which is subtle and error-prone to reproduce
correctly in Go; a spelled-out byte layout is trivially implementable and
testable in both languages. The preimage covers the six content fields (`seq`,
`type`, `version`, `payload`, `ts`, `prev_hash`); the signing preimage is the
same construction with the `sig` payload key omitted (`event-schema.md` ES-27,
ES-32).

**D4 — No floats in hashed payloads.** Hashed payload values are **integers and
UTF-8 strings only** — no floats, booleans, `null`, nested objects, or arrays
(`event-schema.md` ES-16/ES-17). This removes the entire cross-language
number-formatting problem at the source rather than legislating around it.

**D5 — Non-canonical input is rejected, never re-canonicalized.** Exactly one
byte representation of an event is valid. A verifier verifies the **stored bytes
as received**; it MUST NOT re-order fields, re-encode numbers, change hex case,
or otherwise "repair" input to make it pass. Semantically-equivalent JSON with
different bytes is INVALID, not silently accepted (`event-schema.md` ES-4).

**D7 — NDJSON framing.** The export is UTF-8 with no BOM, LF line endings only,
one event per line, with a **required final newline** — so every line, including
the last, is constructed identically (`export-format.md`, T4).

## Consequences

- `hashing.md` (T4) is the byte-exact realization of D3/D4; `export-format.md`
  (T4) realizes D7. Both are hard-frozen at `contracts-v1` (contracts-guard).
- Strict rejection (D5) makes the fixture suite's adversarial vectors
  meaningful: reordered keys, wrong hex case, a float in payload, a CRLF line,
  and a missing final newline must each produce a reason-coded INVALID (T5).
- The "reject, don't repair" stance means the verifier is a pure function of the
  stored bytes — no hidden normalization state — which is what lets an
  independent reimplementation agree byte-for-byte.

## Charter check

- **P1 (recomputable by anyone):** an explicit byte layout with no float hazard
  is the concrete mechanism by which a stranger's afternoon-built verifier
  reaches the identical hash — the property P1 promises.
- **P3 (characterize, never weigh):** strict rejection is a syntactic integrity
  rule; it makes no interpretive judgement about an event's meaning.
