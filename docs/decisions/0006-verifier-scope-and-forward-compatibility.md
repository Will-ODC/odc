# ADR-0006: Verifier scope and forward compatibility

- **Status:** accepted
- **Date:** 2026-07-24
- **Phase:** 0

## Context

The T3 drafts tell a verifier to **reject** any event whose `type` is not in
the registry it knows: `event-schema.md` ES-9/ES-11 ("`type` MUST be a string
naming a type registered in `event-types.md`" … "a verifier MUST reject an
event whose `type` is not a registered type name") and `event-types.md`
ET-1/ET-2 ("the v1 registry is exactly these four types … a verifier MUST
reject any event whose `type` is not one of these"; a listed type at a
non-`1` `version` "MUST be rejected until a future contracts version defines
it").

Three other commitments pull the opposite way:

- **Additive evolution (implementation plan §Phase-0 rule 3; `contracts/README.md`).**
  Contracts change only additively, and verifiers "accept all published
  versions."
- **The fork/exit right (charter §8).** A community may fork, "re-declare
  genesis anchored to the old chain's head, and continue" — necessarily adding
  event types the original verifier never knew.
- **P1 recomputability (charter, P1).** Anything the platform can compute,
  anyone else can recompute — including on a chain that has evolved past the
  verifier binary in their hand.

A verifier frozen at `contracts-v1` has a fixed registry. Under ES-11/ET-2 as
written, the first legally-added future type makes that frozen verifier declare
the **whole chain INVALID** — bricking every deployed verifier on every future
version bump, and turning a healthy fork into a false "tampered" verdict. This
is the exact tension `memory/OPEN-QUESTIONS.md` reserved for this ADR, and it
must be resolved **before T4 drafts `hashing.md`**, because the resolution
constrains the byte-exact preimage.

There are two coupled decisions:

1. **What verdict does a verifier reach on a well-formed event of a type (or
   `(type, version)`) it does not know?** Today the verdict vocabulary is only
   `VALID | INVALID` — there is no third state for "chain structurally intact,
   but I cannot interpret this event."
2. **Can the preimage even be computed for an unknown type?** A frozen verifier
   can only check an unknown event's chain integrity if it can hash it — which
   requires the preimage to be constructible **without a per-type field list**.

## Decision

**1. Two-stage verification.** Verification splits into a type-agnostic stage
that applies to _every_ event, and a type-specific stage that applies only to
`(type, version)` pairs the verifier's contracts version registers.

- **Stage A — structural, type-agnostic (always applied).** Envelope
  well-formedness and strict rejection (ES-1–ES-4), `seq` form and monotonicity
  (ES-5–ES-8), `type` character set (ES-10), `ts` format and calendar gate
  (ES-20), `prev_hash` linkage (ES-23–ES-25), **`hash` recomputation**
  (ES-27/ES-28), and the genesis position rule (ES-33). Stage A never consults
  the type registry beyond the ES-10 character-set check.
- **Stage B — semantic, type-specific (applied only to registered
  `(type, version)`).** Signature verification (ET-3–ET-5 and each type's
  signing-key rule), the payload key-set (ES-18), and every value/reference
  constraint (title bounds, `choice`/`choice_count`, `issue_id` back-reference,
  etc.).

**2. Three verdicts, not two.** A verifier reports exactly one overall chain
verdict:

- **`VALID`** — every event passes Stage A, and every event's `(type, version)`
  is registered and passes Stage B.
- **`INVALID` (at line N, reason code)** — the first fatal failure: any Stage A
  failure (broken chain, malformed field, non-canonical bytes, a `type` that
  fails ES-10), **or** a Stage B failure on a _registered_ type. Fatal: it taints
  the chain from line N and verification stops there.
- **`PARTIAL`** — Stage A passes for the entire chain and no registered event
  fails Stage B, but one or more events carry a well-formed (ES-10) `type` or
  `(type, version)` the verifier does not register, so Stage B could not run for
  them. The verifier MUST enumerate the affected line numbers and MUST NOT
  report the chain `INVALID` solely for this reason.

`PARTIAL` means: _the record's structure and hash-chain are sound; some events
are of kinds newer than I understand, and I have said which._ This is the
non-silent verdict P1 and §8 require — an old verifier confirms integrity of a
newer chain instead of lying about it.

**3. The payload preimage is generic, never per-type.** `hashing.md` (T4) MUST
construct the payload portion of the preimage by a mechanical rule over **any**
flat map of `string → (integer | string)` — key set discovered from the payload
itself, deterministic ordering, per-value encoding — and MUST NOT enumerate
per-type field lists. `event-schema.md` ES-16/ES-17 already guarantee every
payload is exactly such a flat int/string map, so this is well-defined for
present and future types alike. This is what makes Stage A hash recomputation
possible for an unknown type.

**4. Home of the normative rule, and scope boundary.** The two-stage model and
the three verdicts are written normatively in `evolution.md` (T4), which is the
authoritative statement of cross-version verifier behavior. This ADR does **not**
edit ES-9/ES-11/ET-1/ET-2: those remain correct as the statement of the _v1
registry_. `evolution.md` refines what their word "reject" means for a
well-formed but unregistered `(type, version)` — it yields the per-event
`PARTIAL`/unknown treatment, never a structural `INVALID`. Only a malformed
`type` (ES-10) or a Stage A failure is `INVALID`. `evolution.md` EV-9 states this
reconciliation normatively; the T3 prose is not edited in T4, to avoid
re-versioning freshly-reviewed drafts mid-ticket. **Pre-freeze gate (MUST):**
before the `contracts-v1` freeze (T10), ES-9/ES-11 and ET-1/ET-2 MUST gain an
inline cross-reference to EV-9, so a verifier-builder reading only those
sentences is not misled by the bare "MUST reject". Shipping a bare "MUST reject"
into the freeze with its override living only in `evolution.md` is not
acceptable; the freeze review (T9/T10) MUST confirm the cross-references are
present.

## Consequences

- **T4 `hashing.md`** realizes decision 3 — a generic, per-type-agnostic payload
  preimage. This is a T4 acceptance criterion, not an aspiration.
- **T4 `evolution.md`** carries decisions 1–2 as numbered normative sentences
  (two-stage verification; the `VALID`/`INVALID`/`PARTIAL` verdict set; the
  refinement of "reject" for unregistered types).
- **T5 fixtures** must include an unknown-`type` vector whose expected verdict is
  `PARTIAL` (structure confirmed, line flagged) and an unknown-`version`-of-a-
  known-type vector likewise — so the rehearsal locks the third verdict in.
- **T7 verifier** implements three verdicts and must encode all three in its exit
  status (a drafting note for that ticket: the plan and `odc-verifier-builder`
  currently describe only `VALID | INVALID` and the `verify` exit codes 0/1 —
  that MUST be reconciled to three outcomes against this ADR; suggested
  `0 = VALID`, `1 = INVALID`, `2 = PARTIAL`, decided in T7).
- **No behavior change on v1-only chains.** A `contracts-v1` verifier knows all
  four v1 types, so no v1 event is ever "unknown" to it; `PARTIAL` cannot arise
  on a pure-v1 chain, and the genesis rehearsal (T6–T8) sees exactly the
  `VALID | INVALID` behavior it always would.

## Charter check

- **P1 (recomputable by anyone):** unknown-type events stay hash-checkable
  (decision 3), so a stranger's frozen verifier can still confirm the integrity
  of a chain that has evolved past it — the property P1 promises, extended across
  versions.
- **P3 (characterize, never weigh):** `PARTIAL` characterizes ("these lines I
  could not semantically check") without weighing; the verifier neither silently
  accepts nor silently rejects an event it does not understand.
- **§8 (fork/exit):** a fork that adds types does not brick everyone's existing
  verifier; old verifiers validate structure and honestly report what they cannot
  interpret, so exit does not require abandoning the verification commons.
