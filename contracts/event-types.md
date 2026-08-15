# Event Types — contracts/event-types.md

**Version:** 8
**Status:** DRAFTING (Phase 0 · T3, amended T4a, T5i, T5j, ADR-0009, ADR-0010,
ADR-0011, and T9a/ADR-0013, ADR-0014, ADR-0016, ADR-0018). Not frozen.
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
- **ET-2a.** **"Reject" in ET-1 and ET-2 is refined by `evolution.md` EV-9.** A
  *well-formed* (`event-schema.md` ES-10) `type` or `(type, version)` outside this
  registry yields the per-event `PARTIAL` treatment of EV-7/EV-8 — Stage A still
  confirms the event's hash and chain position; only its type-specific semantics
  go unchecked. A frozen verifier therefore does **not** condemn a chain that has
  legally grown past it (charter §8, P1). Only a malformed `type` or a Stage A
  failure is structurally `INVALID`; a malformed payload is `INVALID` even on an
  unregistered type (EV-16). **One position is exempt from all of this: an
  unregistered `(genesis, version)` at line 1 is `INVALID`** (`evolution.md`
  EV-20), because `genesis` is the only event whose payload a verifier must read
  in order to check any other event.

---

## Signing model (applies to signed types below)

- **ET-3.** A **signed** event carries a `sig` field in its payload: an Ed25519
  signature as 128 lowercase hex characters (`event-schema.md` ES-31).
- **ET-4.** `sig` MUST be a valid Ed25519 signature, under the event's
  **signing key** (named per type below), over the event's **signing preimage** —
  the hash preimage with the `sig` key omitted from `payload`
  (`event-schema.md` ES-32; bytes in `hashing.md`, T4).
- **ET-4a.** _Canonical `sig` encoding._ RFC 8032 leaves the Ed25519
  verification predicate underdetermined for non-canonically encoded inputs, and
  the two v1 verifiers' standard libraries need not agree on such inputs; v1
  makes that divergence **unreachable** by rejecting the non-canonical encodings
  **before** the Ed25519 verification primitive (ET-5) is ever called, exactly as
  ET-14a caps `choice_count` rather than reasoning about large values (ADR-0009).
  Let `L = 2^252 + 27742317777372353535851937790883648493` (the order of the
  Ed25519 prime-order subgroup) and `p = 2^255 − 19` (the field prime). Given the
  64 octets obtained by hex-decoding `sig` (which ES-31 fixes at 128 lowercase
  hex) as `R = sig[0..32)` followed by `S = sig[32..64)`, a verifier MUST reject
  the event (`INVALID`) — never reducing, masking-and-accepting, or otherwise
  repairing the value (D5) — unless **both** of these hold on the raw decoded
  bytes:
  - **(i) canonical `S`:** the 32 octets of `S`, interpreted as an unsigned
    little-endian integer, are strictly `< L`;
  - **(ii) canonical `R`:** the 32 octets of `R`, with bit 255 (the encoded
    x-coordinate sign bit — the most-significant bit of octet 31) cleared and the
    remainder interpreted as an unsigned little-endian integer, are strictly
    `< p`.

  This is an **additional** check beyond ES-31's hex format and beyond ET-5's
  verification (`hashing.md` HA-16): a `sig` that is 128 lowercase hex, and would
  even verify under some predicates, can still decode to a non-canonical `R` or
  `S`, so the format is necessary but not sufficient.
