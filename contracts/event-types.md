# Event Types — contracts/event-types.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T3). Not frozen.
**Companion specs:** `event-schema.md` (envelope), `ids.md` (identifiers),
`hashing.md` (preimage — T4).

The v1 registry of event types and their payloads. The envelope
(`event-schema.md`) is identical for all types; this spec fixes each type's
`payload` keys, value types, and signing rule. Payload values are integers or
UTF-8 strings only, flat, per `event-schema.md` ES-16/ES-17 (D4).

Every normative sentence is numbered `ET-n`. RFC-2119 keywords are normative.
Each payload table column: **key** · **type** · **constraint**.

- **ET-1.** The v1 registry is exactly these four types: `genesis`,
  `participant_registered`, `issue_created`, `vote_cast`. A verifier MUST reject
  any event whose `type` is not one of these (`event-schema.md` ES-11).
- **ET-2.** Each type below is defined at `version` = 1. An event of a listed
  type with `version` ≠ 1 has no v1 schema and MUST be rejected until a future
  contracts version defines it (`evolution.md`, T4).

---

## Signing model (applies to signed types below)

- **ET-3.** A **signed** event carries a `sig` field in its payload: an Ed25519
  signature as 128 lowercase hex characters (`event-schema.md` ES-31).
- **ET-4.** `sig` MUST be a valid Ed25519 signature, under the event's
  **signing key** (named per type below), over the event's **signing preimage** —
  the hash preimage with the `sig` key omitted from `payload`
  (`event-schema.md` ES-32; bytes in `hashing.md`, T4).
- **ET-5.** A verifier MUST reject a signed event whose `sig` does not verify
  under the signing key named for its type.

---

## `genesis` (signed by the operator key)

The mandatory first event (`event-schema.md` ES-33). It anchors the chain and
declares the operator key that later `issue_created` events are signed with.

| key           | type   | constraint                                                          |
| ------------- | ------ | ------------------------------------------------------------------ |
| `chain_id`    | string | `^[0-9a-f]{64}$` — the chain's stable identifier (see ET-7)        |
| `contracts`   | string | the frozen contracts version this chain runs, e.g. `"contracts-v1"` |
| `operator_pk` | string | `^[0-9a-f]{64}$` — operator Ed25519 public key (32 bytes, hex)      |
| `sig`         | string | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)                        |

- **ET-6.** `genesis.version` MUST be `1`, `seq` MUST be `1`, and `prev_hash`
  MUST be the 64-zero anchor (`event-schema.md` ES-24, ES-33).
- **ET-7.** `chain_id` MUST equal the `participant_id`-style derivation
  `sha256(operator_pk_bytes)` in lowercase hex (same construction as `ids.md`
  ID-4/ID-5 applied to `operator_pk`). This binds the chain's identity to its
  operator key with no free parameter.
- **ET-8.** The `genesis` signing key is `operator_pk` (the event is
  self-signed by the key it declares). A verifier MUST reject a `genesis` whose
  `sig` does not verify under its own `operator_pk`.
- **ET-9.** `contracts` MUST be a non-empty string; it is advisory provenance
  and is covered by `hash` but places no further constraint on verification in
  v1.

## `participant_registered` (self-signed by the registrant)

Adds a public-plane participant. Self-signed to prove possession of the private
key for the declared public key.

| key      | type   | constraint                                             |
| -------- | ------ | ------------------------------------------------------ |
| `pubkey` | string | `^[0-9a-f]{64}$` — Ed25519 public key, 32 bytes (hex)  |
| `sig`    | string | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)           |

- **ET-10.** The `participant_registered` signing key is its own `pubkey`. A
  verifier MUST reject the event if `sig` does not verify under `pubkey`
  (proof-of-possession).
- **ET-11.** The participant's `participant_id` is derived from `pubkey` per
  `ids.md` ID-4. It is NOT stored in the payload; it is always recomputed.
- **ET-12.** Structural validity does not imply uniqueness of the human behind
  the key. One-verified-human enforcement is an identity-service concern
  (charter §P2, §10), not a property this event guarantees on its own. A
  verifier checks signature and format only.

## `issue_created` (operator-signed)

Opens an issue for voting. Title only — no free-text body (charter §5 MVP; D4).

| key     | type   | constraint                                                      |
| ------- | ------ | -------------------------------------------------------------- |
| `title` | string | 1–200 UTF-8 characters; MUST NOT contain U+0000–U+001F or U+007F |
| `sig`   | string | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)                    |

