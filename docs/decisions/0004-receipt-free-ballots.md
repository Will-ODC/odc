# ADR-0004: Receipt-free v1 ballots — registrar-signed `vote_cast`, no voter-held ballot key

- **Status:** accepted
- **Date:** 2026-07-21
- **Phase:** 0

## Context

The T3 draft of `contracts/event-types.md` (ET-17/ET-20/ET-21) recorded a
ballot as payload `{ issue_id, ballot_pk, choice, sig }`, with `sig` produced
by the **voter-held** private key behind `ballot_pk`, published on the public
append-only log. Fresh-context review raised a blocking finding: **a
voter-held per-ballot signing key is itself a receipt.** A coercer or vote
buyer demands "sign this fresh challenge with the key behind the `ballot_pk`
next to `choice = X`," and the voter can prove — voluntarily or under duress —
exactly how they voted.

Charter §5 is explicit: "No one can prove how they voted, even voluntarily. A
disclosure option that exists can be demanded." §8 makes receipt-freeness
"non-negotiable … guaranteed structurally, not by policy." §11 defers only
coercion-resistance _beyond_ receipt-free design — receipt-free design itself
is v1 scope. The draft's ET-21 flag defended the linkage-to-public-identity
dimension but missed the proving-your-own-ballot dimension.

The Phase 0 plan's T3 ticket text says "`vote_cast` (signed)," so this was a
plan-vs-charter tension, not merely a drafting error. Per `CLAUDE.md`, the
charter wins; this ADR is the architect adjudication.

A key observation drives the decision: **the voter-held ballot key bought
nothing real in v1.** The draft already conceded (ET-20) that the log enforces
neither eligibility, nor one-human-one-vote, nor unlinkability — all were
identity-service policy, off-log, because ballot keys would have been issued
by the identity service anyway. The scheme's only v1-real effects were
negative: a demandable receipt, plus on-log linkability of one voter's votes
to each other across issues. Removing the voter key therefore loses no v1
guarantee and restores the charter property.

## Decision

**1. `vote_cast` carries no voter-held key and no voter-produced signature.**
Payload becomes `{ issue_id, choice, sig }`. `ballot_pk` is removed. `sig` is
an Ed25519 signature (D2) by the **ballot registrar key**, produced when the
identity service has checked eligibility (verified personhood, not already
voted on this issue) and submits the ballot for append. The signature covers
the standard signing preimage (ADR-0003; `event-schema.md` ES-32), so it binds
the ballot to its chain position like every other signed event.

**2. The `genesis` payload declares `registrar_pk`** (same form as
`operator_pk`: 32-byte Ed25519 key, 64 lowercase hex) alongside `operator_pk`.
The `vote_cast` signing key is `registrar_pk`, exactly as the `issue_created`
signing key is `operator_pk`. No normative relation between the two keys is
imposed by the contract, but operationally they SHOULD be distinct and held by
different services (identity signs ballots; the ledger operator creates
issues) — the identity service must never hold the issue-creation key.
`chain_id` derivation (ET-7) stays bound to `operator_pk` alone.

**3. The choice domain is bounded, closing the tagging channel.**
`issue_created` gains `choice_count` (JSON integer, `2 ≤ choice_count ≤ 64` —
drafting decision), and a `vote_cast` is valid only if
`0 ≤ choice < choice_count` for the referenced issue, verifier-checked. This
is required for the fix to be coherent: with `choice` an unbounded integer, a
coercer demands "cast choice = ⟨unique nonce⟩" and the log itself becomes a
deterministic receipt. Bounding the domain to the issue's actual options
reduces the covert channel to ordinary plaintext-tally statistics (see honest
limits, below). The contract still assigns `choice` no meaning (P3);
`choice_count` characterizes the ballot format, it weighs nothing.

**4. Permanent evolution constraint.** No future `vote_cast` version may
introduce a voter-held public key, a signature produced by a voter-held key,
or an unbounded voter-chosen value into the ballot payload. Receipt-freeness
is structural and permanent (§5, §8); future cryptographic upgrades (blind
signatures, ZK eligibility, §11) must _strengthen_ it, never trade it away.
This is recorded as a normative sentence in `event-types.md`, so it survives
into the frozen contract and binds `evolution.md` (T4).

**Why this is receipt-free:** the voter holds no secret that binds them to any
log entry. Pointing at a line and saying "that one is mine" is an
unfalsifiable claim — any voter who voted the same way can point at the same
line — so no transferable proof of an individual ballot exists. That is
precisely §8's "no sellable artifact of an individual vote can exist," on the
voter's side, achieved structurally.

**What this does NOT guarantee in v1 (stated honestly):**