- **ET-4b.** _Canonical verification-key encoding._ The same underdetermination
  affects the verification key. For **every** verification key `A` that a
  verifier hex-decodes — `operator_pk` (ET-8, ET-13), `registrar_pk` (ET-17, but
  validated at its genesis declaration per ET-9c), and
  `participant_registered.pubkey` (ET-10) — a verifier MUST reject the event
  (`INVALID`), never repairing the value (D5), unless the 32 decoded octets of
  `A`, with bit 255 (the most-significant bit of octet 31) cleared and the
  remainder interpreted as an unsigned little-endian integer, are strictly `< p`
  (`p = 2^255 − 19`). This check runs on the raw decoded key octets **before** the
  verification primitive (ET-5), and it is **additional** to the lowercase-hex
  format fixed by ES-31, ET-9b, and `ids.md` ID-3 (keys are hashed as their hex
  text, `hashing.md` HA-12): a key that is 64 lowercase hex (necessary) can still
  decode to a non-canonical point encoding (not sufficient). A non-canonical `A`
  is the one case where both reference standard libraries otherwise proceed to
  verify — the identity point encoded as `y = 1 + p` accepts a degenerate
  self-signature, so a verifier that omits ET-4b **accepts** an event it must
  reject (ADR-0009; fixture `078`).

  > **Note (informative — imposes no new MUST).** The verification predicate v1
  > assumes is **cofactorless**: `[S]B = R + [k]A` with
  > `k = SHA-512(R‖A‖M) mod L` (RFC 8032 §5.1.7, without the cofactor-8
  > multiplication of the permissive batch equation). Both standard libraries the
  > v1 verifiers are built on — Go `crypto/ed25519` (1.24.7) and Node
  > `node:crypto` (v22, OpenSSL 3) — satisfy this, so no explicit cofactor rule is
  > stated. A full **prime-order subgroup** check on `A` **is** required in v1 —
  > see **ET-4c** below. When ET-4a/ET-4b first landed, that check was
  > deliberately excluded (ADR-0009), for two reasons: measurement found no
  > divergence it would close, and it needs curve scalar multiplication outside
  > both standard libraries. **ADR-0010 reverses that exclusion** — a later
  > measurement resolved both blockers — so the requirement now lives in ET-4c and
  > the stdlib-only constraint is relaxed to permit one audited curve library for
  > that check alone. The cofactorless assumption above is unaffected. This
  > assessment is **version-bound**; the T10 re-audit re-measures.
- **ET-4c.** _Prime-order verification key._ Let `A` be the point obtained by
  decoding a verification key's **already-canonical** encoding — i.e. after ET-4b
  has passed on its raw bytes. For **every** verification key `A` a verifier
  decodes — `operator_pk` (ET-8, ET-13), `registrar_pk` (ET-17, but
  validated at its genesis declaration per ET-9c), and
  `participant_registered.pubkey` (ET-10) — a verifier MUST reject the event
  (`INVALID`), never repairing the value (D5), **unless `A` lies in the
  prime-order subgroup**:

  > `[L]A == 𝒪` (the identity point) **AND** `A != 𝒪`

  where `L = 2^252 + 27742317777372353535851937790883648493` is the subgroup
  order and `𝒪` is the group identity. Equivalently, `[L]A == 𝒪 AND [8]A != 𝒪`.
  This rejects **all** small-order keys (including the identity, whose canonical
  encoding is `0100000000000000000000000000000000000000000000000000000000000000`)
  **and all** mixed-order keys (a point `A = P + T` with `P` in the prime-order
  subgroup and `T` a non-trivial torsion component).

  ET-4c runs **on the canonical point, after ET-4a/ET-4b**: a key must first
  decode to a canonical point encoding (ET-4b) before its subgroup membership is
  even defined. It is an **additional** check beyond ET-4b: a canonically-encoded
  key can still be small-order or mixed-order — such a key **passes** ET-4b (its
  `y` is `< p`) and is caught **only here** (fixtures `081`, `082`). It is also
  additional to ET-5's signature verification: a small-order or mixed-order key
  can carry a `sig` that **verifies** under it — the degenerate identity
  self-signature verifies under the identity key, and a mixed-order key
  `A = P + T` self-signed honestly under `P` with the challenge ground to
  `k ≡ 0 (mod 8)` verifies under `A` because `[k]T = 𝒪` — so a verifier that
  omits ET-4c **accepts** an event it must reject (ADR-0010).

  Unlike ET-4a/ET-4b, ET-4c is **exact curve arithmetic**, not an
  RFC-8032-underdetermined case: the two v1 verifiers agree on it by construction
  rather than by measured coincidence, so it is more version-stable. But it
  requires curve scalar multiplication that is in **neither** verifier's standard
  library, so v1 relaxes the stdlib-only constraint to permit **one audited curve
  library per verifier, used ONLY for this subgroup check** (`filippo.io/edwards25519`
  for the Go verifier, `@noble/curves` for the TypeScript verifier; ADR-0010).

  > **Note (informative).** A verifier built on `@noble/curves` satisfies ET-4c
  > with `A.isTorsionFree() && !A.is0()`; one built on `filippo.io/edwards25519`
  > with `[L]A == 𝒪 && A != 𝒪` (its `ScalarMultBase`/`ScalarMult` compute `[L]A`).
  > These compute the **identical** decision on every measured point — but only
  > with the explicit non-identity clause: `@noble/curves`' `isTorsionFree()`
  > returns **true** for the identity key, which ET-4c must reject, so
  > `isTorsionFree()` **alone** is not ET-4c. Do not phrase the check as bare
  > "torsion-free"; the `A != 𝒪` clause is load-bearing (fixture `081`).
