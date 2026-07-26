---
name: odc-keys-and-signatures
description: Ed25519 key handling, signing, and signature verification discipline for ODC. Use this skill whenever generating, storing, loading, or rotating a keypair; signing or verifying any event; writing signature fixtures; implementing the ledger's append-time signature check, identity's registrar key, or the web client's key storage; or reviewing any code that touches a private key, a `sig` field, or a `pubkey` field.
---

# ODC Keys & Signatures

`odc-contracts` owns the bytes that get hashed. This skill owns the bytes that
get **signed**, and the keys that sign them. Different failure mode: a hashing
mistake makes two implementations disagree loudly, a signature mistake makes
them disagree _on some inputs only_, or makes a key leak while every test
passes.

Contracts already pin the parts that are settled — read them, do not re-derive:
`hashing.md` HA-15–HA-17 (signing preimage, pure Ed25519, raw message not
pre-hashed), `event-schema.md` ES-29–ES-32, `event-types.md` ET-3–ET-5,
`ids.md` ID-3–ID-6, ADR-0002.

## 1. "Valid Ed25519 signature" is not one predicate — pin it, then prove it

RFC 8032 leaves verification edge cases underdetermined, and real libraries
have documented, deliberate disagreements about them:

- non-canonically encoded `R` or `A` (a `y` coordinate ≥ p, or the sign bit set
  on `x = 0`),
- small-order or mixed-order public keys, and small-order `R`,
- non-canonical `S` (`S ≥ L`) — most libraries reject, not all always did,
- cofactored (`[8][S]B = [8]R + [8][k]A`) vs cofactorless (`[S]B = R + [k]A`)
  verification.

A signature landing in one of these classes can verify under Go's
`crypto/ed25519` and fail under Node's `node:crypto`, or vice versa. For ODC
that is not a curiosity: it means the ledger appends an event the independent
verifier calls `INVALID`, or one verifier says `VALID` and another says
`INVALID` **on identical bytes**. That is precisely the failure the whole
two-language architecture exists to prevent, and it is the signature-side twin
of the canonical-JSON problem ADR-0003 already closed.

Rules:

- Apply the contracts acid test to signatures, not just to hashing: _could two
  conforming implementations disagree about whether this signature verifies?
  Then the spec is not done._ The answer must come from `contracts/`, not from
  whichever library a service happened to import.
- **Never** hand-roll, patch, or "harden" verification — no manual point
  decoding, no cofactor multiplication of your own, no extra checks bolted onto
  a stdlib call. The remedy for a divergence is a contracts sentence plus a
  fixture, never a local workaround.
- Anything an implementation rejects that another accepts needs a golden
  fixture with an asserted verdict, or the disagreement is invisible until
  production. Until the predicate is pinned, **do not commit a fixture whose
  verdict depends on any bullet above** — a wrong verdict is unfixable after
  the freeze (see the `RETIRED.md` entry in `memory/OPEN-QUESTIONS.md`).
- The cross-language gate in `odc-contracts` covers hashes. It is not passed
  until it also covers signatures: TS and Go must agree on accept **and**
  reject for every signature fixture.

## 2. Signing discipline

- Sign `SIGN_PRE(E)` (HA-15) and nothing else. Never sign a JSON string, a
  re-serialized line, a display form, or a SHA-256 of the preimage — Ed25519
  hashes its own input (HA-16). If you find yourself hashing before signing,
  you have built a second, unspecified scheme.
- The preimage carries `DOMAIN`, `seq`, `type`, `version`, `ts` and `prev_hash`
  (HA-11). Domain separation and replay resistance come from those fields being
  _in_ the signed bytes — so never sign a payload fragment, and never let a
  signature computed for one event be accepted for another `(seq, type)`.
- Verify **before** append, on every mutating path, and verify against the key
  the contract names for that type (ET-4/ET-5) — not against whatever key the
  request supplied. `genesis` self-verifies under its own `operator_pk`
  (ET-7); `issue_created` under the genesis-declared operator key;
  `participant_registered` under the `pubkey` it carries; `vote_cast` under
  `registrar_pk`.
- Compare digests, keys, and signatures as bytes for equality only. Never
  normalize case, never trim, never "repair" a near-match (D5).

## 3. Key custody

- One key, one holder, one purpose. `operator_pk` and `registrar_pk` are
  distinct keys with distinct custody (ET-7): the registrar key lives only in
  `identity` and never in `ledger`, and neither ever reaches `web`.
- Private keys never enter: git, fixtures, logs, metrics, error messages, test
  snapshots, PR descriptions, or an ORM. The one exception is a **published
  test seed** used by `contracts/` worked examples (the `0x01…01` /
  `0x02…02` genesis seeds) — those are public by construction and must never be
  reused for anything real.
- Load a key from exactly one configured source per service, resolved at
  startup, and fail closed at boot if it is absent or malformed — never lazily
  at first signature, never with a generated fallback. **Which source (file,
  env, KMS) is an unresolved open question** — see `memory/OPEN-QUESTIONS.md`;
  answer it in an ADR before the first Phase 1 key ships, don't decide it in a
  service PR.
- `participant_id` is `sha256(pubkey_bytes)` (ID-4), so a participant's key
  _is_ their identity: there is no rotation story, and a new key is a new
  person. Treat any proposed rotation as an architecture decision
  (`odc-architect`), never as a feature.
- Web-client keys are generated and stored client-side, invisibly (`odc-ui`);
  the server never receives or reconstructs one.

## 4. Signatures and receipt-freeness (charter §5, ADR-0004)

Signature plumbing is the most likely place to accidentally rebuild the receipt
that ADR-0004 deliberately removed.

- `vote_cast` is registrar-signed. There is no voter-held ballot key, and no
  code may introduce one — permanent per ET-22, not revisable by vote.
- Never return, display, log, or store a per-ballot artifact that binds a voter
  to a log line: no signature echo, no `seq`, no event `hash`, no "your vote is
  recorded as…" confirmation. A confirmation says that a vote was recorded, and
  nothing that identifies which line it is.
- Registrar signing necessarily sees `{who, issue, choice}` in v1 (trust by
  policy, charter §10). Keep that exposure at signing time only: it must not be
  persisted, logged, or emitted as a metric with enough fields to reconstruct
  the tuple.

## 5. Tests that must exist

- RFC 8032 test vectors for the raw primitive, so a broken key-encoding
  assumption fails before any event does.
- Round-trip: sign → append → export → independent verify → `VALID`.
- Negative, per signed type: wrong key, signature from a different event,
  truncated/over-long `sig`, uppercase hex `sig`, `sig` absent — each with the
  contract-mandated verdict, none merely "throws".
- Tamper: flip one bit of `sig` → `INVALID` at the right line (and note it
  breaks the chain too, ES-29 — assert the line, not the reason).
- Leak scan: no test may print a private key; identity's leak test
  (`odc-testing`) covers responses and log lines for key material too.