- **The registrar learns choices.** The identity service sees
  `{ who, issue, choice }` at eligibility-check time. This is the charter's
  own v1/v2 staging (§10: v1 linkage held privately, physically separated from
  the log; v2 blind-signature credentials remove the operator's knowledge).
  Trust-by-policy on the operator side, structure on the voter side — the
  voter-side receipt is the only part §5/§8 can achieve pre-blind-signatures,
  and it is achieved.
- **Eligibility, uniqueness, and stuffing-resistance stay off-log** —
  registrar policy, exactly as in the draft (ET-20 unchanged in substance).
  A malicious registrar can stuff ballots; it could equally have minted ballot
  keys under the draft. External audit of registration counts constrains this
  until identity v2.
- **No voter-provable inclusion.** A voter can watch the log and see their
  ballot appear but cannot _prove_ a specific line is theirs — deliberately,
  since an identity-bound inclusion proof would itself be a receipt.
  Individual cryptographic verifiability is traded for receipt-freeness; the
  charter promises verifiability of the _record_ (§4, P1), not of one's own
  ballot, in v1.
- **Coercion beyond receipt-freeness** (over-the-shoulder casting, timing
  correlation, small-tally statistical inference inherent to plaintext
  parallel tallies) remains deferred per §11.

**Alternatives rejected:**

- **Amend the charter's v1 scope (documented exception).** Rejected. §8's
  language is deliberately strong, and no exception is needed: a compliant
  construction exists and is _simpler_ than the draft (two chain keys total,
  no per-ballot key material).
- **Descope `vote_cast` from T3.** Rejected. The genesis rehearsal (T6–T8)
  exercises "cast signed votes" and the T9 security audit explicitly asks
  whether receipt-freeness is compromised by any spec artifact; freezing
  contracts-v1 without the ballot would push ballot design outside the
  rehearsal-and-audit discipline that exists precisely for it, and it would
  re-enter post-freeze as an unrehearsed additive change.
- **Nullifier / eligibility-token schemes** (per-(human, issue) tokens
  enabling on-log duplicate detection). Rejected for v1: a token derived from
  personhood under an operator secret is a deanonymization time bomb if the
  secret leaks, it still cannot stop a malicious registrar from minting
  tokens, and it is exactly the §11-deferred machinery. Revisit with identity
  v2.

## Consequences

- `contracts/event-types.md` is edited per this ADR (payload tables, signing
  rules, boundary section, acid-test tables; ET renumbering is legal — no
  fixtures exist yet). `event-schema.md` and `ids.md` need no changes:
  ES-30–ES-32 already describe signing generically by "the key named per
  type," and `ids.md` never mentions ballots.
- The verifier gets _simpler_: two signing keys for the whole chain, both read
  from `genesis`; no per-event key extraction for votes. It must additionally
  track each issue's `choice_count` alongside the issue hashes it already
  tracks for ID-8. Still buildable from the export alone.
- On-log ballot privacy _improves_ over the draft: without a stable
  `ballot_pk`, one voter's ballots across issues are not linkable to each
  other at all on the log.
- Phase 1/2 discipline this ADR creates (recorded in
  `memory/OPEN-QUESTIONS.md`): the identity service and web client MUST NOT
  return or display any per-ballot confirmation artifact that binds a voter
  to a specific log line (no signed receipts, no "your vote is seq N"
  attestations); registrar key management and one-human-one-issue enforcement
  are Phase 1 identity-design work; blind-signature credentials (identity v2)
  remove the registrar's knowledge of choices.
- The plan's T3 ticket phrase "`vote_cast` (signed)" is satisfied — signed by
  the registrar, not the voter. No plan amendment needed. The plan's mention
  of `0004-genesis-rehearsal.md` (T8) shifts to the next free ADR number.

## Charter check

- **P1 (log is the only truth; recomputable):** ballots stay plaintext
  integers on the log; every parallel tally remains recomputable by anyone
  from the export. Registrar signatures verify from `genesis` content alone.
- **P2 (one human, two planes):** the ballot plane is strengthened — no
  voter-held artifact links a ballot to a person _or to the voter's other
  ballots_. The linkage that does exist in v1 (registrar's private knowledge)
  is the charter's own §10 v1 staging, held off-log, never exported.
- **P3 (characterize, never weigh):** `choice` remains an opaque integer the
  contract does not interpret; `choice_count` describes the ballot format and
  weighs nothing; the registrar checks _eligibility_, never content.
- **P4 (floors, not ladders):** the only gate on casting a ballot is the
  personhood floor the charter requires; no key-management burden is imposed
  on voters (removing ballot keys also removes a usability ladder — voters
  who can't manage key material no longer vote through a weaker path).
- **§5/§8 (receipt-free, structural):** restored on the voter side — no
  demandable proof can exist. §11 remains honestly scoped: only
  coercion-resistance _beyond_ receipt-freeness is deferred.