- **ET-5.** A verifier MUST reject a signed event whose `sig` does not verify
  under the signing key named for its type. The canonical-encoding checks ET-4a
  and ET-4b, then the prime-order check ET-4c, run first, on the decoded key /
  signature bytes, so a non-canonical `R`, `S`, or `A`, or a small-order or
  mixed-order `A`, is rejected there and never reaches this verification step.

---

## `genesis` (signed by the operator key)

The mandatory first event (`event-schema.md` ES-33). It anchors the chain and
declares the operator key that later `issue_created` events are signed with.

| key            | type   | constraint                                                          |
| -------------- | ------ | ------------------------------------------------------------------- |
| `chain_id`     | string | `^[0-9a-f]{64}$` — a restatement of `operator_pk`, NOT the chain's identity (ET-7, ET-7a) |
| `contracts`    | string | the frozen contracts version this chain runs, e.g. `"contracts-v1"` |
| `operator_pk`  | string | `^[0-9a-f]{64}$` — operator Ed25519 public key (32 bytes, hex)       |
| `registrar_pk` | string | `^[0-9a-f]{64}$` — registrar Ed25519 public key (32 bytes, hex)      |
| `sig`          | string | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)                         |

- **ET-6.** `genesis.version` MUST be `1`, `seq` MUST be `1`, and `prev_hash`
  MUST be the 64-zero anchor (`event-schema.md` ES-24, ES-33).
- **ET-7.** `chain_id` MUST equal the `participant_id`-style derivation
  `sha256(operator_pk_bytes)` in lowercase hex (same construction as `ids.md`
  ID-4/ID-5 applied to `operator_pk`). It **restates the operator key**; it does
  not identify the chain. The derivation has no free parameter, so every chain a
  given operator ever starts carries the **same** `chain_id`, and two different
  chains under one operator key are indistinguishable by it. What identifies a
  chain is **ET-7a**. `chain_id` derives from `operator_pk` alone; `registrar_pk`
  does not enter it.
- **ET-7a.** _Chain identity._ A chain's identity is the `hash` of its `genesis`
  event (`event-schema.md` ES-27) — the **genesis hash** of `export-format.md`
  EX-21. Two exports are exports of the same chain exactly when their genesis
  hashes are equal. Wherever a chain must be named — an anchor or witness record
  (charter §4), a verifier invocation (EX-22), a fork's `ancestor_head` (ET-9e) —
  the genesis hash is the name, and `chain_id` MUST NOT be used as one (ET-7).
  The genesis hash covers every content field of the genesis event, including
  `ts`, so two chains an operator starts one millisecond apart have different
  identities even though their `chain_id`, `operator_pk` and `registrar_pk` are
  identical. A `head` does **not** identify a chain either: it names a position,
  and a position is a position **on** some chain (EX-14, EX-21) — which is why
  anchoring the head alone cannot deliver charter §4's non-equivocation
  (ADR-0013).
