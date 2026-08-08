# Open Questions

Unresolved design questions. Move each to an ADR when decided; delete when moot.

- ~~Canonical JSON serialization~~ → DECIDED: fixed-field-order byte
  construction, strict rejection (D3/D5 in docs/plans/phase-0.md; ADR in T3).
- ~~Signature scheme~~ → DECIDED: Ed25519 (D2; ADR in T3).
- **Ballot unlinkability vs. signed `vote_cast`** → DECIDED (ADR-0004): voter-held ballot keys removed entirely; `vote_cast` is registrar-signed, no voter-held artifact can prove any ballot.
- **Registrar-side ballot privacy (Phase 1 identity design, from ADR-0004).**
  In v1 the registrar (identity service) necessarily sees `{who, issue,
choice}` at eligibility-check time — trust-by-policy per charter §10 v1,
  removed by blind-signature credentials in identity v2. Phase 1 must design:
  registrar key custody (separate from `operator_pk`, held only by identity);
  one-human-one-issue enforcement and its audit trail (off-log); and the
  no-receipt discipline — identity and web MUST NOT return or display any
  per-ballot confirmation artifact binding a voter to a specific log line
  (no signed receipts, no "your vote is seq N" attestations).
- **Verifier reason codes** → DECIDED (T4a / EV-17, 2026-07-25): no reason-code registry for v1; reason text is advisory, conformance judged on verdict token + line number alone.
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
- **Ed25519 verification predicate** → DECIDED (ADR-0009 + ADR-0010, 2026-08-08).
  Pinned at the encoding level: `event-types.md` **ET-4a** (canonical `sig`:
  `S < L`; `R` masked `< p`) and **ET-4b** (canonical verification key `A` masked
  `< p`), checked on the raw decoded bytes before the verify primitive, rejected
  never repaired (D5) — makes RFC 8032's underdetermination unreachable. **AND
  pinned at the subgroup level: ET-4c requires every verification key to be
  prime-order — `[L]A == 𝒪 AND A != 𝒪`** (rejects all small-order AND mixed-order
  keys), so key legitimacy is verifiable from the log, not trusted-by-policy.
  **ADR-0010 REVERSES ADR-0009's prime-order exclusion** after a measurement
  resolved its two blockers: the two audited curve libraries
  (`filippo.io/edwards25519` Go, `@noble/curves` TS) AGREE on the predicate for
  all 11 points tested, and the stdlib-only rule is relaxed to permit one such
  library per verifier for the ET-4c check ALONE. Worded `[L]A == 𝒪 AND A != 𝒪`,
  NOT bare "torsion-free": noble's `isTorsionFree()` returns true for the identity
  (the `A != 𝒪` clause is load-bearing). Fixtures: `078` (ET-4b, discriminating),
  `079`/`080` (ET-4a, verdict-pinning), `081` small-order + `082` mixed-order
  (ET-4c, both discriminating), each isolating one rule under EV-5. Version-bound;
  the T10 re-audit re-measures.
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
  **PART A DONE 2026-08-02 (operator-ratified).** `charter.md` §5 now marks the
  aggregation-method list as **roadmap, not a v1 property**, states that a v1
  ballot is one choice from a small bounded set (plurality only), and fixes the
  ordering: where expressiveness and receipt-freeness collide, receipt-freeness
  wins. That much is honesty — §5 had promised in the present tense something
  the merged contract cannot compute from a single integer.
  **PART B IS STILL OPEN: where exactly the ceiling sits.** Deliberately NOT
  settled in the charter edit. The branch's proposed wording went further than
  ratified text supports — it would have required a richer ballot to "keep its
  value space small enough that a ballot cannot single out its caster", which is
  **stricter than ET-22**: a bounded-but-large space (10 options ranked = 3.6M
  orderings) satisfies ET-22's letter while failing that test. **That stricter
  criterion is the right starting point for the ADR**, but it is a new
  constraint, so it needs deciding rather than inheriting. Three options as
  framed: ballots stay one-choice forever and intensity lives in the sentiment
  stream; or richer ballots capped by a k-anonymity rule relating the number of
  distinct legal ballots to expected turnout; or defer until real turnout data
  exists. Default until someone argues otherwise: **stay one-choice**, the only
  option needing no assumptions about electorate size.
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
  audited" line is 20+ PRs stale.
  **DECIDED 2026-08-02 (operator). The audit is INPUT to T9, never merged as-is,
  and T9 creates `docs/security/` with its OWN output as the first file.** Both
  now written into the T9 ticket. Merging a stale audit would create a document
  that reads as authoritative and is not — the same disease this session spent
  the day curing, and deliberately doing it to a security document would be
  worse than the accidents. Its raw material is genuinely good and should not be
  re-derived, so T9 reads it the way a reviewer reads a previous review: useful,
  dated, not authoritative. The directory's boundary is stated in the same
  ticket — threat models and posture reviews, never secrets — which is
  consistent with charter §9.
  **The doc-drift gap is fixed at its source, not by a sweep.** The obvious
  reaction was to add "check docs outside `contracts/`" to T9. Rejected: it is
  unbounded (so it gets skimmed), it is an accuracy job wearing a security
  ticket's clothes (diluting the audit at the one gate you want sharp), it runs
  at the LAST possible moment since Phase 1 begins right after T9a, and a sweep
  is a snapshot rather than a guard. **The failure did not happen at T9 — it
  happened at ADR-0004**, which changed the ballot model and left two documents
  stating the old one. So:
  1. `docs/decisions/0000-template.md` gains a **"Documents reconciled"**
     subsection: every ADR must list the documents outside `contracts/` that
     stated what it changes and fix them in the same PR, or say explicitly that
     none needed changing. Prevention, in the PR where the author still has the
     context, and the only person who reliably knows the answer.
  2. **T9a** gains a bounded backstop over the only three things that state
     normative behaviour outside `contracts/` — `docs/implementation-plan.md`,
     `docs/charter.md`, `services/*/CLAUDE.md`. A named list, checkable in an
     hour, at the moment Phase 1 starts building from them.
     A CI grep for now-false phrases was considered and rejected: it needs updating
     on every ADR, and a stale denylist gives false confidence, which is the
     disease rather than the cure.
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
- **Correction/retraction model** → DECIDED (ADR-0005, PR #6): no `supersedes` field; corrections are additive payload conventions (EV-11–EV-14); ballot plane permanently excluded (ET-22, ADR-0004).
- **Verifier scope & forward compatibility** → DECIDED (ADR-0006, PR #6): two-stage verification — chain/envelope checks type-agnostic, registry checks per `(type, version)`; unregistered types get `PARTIAL` (EV-6–EV-10). Cross-references landed in T4a (PR #10).
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
- **`event-types.md` unit contradiction (ET-14 characters vs. scalar values)** → DECIDED (T5i): normative sentence ("Unicode scalar values") governs over the payload table; table corrected, `event-types.md` → v3. No fixture verdict shifted; T7's start unblocked.
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
- **A second, independent TS verifier has no ticket** → DECIDED: ticketed as **T7b** in `docs/plans/phase-0.md` (2026-08-02), slotted after T7 and before T8, same fresh-context/contracts-only isolation as T7 (extended to exclude `services/verifier/`). Gates the freeze decision (ADR-0007 §5).
