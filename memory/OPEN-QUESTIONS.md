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
- ~~Correction/retraction model — ADR-0005 needs human ratification~~ →
  **RATIFIED 2026-07-23.** Item 1 (the envelope will never carry a `supersedes`
  field) is confirmed by the human; the six-field envelope / six-field preimage
  freeze as drafted. Corrections arrive as additive payload conventions per
  ADR-0005 (T4 `evolution.md` carries the template). v1 ballot finality stands
  (registrar refuses re-votes; no correction may ever touch the ballot plane
  per ADR-0004). ADR-0005 should be flipped `proposed` → `accepted` when T4
  lands its `evolution.md` correction-conventions section.
- ~~Verifier scope & forward compatibility — needs an ADR BEFORE T4 starts.~~ →
  **RESOLVED by ADR-0006 (accepted 2026-07-23).** Two-stage verification:
  Stage 1 (envelope/chain/hash) is type-agnostic and runs on every event;
  Stage 2 (sigs, payload keys, title, choice range, back-refs) applies only to
  known `(type, version)`; unknown types yield a distinct non-silent verdict at
  **exit code 2** (chain intact, semantics unchecked) — 0 = fully valid,
  1 = invalid. ES-9/ES-11/ET-1's blanket "reject unknown type" is re-scoped to
  Stage 2 by T4 `evolution.md` (T3 not edited in place). **Binds T4:**
  `hashing.md` MUST define the payload preimage generically over any flat
  int/string payload (mechanical key-walk, sort by key bytes), not per-type
  field lists. The ballot carve-out stays type-aware: ADR-0004's choice-range
  check (ET-18a) and ET-22's no-unbounded-voter-value rule are load-bearing for
  receipt-freeness and stay Stage-2, not generic. The "one generic/flagged
  ballot-poll event" alternative is rejected in ADR-0006 §6 (violates plane
  separation, rule 7, and receipt-freeness).
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
