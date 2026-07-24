# Evolution — contracts/evolution.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T4). Not frozen.
**Companion specs:** `event-schema.md`, `event-types.md`, `hashing.md`,
`export-format.md`, `read-api.md`.
**Governing ADRs:** ADR-0006 (verifier scope & forward compatibility),
ADR-0005 (correction & retraction), ADR-0003 (preimage & strict rejection).

How the contracts change **after** `contracts-v1` is frozen, and how a verifier
frozen at one version behaves against a chain that has grown past it. The freeze
makes `hashing.md` and the fixtures permanent; this spec is the rulebook for
everything that may still move, and the guarantee that old verifiers stay
useful.

Every normative sentence is numbered `EV-n`. RFC-2119 keywords are normative.

---

## 1. Additive-only versioning

- **EV-1.** Changes to `contracts/` after freeze MUST be **additive**: a new
  event `type`, or a new `version` of an existing type, or a new optional
  endpoint/field on the read surface. An existing frozen `(type, version)`
  schema MUST NOT be altered, and a `type` MUST NOT be removed. This is the
  implementation-plan non-negotiable rule 3 made concrete.
- **EV-2.** `version` is **per-type** (`event-schema.md` ES-13): bumping the
  payload of one type defines a new `(type, version)` and leaves every other
  type untouched. There is no chain-wide protocol version in the envelope; the
  contracts version a chain was started under is recorded once, in the `genesis`
  payload `contracts` field (`event-types.md` ET-9, ES-14).
- **EV-3.** A new `(type, version)` MUST obey the frozen `hashing.md`
  construction unchanged: values remain flat integers or UTF-8 strings
  (`event-schema.md` ES-16/ES-17), hashed by the generic payload rule
  (`hashing.md` HA-7). Because that rule is per-type-agnostic, a new type needs
  **no** new hashing code and produces hashes a frozen verifier can already
  recompute (EV-8).
- **EV-4.** **Hashing never changes retroactively.** `hashing.md` is frozen at
  `contracts-v1` (`contracts-guard`); no later version may redefine the
  preimage, the digest, the domain constant, or the encoding of any existing
  field. A value shape that cannot be expressed as a flat int/UTF-8-string
  (`event-schema.md` ES-16) is therefore **not addable** — it would require a
  hashing change. Absence of a value is expressed by a later per-type `version`
  that omits the key, never by a `null` (ES-3), and never by a new float or
  nested shape.
- **EV-5.** Every additive change MUST ship its own golden fixtures (T5
  discipline) before it is published, and MUST be logged in
  `CONTRACTS-CHANGE.md` with a version bump on each touched spec (`contracts-
  guard`).

## 2. Cross-version verification (two-stage; three verdicts)

Per ADR-0006. A verifier is built for some contracts version and knows exactly
the `(type, version)` pairs that version registers — its **registry**. It may
still be run against a chain containing pairs it does not register (a newer
chain, or a fork that added types, charter §8).

- **EV-6.** Verification is **two-stage**. **Stage A (structural, type-
  agnostic)** applies to every event regardless of `type`: envelope
  well-formedness and strict rejection (`event-schema.md` ES-1–ES-4), `seq` form
  and contiguity (ES-5–ES-8), `type` character set (ES-10), `ts` format (ES-20),
  `prev_hash` linkage (ES-23–ES-25), `hash` recomputation (`hashing.md`
  HA-14), and the genesis position rule (ES-33). **Stage B (semantic, type-
  specific)** applies only to `(type, version)` pairs in the verifier's
  registry: signatures (`event-types.md` ET-3–ET-5), payload key-set (ES-18),
  and all value/reference constraints (title bounds, `choice`/`choice_count`,
  `issue_id` back-reference, etc.).
