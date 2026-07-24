# Hashing — contracts/hashing.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T4). Not frozen.
**Companion specs:** `event-schema.md` (envelope), `event-types.md` (payloads),
`ids.md` (identifiers), `export-format.md` (NDJSON framing), `evolution.md`
(versioning + cross-version verifier behavior).

Fixes the one degree of freedom `event-schema.md` deferred: the **exact bytes**
fed to SHA-256 to produce an event's `hash`, and to Ed25519 to produce a signed
event's `sig`. This is an **explicit byte-string construction** (ADR-0003, D3),
never "canonicalize the JSON and hash it". The construction is **generic over
any flat integer/string payload** (ADR-0006, decision 3): it never enumerates
per-type fields, so a verifier can recompute the hash of an event whose `type`
it does not know.

Every normative sentence is numbered `HA-n`. RFC-2119 keywords are normative.
Given the same event, a TypeScript and a Go implementation built from this text
alone MUST produce the identical preimage bytes and therefore the identical
digest.

> **Once `contracts-v1` is tagged this file is frozen (`contracts-guard`).** A
> hashing mistake found after real events exist is permanent. Read the worked
> example (§6) and reproduce its digest before approving the freeze.

---

## 1. Primitive encoders

All lengths and counts are **octet** (byte) counts, never character counts.

- **HA-1.** `U64(n)` is the integer `n` encoded as **exactly 8 octets,
  big-endian** (most-significant octet first), unsigned. Because every integer
  in an event is bounded to `0 … 2^53 − 1` (`event-schema.md` ES-5), it always
  fits in 8 octets with no overflow.
- **HA-2.** `UTF8(s)` is the UTF-8 encoding of string `s`, with **no** byte-order
  mark and **no** Unicode normalization of any form (NFC/NFD/NFKC/NFKD MUST NOT
  be applied). The string's octets are taken exactly as they appear in the
  stored event. An implementation MUST reject a string that is not
  well-formed UTF-8.
- **HA-3.** `LP(x)` (length-prefixed octets) is `U64(len) || x`, where `len` is
  the octet count of `x` and `||` is concatenation. Length-prefixing (never a
  delimiter) is what makes the construction unambiguous even when a string value
  contains any byte sequence.
- **HA-4.** `ENC_INT(n)` — the encoding of an integer **field value** — is
  `U64(n)`.
- **HA-5.** `ENC_STR(s)` — the encoding of a string **field value** — is
  `LP(UTF8(s))`.

## 2. Encoding the payload (generic, per-type-agnostic)

The payload is a flat JSON object whose values are integers or strings only
(`event-schema.md` ES-16/ES-17). It is encoded by the mechanical rule below with
no reference to the event's `type` (ADR-0006).

- **HA-6.** If the payload JSON object contains the **same key more than once**,
  the event is non-canonical and MUST be rejected (`INVALID`); it is never
  de-duplicated to conform (D5).
- **HA-7.** `ENC_PAYLOAD(P)` is:
  1. `U64(k)`, where `k` is the number of keys in `P`; then
  2. for each key in `P`, taken in **ascending key order** (HA-8), the
     concatenation of:
     - a **1-octet type tag**: `0x69` (ASCII `i`) if the key's value is a JSON
       integer, `0x73` (ASCII `s`) if the key's value is a JSON string;
     - `ENC_STR(key)` — the key, length-prefixed (HA-5); then
     - `ENC_INT(value)` if the value is an integer, or `ENC_STR(value)` if the
       value is a string.
- **HA-8.** **Key order** is ascending lexicographic comparison of the keys'
  **UTF-8 octet sequences**, compared as unsigned bytes (the shorter key sorts
  first when it is a prefix of the longer). This ordering is a property of the
  bytes, not of any locale or collation. An empty payload (`k = 0`) encodes as
  `U64(0)` and nothing more.
- **HA-9.** The 1-octet type tag (HA-7) is load-bearing: it makes the integer
  value `1` and the string value `"1"` under the same key encode to different
  bytes, so no two distinct payloads can collide on a preimage.

## 3. The preimage

- **HA-10.** `DOMAIN` is the 4 octets `0x4F 0x44 0x43 0x31` (ASCII `ODC1`). It
  prefixes every preimage so these digests can never collide with bytes hashed
  for another purpose or protocol.