- **ET-13.** The `issue_created` signing key is the chain's `operator_pk` from
  the `genesis` event. A verifier MUST reject an `issue_created` whose `sig`
  does not verify under `operator_pk`.
- **ET-14.** `title` MUST be present and 1–200 Unicode scalar values in length,
  and MUST NOT contain any C0 control character (U+0000–U+001F) or U+007F. No
  other payload field is permitted (`event-schema.md` ES-18).
- **ET-15.** The issue's `issue_id` is this event's `hash` (`ids.md` ID-7); it
  is not stored in the payload.
- **ET-16.** `title` string bytes are hashed as-is (UTF-8, no normalization);
  see `hashing.md` (T4) for the string-encoding rule. Two titles that are
  visually equal but differently encoded are different events.

## `vote_cast` (signed by a ballot key)

Records one ballot on one issue.

| key         | type    | constraint                                                       |
| ----------- | ------- | ---------------------------------------------------------------- |
| `issue_id`  | string  | `^[0-9a-f]{64}$` — `hash` of a prior `issue_created` (`ids.md` ID-8) |
| `ballot_pk` | string  | `^[0-9a-f]{64}$` — Ed25519 ballot public key (32 bytes, hex)     |
| `choice`    | integer | an integer choice code; semantics are a derived-view concern (ET-19) |
| `sig`       | string  | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)                     |

- **ET-17.** The `vote_cast` signing key is its own `ballot_pk`. A verifier
  MUST reject a `vote_cast` whose `sig` does not verify under `ballot_pk`.
- **ET-18.** `issue_id` MUST reference a prior `issue_created` event per
  `ids.md` ID-8; a verifier MUST reject a vote for an unknown or forward issue.
- **ET-19.** `choice` MUST be a JSON integer. The contract records the integer
  verbatim and assigns it no meaning: interpreting choices into a result is a
  derived-view act of the tally engine, never of the log (charter §P3 — the
  platform characterizes, it never weighs). Richer ballot shapes (e.g. ranked
  lists) are a future additive `vote_cast` version, not a v1 field.

### Boundary — what `vote_cast` does and does not guarantee (charter flag)

- **ET-20.** In v1 the log verifies a vote's **structural integrity** (hash
  chain, ES-25/ES-28) and its **signature** (ET-17) only. It does NOT, by
  itself, enforce ballot **eligibility** (that `ballot_pk` is entitled to vote),
  **uniqueness** (one ballot per human per issue), or **unlinkability** of the
  ballot plane from the public plane. Those are identity-service and tally
  concerns (charter §P2, §5, §10).
- **ET-21.** A stable `ballot_pk` on each vote makes a single voter's votes
  linkable **to one another**; it is not linkable to a public `participant_id`
  by anything in the log. Full receipt-freeness and unlinkable-eligibility
  (blind-signature credentials) are explicitly deferred to identity v2 (charter
  §5, §11). **This is a known tension with charter §5 and is recorded in
  `memory/OPEN-QUESTIONS.md`; contracts v1 does not resolve it and must not be
  read as claiming to.** The MVP relies on the identity service holding the
  ballot-eligibility linkage privately, off the log (charter §10 v1).

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                              | Closed by      |
| ---------------------------------------------- | -------------- |
| The exact set of v1 types                      | ET-1           |
| Which version each type is defined at          | ET-2           |
| How signatures are carried / what they cover   | ET-3, ET-4     |
| Genesis fields, seq/prev_hash, self-signing    | ET-6, ET-7, ET-8 |
| `chain_id` derivation                          | ET-7           |
| participant self-signing + id derivation       | ET-10, ET-11   |
| Title length + forbidden characters            | ET-14          |
| Title normalization (none)                     | ET-16          |
| Issue id source                                | ET-15          |
| Vote signing key + issue reference direction   | ET-17, ET-18   |
| `choice` type + who interprets it              | ET-19          |
| What the log does/does not enforce for ballots | ET-20, ET-21   |

## Acid-test walkthrough

Given the same four events, two implementations agree on: the legal type set
(ET-1); that every `sig` is 128 hex and verified under the type's named key —
`operator_pk` for genesis/issue, own key for participant/vote (ET-8/10/13/17);
that a `title` over 200 scalars or with a control character is rejected (ET-14);
that a vote for a not-yet-created issue is rejected (ET-18); and that `choice`
is an opaque integer (ET-19). The only undecided bytes are the signing/hash
preimage layout — deferred to `hashing.md` (T4). No type-level ambiguity remains
in this spec's scope.
