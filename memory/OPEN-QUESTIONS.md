# Open Questions

Unresolved design questions. Move each to an ADR when decided; delete when moot.

- ~~Canonical JSON serialization~~ → DECIDED: fixed-field-order byte
  construction, strict rejection (D3/D5 in docs/plans/phase-0.md; ADR in T3).
- ~~Signature scheme~~ → DECIDED: Ed25519 (D2; ADR in T3).
- **Ballot unlinkability vs. signed `vote_cast` (charter §5 tension).** T3's
  `vote_cast` (event-types.md ET-20/ET-21) is signed by a stable `ballot_pk`,
  which is unlinkable to any public `participant_id` on the log but links a
  voter's own votes to one another, and the log itself enforces neither ballot
  eligibility nor one-human-one-vote. v1 leans on the identity service holding
  the ballot-eligibility linkage privately, off-log (charter §10 v1); full
  receipt-freeness + unlinkable eligibility (blind-signature credentials) is
  deferred to identity v2 (charter §5, §11). RESOLVE in Phase 1 identity design:
  how are ballot keys issued/authorized without linking to personhood, and does
  a richer/anonymized `vote_cast` version follow (additive, `evolution.md`)?
- Operator key + identity service key management for MVP: file, env, or KMS?
  (Needed by Phase 1 identity/ledger tickets, not Phase 0.)
- Anchoring cadence and venue for the chain head in v1 (manual README anchor
  at genesis per phase-0 plan; automation cadence is a Phase 1+ question.)