- **HA-11.** The **preimage** of an event `E` is the concatenation, in **exactly
  this field order**:

  ```
  PRE(E) =  DOMAIN
         || ENC_INT(E.seq)
         || ENC_STR(E.type)
         || ENC_INT(E.version)
         || ENC_PAYLOAD(E.payload)
         || ENC_STR(E.ts)
         || ENC_STR(E.prev_hash)
  ```

  These are the six content fields of `event-schema.md` ES-27, in that order.
  `E.hash` is **not** part of the preimage.
- **HA-12.** `E.prev_hash` is encoded by `ENC_STR` — that is, the preimage
  contains the **64 lowercase-hex ASCII characters** of `prev_hash`, length-
  prefixed, **not** the 32 decoded bytes. The genesis `prev_hash` (64 ASCII `0`,
  `event-schema.md` ES-24) is encoded the same way, as 64 `0x30` octets. The same
  applies to every hex-string field that appears in a payload (public keys,
  `chain_id`, `issue_id`, `sig`): each is hashed as its lowercase-hex text via
  `ENC_STR`, never as decoded bytes. One rule for all string fields.

## 4. The hash

- **HA-13.** `hash(E)` MUST equal the **SHA-256** (D1) digest of `PRE(E)`,
  rendered as **64 lowercase hexadecimal characters** (`^[0-9a-f]{64}$`). Upper-
  or mixed-case hex is non-conforming (`event-schema.md` ES-26; D5).
- **HA-14.** A verifier MUST recompute `PRE(E)` from the six content fields as
  stored and MUST reject the event (`INVALID`) if the recomputed digest does not
  equal the stored `hash` octet-for-octet (`event-schema.md` ES-28). This check
  is type-agnostic and applies to every event, including one whose `type` the
  verifier does not register (ADR-0006 Stage A).

## 5. The signing preimage

Signed types carry a `sig` key in their payload (`event-types.md` ET-3). The
signature is produced **before** `sig` exists, over a preimage that omits it;
`sig` is then inserted and becomes part of what `hash` covers
(`event-schema.md` ES-32).

- **HA-15.** The **signing preimage** `SIGN_PRE(E)` is `PRE(E)` computed over the
  event with the single payload key `"sig"` removed. Concretely: in
  `ENC_PAYLOAD` (HA-7) the count `k` is one lower and the `"sig"` entry is
  absent; every other field is byte-identical to `PRE(E)`. All other fields —
  `DOMAIN`, `seq`, `type`, `version`, the remaining payload keys, `ts`,
  `prev_hash` — are unchanged.
- **HA-16.** `sig` MUST be the **Ed25519** (D2) signature over `SIGN_PRE(E)`,
  under the signing key named for the event's `type` (`event-types.md`),
  encoded as 128 lowercase hex characters (`event-schema.md` ES-31). Ed25519
  hashes its own input internally; `SIGN_PRE(E)` is passed to Ed25519 as the raw
  message, **not** pre-hashed with SHA-256.
- **HA-17.** Removing exactly the `"sig"` key (HA-15) is unambiguous because the
  payload key set is otherwise fixed for a signed event and keys are unique
  (HA-6). Because `sig` sorts by its own bytes among the other keys (HA-8), its
  removal shifts no other key's position or bytes.

## 6. Worked example — a `genesis` event (hand-verifiable)

A complete, valid `genesis` event (seq 1). Its operator keypair is derived from
the 32-octet seed `0x01…01`, its registrar keypair from `0x02…02`; `chain_id`
is `sha256(operator_pk raw bytes)` (`event-types.md` ET-7). The `sig` is a real
Ed25519 signature by the operator key over the signing preimage, and it verifies.
Reproduce every digest below with any SHA-256 tool.

**The event (fields shown in canonical envelope order; `payload` keys in JSON as
authored):**

```json
{
  "seq": 1,
  "type": "genesis",
  "version": 1,
  "payload": {
    "chain_id": "34750f98bd59fcfc946da45aaabe933be154a4b5094e1c4abf42866505f3c97e",
    "contracts": "contracts-v1",
    "operator_pk": "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c",
    "registrar_pk": "8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394",
    "sig": "631d1b8001d674f4f9c2d04a9e7ff83b246a2d9ac10077b2095298777ed3c9055d7e5512c52604cb27b77076257a0ff8ced9fb156708d14f6b16b7769f305900"
  },
  "ts": "2026-07-21T00:00:00.000Z",
  "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a"
}
```

### 6.1 The signing preimage (payload without `sig`)

