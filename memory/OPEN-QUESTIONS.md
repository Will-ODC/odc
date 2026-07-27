# Open Questions

Unresolved design questions. Move each to an ADR when decided; delete when moot.

- ~~Canonical JSON serialization~~ → DECIDED: fixed-field-order byte
  construction, strict rejection (D3/D5 in docs/plans/phase-0.md; ADR in T3).
- ~~Signature scheme~~ → DECIDED: Ed25519 (D2; ADR in T3).
- ~~Ballot unlinkability vs. signed `vote_cast` (charter §5 tension)~~ →
  DECIDED (ADR-0004): voter-held ballot keys removed entirely — a voter-held
  key is a demandable receipt (§5, §8). `vote_cast` is registrar-signed
  (`registrar_pk` declared in `genesis`), payload `{issue_id, choice, sig}`,
  `choice` bounded by the issue's `choice_count`. No voter-held artifact can
  prove any ballot; votes are also no longer linkable to one another on-log.
- **Registrar-side ballot privacy (Phase 1 identity design, from ADR-0004).**
  In v1 the registrar (identity service) necessarily sees `{who, issue,
choice}` at eligibility-check time — trust-by-policy per charter §10 v1,
  removed by blind-signature credentials in identity v2. Phase 1 must design:
  registrar key custody (separate from `operator_pk`, held only by identity);
  one-human-one-issue enforcement and its audit trail (off-log); and the
  no-receipt discipline — identity and web MUST NOT return or display any
  per-ballot confirmation artifact binding a voter to a specific log line
  (no signed receipts, no "your vote is seq N" attestations).
- ~~Verifier reason codes~~ → DECIDED (2026-07-25, T4a / EV-17): **no
  reason-code registry exists or will be defined for v1.** Reason text is
  advisory and SHOULD name the violated sentence (`ES-7`, `HA-14`) rather than a
  new vocabulary; conformance is judged on verdict token + line number alone.
  Rationale: one tampered line usually violates several sentences at once, so
  exact-match codes would silently require freezing a total precedence order over
  every check — and splitting a coarse distinction later is additive, while
  un-freezing a wrongly-named code in a frozen fixture is not.
- **⚠️ Before writing the "definitional vs provisional constraints" ADR.** A
  draft of that ADR classifies three things as _provisional_ and therefore fair
  game for future community governance: the absence of a voter field in
  `vote_cast`, the no-re-vote rule, and `choice_count`'s ceiling of 64. **Two of
  those contradict merged normative text.** `event-types.md` ET-22 and
  `evolution.md` EV-13 each state their bar "survives any future community vote
  (charter §8)". The correct cut is finer:
  - **Permanent:** the entire ET-22 bar (no voter-held key, no voter-key
    signature, no unbounded voter-chosen value); the ballot plane's exclusion
    from all correction mechanisms (EV-13); _that a bound on `choice_count`
    exists at all_.
  - **Provisional:** the registrar's one-ballot-per-human policy, which EV-13
    itself calls policy; and the specific number **64**.
    Writing it the draft's way would read as license to revisit receipt-freeness
    by vote.
- **`RETIRED.md` valve — deferred, deliberately not foreclosed.** There is no
  mechanism to withdraw a golden fixture that turns out to be wrong after the
  freeze; adding a fixture cannot neutralise a bad one, so a wrong vector would
  break conformance permanently. PR #9 makes post-freeze _additions_ legal, so a
  `contracts/fixtures/RETIRED.md` could be introduced later if a wrong vector is
  ever actually found. Not built now: with no concrete case to reason about it is
  premature, and a withdrawal lever is morally the same act as regenerating a
  golden hash, which `odc-testing` forbids. Revisit only with a real instance.
- **Is EV-5's "every additive change MUST ship golden fixtures" too broad?** For a
  new type or a new `(type, version)` — new bytes, never hashed before — a fixture
  is load-bearing. For a pure prose clarification that changes no bytes it proves
  nothing. Narrowing EV-5 to byte-changing changes is worth considering; not
  urgent, and it does not affect PR #9's guard fix, which is required under even
  the narrowest reading.
