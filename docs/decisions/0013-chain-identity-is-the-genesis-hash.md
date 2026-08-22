# ADR-0013: A chain's identity is its `genesis` event hash

- **Status:** accepted — amended in part by ADR-0019 (the "one genesis change
  this project gets" restated as a bar on the tag, not a count of keys)
- **Date:** 2026-08-15
- **Phase:** 0

## Context

T9 finding **F1** (`docs/security/audit-phase-0.md`), rated blocking. `chain_id`
is `sha256(operator_pk_bytes)` (ET-7) — a derivation the spec itself described as
having "no free parameter". It is therefore constant across every chain a given
operator ever starts, and nothing in `contracts/` requires a chain to be unique
per `chain_id`.

The auditor built the consequence rather than describing it: two complete chains
differing only in a one-millisecond `genesis` `ts`, reaching **opposite outcomes**
on the same question, carrying the **same** `chain_id`, both `VALID` under both
verifiers. Audience 1 is shown chain A, audience 2 chain B; each verifies, each
is told the chain's identity is `34750f98…`, and comparing that value teaches
them nothing. `--head` does not close it: a head names a **position**, and a
position is a position on some chain, so the operator anchors chain A and shows
chain B.

An independent assessment (recorded in `memory/OPEN-QUESTIONS.md`, Q-A) sharpened
this. Key-derived log identity is conventional — CT v1 (RFC 6962) defines LogID as
SHA-256 of the log's SubjectPublicKeyInfo, exactly our construction — but it is
conventional **under an invariant we do not have**: CT v2 (RFC 9162) states a log
MUST NOT share a keypair with any other log, and moved identity off the key
entirely; C2SP checkpoints give every log an `origin` line separate from its key.
The rule everywhere is one key, one log. We permit one key to start many chains,
and that is the actual defect. The same assessment established that prevention is
not achievable (SUNDR fork consistency: an untrusted server can always fork
clients; the goal is that forks be detectable and permanent), and that the
identifier's one future job — keying the anchoring and witnessing layer — is a
job `chain_id` as specified cannot do.

Unfixable after the freeze: ES-18 closes the `genesis` key set and ET-6 pins
`genesis.version` to 1, so no distinguishing field can be added later.

## Decision

**A chain's identity is the `hash` of its `genesis` event.** Three parts:

1. **`chain_id` is demoted to what it is** — a restatement of `operator_pk`, kept
   because it is cheap and occasionally convenient, but never an identity. ET-7's
   sentence "This binds the chain's identity to its operator key with no free
   parameter" was **false as written** (it binds the _operator's_ identity) and is
   replaced; the payload table's "the chain's stable identifier" was false for the
   same reason and is replaced. The derivation itself is unchanged — no byte, no
   hash and no existing fixture verdict moves.
2. **`event-types.md` ET-7a** states the identity normatively, including that a
   head does not identify a chain either.
3. **`export-format.md` EX-21–EX-24** give the verifier its half: the genesis
   hash is defined on the export (EX-21), `--chain <genesis-hash>` is an optional
   input whose mismatch is `INVALID` (EX-22) at line 1 (EX-23), and a verifier
   **MUST report the genesis hash and the head it computed on every run** (EX-24).

**No new `genesis` field.** The nonce option (`genesis_nonce`) is rejected: the
genesis hash already commits to `operator_pk`, `registrar_pk`, `contracts` and
`ts`, is unique per chain by construction, and costs no schema change — while a
nonce would spend the one genesis change this project gets, which ADR-0016 spends
on `ancestor_head` instead.

EX-24 is the part neither the audit nor the orchestration proposed, and it is the
cheapest of the three: a tool that answers only `VALID` is answering "is _some_
chain valid".

### What this does and does not buy

It does **not** prevent equivocation — nothing in a one-writer log can. It makes
the two chains **nameable**, which is the precondition for detection: an anchor
can now publish `(genesis_hash, head)`, a reader can compare the identity they
were given against the identity the verifier computed, and the two audiences in
the constructed attack now hold visibly different values. Anchoring itself (venue,
cadence, signed-checkpoint format, and the rule that a gap or regression in `seq`
is an alarm) is **not** in this ADR: it is a new artifact rather than an event
schema, it is safely addable after the freeze, and it is filed in
`memory/OPEN-QUESTIONS.md` Q-A. This ADR removes the reason it could not be built.

## Consequences

- **`contracts/`** — `event-types.md` (v7 → v8, shared with ADR-0014/0016/0018):
  ET-7 rewritten, ET-7a added, `chain_id` table row corrected.
  `export-format.md` (v2 → v3): §6 with EX-21–EX-24, plus rule-index and
  acid-test rows.
- **Owed fixtures (EV-5), not written in this pass.** The change adds no new event
  bytes, so no existing vector's bytes or verdict move. Owed:
  - a `--chain` **match** vector (`VALID`) and a `--chain` **mismatch** vector
    (`INVALID` at line 1, EX-23) — these are the first vectors that require the
    harness to pass an expected chain identity, exactly as `003-head-match` did
    for `--head`;
  - a **two-chain** pair under one operator key, differing only in `genesis.ts`,
    both `VALID` with no flags, each `INVALID` under the other's `--chain`. This
    is the audit's `chainA`/`chainB` demonstration promoted into
    `contracts/fixtures/` — it is the one vector that pins the finding rather than
    the fix. (The audit's own artifacts stay where they are; they are adversarial
    inputs, not conformance vectors, per `docs/security/attacks/README.md`.)
  - EX-24's reported values are deliberately **not** fixture-asserted (EV-17).
- **Owed verifier work, both verifiers, in their own isolated passes.** A
  `--chain <genesis-hash>` flag; the `INVALID`-at-line-1 mismatch verdict; and
  printing the computed genesis hash and head on every run. Neither is touched
  here — verifier independence is the point of building two.

### Documents reconciled

- `docs/charter.md` §4 — "The chain head is periodically published…" stated the
  anchoring practice without an identity to anchor to, which is the gap F1 turns
  on. Amended to publish the chain's identity **and** its head. **In this PR.**
- `docs/implementation-plan.md` §Services/`verifier` — the CLI line stated
  `verify <export.ndjson> [--head <hash>]`. Amended to carry `[--chain
<genesis-hash>]` and EX-24's reporting requirement. **In this PR.**
- `services/verifier/CLAUDE.md` — states the same CLI surface and is now
  incomplete in the same way. **NOT updated here, deliberately:** this pass is
  scoped to exclude both verifiers, whose independence is load-bearing. It is
  **owed to the verifier pass** and must be in that ticket's text, since the
  isolated builder reads that file as its interface contract. Named here so it
  cannot be lost — this is precisely the ADR-0004 failure mode this section
  exists to prevent.
- `tools/verifier-ts/` docs — same status, same reason, same owner.
- `docs/charter.md` §8, `services/ledger/CLAUDE.md`, `services/identity/CLAUDE.md`,
  `services/tally/CLAUDE.md` — checked; none states chain identity. No change.

## Charter check

- **P1 (the log is the only truth; trust comes from verifiability, not
  authority).** This is the ADR's whole subject. Under ET-7 a reader could verify
  a chain completely and still not know **which** chain they verified, so the
  verifiability was of an unnamed artifact — authority by another route, since
  only the operator knew how many chains existed. ET-7a and EX-24 make the
  answer computable by the reader.
- **P2/P3/P4.** Untouched. This changes no ballot, plane, tally or floor; it
  names the log.
- **Charter §4** ("a stranger can write an independent verifier in an afternoon"
  and "non-equivocation by anchoring") is served on both clauses: the stranger's
  verifier now reports something an anchor can be compared against, and the
  anchor finally has a thing to anchor to.
