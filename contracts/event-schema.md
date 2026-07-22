# Event Schema — contracts/event-schema.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T3). Not frozen.
**Companion specs:** `event-types.md` (payloads), `ids.md` (identifiers),
`hashing.md` (byte-exact preimage — T4), `export-format.md` (NDJSON — T4).

Defines the **event envelope**: the seven fields every event carries and the
constraints on each, independent of event type. Payload shapes live in
`event-types.md`; the exact bytes fed to SHA-256 live in `hashing.md`. This
spec fixes *what the fields are and what values are legal*; `hashing.md` fixes
*how those values become bytes*.

Every normative sentence is numbered `ES-n` so a fixture can cite the exact
rule it exercises. RFC-2119 keywords (MUST, MUST NOT, SHOULD) are normative.

---

## 1. The envelope

An **event** is a JSON object with exactly these seven fields, no more and no
fewer:

```json
{
  "seq": 1,
  "type": "genesis",
  "version": 1,
  "payload": { "...": "per event-types.md" },
  "ts": "2026-07-21T00:00:00.000Z",
  "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "b7e2…64 lowercase hex"
}
```

- **ES-1.** An event MUST contain all seven fields: `seq`, `type`, `version`,
  `payload`, `ts`, `prev_hash`, `hash`.
- **ES-2.** An event MUST NOT contain any top-level field other than those
  seven. A verifier MUST reject an event carrying an unknown top-level field.
- **ES-3.** A field value MUST NOT be JSON `null`, and no field may be absent.
  A verifier MUST reject an event in which any of the seven fields is `null` or
  absent.
- **ES-4.** A verifier MUST NOT re-order, re-serialize, or otherwise
  "normalize" an event to make it conform. Non-conforming input is rejected as
  received; it is never repaired (D5).

## 2. `seq` — sequence number

- **ES-5.** `seq` MUST be a JSON integer in **canonical integer form**: no
  fractional part, no exponent, no leading zeros, and no sign (`1`, never `1.0`,
  `1e0`, `01`, or `+1`). Wherever this spec requires "a JSON integer" — `seq`,
  `version` (ES-12), and every integer payload value (ES-16, including
  `vote_cast.choice` and `issue_created.choice_count`) — the value MUST be in
  this canonical integer form and MUST lie within the closed range
  −(2^53 − 1) … 2^53 − 1, so it round-trips losslessly through a standard JSON
  number in both TypeScript and Go (D4). A verifier MUST reject any integer that
  is out of form or out of range.
- **ES-6.** The first event in a chain MUST have `seq` equal to `1`.
- **ES-7.** For every event after the first, `seq` MUST equal the previous
  event's `seq` plus `1`. There are no gaps and no repeats.
- **ES-8.** `seq` is the sole authority for event ordering. Nothing else —
  not `ts`, not insertion time — orders events (D6).

## 3. `type` — event type

- **ES-9.** `type` MUST be a string naming a type registered in
  `event-types.md`, and the event's `(type, version)` pair MUST be a
  registered combination (`version` is per-type, ES-13 — there is no
  chain-wide version).
- **ES-10.** `type` MUST match the pattern `^[a-z][a-z0-9_]*$` (lowercase
  ASCII, underscores allowed, no leading digit or underscore).
- **ES-11.** A verifier MUST reject an event whose `type` is not a registered
  type name.

## 4. `version` — per-type payload schema version

- **ES-12.** `version` MUST be a JSON integer greater than or equal to `1`, in
  the canonical integer form of ES-5.
- **ES-13.** `version` identifies the schema version of `payload` **for this
  `type`** — it is not a protocol-wide version. Each event type versions its
  payload independently (see `evolution.md`, T4).
- **ES-14.** The protocol/contracts version under which a chain was started is
  recorded once, in the `genesis` event payload (`event-types.md`), not in
  this field.

## 5. `payload` — the typed body

- **ES-15.** `payload` MUST be a JSON object.
- **ES-16.** Every value in `payload` MUST be either a JSON integer (in the
  canonical integer form of ES-5) or a JSON string. Floats, booleans, `null`,
  nested objects, and arrays MUST NOT appear in a v1 payload (D4). A verifier
  MUST reject a payload containing any of them.
- **ES-17.** `payload` MUST be flat: it MUST NOT nest objects or arrays. (This
  is what lets `hashing.md` spell the preimage byte-for-byte without recursion.)
- **ES-18.** The set of keys a payload MUST carry, and their value types, is
  fixed per `(type, version)` in `event-types.md`. A verifier MUST reject a
  payload that is missing a required key or carries a key not defined for that
  `(type, version)`.
- **ES-19.** Integer payload values are bounded and formatted per ES-5; string
  payload values MUST be valid UTF-8 (the byte-exact string encoding, including
  normalization stance, is fixed in `hashing.md`, T4).

## 6. `ts` — timestamp (advisory)

- **ES-20.** `ts` MUST satisfy BOTH of these tests, in order (D6):
  1. **Syntactic gate:** it MUST match `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`
     (UTC, exactly millisecond precision, trailing uppercase `Z`).
  2. **Calendar gate:** the matched value MUST additionally be a real UTC
     calendar instant — month `01`–`12`, day valid for that month and year
     (leap years included), hour `00`–`23`, minute `00`–`59`, second `00`–`59`.
     **Leap seconds (`60`) are REJECTED** even though RFC 3339 permits them, so
     that a regex-only implementation and a calendar-parsing one (e.g. Go's
     `time.Parse`) reach the SAME verdict. A value that passes the regex but is
     not a real instant (e.g. `2026-13-40T25:61:61.999Z`) MUST be rejected.
  A verifier MUST reject any `ts` failing either gate.
