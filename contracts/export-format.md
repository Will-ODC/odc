# Export Format — contracts/export-format.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T4). Not frozen.
**Companion specs:** `event-schema.md` (envelope), `hashing.md` (preimage +
`hash`), `read-api.md` (the online read interface), `evolution.md` (versioning).

Fixes how a whole chain is serialized to a file so that every participant
downloads, stores, and verifies **identical bytes**. The export is the portable
form of the log — the thing a stranger feeds to an independent verifier
(charter §4). Per ADR-0003 D5 an event has **exactly one** valid byte
representation; this spec pins it, so two conforming producers emit the
byte-identical export of a chain and any variation is rejected, not repaired.

Every normative sentence is numbered `EX-n`. RFC-2119 keywords are normative.

---

## 1. Framing (NDJSON)

- **EX-1.** An export is **newline-delimited JSON (NDJSON)**: a sequence of
  zero or more lines, each line the canonical serialization (§2) of exactly one
  event (`event-schema.md`), in ascending `seq` order.
- **EX-2.** The file MUST be **UTF-8** with **no** byte-order mark.
- **EX-3.** Lines are separated and terminated by a single line feed `0x0A`
  (`LF`). Carriage returns (`0x0D`) MUST NOT appear. A `CRLF` line ending makes
  the file non-conforming and MUST be rejected (D5).
- **EX-4.** A **final `LF` is required**: every line, including the last, is
  followed by exactly one `LF`. There is therefore no special-case last line,
  and a non-empty export always ends in `0x0A`.
- **EX-5.** There MUST be no blank lines, no leading or trailing spaces or tabs
  on any line, and no bytes between a line's terminating `LF` and the start of
  the next line. A verifier MUST reject an export containing an empty line.
- **EX-6.** An **empty chain** exports as the **zero-length file** (no bytes).
  It is not a single `LF`. (An empty file has no genesis and so cannot be a
  valid *chain*, but it is a well-formed *export*; where a genesis is required is
  a chain rule, `event-schema.md` ES-33, not a framing rule.)

## 2. Canonical line form (exactly one valid representation, D5)

Per ADR-0003 D5, exactly one byte representation of an event is valid, and
semantically-equal JSON with different bytes is INVALID, never re-canonicalized.
This section fixes that single representation. It is a **structural** requirement
on the stored line, and it is *separate from* the value-based `hash` of
`hashing.md`: the `hash` commits to the field **values** and is insensitive to
JSON key order and whitespace (HA-11), so hash-recomputation alone cannot make
the byte form unique — this section does. The two together give both properties:
a portable content fingerprint (the `hash`) and a unique on-disk form (this §2).

- **EX-7.** Each line MUST be the **canonical serialization** of its event: one
  JSON object, **compact** — no whitespace anywhere between tokens (no space or
  tab after `:` or `,`, none inside the braces) — with the seven envelope fields
  in exactly this order: `seq`, `type`, `version`, `payload`, `ts`, `prev_hash`,
  `hash` (`event-schema.md` §1).
- **EX-8.** Inside `payload`, keys MUST appear in **ascending UTF-8-byte order**,
  compared as unsigned bytes (the same ordering `hashing.md` HA-8 uses for the
  preimage; a shorter key that is a prefix of a longer one sorts first). An
  integer value MUST be serialized in the canonical integer form of
  `event-schema.md` ES-5 (no leading zeros, no sign, no exponent, no fractional
  part). A string value MUST be serialized per EX-9.
- **EX-9.** Every string — envelope or payload — MUST use **minimal JSON
  escaping**: `\"` and `\\` for the two mandatory cases; the short escapes
  `\b \t \n \f \r` for U+0008, U+0009, U+000A, U+000C, U+000D; any other control
  character in U+0000–U+001F as `\u00xx` with **lowercase** hex; and every other
  character — including every non-ASCII character and `/` (solidus) — as its
  literal UTF-8 bytes, **never** a `\u` escape. This is the decoded-value stance
  of `hashing.md` HA-2 pinned as bytes: the canonical line and the hash preimage
  agree, character for character, on what each string is.
- **EX-10.** A verifier MUST reject (`INVALID`) any line that is not in this
  canonical form: wrong envelope-field order, any insignificant whitespace, a
  non-canonical number, unsorted or duplicated payload keys (`hashing.md` HA-6),
  a non-minimal or upper-case-hex string escape, or any top-level field beyond
  the seven (`event-schema.md` ES-2/ES-3). The verifier compares the received
  bytes against the canonical form and MUST NOT rewrite the stored line to make
  it pass (D5) — a mismatch is rejected, never repaired.
