# Identifiers — contracts/ids.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T3). Not frozen.
**Companion specs:** `event-schema.md`, `event-types.md`, `hashing.md` (T4).

Defines the two stable identifiers the v1 event types reference:
`participant_id` and `issue_id`. Both are **content-addressed** — derived by
SHA-256 from material already on the chain — so no identifier registry, counter,
or coordinating authority is needed, and any verifier can recompute every id
from the export alone.

Every normative sentence is numbered `ID-n`. RFC-2119 keywords are normative.

---

## 1. Shared form

- **ID-1.** Every identifier defined here MUST be a string of exactly 64
  lowercase hexadecimal characters, matching `^[0-9a-f]{64}$`.
- **ID-2.** Identifiers are case-stable and fixed-length by construction (they
  are SHA-256 digests in lowercase hex, D1). An uppercase or mixed-case
  identifier MUST be rejected; it is never lowercased to conform (D5).

## 2. `participant_id`

A participant is a holder of an Ed25519 keypair. The identifier is derived from
the **public** key, not from a counter or a name.

- **ID-3.** A participant's Ed25519 public key MUST be the 32-byte raw key
  (RFC 8032), carried on the chain as a 64-lowercase-hex string in the
  `participant_registered` payload (`event-types.md`).
- **ID-4.** `participant_id` MUST equal the lowercase-hex SHA-256 of the
  **32 raw public-key bytes** — i.e. `sha256(pubkey_bytes)`, hex-encoded — NOT
  the SHA-256 of the 64-character hex string of the key.
- **ID-5.** The hash input for ID-4 is exactly the 32 decoded key bytes, in
  order, with nothing prepended or appended. A verifier hex-decodes the
  `pubkey` field to 32 bytes, hashes those, and hex-encodes the digest.
- **ID-6.** Deriving the id from a hash of the key (rather than using the key
  itself as the id) keeps the identifier space uniform and fixed-length even if
  a future contracts version admits a different key algorithm with a
  different-length key (additive evolution, `evolution.md`). This is a drafting
  decision, fixed here.

**Worked shape (illustrative, not a fixture):** given
`pubkey = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"`
(64 hex = 32 bytes), `participant_id = sha256(<those 32 bytes>)` rendered as 64
lowercase hex. The exact digest is pinned as a golden fixture in T5, not here.

## 3. `issue_id`

An issue is created by exactly one `issue_created` event. The issue's identity
is that event's own `hash`.

- **ID-7.** `issue_id` MUST equal the `hash` field of the `issue_created` event
  that created the issue (`event-schema.md` ES-27). It is content-addressed by
  construction and requires no separate derivation.
- **ID-8.** A reference to an issue (e.g. `vote_cast.payload.issue_id`,
  `event-types.md`) MUST equal the `hash` of an `issue_created` event that
  appears **earlier in the chain** (strictly lower `seq`). A verifier MUST
  reject an event referencing an `issue_id` that is not the `hash` of a prior
  `issue_created` event.
- **ID-9.** Because an event's `hash` covers its position in the chain
  (`prev_hash` is part of the preimage, ES-27), an `issue_id` is unique within
  a chain without any additional uniqueness rule.

## 4. Why content-addressed (rationale)

- **ID-10.** Content-addressing is chosen over sequential ids (e.g. "issue #7")
  so that identifiers are (a) fixed-length and case-stable (ID-1), (b)
  independently recomputable by any verifier from the export with no shared
  counter, and (c) self-authenticating — an `issue_id` that does not match any
  event's `hash` is detectably invalid. This is a drafting decision permitted
  by the Phase-0 plan's "derive from pubkey / from seq" latitude.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                         | Closed by  |
| ----------------------------------------- | ---------- |
| Identifier length / character set / case  | ID-1, ID-2 |
| Case repair vs reject                     | ID-2       |
| Hash of key bytes vs hash of hex string   | ID-4, ID-5 |
| Key-as-id vs hash-of-key-as-id            | ID-4, ID-6 |
| Issue id source (seq vs content)          | ID-7       |
| Forward/backward reference legality       | ID-8       |
| Uniqueness rule for issue ids             | ID-9       |

## Acid-test walkthrough

Two implementations given the same `participant_registered` event both:
hex-decode `pubkey` to 32 bytes (ID-3/ID-5), `sha256` those exact bytes, and
hex-encode lowercase (ID-4) — identical `participant_id`, no ambiguity about
whether the hash covers the key or its hex text. Given the same
`issue_created` event, both read its `hash` field as the `issue_id` (ID-7):
nothing to compute, nothing to disagree on. The only dependency is the digest
of the preimage itself, which `hashing.md` (T4) fixes.
