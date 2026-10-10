# ADR-0032 — Anchor comparison follows file checks; endpoint reports are stored claims

**Status:** Accepted by the operator, 2026-10-09; contract amendment merged in #224 (`b8b9491`).
**Scope:** `export-format.md` v4 → v5. No hash construction or wire-format change.

## Context

#220 and #221 added expected-chain comparison and endpoint reports, but disclosed
three ambiguities: an existing file error versus an anchor mismatch, stored
versus recomputed hashes on invalid input, and unavailable endpoint fields.
EX-24 demanded values even when a malformed endpoint had none. EX-22 lacked
EX-15's comparison condition. Cross-language agreement does not settle a spec.

The scoped security checkpoint reproduced the current policy in both CLIs.
The operator approved stored-claim/unavailable reporting and structural-error
precedence, then explicitly chose to preserve registered-event semantic errors
ahead of anchor mismatch as well. This records those decisions, rather than
silently inheriting them from implementations.

## Decision

Complete file checks first. An existing structural or registered-event semantic
INVALID retains its attributed line. Only a file otherwise VALID or PARTIAL is
compared to supplied anchors. When both anchors mismatch, chain mismatch wins
at line 1; otherwise head mismatch is attributed to the last line. Expected
anchors cannot turn opaque semantics into full semantic verification.

Report recoverable stored endpoint hash fields, explicitly described as claims
in the output interface. Report an unavailable endpoint without hiding the other
one. These forensic values are not successful recomputations, and an INVALID
verdict does not authenticate them. Input-record extraction includes malformed
and unterminated records; only the one framing LF is excluded from candidate
records. Empty input and tool failures without verdicts have no report obligation.

## Alternatives

- Let a wrong chain override any later file error: rejected by the operator.
  It would change both implementations' current line attribution.
- Require recomputed hashes on every invalid input: some malformed records have
  no computable preimage. Optional recomputations need separate labels.
- Put report values into golden fixture expectations: rejected; EV-17 defines
  verdict/line conformance, and EX-24 intentionally permits different interfaces.

## Consequences and validation

The amendment matches current CLI behavior; source rewrites are unnecessary.
It removes ambiguity without changing golden data or cryptographic primitives.
`docs/security/attacks/check-anchor-policy.py` exercises both actual CLIs using
existing fixtures and temporary malformed files, including structural and
semantic errors plus wrong anchors. It pins documented CLI report labels for
these implementations, not a global presentation requirement.

This does not settle mixed-version ballot batching, implementation resource
limits, or the remaining T9 questions. It does not clear T9 or start ledger.

## Documents reconciled

- `contracts/export-format.md`: EX-15 and EX-22–EX-24, version 5.
- `contracts/CONTRACTS-CHANGE.md`: records the amendment and unchanged golden data.
- `services/verifier/API.md` and `tools/verifier-ts/README.md`: already document
  the chosen all-file-check precedence, stored fields and unavailable values;
  no verifier source was read or changed for this amendment.
- EV-15's independent stage-map correction merged in #203 (`25ff5af`). Classification of
  a comparison as type-agnostic does not require it to replace an existing
  registered-event error; EX-15/EX-22 specify its eligibility explicitly.
- Charter §4 and `docs/implementation-plan.md`: identity and head still provide
  independent out-of-band checks; report presentation is left to each CLI.
- Core memory records the approved policy separately from its pending merge.

Checkpoint self-review (2026-10-09): APPROVE. Rebased after #222 while preserving
its fixtures v14 entry and #203's evolution v6 entry. Both CLIs pass all 16
policy cases against the 115-vector tree. The required repo job runs these
checks after building each CLI; golden fixture bytes remain unchanged.