- **ET-8.** The `genesis` signing key is `operator_pk` (the event is
  self-signed by the key it declares). A verifier MUST reject a `genesis` whose
  `sig` does not verify under its own `operator_pk`.
- **ET-9.** `contracts` MUST be a non-empty string; it is advisory provenance
  and is covered by `hash` but places no further constraint on verification in
  v1.
- **ET-9a.** `registrar_pk` declares the key under which `vote_cast` events on
  this chain are signed (ET-17). The contract imposes no relation between
  `registrar_pk` and `operator_pk`. Operationally they SHOULD be distinct keys:
  the registrar key is held only by the identity service (which admits ballots),
  and the identity service MUST NOT hold `operator_pk` (which creates issues) —
  separating "who may vote" from "who sets the questions" (charter §P2, §P3).
  This separation is policy, not verifier-enforced.
- **ET-9b.** `operator_pk` and `registrar_pk` MUST each be a 32-byte raw Ed25519
  public key (RFC 8032), carried as a string of exactly 64 lowercase hexadecimal
  characters matching `^[0-9a-f]{64}$` — the same key format `ids.md` ID-3 fixes
  for `participant_registered.pubkey`. An uppercase or mixed-case key MUST be
  rejected; it is never lowercased to conform (D5). This is a **distinct check**
  from ET-7 and ET-8: an uppercase key hex-decodes to the same 32 bytes, so
  `chain_id` still derives (ET-7) and the genesis self-signature still verifies
  (ET-8). A verifier that omits this format check therefore accepts a `genesis`
  that ET-9b requires it to reject, with nothing else on the line to signal the
  fault.
- **ET-9c.** _Genesis key-validation timing._ The canonical-encoding check ET-4b
  and the prime-order check ET-4c apply to `operator_pk` and `registrar_pk` **at
  the `genesis` line where each is declared** (ET-9a), on the raw decoded key
  octets — **not** deferred to a key's first later use to verify a signature
  (`operator_pk` at ET-13, `registrar_pk` at ET-17). A `genesis` whose
  `operator_pk` or `registrar_pk` decodes to a non-canonical point (ET-4b) or to
  a small-order or mixed-order key (ET-4c) is therefore `INVALID` **at the
  `genesis` line**, on **any** chain — including one that carries no `vote_cast`
  and so never exercises `registrar_pk` at ET-17. This is a distinct requirement
  only for `registrar_pk`: `operator_pk` is already used to verify the genesis
  self-signature on this same line (ET-8), whereas `registrar_pk` is declared here
  but first _used_ only at a later `vote_cast`, so without this rule a verifier
  could defer its ET-4b/ET-4c checks and accept a `genesis` that declares an
  illegitimate registrar key. ET-4c exists precisely so key legitimacy is
  verifiable from the log itself (ADR-0010), and ET-9b already checks
  `registrar_pk`'s _format_ at genesis; ET-9c fixes that the encoding and
  subgroup checks are applied at the same point. Two conforming verifiers would
  otherwise diverge here — on the **verdict** (a no-`vote_cast` chain: `INVALID`
  at line 1 vs `VALID`) or the **line** (a voting chain: line 1 vs the
  `vote_cast` line) — the one place they could disagree by construction rather
  than by coincidence (fixture `083`; ADR-0011).

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

| key                        | type    | constraint                                                            |
| -------------------------- | ------- | --------------------------------------------------------------------- |
| `title`                    | string  | 1–200 Unicode scalar values; MUST NOT contain U+0000–U+001F or U+007F |
| `choice_count`             | integer | `2 ≤ choice_count ≤ 64` — the number of valid ballot choices          |
| `ballot_batch_interval_ms` | integer | `≥ 60000` — this issue's ballot batch interval, in ms (ET-14b, ET-23) |
| `ballot_batch_min`         | integer | `≥ 3` — this issue's minimum ballot batch size (ET-14b, ET-24)        |
| `sig`                      | string  | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)                          |

