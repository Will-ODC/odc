# ADR-0006: Verifier scope and forward compatibility — two-stage verification + generic payload preimage

- **Status:** accepted
- **Date:** 2026-07-23
- **Phase:** 0

## Context

The T3 drafts make the verifier reject any event whose `type` is not in the v1
registry (`event-schema.md` ES-9/ES-11, `event-types.md` ET-1). Read literally,
that rule breaks two charter guarantees the moment the contracts evolve:

- **The evolution rule** (implementation plan §Phase-0 rule 7; `evolution.md`,
  T4): event versions are additive-only and _"verifiers must accept all
  published versions."_ If an unregistered `type` is a hard INVALID, then every
  future additive event type — and every richer ballot payload version
  (ADR-0004 ET-22 permits bounded ones) — retroactively invalidates every
  already-frozen verifier. A frozen verifier that says INVALID on a log
  containing a type minted after it shipped is not forward-compatible.
- **The fork/exit right** (charter §8): a community may fork and _"re-declare
  genesis anchored to the old chain's head and continue elsewhere."_ A fork
  will add event types the original never had. Anyone holding the original,
  frozen verifier must still be able to verify the _shared_ history and the
  chain integrity of the fork — otherwise exit is not credible.

There is a second, coupled problem. Even chain-integrity checking of a log
containing an unknown type requires computing that event's `hash`. If
`hashing.md` (T4) fixes the preimage **per type** (a concatenation of that
type's named payload fields), then an unknown type's preimage — and therefore
its hash, and therefore the `prev_hash` link of the _next_ event — is
uncomputable by a verifier that predates it. Forward-compatible verification is
impossible unless the payload preimage is defined **generically**, over any
conforming flat payload, independent of type.

Both decisions must be made now: they shape the bytes `hashing.md` freezes at
T4 and the verifier's public contract. This ADR is the "verifier scope"
open question from `memory/OPEN-QUESTIONS.md`, ratified 2026-07-23.

## Decision

Numbered for fixture cross-reference; RFC-2119 keywords are normative.

1. **Two-stage verification.** Verification splits into two layers with
   different scopes:

   - **Stage 1 — structural / chain integrity, type-agnostic.** Applies to
     **every** event regardless of whether its `type` is known: envelope shape
     and field presence (ES-1/2/3), field _forms_ (canonical integer form ES-5,
     64-hex ES-23/26, `ts` format ES-20), `seq` = 1 then +1 (ES-6/7),
     `prev_hash` linkage (ES-25), and `hash` recomputed over the six content
     fields (ES-27/28). A verifier MUST be able to fully check the chain
     integrity of a log that contains types it has never heard of.
   - **Stage 2 — registry / semantics, per known `(type, version)`.** Applies
     only to events whose `(type, version)` the verifier knows: signature under
     the type's named key (ET-4/8/10/13/17), required payload key set and value
     constraints (ET-14 title, ET-14a/18a `choice_count`/`choice` range),
     and backward references (`ids.md` ID-8).

2. **A defined, non-silent verdict for unknown `(type, version)`.** An event
   that passes Stage 1 but whose `(type, version)` is not in the verifier's
   registry receives a **third verdict, `UNVERIFIED`**, distinct from both
   `VALID` and `INVALID`. Such an event MUST NOT be silently treated as `VALID`,
   and a well-chained log MUST NOT be reported `INVALID` merely because it
   carries a type newer than the verifier. The chain verdict and the per-event
   semantic verdict are reported separately, e.g. _"chain VALID; N events
   UNVERIFIED at lines …"_. This is the concrete mechanism by which "verifiers
   accept all published versions" and the fork/exit right are honored.

3. **This replaces "reject unknown type" as an INVALID with "UNVERIFIED at
   Stage 2."** ES-9/ES-11 and ET-1 currently say a verifier MUST _reject_ an
   unregistered type; T4 MUST reword them so an unknown `type` (or unknown
   `version` of a known type) yields the Stage-2 `UNVERIFIED` verdict and never
   a Stage-1 chain INVALID. This ADR records the decision; the contracts edits
   themselves land at T4 under contracts-guard version-bump discipline (this
   ADR does not touch `contracts/`).

4. **Generic payload preimage.** `hashing.md` (T4) MUST define the payload's
   contribution to the hash/signing preimage **generically over any flat object
   of integer/string values** (the ES-16/17 shape) — by a fixed, spelled-out
   rule (e.g. keys in a defined byte order, each key and value length-delimited
   exactly), **not** as a per-type concatenation of named fields. Consequence:
   the `hash` of any conforming event is computable by a verifier that has never
   seen its type. Genericity applies to _hashing only_.

5. **Semantics stay per-type; load-bearing checks stay in the verifier.**
   Generic hashing does NOT mean generic semantics. ADR-0004's `choice`-range
   check — and any receipt-freeness-critical bound — is a Stage-2 check the
   verifier performs for known types and MUST NOT be relocated to a tally-side
   interpreter (it is load-bearing for §5/§8). Unknown types are `UNVERIFIED`
   precisely _because_ their semantics are unknown, not merely un-hashable.

6. **Executability gate (fixtures).** No verifier ships on prose alone. T5
   golden fixtures MUST include: (a) an unknown `type` on an otherwise-valid
   chain → `UNVERIFIED` at the right line, chain still `VALID`; (b) an unknown
   `version` of a known type → same; (c) the generic preimage exercised by at
   least two _different_ flat payload shapes, each with a hand-verifiable
   `hash`. These mirror the ADR-0005 item-4 discipline.

## Consequences

- **T4** `hashing.md` writes the generic payload preimage with a worked example;
  `evolution.md` records the two-stage model and the `UNVERIFIED` verdict as the
  realization of "verifiers accept all published versions." `event-schema.md`
  (ES-9/ES-11) and `event-types.md` (ET-1) are reworded per Decision 3 — legal
  pre-freeze, no fixtures exist yet.
- **The verifier's public contract gains a third outcome.** The CLI reports
  `UNVERIFIED` distinctly from `VALID`/`INVALID`; its exit-code mapping (e.g.
  `0` VALID, `1` INVALID, and a defined code or warning-count for a
  VALID-chain-with-UNVERIFIED-events log) is a T4/T7 drafting detail but MUST be
  defined, not ad hoc. The MVP acceptance test's "`VALID` … then flip one byte …
  `INVALID at line N`" is unchanged for v1-only logs (no unknown types present).
- **Forward path unlocked.** Additive event types and the richer poll-type
  ballots roadmap (approval/ranked/score as future `vote_cast` versions, bounded
  per ADR-0004 ET-22) can ship without breaking any frozen verifier.
- **The verifier stays a pure function of the stored bytes** (ADR-0003 D5):
  Stage 1 is type-blind and recomputes from bytes; the `UNVERIFIED` verdict adds
  no hidden normalization, only an honest "I cannot vouch for this."

## Charter check

- **P1 (log is the only truth; recomputable by anyone):** a generic preimage
  makes any conforming event's `hash` recomputable by any verifier — including
  across version upgrades and forks — strengthening P1's "anything computable by
  the platform is recomputable by anyone else."
- **P3 (characterize, never weigh):** `UNVERIFIED` is a characterization ("this
  type is outside what I know"), not a weighing; the verifier still interprets
  nothing and picks no winner.
- **P4 (floors, not ladders):** no effect; verification grants no standing.
- **§8 (fork/exit):** a fork that adds types keeps its shared history verifiable
  by pre-existing verifiers — the property that makes credible exit real.
- **Evolution rule (additive-only; accept all published versions):** this ADR is
  the mechanism that makes the rule executable rather than aspirational.

## Alternatives rejected

- **Keep strict reject (unknown type ⇒ INVALID).** Simplest to spec today, but
  it breaks every frozen verifier on the first additive type and contradicts
  both the evolution rule and §8 fork/exit. Rejected.
- **Generic hashing _and_ generic semantics (verifier interprets nothing
  per-type).** Would force the load-bearing `choice`-range / receipt bound out
  of the verifier into a downstream interpreter, re-opening the §5/§8 surface
  ADR-0004 closed. Rejected — hashing is generic, semantics are per-type.
- **Version the whole verifier per contracts version (ship a new verifier for
  every new type).** Defeats the "stranger writes a verifier in an afternoon"
  independence and the "one copy verifies the record" promise: a fork could not
  be verified by anyone's existing tool. Rejected.
