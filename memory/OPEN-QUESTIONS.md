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
- **⚠️ Ed25519 verification is NOT one predicate, and nothing pins ours. Needed
  before T7.** (Recovered 2026-08-02 from `claude/review-memory-context-skills-383f6i`,
  a branch whose content never landed.) RFC 8032 leaves several cases
  underdetermined: non-canonical `R`/`A`/`S` encodings, small-order public keys,
  and cofactored vs cofactorless verification. Go's `crypto/ed25519` and Node's
  `node:crypto` can therefore **disagree on identical bytes**, both conformant.
  Nothing in `contracts/` says which we mean. **T7 (Go) and T7b (TS) will each
  silently pick their library's default**, which is precisely the cross-language
  divergence the two-verifier architecture exists to expose — but only if a
  fixture forces it, and none does. **Immediate constraint regardless of how it
  is decided: no fixture may assert a verdict that depends on any of those edge
  cases**, because a wrong frozen verdict is unfixable. Decide before T7 starts;
  the cost rises once two verifiers exist and disagree.
- **⚠️ Ballot expressiveness vs receipt-freeness — a live contradiction in
  merged text.** (Recovered 2026-08-02 from
  `claude/golden-fixtures-voting-verify-7urqku`, never landed.) `docs/charter.md`
  §5 promises "multiple aggregation methods in parallel (approval,
  ranked-choice/STV, quadratic, others) computed from the same ballots", in the
  present tense and unqualified. `event-types.md` **ET-22** permanently bars any
  "unbounded voter-chosen value" in a ballot payload, and ADR-0004 ratified that
  as surviving any future community vote. **A quadratic ballot is definitionally
  a voter-chosen vector of magnitudes.** So the two cannot both stand as written.
  Three ways through, none chosen: hard-bound the value space; move intensity
  into the sentiment stream (which never shares a store or a pipe with ballots);
  or accept a permanently nominal tally. **Counter-intuitive point worth keeping:
  ranked-choice is the WORSE covert channel, not the better one** — N! orderings
  carry more marker capacity than a bounded quadratic budget. The branch also
  carries a proposed `charter.md` §5 edit resolving this in §8's favour;
  **that edit is deliberately NOT applied here.** The charter governs everything
  else and its own author marked the commit "subject to operator ratification" —
  it needs an operator decision, most likely as the queued
  "ballot-expressiveness ceiling" direction ADR, not a routine docs merge.
- **`hashing.md` HA-9's example does not demonstrate what HA-9 claims. Pre-tag
  fix.** (Recovered 2026-08-02 from the same branch; **verified empirically**.)
  HA-9 says the 1-octet type tag is load-bearing "because the integer value `1`
  and the string value `\"1\"` under the same key encode to different bytes".
  They do — but by LENGTH: `ENC_INT(1)` is 8 octets `0000000000000001` and
  `ENC_STR("1")` is 9 octets `000000000000000131`. They would differ with no tag
  at all, so the example proves nothing about the tag. The case that actually
  proves it is **int `0` vs string `""`**: both encode to 8 zero octets, byte
  identical, and ONLY the tag separates them. Swapping the example changes no
  byte, no digest and no fixture — but `hashing.md` is immutable once
  `contracts-v1` is tagged, so it must land before the tag or the spec keeps a
  worked example that does not support its own sentence.
- **A security posture audit exists on a branch and has never landed.**
  `claude/odc-security-posture-audit-urgrjs` holds `docs/security/posture-audit.md`
  (406 lines); `docs/security/` does not exist on master. It is explicitly NOT
  the T9 audit — it inventories the four secrets the system will eventually hold
  (operator key, registrar key, the private linkage map, and the registrar's
  `{who, issue, choice}` knowledge — none of which exist yet), ranks ten
  findings, and proposes a milestone-keyed concealment timeline on the principle
  "conceal keys and identity linkage; never conceal rules, formats, or logic".
  **Its top finding is already fixed** (2026-08-02): the ledger docs described
  the pre-ADR-0004 voter-signed ballot. The rest is unreviewed and its "tree
  audited" line is 20+ PRs stale. Decide whether `docs/security/` is a directory
  this project wants before landing it, and re-base it if so. **T9's checklist
  does not currently include a sweep for stale claims in docs OUTSIDE
  `contracts/`** — which is how the ledger contradiction survived; worth adding.
- **`RETIRED.md` valve — deferred, deliberately not foreclosed.** There is no
  mechanism to withdraw a golden fixture that turns out to be wrong after the
  freeze; adding a fixture cannot neutralise a bad one, so a wrong vector would
  break conformance permanently. Post-freeze _additions_ are legal (PR #9, as
  corrected by **ADR-0008**), so a `contracts/fixtures/RETIRED.md` could be
  introduced later if a wrong vector is ever actually found. Not built now: with
  no concrete case to reason about it is premature, and a withdrawal lever is
  morally the same act as regenerating a golden hash, which `odc-testing`
  forbids. Revisit only with a real instance.
  **Amended 2026-08-02 (ADR-0008): this valve is now MORE load-bearing, not
  less.** The freeze rules make fixture `note` prose immutable along with the
  verdicts, so a vector later found wrong can no longer be annotated in place —
  `RETIRED.md` becomes the only route to flagging it. That was an accepted cost
  of keeping the freeze rule dumb enough not to fail open, but it removes the
  cheap intermediate option this entry previously had in reserve.