- **ET-13.** The `issue_created` signing key is the chain's `operator_pk` from
  the `genesis` event. A verifier MUST reject an `issue_created` whose `sig`
  does not verify under `operator_pk`.
- **ET-14.** `title` MUST be present and 1–200 Unicode scalar values in length,
  and MUST NOT contain any C0 control character (U+0000–U+001F) or U+007F. No
  other payload field is permitted beyond those in the table
  (`event-schema.md` ES-18).
- **ET-14a.** `choice_count` MUST be an integer with `2 ≤ choice_count ≤ 64`. It
  fixes the valid range of `vote_cast.choice` for this issue (ET-18a). The upper
  bound is a drafting decision: an unbounded or very large choice domain would
  re-open a covert receipt channel — a coercer could demand a unique large
  integer as a per-voter marker (charter §5; ADR-0004). A verifier MUST reject
  an `issue_created` whose `choice_count` is out of range.
- **ET-14b.** _Ballot batching parameters._ An `issue_created` payload MUST carry
  both `ballot_batch_interval_ms` and `ballot_batch_min`, each a JSON integer in
  the canonical form of `event-schema.md` ES-5. They declare **on the log** the two
  values this issue's ballot publication discipline (ET-23–ET-25) is checked
  against, so that a reader checks a ledger's ballot timing against numbers the
  ledger published in advance rather than against numbers a verifier hard-codes,
  and so that a community can change them by the mechanism it changes everything
  else — a vote. A verifier MUST reject an `issue_created` whose values fall below
  the permanent floors:
  - `ballot_batch_interval_ms` MUST be **≥ 60000** (one minute);
  - `ballot_batch_min` MUST be **≥ 3**.

  **What is permanent and what is votable.** The batching mechanism (ET-23–ET-25)
  and the *existence* of a floor on each parameter are **permanent**, in the
  register of ET-22 and `evolution.md` EV-13: no future contracts version and no
  community vote may remove them. Without a floor "governable" would mean an
  operator declaring `1` and `1`, which satisfies every sentence of this spec while
  publishing each ballot alone, in arrival order, at millisecond resolution — the
  mechanism made decorative by configuration. The **values above the floor are
  per-issue and votable**, which is why they live in the payload and not in this
  spec. This is exactly the cut ET-14a already draws for `choice_count`: *that a
  bound exists at all* is permanent, *the number* is a drafting decision. The two
  floor numbers are drafting decisions recorded in ADR-0014; a later
  `issue_created` version may raise them, and may never lower them to where the
  rule stops binding.

  > **Note (informative — imposes no requirement).** A **quorum** — a minimum
  > turnout below which an issue publishes no ballots at all — is deliberately
  > **not** a v1 parameter, and these two do not provide one. Batching addresses
  > *timing* correlation (ET-23–ET-25). Small-turnout exposure is *arithmetic* on
  > the tally — five ballots at 3–2 with four choices known reveals the fifth, a
  > unanimous batch reveals everyone — and no interval, batch size or shuffle
  > touches it. A `min_turnout` key is a Phase 1 `issue_created` **version 2**
  > concern, which `evolution.md` EV-1/EV-2 keep additive at any time because only
  > `genesis` is version-pinned (ET-6). Recorded here so that batching is never
  > later mistaken for having solved turnout exposure.
- **ET-15.** The issue's `issue_id` is this event's `hash` (`ids.md` ID-7); it
  is not stored in the payload.
- **ET-16.** `title` string bytes are hashed as-is (UTF-8, no normalization);
  see `hashing.md` (T4) for the string-encoding rule. Two titles that are
  visually equal but differently encoded are different events.

## `vote_cast` (registrar-signed)

Records one ballot on one issue. Per ADR-0004 the voter holds NO on-log key: a
voter-held per-ballot key is a demandable receipt (charter §5/§8). The ballot is
signed by the **registrar** (the identity service), which admits it after an
off-log eligibility check.

