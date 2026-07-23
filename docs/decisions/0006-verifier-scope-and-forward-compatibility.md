# ADR-0006: Verifier scope and forward compatibility

- **Status:** accepted
- **Date:** 2026-07-23
- **Phase:** 0

## Context

The verifier is the load-bearing promise of the whole system: a standalone
artifact a stranger can build from `contracts/` alone and use to check that a
chain is intact and authentic (charter §4). Two contract commitments bear
directly on how it must behave, and as the T3 specs stand today they are in
direct contradiction:

- **The evolution rule** (implementation plan §Phase-0 rule 7): "event versions
  are additive-only; hashing rules never change retroactively; **verifiers must
  accept all published versions**." This exists to serve the fork/exit right
  (charter §8): someone can freeze a verifier binary today and must still be
  able to check a chain years from now, even after the community has added new
  event types by additive version bump. A verifier that is orphaned by the first
  additive type defeats the exit right — a departing community would find its
  archived verifier calling every modern chain invalid.

- **The T3 registry-closure rules** (`event-schema.md` ES-9, ES-11;
  `event-types.md` ET-1): a verifier "MUST reject an event whose `type` is not a
  registered type name." As written, this means the moment **any** new type is
  ever added, every previously-frozen verifier declares every chain carrying
  that type `INVALID`. Rule 7 says "accept all versions"; ES-11 says "reject
  anything I don't recognize." The spec contradicts itself.

`memory/OPEN-QUESTIONS.md` flagged this as requiring an ADR **before T4 drafts
`hashing.md`**, because the resolution dictates how the hash preimage is
constructed: if a verifier must hash a type it has never seen (to check the
chain), the preimage cannot be defined as a per-type list of named fields, or
unknown-type hashes are uncomputable.

A related question was raised in discussion: since the preimage is going
generic anyway, why keep type-aware verification at all — why not one generic
event, or a `kind: ballot | poll` flag, extended freely in the payload? That
option is addressed and rejected below (it re-opens receipt channels and merges
the two planes); it is recorded here so it is not relitigated.

## Decision

**Verification is two-stage. Structural checks are universal and type-agnostic;
semantic checks are per-type and best-effort on types the verifier knows.**

### 1. Stage 1 — structural verification (every event, known type or not)

A verifier MUST run these on every event regardless of `type`, using no
knowledge of what the type means:

- envelope shape and field presence (`event-schema.md` ES-1…ES-4);
- `seq` canonical form, start-at-1, +1 continuity, ordering authority
  (ES-5…ES-8);
- `type` character-set and `ts` format/calendar gates (ES-10, ES-20);
- `payload` is a flat object of integers/strings only (ES-15…ES-17, ES-19);
- `prev_hash` linkage to the predecessor's `hash` (ES-23…ES-25);
- `hash` recomputation from the six content fields (ES-26…ES-28);
- genesis position and uniqueness (ES-33): `seq` = 1 is `genesis`, and
  `genesis` occurs only there.

Stage 1 is sufficient to prove a chain is **untampered and well-formed** for
types the verifier has never seen. It is the part of the promise that must
survive forever.

### 2. Stage 2 — semantic verification (known types only)

For an event whose `(type, version)` is in the verifier's built-in registry,
the verifier MUST additionally check that type's registered semantics:
signature under the named key (`event-types.md` ET-4/ET-5/ET-8/ET-10/ET-13/
ET-17), required-and-only payload keys (ES-18), and per-type value constraints
(title length ET-14, `choice_count` range ET-14a, `issue_id` back-reference
ID-8/ET-18, `choice` range ET-18a).

### 3. Unknown types — a defined, non-silent third verdict

A verifier MUST NOT reject an event solely because its `(type, version)` is
unregistered (this repeals the blanket rejection in ES-9/ES-11/ET-1 — those
rules are re-scoped to Stage 2 by `evolution.md`, T4). Instead:

- If Stage 1 passes for the whole chain and **every** event's `(type, version)`
  is known, the verdict is `VALID` (exit code `0`).
- If Stage 1 passes for the whole chain but **one or more** events carry an
  unregistered `(type, version)`, the verdict is a distinct, non-silent
  `VALID (chain intact); N event(s) of unknown type — semantics unchecked`,
  with a **distinct exit code `2`**. It MUST name the unknown `(type, version)`
  pairs (or at least the lines) so the caller knows exactly what was not judged.
- If any event fails Stage 1, or any **known**-type event fails Stage 2, the
  verdict is `INVALID at line N` (+ reason code), exit code `1`.

The three exit codes let a caller distinguish "fully checked and good" (`0`)
from "chain provably intact but I am too old to fully judge some events" (`2`)
from "tampered or malformed" (`1`). Silence — returning `VALID` while hiding
that some events were unchecked — is forbidden; so is crying wolf (`INVALID`
for a merely-unknown type). Exit `2` is a success family for chain integrity
and a caveat for semantics, never a tamper signal.

### 4. The preimage is generic over the flat payload (binds `hashing.md`, T4)

