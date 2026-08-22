# ADR-0016: An optional `ancestor_head` on `genesis` — the fork right, made expressible

- **Status:** accepted — amended in part by ADR-0019 (`ancestor_chain` added; the
  "only key" statement restated as a bar on the tag, not a count of keys)
- **Date:** 2026-08-15
- **Phase:** 0

## Context

T9 finding **F4** (`docs/security/audit-phase-0.md`), rated blocking, and the
only one of the six the auditor classed as an outright **charter violation**
rather than a gap.

Charter §8 states as a **right** that a community "can fork — the export, the
software, the rules, and keys-as-identity mean a community can **re-declare
genesis anchored to the old chain's head** and continue elsewhere without
anyone's permission", and makes it load-bearing whether or not it is ever used:
"credible exit disciplines the operator even if never used."

The contract could not express it:

- **ES-24** fixes the first event's `prev_hash` at 64 zeros — no slot for an
  ancestor.
- **ES-18** closes the `genesis` payload key set to
  `{chain_id, contracts, operator_pk, registrar_pk, sig}`.
- **ET-6** pins `genesis.version` at `1`, so the usual additive escape — define a
  version 2 with an extra key — is barred for this one type, and **EV-1** forbids
  altering the frozen v1 schema.

So after the freeze there would be no conforming way for a forked community to
record what it forked from, at the one point where it matters. The two
workarounds are both bad: smuggling the head into the `contracts` string invents
an unspecified field inside a field ET-9 assigns no structure to, and recording
ancestry in a new event type at `seq` 2 leaves the fork's genesis unanchored with
no rule tying the claim to the chain's start.

## Decision

**Add an OPTIONAL `ancestor_head` key to the `genesis` payload** (`event-types.md`
**ET-9e**), carrying the head of the chain this one forked from.

- **Format:** 64 lowercase hex, `^[0-9a-f]{64}$` — an event `hash`, the same shape
  as every other hash reference in the contract. **Absent** on a chain with no
  recorded ancestor.
- **The 64-zero anchor is explicitly barred** as a value. Two ways to say "no
  ancestor" (absent, or 64 zeros) would be two byte forms of one meaning, which is
  the exact defect D5 exists to prevent, and it would give the 64-zero string a
  second meaning alongside `prev_hash`'s anchor (ES-24). One meaning, one
  representation.
- **A fork's own structure is unchanged:** `seq` 1, `prev_hash` 64 zeros. A fork
  is a **new chain with a new identity** (ET-7a, ADR-0013) — not a continuation.
  `ancestor_head` records provenance; it does not extend a chain.

### What a verifier does and does not check — stated plainly

It checks **format, and nothing else**. `ancestor_head` is a **recorded claim,
not a verified link**. The ancestor chain is a different export that the verifier
does not hold and cannot demand, so it cannot confirm that the value is any
chain's head, that it is _that_ community's chain, or that the ancestor exists at
all. ET-9e therefore states as a MUST NOT that a verifier reject or flag a
`genesis` whose `ancestor_head` it cannot resolve — otherwise conformance would
depend on what files a reader happens to have, and the same export would verify
differently in two hands.

The value is still worth recording, because a reader who holds **both** exports
settles the claim in one comparison. That comparison is a reader's act, outside
this contract. Anything stronger — a verified link — would need the verifier to
fetch and fully verify a second chain, which is a different tool.

### Optional keys needed a rule of their own

v1 had no notion of an optional payload key: ES-18 fixed the key set flatly, and
ES-3 bars `null`. **`event-schema.md` ES-34** now defines the concept once —
present with a legal value, or entirely absent; never `null`, never a placeholder
standing for absence — and records that `hashing.md` needs no change, because
HA-7 encodes exactly the keys present and leads with the key count `U64(k)`, so
the two forms are simply different preimages. This was found while writing ET-9e
and is a genuine prerequisite: without it, "optional" would have been stated only
in a payload table, which is the mistake that produced ET-9b.

### The door does not reopen

**This is the only key ever added to `genesis`.** ET-6 pins `genesis.version` at
1 and EV-1 bars altering a frozen `(type, version)`, so after the tag no further
genesis key is addable by any mechanism. Chain identity (ADR-0013) was
deliberately solved _without_ spending this change — that is why a
`genesis_nonce` was rejected there. Anything else anyone later wants at genesis
must live in a separate event type, and will not be genesis.

## Consequences

- **`contracts/`** — `event-types.md` (v7 → v8): `ancestor_head` row in the
  `genesis` table, ET-9e added, rule-index and acid-test updated.
  `event-schema.md` (v2 → v3, shared with ADR-0014): ES-34 added in a new §11,
  ES-18 cross-referenced.
- **No existing bytes move.** The key is optional and no existing fixture carries
  it, so every current vector's payload, `hash` and verdict are unchanged. This is
  the cheapest of the six changes and the one with the shortest window.
- **Owed fixtures (EV-5), not written in this pass:**
  - a `genesis` **with** a well-formed `ancestor_head` → `VALID` (this is the
    fork-declaring positive case, and the first vector whose genesis payload has
    six keys — it also exercises HA-7's key count and HA-8's ordering, since
    `ancestor_head` sorts first among the genesis keys);
  - a `genesis` with `ancestor_head` = the **64-zero anchor** → `INVALID` at line 1
    (the barred second representation, ET-9e);
  - a `genesis` with a malformed `ancestor_head` (uppercase hex or wrong length)
    → `INVALID` at line 1;
  - a `genesis` whose `ancestor_head` names a chain **not in the fixture set** →
    `VALID`, pinning that unresolvability is not a defect. This is the vector that
    stops a future verifier from "helpfully" trying to resolve it.
- **Owed verifier work (both verifiers, isolated passes):** accept the optional
  key, check its format, resolve nothing.
- **Anchoring interaction (informative).** Because the genesis hash now covers
  `ancestor_head`, a fork's identity differs from its parent's automatically, and
  an anchor that publishes `(genesis_hash, head)` per ADR-0013 publishes a fork as
  a visibly distinct chain. That is a consequence, not a mechanism to rely on.

### Documents reconciled

- `docs/charter.md` §8 ("Exit is a right") — this ADR exists to make the contract
  match it, so the charter sentence becomes **true rather than aspirational**. The
  audit's alternative was amending the charter to describe what the contract could
  do; the operator chose the contract change instead. **No charter edit needed —
  deliberately, and that is the point.**
- `docs/implementation-plan.md` — Phase 0 item 5 lists the v1 type registry
  without payload keys, and no section describes genesis payload contents.
  **Checked, no change needed.**
- `services/ledger/CLAUDE.md` — describes auth and append rules, not the genesis
  payload. **Checked, no change needed.**
- No document outside `contracts/` stated that `genesis` had no ancestry slot, so
  none contradicted this change.

## Charter check

- **Charter §8 (exit is a right).** Directly, and this is the ADR's whole purpose:
  a right the charter grants was inexpressible in the artifact that implements it,
  and would have become permanently inexpressible at the tag. Credible exit
  disciplines the operator only if it is actually available.
- **P1 (the log is the only truth).** Served with a caveat that is stated rather
  than hidden: the ancestry claim is _recorded_ in the log, and its
  _confirmation_ requires a second export. The contract says so instead of
  implying a verification it cannot perform.
- **P2/P3/P4.** Untouched. `ancestor_head` is operator-declared chain metadata; it
  touches no ballot, no plane, no tally and no participation floor.