| key        | type    | constraint                                                          |
| ---------- | ------- | ------------------------------------------------------------------- |
| `issue_id` | string  | `^[0-9a-f]{64}$` — `hash` of a prior `issue_created` (`ids.md` ID-8) |
| `choice`   | integer | `0 ≤ choice < choice_count` of the referenced issue (ET-18a, ET-19) |
| `sig`      | string  | `^[0-9a-f]{128}$` — Ed25519 signature (ET-4)                         |

- **ET-17.** The `vote_cast` signing key is the chain's `registrar_pk` from the
  `genesis` event (ET-9a). A verifier MUST reject a `vote_cast` whose `sig` does
  not verify under `registrar_pk`. The ballot carries no voter-held key.
- **ET-18.** `issue_id` MUST reference a prior `issue_created` event per
  `ids.md` ID-8; a verifier MUST reject a vote for an unknown or forward issue.
- **ET-18a.** `choice` MUST satisfy `0 ≤ choice < choice_count`, where
  `choice_count` is that of the `issue_created` event referenced by `issue_id`
  (ET-14a). A verifier MUST reject an out-of-range `choice`; it already tracks
  each issue's `hash` for ID-8, and tracks the issue's `choice_count` alongside.
- **ET-19.** `choice` MUST be a JSON integer. Within its valid range the
  contract records the integer verbatim and assigns it no meaning: interpreting
  choices into a result is a derived-view act of the tally engine, never of the
  log (charter §P3 — the platform characterizes, it never weighs). Richer ballot
  shapes (e.g. ranked lists) are a future additive `vote_cast` version — subject
  to ET-22 — not a v1 field.

### Boundary — what `vote_cast` does and does not guarantee (per ADR-0004)

- **ET-20.** In v1 the log verifies a vote's **structural integrity** (hash
  chain, ES-25/ES-28), its **admission** (a valid `registrar_pk` signature,
  ET-17), and that its `choice` is **in range** (ET-18a). It does NOT, by
  itself, enforce ballot **eligibility** (that the voter was entitled) or
  **uniqueness** (one ballot per human per issue): those are registrar policy,
  checked off-log before the registrar signs (charter §P2, §5, §10). A malicious
  registrar could stuff or drop ballots — v1 accepts this trust-by-policy
  posture (charter §10 v1); identity v2 hardens it.
- **ET-21.** The ballot carries **no voter fingerprint** — no `participant_id`,
  no voter-held key, nothing a voter retains that binds them to a log line.
  Receipt-freeness therefore holds structurally (charter §5/§8): "that ballot is
  mine" is unfalsifiable, so it cannot be demanded or sold. Two votes by the
  same voter also share no field, so ballots are unlinkable to one another
  on-log. **Residuals (per ADR-0004):** the registrar necessarily sees
  `{voter, issue, choice}` at admission time in v1 — trust-by-policy, removed by
  blind-signature credentials in identity v2 (charter §10 v2, §11); and there is
  deliberately **no voter-provable inclusion** proof, since any identity-bound
  inclusion proof would itself be a receipt. Phase-1 identity obligations are in
  `memory/OPEN-QUESTIONS.md`.

  **Residual addressed by ET-23–ET-25: timing correlation.** ET-21 is correct
  about what it claims — the voter retains no artifact — and was incomplete about
  what receipt-freeness requires, because coercion does not need the voter to
  retain anything; it needs the **coercer** to be able to check. With `ts` at
  mandatory millisecond precision (ES-20), `seq` in arrival order (ES-8), `choice`
  in the clear, and an unauthenticated tail-pollable read surface (`read-api.md`
  RA-12/RA-13), an observer who knows *when* a person voted reads *what* they
  voted, holding the proof themselves. The ballot publication discipline below is
  the rule that addresses that residual (ADR-0014).

  **Residuals it does not close.** Two remain, and neither is a timing problem:
  the registrar chooses 64 published, permanent signature bytes per ballot and can
  encode a voter identifier in them undetectably (`memory/OPEN-QUESTIONS.md` Q-F);
  and a `participant_registered` line adjacent in `seq` to a ballot still
  correlates the two planes by position, even once the ballot's `ts` no longer
  confirms the minute.
