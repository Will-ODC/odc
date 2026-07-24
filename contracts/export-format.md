# Export Format — contracts/export-format.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T4). Not frozen.
**Companion specs:** `event-schema.md` (envelope), `hashing.md` (preimage +
`hash`), `read-api.md` (the online read interface), `evolution.md` (versioning).

Fixes how a whole chain is serialized to a file so that every participant
downloads, stores, and verifies **identical bytes**. The export is the portable
form of the log — the thing a stranger feeds to an independent verifier
(charter §4). Its framing (D7) is deliberately trivial so that every line,
including the last, is constructed the same way.

Every normative sentence is numbered `EX-n`. RFC-2119 keywords are normative.

---

## 1. Framing (NDJSON)

- **EX-1.** An export is **newline-delimited JSON (NDJSON)**: a sequence of
  zero or more lines, each line the JSON serialization of exactly one event
  (`event-schema.md`), in ascending `seq` order.
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

## 2. The line is the canonical carrier (strict mode)

- **EX-7.** Each line's bytes, between one `LF` and the next, are the event's
  **stored representation**. The `hash` and any `sig` are verified against
  **these exact bytes** (their six content fields as serialized on the line),
  per `hashing.md` HA-14 / HA-16. A verifier MUST NOT re-serialize, re-order
  keys, re-encode numbers, or change hex case to make a line verify; a line that
  does not verify as-received is `INVALID` (D5; `event-schema.md` ES-4).
- **EX-8.** Two lines that are semantically-equal JSON but differ in bytes (key
  order, whitespace, number spelling) are **different lines**; at most one can
  carry the `hash` that matches its content fields under `hashing.md`. The other
  is `INVALID`. The export does not define a "pretty" and a "canonical" form —
  the stored line is the only form.
- **EX-9.** This spec does not add a second, independent JSON-canonicalization
  rule on top of `hashing.md`. The integrity guarantee comes entirely from
  recomputing each event's `hash` over its content fields (`hashing.md`) and
  from the chain linkage of §3; the JSON text around those fields is verified by
  *reproducing the same `hash`*, not by a separate byte-canonicality check of the
  line. Whitespace or key-order variation that still yields the stored `hash`'s
  content-field bytes is therefore simply the event; variation that changes those
  bytes changes the `hash` and is caught by HA-14.

> Note (implementers): the simplest conforming producer emits each event with a
> fixed key order and no insignificant whitespace, so the line is stable and
> diffable. The contract does not *mandate* a specific JSON whitespace/key-order
> form for the envelope, because `hash` already pins what must be pinned (the
> content-field bytes). `read-api.md` MAY require a specific compact form on the
> wire; that is an interface choice, not a hashing rule.

## 3. Chain linkage across lines

- **EX-10.** The first line MUST be the genesis event: `seq` = 1, `prev_hash` =
  64 zeros, `type` = `genesis` (`event-schema.md` ES-6/ES-24/ES-33).
- **EX-11.** For each line after the first, `seq` MUST be exactly one greater
  than the previous line's `seq` (no gaps, no repeats; ES-7), and `prev_hash`
  MUST equal the previous line's `hash` (ES-25). A verifier reads the file in
  order and checks these link-by-link.
- **EX-12.** The **head** of an export is the `hash` field of its **last** line
  (or, for an empty export, the 64-zero anchor). The head identifies the whole
  chain: any two exports with the same head over a valid chain are identical up
  to that point.

## 4. `--head` and what truncation the export can and cannot self-detect

- **EX-13.** A verifier MAY be given an expected head via `--head <hash>` (64
  lowercase hex). When given, after all link checks pass the verifier MUST
  confirm the last line's `hash` equals `<hash>` and MUST report `INVALID` if it
  does not.
- **EX-14.** **End-truncation is not detectable from the export alone.** A prefix
  of a valid chain is itself a valid chain — every remaining line still links
  correctly — so dropping trailing lines yields a file that verifies `VALID` on
  its own. Detecting that lines were dropped from the end REQUIRES an out-of-band
  expected head: the verifier MUST be run with `--head` set to the independently
  anchored head (charter §4 anchoring), and truncation then surfaces as an
  EX-13 head mismatch. Any procedure that must catch truncation — including the
  genesis-rehearsal tamper matrix — MUST run the truncation case **with**
  `--head`; a run without `--head` recording `VALID` on a truncated export is
  expected, not a verifier bug.
- **EX-15.** Tampering **within** the retained lines is always detectable without
  `--head`: a flipped byte changes a `hash` (HA-14) or breaks the next line's
  `prev_hash` link (EX-11); a deleted, reordered, or duplicated interior line
  breaks `seq` contiguity (ES-7) or the `prev_hash` link. Only clean
  end-truncation escapes detection, and only §4's `--head` closes it.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                          | Closed by        |
| ------------------------------------------ | ---------------- |
| Line framing / delimiter                   | EX-1, EX-3       |
| Encoding + BOM                             | EX-2             |
| CRLF vs LF                                 | EX-3             |
| Final-newline rule                         | EX-4             |
| Blank lines / stray whitespace             | EX-5             |
| Empty-chain representation                 | EX-6             |
| Which bytes `hash`/`sig` verify against    | EX-7             |
| Equivalent-JSON-different-bytes handling   | EX-8, EX-9       |
| First-line / linkage rules                 | EX-10, EX-11     |
| Head definition                            | EX-12            |
| `--head` semantics                         | EX-13            |
| Truncation detectability + required `--head` | EX-14, EX-15   |

## Acid-test walkthrough

Two implementations given the same export both: read UTF-8, split strictly on
`0x0A`, require a trailing `0x0A` (EX-4) and no CR or blank lines (EX-3/EX-5),
parse each line to an event, and verify each event's `hash` over its content
fields (`hashing.md`) plus `seq`+1 and `prev_hash`-linkage (EX-11). Given the
same file with the last two lines removed, both report `VALID` without `--head`
and both report `INVALID` (head mismatch) with the true `--head` — identical
verdicts in both modes (EX-14). No framing ambiguity remains; the byte-exact
content integrity lives in `hashing.md`.