- **ES-21.** `ts` is advisory metadata only. It MUST NOT be used to order,
  select, or validate events beyond the format check in ES-20. `seq` orders
  (ES-8).
- **ES-22.** `ts` is nonetheless covered by `hash` (Section 8): once written it
  is immutable, even though it is not authoritative.

## 7. `prev_hash` — chain linkage

- **ES-23.** `prev_hash` MUST be a string of exactly 64 lowercase hexadecimal
  characters, matching `^[0-9a-f]{64}$` (D1).
- **ES-24.** The first event (`seq` = 1) MUST have `prev_hash` equal to 64
  ASCII `0` characters
  (`0000000000000000000000000000000000000000000000000000000000000000`). This
  64-zero string is the genesis anchor; it is a drafting decision fixed here.
- **ES-25.** For every event after the first, `prev_hash` MUST equal the `hash`
  field of the event whose `seq` is one less. A verifier MUST reject an event
  whose `prev_hash` does not match its predecessor's `hash`.

## 8. `hash` — this event's identity

- **ES-26.** `hash` MUST be a string of exactly 64 lowercase hexadecimal
  characters, matching `^[0-9a-f]{64}$`.
- **ES-27.** `hash` MUST equal the lowercase-hex SHA-256 of the event's
  **canonical preimage**, computed over the six content fields `seq`, `type`,
  `version`, `payload`, `ts`, `prev_hash` — every field except `hash` itself.
  The byte-exact preimage construction is specified in `hashing.md` (T4); this
  spec fixes only *which fields it covers* and *that the digest is SHA-256 in
  lowercase hex* (D1, D3).
- **ES-28.** A verifier MUST recompute `hash` from the six content fields and
  MUST reject any event whose recomputed digest does not equal the stored
  `hash` byte-for-byte.
- **ES-29.** Because `payload` is covered by `hash` (ES-27), any signature
  carried inside a payload (see `event-types.md`) is also covered by `hash`:
  tampering with a signature breaks the chain, not just the signature check.

## 9. Signed events (envelope-level statement)

Some event types are **signed**; which ones, and the exact signing rule, are in
`event-types.md`. At the envelope level:

- **ES-30.** A signature, when required by an event's type, MUST be carried as a
  string field inside `payload` (the envelope has no dedicated signature field).
- **ES-31.** A signature MUST be an Ed25519 signature encoded as exactly 128
  lowercase hexadecimal characters, matching `^[0-9a-f]{128}$` (D2).
- **ES-32.** A signature MUST cover the event's **signing preimage** — the same
  six content fields as the hash preimage (ES-27) but with the signature field
  itself omitted from `payload`. The byte-exact signing preimage is specified
  in `hashing.md` (T4). This ordering (sign first, then the signature becomes
  part of what `hash` covers) is deliberate and is fixed here.

## 10. Genesis event

- **ES-33.** A chain's first event (`seq` = 1, `prev_hash` = 64 zeros per ES-24)
  MUST be of type `genesis` (defined in `event-types.md`). A `genesis` event
  MUST NOT appear at any `seq` other than `1`. Equivalently: `genesis` occurs
  exactly once, at `seq` = 1, and the `seq` = 1 event is always `genesis`. A
  verifier MUST reject a chain that violates this.

---

## Degrees of freedom closed (acid-test checklist)

Per `odc-contracts`: *could two conforming implementations produce different
bytes?* Each envelope-level degree of freedom and where it is closed:

| Degree of freedom                         | Closed by            |
| ----------------------------------------- | -------------------- |
| Which fields exist / extra fields allowed | ES-1, ES-2           |
| null vs absent vs present                 | ES-3                 |
| Repair vs reject non-canonical input      | ES-4 (reject)        |
| `seq` numeric form (leading zeros, sign)  | ES-5                 |
| First seq, gaps, ordering authority       | ES-6, ES-7, ES-8     |
| `type` character set                      | ES-10                |
| Payload value types (floats/bools/nulls)  | ES-16                |
| Payload nesting                           | ES-17                |
| Payload key set                           | ES-18                |
| `ts` textual form + role                  | ES-20, ES-21         |
| `prev_hash` case, length, genesis value   | ES-23, ES-24         |
| Digest algorithm, coverage, case          | ES-27 (+ hashing.md) |
| Where a signature lives / what it covers  | ES-30, ES-31, ES-32  |

Byte-exact serialization of the preimage and of the stored NDJSON line is the
one remaining degree of freedom; it is closed by `hashing.md` and
`export-format.md` (T4). No `hash` value can be hand-verified until those land —
that is expected at T3.

## Acid-test walkthrough

Take two independent implementations, one TypeScript, one Go, each given the
same event object. They agree on: the seven required fields (ES-1/2), that a
`null` or extra field is rejected (ES-2/3), that `seq` must be `1` then `+1`
(ES-6/7), that a float in `payload` is rejected (ES-16), that `prev_hash` is 64
lowercase hex with a 64-zero genesis (ES-23/24), and that `hash` is SHA-256 over
six named fields in lowercase hex (ES-27). The only thing they cannot yet agree
on byte-for-byte is the preimage layout — explicitly deferred to `hashing.md`.
No envelope ambiguity remains within this spec's scope.