- **EX-11.** The `hash` and any `sig` are verified over the event's content-field
  **values** per `hashing.md` HA-14 / HA-16, independently of EX-7–EX-10. A line
  therefore faces two independent checks that MUST both hold: it is the canonical
  serialization, and its recomputed `hash`/`sig` match. Because the canonical
  form is unique, a "re-serialized but value-equal" line (reordered envelope
  keys, added whitespace, a `\u`-escaped character) fails EX-10 even though it
  would pass the `hash` check — which is exactly how "equivalent JSON with
  different bytes is INVALID" (D5) is enforced. (The genesis-rehearsal tamper
  matrix's "re-serialized-but-equivalent line" case is an EX-10 rejection, not a
  hash mismatch.)

## 3. Chain linkage across lines

- **EX-12.** The first line MUST be the genesis event: `seq` = 1, `prev_hash` =
  64 zeros, `type` = `genesis` (`event-schema.md` ES-6/ES-24/ES-33).
- **EX-13.** For each line after the first, `seq` MUST be exactly one greater
  than the previous line's `seq` (no gaps, no repeats; ES-7), and `prev_hash`
  MUST equal the previous line's `hash` (ES-25). A verifier reads the file in
  order and checks these link-by-link.
- **EX-14.** The **head** of an export is the `hash` field of its **last** line
  (or, for an empty export, the 64-zero anchor). The head identifies the whole
  chain: any two valid exports with the same head are identical up to that point.

## 4. `--head` and what truncation the export can and cannot self-detect

- **EX-15.** A verifier MAY be given an expected head via `--head <hash>` (64
  lowercase hex). When given, after all link checks pass the verifier MUST
  confirm the last line's `hash` equals `<hash>` and MUST report `INVALID` if it
  does not.
- **EX-16.** **End-truncation is not detectable from the export alone.** A prefix
  of a valid chain is itself a valid chain — every remaining line still links
  correctly — so dropping trailing lines yields a file that verifies `VALID` on
  its own. Detecting that lines were dropped from the end REQUIRES an out-of-band
  expected head: the verifier MUST be run with `--head` set to the independently
  anchored head (charter §4 anchoring), and truncation then surfaces as an
  EX-15 head mismatch. Any procedure that must catch truncation — including the
  genesis-rehearsal tamper matrix — MUST run the truncation case **with**
  `--head`; a run without `--head` recording `VALID` on a truncated export is
  expected, not a verifier bug.
- **EX-17.** Tampering **within** the retained lines is always detectable without
  `--head`: a flipped byte changes a `hash` (HA-14), breaks the next line's
  `prev_hash` link (EX-13), or violates the canonical form (EX-10); a deleted,
  reordered, or duplicated interior line breaks `seq` contiguity (ES-7) or the
  `prev_hash` link. Only clean end-truncation escapes detection, and only §4's
  `--head` closes it.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                            | Closed by        |
| -------------------------------------------- | ---------------- |
| Line framing / delimiter                     | EX-1, EX-3       |
| Encoding + BOM                               | EX-2             |
| CRLF vs LF                                    | EX-3             |
| Final-newline rule                           | EX-4             |
| Blank lines / stray whitespace               | EX-5             |
| Empty-chain representation                    | EX-6             |
| Envelope field order + compactness            | EX-7             |
| Payload key order + integer form              | EX-8             |
| String escaping (minimal, lowercase `\u`)     | EX-9             |
| Non-canonical line: reject vs repair          | EX-10 (reject)   |
| Canonical form vs value-based `hash`          | EX-11            |
| First-line / linkage rules                    | EX-12, EX-13     |
| Head definition                               | EX-14            |
| `--head` semantics                            | EX-15            |
| Truncation detectability + required `--head`  | EX-16, EX-17     |

## Acid-test walkthrough

Two producers given the same chain both emit byte-identical exports: compact
JSON, envelope fields in fixed order (EX-7), payload keys in UTF-8-byte order
(EX-8), minimally-escaped strings (EX-9), `LF`-framed with a final newline
(EX-4). Two verifiers given the same file both: reject any non-canonical line
(EX-10), recompute each `hash` over content-field values (`hashing.md`), and
check `seq`+1 and `prev_hash` linkage (EX-13). Given a line with its envelope
keys reordered, both reject it at EX-10 (not at the hash check, which would pass)
— so "equivalent JSON, different bytes" is `INVALID` (D5, EX-11). Given the file
with its last two lines removed, both report `VALID` without `--head` and
`INVALID` with the true `--head` (EX-16). No framing or serialization ambiguity
remains; byte-exact content integrity lives in `hashing.md`.