- **EV-7.** A verifier MUST report exactly one of three chain verdicts:
  - **`VALID`** — every event passes Stage A, and every event's `(type,
    version)` is registered and passes Stage B.
  - **`INVALID` (at line N, reason code)** — the first fatal failure: any Stage A
    failure, **or** a Stage B failure on a **registered** `(type, version)`,
    **or** a `type` that fails the ES-10 character set. Verification stops at
    line N; the chain is tainted from there.
  - **`PARTIAL`** — Stage A passes for the whole chain and no registered event
    fails Stage B, but one or more events carry a **well-formed** (ES-10) `type`
    or `(type, version)` the verifier does not register, so Stage B could not run
    for them. The verifier MUST enumerate the affected line numbers.
- **EV-8.** A verifier MUST NOT report `INVALID` **solely** because a well-formed
  event has an unregistered `(type, version)`. Such an event is hash-checkable
  under Stage A (EV-3/HA-7); its integrity and chain position are confirmed, and
  only its type-specific semantics are left unchecked (`PARTIAL`, EV-7). This is
  the property the fork/exit right and P1 require: an old verifier confirms the
  integrity of a newer chain instead of falsely condemning it.
- **EV-9.** **Refinement of "reject" for unregistered types.** Where
  `event-schema.md` ES-9/ES-11 and `event-types.md` ET-1/ET-2 direct a verifier
  to *reject* an event of an unregistered `type` or `(type, version)`, that
  rejection means: the event does not receive a `VALID` **semantic** verdict. For
  a **well-formed** unregistered pair (ES-10 satisfied) the outcome is the
  per-event `PARTIAL` treatment of EV-7/EV-8, **not** a structural `INVALID`.
  Only a malformed `type` (ES-10) or a Stage A failure is `INVALID`. This
  sentence is the authoritative reconciliation of those T3 sentences with the
  evolution rule; a future revision of `event-schema.md`/`event-types.md` SHOULD
  add a cross-reference to it.
- **EV-10.** On a chain that uses only `(type, version)` pairs in the verifier's
  registry, `PARTIAL` never arises, and EV-6/EV-7 reduce to the plain
  `VALID | INVALID` behavior of a single-version verifier. A `contracts-v1`
  verifier on a pure-v1 chain therefore behaves exactly as the genesis rehearsal
  (T6–T8) exercises it.

## 3. Correction and retraction conventions (per ADR-0005)

The envelope carries **no** correction machinery — no `supersedes` field — and
never will (ADR-0005; the six-field preimage is frozen). Corrections are
expressed additively, in the two conventional forms below. Both are **derived-
view** (interpreter) mechanisms: the log records, views resolve (charter P3).
Neither is verifier-enforced beyond referential integrity where noted.

- **EV-11.** **Scoped last-write-wins.** A correctable type MAY define a **scope
  key set** in its payload (e.g. `(actor, delegation_scope)`); an interpreter
  resolves each scope to the event with the highest `seq` in that scope. No
  reference and no envelope change is involved; the resolution rule is
  `max(seq)` per scope.
- **EV-12.** **Targeted correction (payload convention).** A type needing to
  point at a specific earlier event MAY carry a payload key `supersedes` — the
  64-lowercase-hex `hash` of a **strictly earlier** event (`ids.md` ID-8
  discipline) — plus a `reason` key drawn from a per-type string enum. In a
  derived view an event with a valid superseder is inert; competing superseders
  of one target resolve by highest `seq`, transitively. A verifier that
  registers such a type MUST check the `supersedes` reference is the `hash` of a
  prior event (Stage B referential integrity); it assigns the correction no
  further meaning (P3).
- **EV-13.** **The ballot plane is permanently excluded from both mechanisms.**
  No `vote_cast` version may carry a scope key, a `supersedes`, or any other
  correction pointer (`event-types.md` ET-22; ADR-0004, ADR-0005 item 3). A
  ballot, once appended, is never superseded on-log; v1 ballot finality is
  registrar policy (one ballot per human per issue, no re-vote path), recorded
  in `memory/OPEN-QUESTIONS.md`. This bar survives any future community vote
  (charter §8).
- **EV-14.** **Executability gate.** Whichever form a future correctable type
  uses, its registry entry MUST ship golden fixtures for the pathological cases
  before it is published (EV-5): a superseder that is itself superseded,
  competing superseders of one target, a dangling `supersedes` target, and scope
  collisions. No correctable type ships on prose alone.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                                     | Closed by      |
| ----------------------------------------------------- | -------------- |
| Additive vs in-place change; per-type vs global bump  | EV-1, EV-2     |
| Whether a new type needs new hashing code             | EV-3, EV-8     |
| Retroactive hashing changes; nullable fields          | EV-4           |
| Two-stage split                                       | EV-6           |
| The verdict set (VALID/INVALID/PARTIAL)               | EV-7           |
| Unknown well-formed type: INVALID vs PARTIAL          | EV-8, EV-9     |
| Behavior on a same-version chain                      | EV-10          |
| Correction forms (scoped LWW; targeted supersedes)    | EV-11, EV-12   |
| Ballot-plane exclusion from corrections               | EV-13          |
| Fixtures required before a correctable type ships     | EV-14          |

## Acid-test walkthrough

Two verifiers built for `contracts-v1`, run on a chain that contains a
hypothetical v2 `delegation_created` event, both: pass Stage A on every line
(including the v2 event, hash-recomputed by the generic rule, HA-7), find the v2
`(type, version)` outside their registry, skip Stage B for it, and report
`PARTIAL` naming that line — never `INVALID` (EV-7/EV-8/EV-9). Run on a pure-v1
chain, both report `VALID | INVALID` identically (EV-10). Given the same future
`delegation` fixtures with a `supersedes` chain, two interpreters resolve the
same surviving events by `max(seq)` transitivity (EV-12). No cross-version or
correction ambiguity remains.
