# Evolution — contracts/evolution.md

**Version:** 4
**Status:** DRAFTING (Phase 0 · T5f, amended T9a/ADR-0014, ADR-0015,
ADR-0017). Not frozen.
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
  - **`INVALID` (at line N, reason code)** — the reason accompanying `INVALID` is
    **advisory**; no reason-code registry exists or is required, and conformance
    is judged on the verdict token and line number alone (EV-17). The first fatal
    failure: any Stage A
    failure, **or** a Stage B failure on a **registered** `(type, version)`,
    **or** a `type` that fails the ES-10 character set. Verification stops at
    line N; the chain is tainted from there.
  - **`PARTIAL`** — Stage A passes for the whole chain and no registered event
    fails Stage B, but one or more events carry a **well-formed** (ES-10) `type`
    or `(type, version)` the verifier does not register, so Stage B could not run
    for them. The verifier MUST enumerate the affected line numbers.
- **EV-8.** A verifier MUST NOT report `INVALID` **solely** because a well-formed
  event has an unregistered `(type, version)` — **with the single exception of
  `genesis`, EV-20.** Such an event is hash-checkable
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

## 4. The report surface (added in v2)

EV-6 names Stage A's checks **by example**; EV-15 makes the split exhaustive,
because a check placed in the wrong stage is verdict-determining — it turns an
`INVALID` chain into a `PARTIAL` one. EV-17 pins what a verifier actually
reports. ADR-0006 left that to the T7 implementation, which is unworkable: that
session reads `contracts/` and its own ticket alone and cannot see the ADR, so
the surface has to live here.

- **EV-15.** **Stage A is exactly the set of checks that do not consult the type
  registry**; EV-6's enumeration is illustrative, not exhaustive. Stage A
  comprises, in full: every rule of `export-format.md` (EX-1–EX-20 — framing,
  canonical line form, chain linkage, head) **except the `sig` clause of EX-11,
  which is Stage B** (verifying `sig` per `hashing.md` HA-16 requires the
  per-type signing key, ET-8/ET-10/ET-13/ET-17); from `event-schema.md` ES-1–ES-8,
  ES-10, ES-12, ES-15–ES-17, ES-19, ES-20, ES-23–ES-28, and ES-33; and from
  `hashing.md` HA-6 and HA-14. **Stage B is exactly the remainder of the
  per-event checks** — those requiring knowledge of the `(type, version)`: ES-9
  and ES-11 (registration), ES-18 (payload key set), ES-30–ES-32 as instantiated
  per type, the EX-11 `sig` clause above, every rule of `event-types.md` (ET-\*),
  and `ids.md` ID-1/ID-2/ID-8, which a verifier reaches only through ET-18. **One
  event escapes that assignment: at line 1, ES-9/ES-11 registration is Stage A,
  because a `genesis` the verifier does not register leaves it no keys to run
  Stage B with anywhere on the chain (EV-20).**
  `event-schema.md` ES-13, ES-14, ES-21, ES-22 and ES-29 state definitions, or
  constraints on the verifier itself, rather than per-event checks; they are
  outside this split and belong to neither stage. So are, in `event-types.md`,
  the boundary statements ET-20 and ET-21 and the evolution constraint ET-22
  (which describe what the log does not enforce, and what a future version may
  not do), and **ET-25**, which is a producer obligation no reader can check —
  a shuffled batch and an arrival-ordered one are indistinguishable, so no
  verifier can report it and no stage contains it (ADR-0014).
- **EV-16.** **A payload-shape failure is `INVALID`, never `PARTIAL`.** An event
  violating `event-schema.md` ES-15, ES-16, or ES-17 — a non-object `payload`, or
  a float, boolean, `null`, nested object, or array anywhere in it — MUST be
  reported `INVALID` at its line **regardless of whether its `(type, version)` is
  registered**. `hashing.md` HA-7 defines an encoding only for flat integer and
  string values, so such an event has **no computable preimage**: a verifier
  cannot confirm its integrity even structurally, and EV-8's rationale for
  `PARTIAL` (integrity confirmed, semantics unchecked) does not hold.
