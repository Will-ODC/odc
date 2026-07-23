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
- Operator key + identity service key management for MVP: file, env, or KMS?
  (Needed by Phase 1 identity/ledger tickets, not Phase 0.)
- Anchoring cadence and venue for the chain head in v1 (manual README anchor
  at genesis per phase-0 plan; automation cadence is a Phase 1+ question.)
- **Correction/retraction model — ADR-0005 `proposed`, needs human
  ratification BEFORE freeze (T10).** The only pre-freeze bit: the envelope
  will never carry a `supersedes` field (rejected; corrections arrive as
  additive payload conventions per the ADR). If ratification overturns this,
  it must land before T4 drafts `hashing.md`. Also fixes v1 ballot finality
  (registrar refuses re-votes; no correction may ever touch the ballot plane
  per ADR-0004).
  **→ RATIFIED 2026-07-23 → ADR-0005 status now `accepted` (full model): no
  `supersedes` envelope field; corrections arrive as additive payload
  conventions; v1 ballot finality (registrar refuses re-votes). T4 unblocked.**
- **Verifier scope & forward compatibility — needs an ADR (next free number)
  BEFORE T4 starts.** Two coupled decisions: (1) ES-9/ES-11/ET-1 as drafted
  make the verifier reject any unregistered `type`, so every future additive
  event type would invalidate every deployed frozen verifier — contradicting
  the evolution rule ("verifiers accept all published versions") and the
  fork/exit right (§8). Candidate fix: two-stage verification — chain/envelope
  checks are type-agnostic; registry checks (sigs, payload keys, title,
  choice range, back-refs) apply to known types; unknown types get a defined
  non-silent verdict. (2) For that to work, T4 `hashing.md` MUST define the
  payload preimage generically over any flat int/string payload (not
  per-type field lists), or unknown-type hashes are uncomputable. Semantic
  payload checks stay in the verifier for v1 types — ADR-0004's choice-range
  check is load-bearing for receipt-freeness and cannot move to a tally-side
  interpreter.
  **→ DECIDED 2026-07-23 → ADR-0006 (accepted): two-stage verification
  (Stage 1 type-agnostic chain integrity; Stage 2 per-known-type semantics),
  an `UNVERIFIED` verdict for unknown `(type, version)`, and a generic flat
  int/string payload preimage. T4 reworks ES-9/ES-11/ET-1 and writes the
  generic preimage in `hashing.md`.**
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

## From the hash-chain / schema / identity design review (2026-07-23)

- **v1 eligibility / enrollment mechanism — undecided (Phase 1 identity).**
  ADR-0004 fixes that the registrar admits ballots after an _off-log_
  eligibility check, but not _how_ personhood/eligibility is established. SSO
  (e.g. a UBC login) is a plausible v1 registration gate, but it proves
  _affiliation_, not _unique personhood_ — so it is best modelled as an
  attribute/eligibility gate (feeding a parallel tally, §5), NOT the personhood
  root, which the charter roots in humans-vouching-for-humans (§7, in-person
  strongest). "Registrar" here is an ODC-internal role (the identity service
  holding `registrar_pk`), not an external IdP; an SSO provider would be a tool
  it _consults_, not the registrar itself. If SSO is adopted as the v1 gate,
  record it as an ADR. Couples to the registrar-key-custody item above.
- **Ballot-payload extensibility guardrails / poll types.** v1 `vote_cast` is a
  single bounded integer `choice` (`0 ≤ choice < choice_count`, 2–64) —
  natively covers agree/disagree and single-select. Multi-select (approval),
  ranked (RCV/STV), and score ballots need a _different payload structure_ and
  therefore an additive `vote_cast` version, bounded by TWO permanent rules:
  bounded domain (ET-22 — no unbounded voter-chosen value = no receipt channel)
  and flat/byte-exact serialization (ES-16/17 forbid arrays today, so a bounded
  encoding must be defined). Aggregation method is unconstrained and free —
  parallel tallies interpret the same ballots (§5). Poll-type polymorphism
  belongs in the app/tally layer as an interface; the _on-log_ payload stays a
  closed, versioned, concretely-specified set (you hash concrete bytes, not an
  abstract interface). Couples to the generic-payload-preimage requirement in
  the verifier-scope item above.
- **Individual ballot verifiability is traded away in v1 (by design).** The
  _record_ is universally verifiable (counted-as-recorded: anyone recomputes
  every tally, P1), but a voter cannot verify _cast-as-intended_ or
  _recorded-as-cast_ for their own ballot — the voter holds no signing key and
  there is no voter-provable inclusion, because either would be a receipt
  (ADR-0004, §5/§8). Known way to regain _cast-as-intended_ confidence without a
  receipt: a Benaloh-style challenge (spoil-and-audit). Deferred; candidate for
  the identity-v2 / coercion-resistance work (§11).
- **Pseudonym reset / rotation after an outing.** A "get a new id" remedy is
  forward-only (append-only log never erases the past — §8, "remedies the
  future, not the past"). Ballot plane: nothing to reset (ballots carry no id);
  the v1 outing vectors (registrar knowledge, small-tally statistics) are
  untouched by a new key. Public plane: rotation is possible, but in v1 the
  registrar re-links it to the same human (so it does not hide from the
  operator), and it must be costly / rate-limited or it becomes a Sybil +
  reputation-laundering hole (§7). Real unlinkable rotation needs blind
  credentials + deniable-credential / re-voting machinery (JCJ/Civitas lineage)
  — identity v2, §11.
- **Attribute visibility differs by plane.** The same attestation (e.g. a UBC
  credential) is _fully public_ on the public plane (named, reputation-bearing,
  §6) but on the ballot plane may appear only in _aggregate_ and must stay
  coarse — a rare per-ballot attribute is a deanonymization / tagging channel
  (same hazard family as bounded `choice_count`). Unlinkability between the two
  uses is registrar-policy in v1, cryptographic (blind credentials) in v2.
  Design the attribute/attestation event types with this two-plane visibility
  split explicit (couples to the deferred attestation-event design above).
- **Doc inconsistency: `latest-per-participant` tally is unimplementable
  on-log.** `docs/implementation-plan.md` (§ledger: "Duplicate votes are
  recorded, not rejected … latest per participant wins") predates ADR-0004,
  which removed the voter key — so ballots are NOT linkable per-participant
  on-log and tally has no per-participant field to take the "latest" of.
  Reconcile with ADR-0005's proposed v1 ballot finality (registrar refuses
  re-votes; duplicates never reach the log). Resolve before T4 freezes anything
  assuming either behaviour. NOT yet ratified.
  **→ RESOLVED 2026-07-23 by ratifying ADR-0005 ballot finality (registrar
  refuses re-votes; no duplicate ballots on-log). `docs/implementation-plan.md`
  §ledger reconciled 2026-07-23 (vote signing key → `registrar_pk`; ballot
  finality; `identity` is in the v1 vote path per ADR-0004).**