- **Unregistered `genesis` version — Stage B key extraction.** If a chain's
  `genesis` carries a `(genesis, version≠1)` a verifier does not register, that
  verifier has no spec-defined way to extract `operator_pk`/`registrar_pk`, and so
  cannot run Stage B on _later, registered_ events that depend on them. Genuinely
  unresolved. Additively resolvable in `evolution.md` post-freeze, so not a freeze
  blocker — **provided no v1 fixture freezes a verdict for this case.** T5 must
  therefore not use `genesis` for its unknown-version vector; use
  `participant_registered`, a leaf type nothing references.
  **Amended 2026-07-27 (T5f, PR #28):** the version to use is
  **`RESERVED_VERSION` (1000000), not 2.** The original note reasoned only about
  genesis key extraction and missed EV-18, which requires every `PARTIAL` fixture
  to use a reserved placeholder — and version 2 is not reserved, so a frozen
  `PARTIAL` on `participant_registered` version 2 would be contradicted the day
  EV-1 registers that version for real. **EV-19** now reserves the `version` range
  `>= 1000000` for exactly this, mirroring EV-18's `x_` type prefix. The genesis
  question itself is untouched and still open; `conformance.test.ts` enforces that
  no vector freezes a verdict for it, and EV-19 does not relax that.
- **Should HA-2's reject-don't-repair be pinned by a fixture, not only a unit
  test?** (Raised by the T5a review, 2026-07-26.) HA-2's closing MUST — reject a
  string whose decoded value is not well-formed UTF-8 — is now covered by a unit
  test in `tools/fixtures-gen`, but nothing in `contracts/fixtures/` exercises it,
  so **T7's Go verifier has no vector telling it to reject rather than repair**.
  A vector would have to carry genuinely ill-formed bytes (e.g. a bare `0xED
0xA0 0x80` surrogate sequence inside a JSON string), which is expressible —
  vectors are read as raw bytes — but interacts with EX-2's UTF-8 requirement and
  EX-9's escaping rule in ways nobody has worked through: is such a line an
  `INVALID` at HA-2, at EX-2, or is it unparseable framing under EX-20? Whichever
  it is, it needs deciding before a vector freezes an answer. Not urgent, and
  additive later, but it is exactly the class of divergence T8 exists to catch —
  and the one place a repair-vs-reject disagreement would surface as a mysterious
  verifier bug rather than a fixture bug. Two mechanics to note when it is taken
  up: the generator can no longer emit such a vector by its normal path (its
  encoder now throws), so it must be built as a post-encode `editLine` mutation,
  the mechanism T5d established; and conformance asserts verdict token + line
  number only (T4a), so the vector is cheap to add but proves nothing unless it
  fails for the intended reason — which is what the EX-2/EX-9/EX-20 question
  above decides. Natural home: **T5f**, with the envelope `INVALID` vectors.
- Operator key + identity service key management for MVP: file, env, or KMS?
  (Needed by Phase 1 identity/ledger tickets, not Phase 0.)
- Anchoring cadence and venue for the chain head in v1 (manual README anchor
  at genesis per phase-0 plan; automation cadence is a Phase 1+ question.)
- ~~Correction/retraction model~~ → DECIDED (ADR-0005, ratified 2026-07-24 in
  PR #6): the envelope never carries a `supersedes` field; corrections arrive
  as additive payload conventions (`evolution.md` EV-11–EV-14). Ballot plane
  permanently excluded from correction (ET-22, ADR-0004).
- ~~Verifier scope & forward compatibility~~ → DECIDED (ADR-0006, accepted
  2026-07-24 in PR #6): two-stage verification — chain/envelope checks stay
  type-agnostic, registry checks apply to known `(type, version)`s, and a
  well-formed-but-unregistered type gets `PARTIAL` (not structural `INVALID`),
  per `evolution.md` EV-6–EV-10. `hashing.md` HA-7 defines the payload
  preimage generically over any flat int/string payload so unknown-type
  hashes remain computable. The pre-freeze follow-up — inline EV-9
  cross-references at the T3 sentences this reinterprets — is **done** (T4a,
  PR #10): `event-schema.md` ES-11 and the new `event-types.md` ET-2a. Brought
  forward from the T9/T10 gate because T7 runs before the freeze review and is
  the session most likely to be misled by a bare "MUST reject".
- **Sanction/negative events (Phase 2, deferred — NOT a freeze blocker).**
  Contribution-style derived views only count up until negative events exist;
  charter §7 requires failure/fraud to crater standing and §9 makes
  moderation a public event. Additive event types + interpreter formula
  change cover this post-freeze; recompute-over-whole-log means no retrofit
  is needed. Design belongs to the Phase 2 reputation/moderation tickets.
- **Money/attestation/capability event design (Phase 2+, deferred).** From
  unratified external notes, the parts that survived review: money
  authorization events on-log with `payment_settled` referencing its
  authorization by event hash (P1 — settlement _records_ are on-log even
  though the transfer is real-world); attestation events record method/
  attestor/time as facts (strength mappings are a view/policy concern, P3 —
  do not encode a strength number in the event); capabilities = grant/revoke
  events + derived policy over contribution and attestations, never
  purchasable (§7); no "nullable" fields ever — absence is expressed by a
  later per-type `version` bump, not a null (ES-3/ES-16). Attestation tiers
  may gate _execution_ capabilities and which parallel tallies a ballot
  feeds — never ballot access itself (P4).