- **EV-17.** **Report surface.** A verifier MUST report exactly one chain verdict
  from the token set `VALID`, `INVALID`, `PARTIAL` (EV-7), subject to:
  - **Precedence.** `INVALID` outranks `PARTIAL`, which outranks `VALID`. A chain
    with both an unregistered type and a Stage A failure is `INVALID`.
  - **Line attribution.** `INVALID` MUST name the **1-based line number** of the
    first fatal line, scanning the export in file order. Any failed check on a
    line makes that line the fatal line; the relative order of checks *within* a
    line is deliberately not pinned, since it cannot change which line is named.
    Failures with no natural line are attributed by `export-format.md` EX-18–EX-20.
  - **`PARTIAL` enumeration.** `PARTIAL` MUST enumerate the affected line numbers
    in ascending order (EV-7).
  - **Reason text is advisory.** A verifier SHOULD accompany `INVALID` with a
    human-readable reason and SHOULD name the violated normative sentence (`ES-7`,
    `HA-14`, `EX-10`, …), reusing the identifiers these specs already assign. That
    text is **not** conformance-checked. **Conformance is judged on the verdict
    token and the line number(s) alone**, and golden fixtures MUST assert only
    those — never the reason text, and never the process exit code. This keeps the
    diagnostic vocabulary and the CLI surface revisable while the verdict itself
    is fixed.

  _Non-normative CLI note (not a conformance requirement, and deliberately
  fixture-free so it stays revisable): a command-line verifier exits `0` for
  `VALID`, `1` for `INVALID`, `2` for `PARTIAL`, and `3` or above for tool-level
  failures such as an unreadable file or bad usage — which are never a chain
  verdict. This is pinned here only so two independent implementations do not
  invent conflicting schemes; it constrains the CLI, not the protocol._

- **EV-18.** **Reserved type-name prefix.** No contracts version — v1 or any
  successor — MAY register an event `type` beginning `x_`, and a conformance
  fixture exercising the unregistered-**type** path (`PARTIAL`, EV-7/EV-8) MUST
  use a `type` beginning `x_`. The obligation is on the type path only; the
  unregistered-**version** path cannot satisfy it and is governed by EV-19
  instead. The prefix satisfies ES-10. Both halves are needed:
  without the reservation, a frozen `PARTIAL` vector is a time bomb — were its
  placeholder type later registered for real, a newer verifier would run Stage B
  on it and contradict a fixture that `contracts-guard` makes uneditable; without
  the obligation on fixtures, a vector could simply pick a plausible future type
  name and re-arm it.
- **EV-19.** **Reserved version range.** No contracts version — v1 or any
  successor — MAY register a `(type, version)` whose `version` is **1000000 or
  greater**, and a conformance fixture exercising the unregistered-**version**
  path (a registered `type` at a `version` outside the registry, ET-2/ET-2a) MUST
  use the value **1000000 exactly**. The reservation is open-ended so that no
  future registration can ever reach it; the obligation on fixtures names a single
  value so that a conformance vector can never carry a `version` near ES-5's
  `2^53-1` ceiling and strain an implementation's `version` parser. 1000000 sits
  inside a signed 32-bit integer, and versions are per-type and increment from 1
  (EV-2, ES-13), so it is unreachable by ordinary evolution.

  This is EV-18's reservation applied to the other half of the registry key, and
  it exists because EV-18 alone cannot cover this case: the unregistered-version
  path can only be exercised by a **registered** type name, which EV-18's `x_`
  obligation forbids, so without a reserved version the path is untestable by
  fixture without arming exactly the time bomb EV-18 defuses. A frozen `PARTIAL`
  vector on, say, `participant_registered` version 2 would be contradicted the day
  EV-1 adds that version for real.