- **Is EV-5's "every additive change MUST ship golden fixtures" too broad?** For a
  new type or a new `(type, version)` — new bytes, never hashed before — a fixture
  is load-bearing. For a pure prose clarification that changes no bytes it proves
  nothing. Narrowing EV-5 to byte-changing changes is worth considering; not
  urgent, and it does not affect the post-freeze addition path (PR #9, corrected
  by ADR-0008), which is required under even the narrowest reading.
- **Unregistered `genesis` version — Stage B key extraction.** If a chain's
  `genesis` carries a `(genesis, version≠1)` a verifier does not register, that
  verifier has no spec-defined way to extract `operator_pk`/`registrar_pk`, and so
  cannot run Stage B on _later, registered_ events that depend on them. Genuinely
  unresolved. Additively resolvable in `evolution.md` post-freeze, so not a freeze
  blocker — **provided no v1 fixture freezes a verdict for this case.** T5 must
  therefore not use `genesis` for its unknown-version vector; use
  `participant_registered`, a leaf type nothing references.
  **Amended 2026-07-26 (T5f, PR #28):** the version to use is
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
- ~~`event-types.md` contradicts itself about the unit ET-14 counts~~ →
  DECIDED (T5i): the `issue_created` payload table then read "1–200 **UTF-8
  characters**" while ET-14's normative sentence read "1–200 Unicode **scalar
  values**" — readings that differ by a factor of 4 on astral titles, and that
  `072`/`073` made load-bearing. Where a table and a numbered RFC-2119 sentence
  disagree, the sentence governs; table corrected to match, `event-types.md`
  → v3. ET-14 is unmoved and no fixture verdict shifts, but the edit does
  narrow the admissible readings — legal only because `contracts/` is still
  `DRAFTING` (EV-1 binds post-freeze changes). **T7's start is unblocked.**
- **`genesis`'s `operator_pk` and `registrar_pk` have no numbered format rule.**
  Both are pinned to `^[0-9a-f]{64}$` only in the `genesis` payload table; no
  `ET-n` sentence states it. ET-7 derives `chain_id` from `operator_pk_bytes`
  and ET-9a describes `registrar_pk`'s role, but neither gives the format, and
  `ids.md` ID-3 reaches only `participant_registered.pubkey`. Found by the T5i
  review (2026-07-28) while testing the claim that tables are advisory — they
  are not, and here the table is the sole source. T7 must enforce a constraint
  with no numbered home. **Resolution is a new `ET-9b`**; not made in T5i,
  which is a one-cell correction and would otherwise have carried an
  unreviewed new normative sentence. Not blocking T7 the way ET-14 was — the
  constraint is at least _stated_, and no fixture contradicts it.
  **Ticketed 2026-08-02 as `T5j`** in `docs/plans/phase-0.md`, to run after T6d
  and before T7. **It MUST land before the freeze, not merely should.** `evolution.md` EV-1:
  "An existing frozen `(type, version)` schema MUST NOT be altered." Adding
  `ET-9b` after the `contracts-v1` tag would alter frozen `genesis`/v1, so
  deferring past the freeze does not postpone the fix — it makes it unaddable
  and leaves the constraint table-only permanently. Do not let it slip past T9.
  **No fixture exercises it.** All 73 vectors checked: none asserts `INVALID`
  on a malformed `operator_pk`/`registrar_pk`. `055-genesis-sig-wrong-key` is a
  wrong _signing_ key (ET-8) and the `chain_id` vectors are derivation
  failures — neither is a bad-format key. A T7 verifier that omits the format
  check passes 73/73 with no signal, so `ET-9b` needs a vector alongside it
  under EV-5 ("every additive change MUST ship its own golden fixtures").
- ~~**A second, independent TS verifier has no ticket yet.**~~ → **TICKETED
  (2026-08-02): `T7b` in `docs/plans/phase-0.md`**, slotted after T7 and before
  T8, with the same fresh-context/contracts-only isolation T7 gets — extended to
  exclude `services/verifier/` as well, so T7b cannot be a transliteration of
  T7. It gates the **freeze decision** (ADR-0007 §5's two-independent-verifiers
  signal), not T8, T9 or T9a. Original write-up kept below for the reasoning.
  `docs/plans/phase-0.md`
  T6 now commits, in prose, that "a second, independent TS verifier gets its
  own ticket — fresh context, contracts-only, the same treatment T7 gets —
  before the freeze." ADR-0007 §5 names the TypeScript implementation as one
  of the two independent verifiers (alongside T7's Go verifier) that the tag
  "SHOULD wait until" agreeing on a non-synthetic chain — one of the
  freeze-readiness signals §5 itself frames as "signals for a human judgment
  call, not an automated gate," not a hard requirement. That softer modal
  doesn't make the gap optional to track: it is still owed before the freeze
  decision is made, and no ticket exists anywhere in the plan for it — not in
  the T1–T10 stack, not as a T-number placeholder. Found during a
  fresh-context review of T6a (2026-07-29). It is owed before T10 (the freeze),
  must be built the way T7 is — fresh context, contracts-only, no prior
  exposure to `encode.ts`/`serialize.ts`/the Go verifier's source — and needs a
  ticket number and slot in the stack before it is forgotten.