Payload keys sort by UTF-8 bytes (HA-8) to: `chain_id`, `contracts`,
`operator_pk`, `registrar_pk` (four keys — `sig` omitted, HA-15). Segments:

| segment                | bytes (hex)                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `DOMAIN`               | `4f444331`                                                              |
| `ENC_INT(seq=1)`       | `0000000000000001`                                                      |
| `ENC_STR("genesis")`   | `0000000000000007` + `67656e65736973`                                   |
| `ENC_INT(version=1)`   | `0000000000000001`                                                      |
| payload count = 4      | `0000000000000004`                                                      |
| tag `s` + key `chain_id` + value | `73` + `0000000000000008`+`636861696e5f6964` + `0000000000000040`+`3334…3937 65` |
| tag `s` + key `contracts` + value | `73` + `0000000000000009`+`636f6e7472616374 73` + `000000000000000c`+`636f6e7472616374 732d7631` |
| tag `s` + key `operator_pk` + value | `73` + `000000000000000b`+`6f70657261746f72 5f706b` + `0000000000000040`+`3861…3663` |
| tag `s` + key `registrar_pk` + value | `73` + `000000000000000c`+`7265676973747261 725f706b` + `0000000000000040`+`3831…3934` |
| `ENC_STR(ts)`          | `0000000000000018` + `323032362d30372d32 3154…2e3030305a`               |
| `ENC_STR(prev_hash)`   | `0000000000000040` + `3030…3030` (64 × `30`)                            |

The full signing preimage is **459 octets**; its SHA-256 is
`31a2a0dcf12cd82f1defb04362528e6bf0663058329a01323b87909b6fd47710`. (The digest
of the signing preimage is not itself used by the protocol — Ed25519 consumes
the 459 raw octets, HA-16 — it is given only so an implementer can confirm they
reconstructed the signing preimage exactly before checking `sig` against
`operator_pk`.)

### 6.2 The hash preimage (payload with `sig`) and `hash`

Insert `sig`; keys now sort to `chain_id`, `contracts`, `operator_pk`,
`registrar_pk`, `sig` (five keys — `sig` last, since `0x73 0x69…` sorts after
`0x72…`). The hash preimage is the signing preimage with the payload count
raised to `5` and one entry appended before `ts`:

```
73 000000000000000373 6967          # tag 's', ENC_STR("sig")
   0000000000000080 <128 hex chars of sig as ASCII>   # ENC_STR(sig): len 0x80 = 128
```

The full hash preimage is **607 octets**. Its complete hex is pinned as fixture
`001` in T5; its SHA-256 is:

```
78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a
```

which is the event's `hash` (HA-13). A verifier reaching this value from the
stored six content fields, and an Ed25519 check of `sig` over §6.1's bytes under
`operator_pk`, together accept the event's structure and signature.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                                   | Closed by       |
| --------------------------------------------------- | --------------- |
| Integer byte width / endianness / signedness        | HA-1, HA-4      |
| String encoding, BOM, Unicode normalization         | HA-2            |
| Framing: length-prefix vs delimiter                 | HA-3            |
| Duplicate payload keys                              | HA-6            |
| Payload key ordering                                | HA-8            |
| int `1` vs string `"1"` collision                   | HA-9            |
| Per-type field list vs generic payload rule         | HA-7 (generic)  |
| Field order in the preimage                         | HA-11           |
| Domain separation                                   | HA-10           |
| hex fields hashed as text vs decoded bytes          | HA-12           |
| Digest algorithm, output case                       | HA-13           |
| What `sig` covers; pre-hash before Ed25519 or not   | HA-15, HA-16    |
| Whether removing `sig` perturbs other keys          | HA-17           |

## Acid-test walkthrough

Two implementations, TypeScript and Go, given the `genesis` event of §6, each
build `PRE(E)` by: writing `DOMAIN`; `U64` of `seq` and `version`; length-
prefixed UTF-8 of `type`, `ts`, and `prev_hash` (as its 64-char hex **text**,
HA-12); and the payload as `U64(5)` followed by the five keys in UTF-8-byte
order, each as `tag || LP(key) || (U64(value) | LP(value))`. Both reach the
identical 607 octets and therefore the identical SHA-256
`78ed980b…f6409a`. Neither consults the `type` `genesis` to lay out the payload
— the same code hashes an event of any future type (ADR-0006). The only inputs
are the stored bytes; there is no normalization, no re-ordering, no repair (D5).
No preimage ambiguity remains.