## 5. The one type that must be registered (added in v4)

- **EV-20.** **A chain's `genesis` event MUST carry a `(type, version)` the
  verifier registers.** A chain whose first line does not is **`INVALID` at line
  1**, and the verifier MUST NOT proceed to a chain-level `VALID` or `PARTIAL`
  verdict. This is the **sole exception to EV-8**, and it is a **Stage A
  promotion for `genesis` alone**: the registration check (`event-schema.md`
  ES-9/ES-11), which EV-15 assigns to Stage B everywhere else, is Stage A at line
  1.

  The justification is structural rather than stylistic. `genesis` is the only
  event whose **payload a verifier must read in order to check any other event**:
  `operator_pk` and `registrar_pk` live there (`event-types.md` ET-9a), and
  reading them is itself Stage B (EV-15). With an unregistered `genesis` those
  keys cannot be extracted at all, so **every** later signature becomes
  uncheckable — and without this rule a verifier could walk such a chain to
  `PARTIAL`, which means "integrity confirmed, some semantics unchecked", over a
  chain on which **nothing was ever authenticated**. That is the one place the
  forward-compatibility posture of EV-8 would announce success about a chain it
  could not check at all, so `genesis` is carved out of it. The general rule is
  unaffected: an old verifier still confirms the integrity of a newer chain that
  has grown past it (EV-8), because a chain that has legally grown past a verifier
  still starts at a `genesis` that verifier registers.
- **EV-21.** **What a verifier should say when it rejects under EV-20.** Reason
  text is advisory (EV-17), so this is **guidance, not a conformance
  requirement**: conformance for EV-20 is the token `INVALID` and the line number
  `1`, and nothing else is asserted by any fixture. A verifier SHOULD nonetheless
  distinguish, in its reason text, the two situations that produce that one
  verdict, because they ask opposite things of the reader:

  - **"this verifier does not register `(genesis, <version>)` — it may be out of
    date for this chain"**, and
  - **"this chain's genesis is corrupt or hostile"**.

  From the log alone the two are **indistinguishable**, and an honest message says
  so rather than picking one: naming the version encountered and the `genesis`
  versions the verifier does register lets the reader go and settle it. A verifier
  that reports the bare token here sends someone hunting for tampering when the
  remedy may be to fetch a newer verifier — and, worse, teaches readers to treat a
  legitimate newer chain as an attack.

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
| Which checks are Stage A vs Stage B (exhaustively)    | EV-15          |
| Malformed payload on an unknown type: INVALID/PARTIAL | EV-16          |
| Verdict precedence, line attribution, exit codes      | EV-17          |
| What a fixture asserts (verdict + line only)          | EV-17          |
| Placeholder type for `PARTIAL` fixtures               | EV-18          |
| Placeholder version for `PARTIAL` fixtures            | EV-19          |
| Unregistered `genesis` version: the verdict           | EV-20          |
| What that rejection should tell the reader            | EV-21          |

## Acid-test walkthrough

Two verifiers built for `contracts-v1`, run on a chain that contains a
hypothetical v2 `delegation_created` event, both: pass Stage A on every line
(including the v2 event, hash-recomputed by the generic rule, HA-7), find the v2
`(type, version)` outside their registry, skip Stage B for it, and report
`PARTIAL` naming that line — never `INVALID` (EV-7/EV-8/EV-9). Run on a chain
whose **`genesis`** is at a version neither registers, both report `INVALID` at
line 1 rather than walking a chain they cannot authenticate to `PARTIAL`
(EV-20), and both say which of "my registry is old" and "this genesis is
hostile" they cannot tell apart (EV-21). Run on a pure-v1
chain, both report `VALID | INVALID` identically (EV-10). Given the same future
`delegation` fixtures with a `supersedes` chain, two interpreters resolve the
same surviving events by `max(seq)` transitivity (EV-12). No cross-version or
correction ambiguity remains.
