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