Because Stage 1 must recompute the `hash` of a type it does not understand,
`hashing.md` MUST define the payload contribution to the preimage **generically
over any flat integer/string payload** — a mechanical walk of the payload's
keys in a single pinned, language-neutral order (sort by key bytes) — **not** as
a per-type list of named fields. Any `(type, version)`, present or future,
whose payload obeys the flat int/string rule (ES-16/ES-17) is therefore
hashable by any conforming verifier, old or new. This is the concrete constraint
this ADR places on T4; `hashing.md` spells the exact bytes.

### 5. The ballot-plane carve-out stays type-aware (and only it)

Two `choice`/ballot checks do **not** move out of the verifier for v1 types and
are **not** made generic:

- the `choice` range check `0 ≤ choice < choice_count` (ET-18a), and
- the ballot payload's exclusion of any unbounded or voter-chosen value
  (ET-22, ET-14a's `choice_count` cap).

These are structural to receipt-freeness (ADR-0004): the bound *is* the defence
against a coercer demanding a unique marker value. They are Stage-2 checks that
must remain in any verifier that claims to know `vote_cast`, and cannot be
demoted to a tally-side interpreter. A verifier too old to know `vote_cast`
returns exit `2` for those events rather than silently blessing them.

### 6. Rejected alternative — one generic/flagged event type

The "accept generic, extend in payload, flag ballot/poll" option is rejected
for the semantic layer (it is *adopted* for the structural/hashing layer — that
is items 1 and 4). A single event type distinguished by a `kind: ballot | poll`
flag, or a ballot payload extensible with arbitrary voter-chosen fields, is
forbidden by constraints the charter marks non-negotiable:

- **Plane separation** (charter "Votes and sentiment stay separate primitives…
  never conflated"; `CLAUDE.md` rule 7: "Ballot events and sentiment events
  never share a store or a pipe"). A flag that co-locates ballot and
  poll/sentiment semantics in one event *is* the shared pipe those rules forbid.
  Separation is expressed **by type/stream** (a future `sentiment` service with
  its own encrypted store and its own additive event types), never by a flag on
  a shared event.
- **Receipt-freeness** (charter §5/§8; ADR-0004; ET-22). Freely extending a
  ballot payload re-opens the covert-receipt channel ET-14a/ET-22 close. Making
  the receipt-critical range check conditional on a mutable-looking payload flag
  (rather than pinned to a distinct type) would let a bug or a hostile writer
  silently disable the one defence that must be robust.

"Extend in payload" for **non-ballot** types is fully supported — that is just
the additive-evolution rule (new keys in a new version, hashed generically by
Stage 1, semantically checked by Stage 2 on new-enough verifiers). Only the
ballot plane is constrained, and only where the charter requires it.

## Consequences

- **T4 is unblocked**, with two hard constraints on it: `hashing.md` defines a
  generic flat-payload preimage (item 4); `evolution.md` (a) records the
  two-stage model and the three-verdict/exit-code contract (item 3),
  (b) re-scopes ES-9/ES-11/ET-1 from "reject unknown type" to "Stage-2 checks
  apply to known types; unknown types get exit 2," and (c) states that the
  ballot carve-out (item 5) and ADR-0004's ET-22 constraint bind every future
  `vote_cast` version.
- **T7 (Go verifier)** implements three exit codes (`0`/`1`/`2`) and the
  generic preimage from `contracts/` alone; its fixtures (T5) MUST include an
  unknown-`(type, version)` vector expecting exit `2` with the chain otherwise
  intact, alongside the existing VALID/INVALID adversarial set.
- **No T3 spec is rewritten by this ADR**; ES-9/ES-11/ET-1 are re-scoped in
  prose by `evolution.md` (T4) rather than edited in place, keeping T3 frozen as
  drafted. The envelope stays six content fields (ADR-0005 item 1, ratified
  2026-07-23) — this ADR adds no field.
- **Runtime cost is negligible or negative:** Stage 1 is the expensive per-line
  work (SHA-256, chain, seq) that every design already pays; on an unknown type
  Stage 2 is *skipped*, not added; the generic key-walk preimage is simpler code
  than a per-type field switch. The only added surface is one verdict and exit
  code to specify and fixture-test.

## Charter check

- **P1 (log is the only truth; recomputable by anyone):** strengthened — a
  frozen verifier can still prove any future chain's structural integrity
  (Stage 1) from `contracts/` alone, so "anyone can recompute and verify"
  survives protocol evolution instead of expiring at the first new type.
- **P2 / §5 / §8 (two planes; receipt-free; fork/exit):** the fork/exit right is
  the direct beneficiary — an archived verifier stays useful after a fork adds
  types. Plane separation and receipt-freeness are preserved by item 5 (ballot
  checks stay type-aware) and item 6 (no ballot/poll flag, no extensible ballot
  payload).
- **P3 (characterize, never weigh):** the verifier still only checks integrity
  and authenticity; the unknown-type verdict *reports* what it could not judge
  rather than silently deciding. It weighs nothing.
- **P4 (floors, not ladders):** no effect; verification grants no standing.