- **ET-22.** _Permanent evolution constraint (binds `evolution.md`, T4)._ No
  future version of `vote_cast` MAY introduce a voter-held public key, a
  signature produced by a voter-held key, or an unbounded voter-chosen value
  into the ballot payload. Each of these re-creates a demandable receipt and
  would violate charter §5/§8, which are non-negotiable and survive any future
  community vote (§8).

### Ballot publication discipline (per ADR-0014)

Three producer rules, checked against the parameters the issue itself declared
(ET-14b). They constrain the **value** of a ballot's `ts` and the **grouping** of
ballot appends; they change no wire format, no payload key, and no hashing rule.
Two of the three are verifiable from the export; the third is not, and says so.

- **ET-23.** _Quantized ballot `ts`._ A `vote_cast` event's `ts` MUST be an exact
  multiple of its issue's `ballot_batch_interval_ms` (ET-14b), measured in
  milliseconds since `1970-01-01T00:00:00.000Z`. That offset is computed on the
  proleptic Gregorian calendar with exactly `86400000` milliseconds in every day
  and **no** leap seconds — ES-20 already rejects a `60` in the seconds field, so
  the conversion is a pure calendar computation that both target languages perform
  identically. A ballot's quantized `ts` is its **batch instant**. A verifier MUST
  reject a `vote_cast` whose `ts` is not so quantized; the issue's interval is
  read from the `issue_created` event named by `issue_id` (ET-18), which a
  verifier already tracks. This is the one rule that constrains the value of `ts`;
  `ts` remains barred from ordering or selecting anything (`event-schema.md`
  ES-21).
