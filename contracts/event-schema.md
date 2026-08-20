# Event Schema — contracts/event-schema.md

**Version:** 4
**Status:** DRAFTING (Phase 0 · T3, amended T4a, T9a/ADR-0014, ADR-0016, and
ADR-0019). Not frozen.
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
  fractional part, no exponent, no leading zeros, and no sign character —
  neither `+` nor `-` (`1`, never `1.0`, `1e0`, `01`, `+1`, or `-1`). Wherever
  this spec requires "a JSON integer" — `seq`, `version` (ES-12), and every
  integer payload value (ES-16, including `vote_cast.choice` and
  `issue_created.choice_count`) — the value MUST be in this canonical integer
  form and MUST lie within the closed range `0 … 2^53 − 1`. Integers are
  therefore non-negative and round-trip losslessly through a standard JSON
  number in both TypeScript and Go (D4). A verifier MUST reject any integer that
  is out of form or out of range. v1 defines no negative or fractional numbers;
  a future type that needs one carries it as a decimal **string** (D4), never as
  a signed or fractional JSON number — so this integer encoding never has to
  change (which matters because `hashing.md` freezes it, T4).
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
  type name. **What "reject" means here is refined by `evolution.md` EV-9:** for
  a *well-formed* (ES-10) but unregistered `type` or `(type, version)`, the
  outcome is the per-event `PARTIAL` treatment of EV-7/EV-8 — the event is denied
  a `VALID` **semantic** verdict, not condemned as structurally `INVALID`. Only a
  malformed `type` (ES-10) or a Stage A failure is `INVALID`. This applies to
  ES-9 above as well.

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
  `(type, version)`. A key that type's table marks **OPTIONAL** may be absent
  without being missing (ES-34).
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
- **ES-21.** `ts` is advisory metadata only. It MUST NOT be used to order or
  select events, and MUST NOT be used to validate them beyond the format check in
  ES-20 and the one type-specific constraint on its **value** that
  `event-types.md` ET-23 places on `vote_cast` — a ballot's `ts` is quantized to
  its issue's declared batch interval, so a verifier checks that value, and still
  never orders or selects by it. `seq` orders (ES-8), always and only.
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

## 11. Optional payload keys (added in v3)

- **ES-34.** A `(type, version)`'s key set (ES-18) MAY declare a key **OPTIONAL**,
  marked as such in that type's payload table in `event-types.md`. An optional key
  is either **present with a legal value** or **entirely absent**. It is never
  `null` (ES-3), never present with a placeholder value standing for "no value",
  and a type MUST NOT define such a placeholder where absence already carries that
  meaning — one meaning, one representation (D5). ES-18 is otherwise unchanged:
  OPTIONAL means "this defined key may be absent", never "an undefined key may
  appear", and a verifier still rejects any key not defined for the
  `(type, version)`.

  Presence and absence produce **different events**: `hashing.md` HA-7 encodes
  exactly the keys the payload carries, and its leading key count `U64(k)` differs,
  so the two forms have different preimages and different `hash` values. No hashing
  rule changes to accommodate optional keys — this sentence records that the
  generic payload rule already handles them. A producer therefore MUST NOT emit an
  optional key it does not mean.

  v1 defines **two** optional keys, both on `genesis`: `ancestor_chain` and
  `ancestor_head` (`event-types.md` ET-9e). Their presence is **not
  independent** — `ancestor_head` MUST NOT appear without `ancestor_chain`
  (ET-9f).

  That is the general shape, not a special case for one type. A type's payload
  table in `event-types.md` fixes **which** of its keys are optional; that type's
  own numbered rules MAY further constrain **when** an optional key may appear,
  including by making one key's presence depend on another's. Such a
  conditional-presence rule MUST be stated as a numbered RFC-2119 sentence in
  `event-types.md`; a payload-table row MUST NOT be the only statement of it (the
  mistake that produced ET-9b). A verifier MUST enforce a conditional-presence
  rule exactly as it enforces the key set of ES-18: a payload that breaks it is
  rejected at the line carrying it.

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
| Optional key: absent vs null vs placeholder | ES-34              |
| Conditional presence of an optional key   | ES-34 (+ its type's rule) |
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