- **ET-24.** _Minimum batch size._ A **batch** is the set of all `vote_cast`
  events on a chain sharing both an `issue_id` and a `ts` — the ballots of one
  issue at one batch instant (ET-23). Every batch MUST contain at least that
  issue's `ballot_batch_min` ballots (ET-14b), **except** the batch containing the
  issue's highest-`seq` ballot, which MAY be smaller: an issue that closes before
  its final batch fills must still publish the ballots it has. A verifier MUST
  reject a chain in which any other batch of an issue is under-size. At most one
  under-size batch per issue is therefore legal, and only as that issue's last.
  Membership and lastness are decided by `seq` (ES-8), never by comparing `ts`
  values.

  _Line attribution (`evolution.md` EV-17)._ An under-size batch is not a
  violation where it appears — it becomes one only when a later ballot of the same
  issue proves it was not the last. The fatal line is therefore the **first
  `vote_cast` of that issue appended after the under-size batch**, which is the
  line at which the chain first violates this rule and the line a verifier
  scanning in file order reaches first. Two consequences are worth stating rather
  than discovering: a ledger that publishes an under-size batch and then keeps
  appending ballots for that issue has broken this rule and the export shows it
  (detection working, not a past line's legality changing); and end-truncation can
  hide a violation by making a mid-chain under-size batch the last one for its
  issue — the same residual EX-16 already documents for everything at the end of a
  chain, with the same remedy, `--head`.
- **ET-25.** _Order within a batch._ The order in which a batch's ballots are
  appended MUST be independent of the order in which they arrived; a producer MUST
  NOT append a batch in arrival order. Any order that does not derive from arrival
  — a shuffle, or an order computed from ballot content — satisfies this.
  **This rule is not verifiable from the log.** A shuffled batch and an
  arrival-ordered batch are indistinguishable to every reader, so no verifier can
  report a violation and no fixture can pin one: ET-25 is an obligation on the
  ledger implementation and on nothing else, and it belongs to neither
  verification stage (`evolution.md` EV-15). It is stated normatively anyway,
  because a rule the log cannot enforce is still a rule the implementation owes,
  and because without it a conforming ledger could publish batches in `seq` order
  and hand a coercer back exactly the arrival ordering ET-23 removed from `ts`.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                              | Closed by         |
| ---------------------------------------------- | ----------------- |
| The exact set of v1 types                      | ET-1              |
| Which version each type is defined at          | ET-2              |
| How signatures are carried / what they cover   | ET-3, ET-4        |
| Canonical `sig` encoding (`S < L`, `R < p`)    | ET-4a             |
| Canonical verification-key encoding (`A < p`)  | ET-4b             |
| Prime-order verification key (`[L]A==𝒪`, `A!=𝒪`) | ET-4c           |
| Genesis fields, seq/prev_hash, self-signing    | ET-6, ET-7, ET-8  |
| `chain_id` derivation (operator key only)      | ET-7              |
| What identifies a chain (the genesis hash)     | ET-7a             |
| Two genesis keys: operator vs registrar        | ET-9a             |
| Genesis key format (operator/registrar pk)     | ET-9b             |
| Genesis key validation timing (at declaration) | ET-9c             |
| participant self-signing + id derivation       | ET-10, ET-11      |
| Title length + forbidden characters            | ET-14             |
| `choice_count` range                           | ET-14a            |
| Ballot batch parameters + their floors         | ET-14b            |
| Title normalization (none)                     | ET-16             |
| Issue id source                                | ET-15             |
| Vote signing key (registrar) + issue direction | ET-17, ET-18      |
| `choice` type, range, and who interprets it    | ET-18a, ET-19     |
| What the log does/does not enforce for ballots | ET-20, ET-21      |
| What future `vote_cast` versions may not do    | ET-22             |
| Ballot `ts` quantization (the batch instant)   | ET-23             |
| What a batch is; minimum size; blamed line     | ET-24             |
| Order within a batch (producer-only, uncheckable) | ET-25          |

## Acid-test walkthrough

Given the same four events, two implementations agree on: the legal type set
(ET-1); that every `sig` is 128 hex and verified under the type's named key —
`operator_pk` for genesis/issue, own `pubkey` for participant, `registrar_pk`
for vote (ET-8/10/13/17); that the chain they just verified is named by its
`genesis` hash and **not** by `chain_id`, so two chains under one operator key
are two chains (ET-7/ET-7a); that a `sig` whose decoded `R`/`S`, or a verification
key whose decoded bytes, are non-canonically encoded is rejected on the raw
bytes before verification (ET-4a/ET-4b), and that a verification key which is
canonically encoded but small-order or mixed-order — so it passes ET-4b and even
carries a `sig` that verifies under it — is rejected by the prime-order check
(ET-4c); that a `genesis` whose `operator_pk` or `registrar_pk`
is not 64 lowercase hex is rejected even though an uppercase key's bytes would
still derive `chain_id` and verify the self-signature (ET-9b); that a `genesis`
whose `registrar_pk` is canonically encoded but small-order or mixed-order is
rejected at the `genesis` line where the key is declared, even on a chain with
no `vote_cast` that never uses it (ET-9c); that a `title`
over 200 scalars or with a control character is rejected (ET-14); that an `issue_created` with `choice_count`
outside 2–64 is rejected (ET-14a); that an `issue_created` declaring a batch
interval under 60000 ms or a batch minimum under 3 is rejected (ET-14b); that a
vote for a not-yet-created issue, or
with `choice` outside `[0, choice_count)`, is rejected (ET-18, ET-18a); that a
ballot whose `ts` is not a multiple of its issue's declared interval is rejected
(ET-23), and that an under-size batch is rejected at the first later ballot of
the same issue, never at the batch itself (ET-24); and that
`choice` is otherwise an opaque integer (ET-19). They also agree that ET-25's
shuffle cannot be checked by either of them, which is why it is stated as a
producer obligation rather than a verifier check. The only undecided bytes are
the signing/hash preimage layout — deferred to `hashing.md` (T4). No type-level
ambiguity remains
in this spec's scope.
