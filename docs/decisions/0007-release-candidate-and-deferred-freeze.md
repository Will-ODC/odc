# ADR-0007: Release candidate state; the freeze is gated on operational experience

- **Status:** accepted
- **Date:** 2026-07-25
- **Phase:** 0

## Context

The plan as written treats `contracts-v1` as the milestone immediately following
the T9 security audit, and uses the irreversibility of hashing as an argument to
settle open questions **now**: cheap before the tag, impossible after.

The asymmetry is real. `contracts-guard` hard-fails any change to `hashing.md`
or `contracts/fixtures/` once the tag exists, so a mistake frozen there is
permanent. But the asymmetry argues the opposite way from how the plan used it.
Today the operator holds the **least** information he will ever hold about what
events need to carry, who uses the system, and what actually gets voted on. The
correct response to "this decision is irreversible" is to defer it until the
information improves — not to make it faster.

Three documents state that no service code may be written until `contracts/` is
frozen:

- `memory/STATE.md` — "Nothing may be implemented in services/ until contracts/
  passes the genesis rehearsal and is frozen."
- `contracts/README.md` — "No service code may be written until the genesis
  rehearsal passes and this directory is frozen."
- `docs/implementation-plan.md` §Phase 0 — "agreed and frozen before Phase 1."

Deferring the tag under those rules **deadlocks the project**. Freezing on
operational experience requires real votes; real votes require the ledger,
identity, and web services; those services may not be built until the freeze.
Freeze → services → use → freeze is a cycle with no entry point.

A second problem: T9's audit approves `contracts/` as it stands on audit day. If
specs may still change after it — which is the entire benefit being bought — then
what eventually freezes is not what was audited.

## Decision

**1. A third state, `RELEASE CANDIDATE`.** `contracts/` moves DRAFTING → RELEASE
CANDIDATE → FROZEN, rather than DRAFTING → FROZEN.

- **DRAFTING** — specs may change freely. Today's state.
- **RELEASE CANDIDATE** — entered when T9's audit passes. No changes are
  _expected_; any change is additive, version-bumped, logged in
  `CONTRACTS-CHANGE.md`, and re-reviewed exactly as today. **Phase 1 services MAY
  be built against a RELEASE CANDIDATE.** No tag exists, so `contracts-guard`'s
  freeze branch stays dormant and mistakes remain fixable.
- **FROZEN** — the `contracts-v1` tag exists. `hashing.md` and
  `contracts/fixtures/` become permanently immutable.

**2. The three "no service code until frozen" rules are amended** to "until
`contracts/` reaches RELEASE CANDIDATE."

**3. The freeze is gated on operational experience, not only on T9.** T10 stops
being a near-term deliverable. T5–T9 keep their full value and their schedule —
they are how correctness is established, and they are cheap to redo. What waits
is the tag.

**4. A re-audit is required immediately before the tag.** T9's approval covers
the specs as audited; if anything changed during the release-candidate period,
the delta must be audited before it becomes permanent. A clean re-audit with an
empty delta is cheap.

**5. Freeze-readiness signals.** The tag SHOULD wait until all of these hold:

- A real community has run at least **three binding votes** on a live chain.
- **No event-shape change** has been needed for at least **four consecutive
  weeks** of real use.
- **Two independent verifiers** (the T7 Go build and the TypeScript
  implementation) agree on a **non-synthetic** chain — one produced by real use,
  not by the rehearsal generator.
- The T9 re-audit passes on the exact tree to be tagged.

These are signals for a human judgment call, not an automated gate. The operator
decides; this list exists so the decision is made against stated criteria rather
than impatience.

## Consequences

- **Phase 1 is unblocked** without the tag. Services build against a
  release-candidate `contracts/`, which is a weaker guarantee than FROZEN and is
  stated as such: a Phase 1 service MUST tolerate an additive contracts change
  during this period.
- **The forcing function is lost.** T9→T10 same-day created a deadline; nothing
  replaces it. The readiness list is the mitigation — drift is visible against
  stated criteria.
- **Two audits instead of one.** Accepted cost.
- **`hashing.md` correctness is unaffected by this ADR.** Nothing here validates
  the byte-level spec. That is settled by the T7 fresh-context Go verifier
  reproducing the fixtures independently (T8), and by nothing else. What changed
  is only that the question is no longer urgent.
- **The reflexive point, named rather than hidden:** a system premised on
  collective decision-making currently has its foundational choices made by one
  operator by fiat. That is unavoidable at bootstrap — there is no community yet
  to decide — and this ADR reduces how much gets permanently fixed before one
  exists.

## Charter check

- **P1 (anyone can recompute).** Strengthened. Recomputability depends on the
  hashing spec being correct, and this buys more time to discover that it is not
  before the mistake becomes permanent.
- **P2 (one human, one vote).** Untouched.
- **P3 (the log records, views resolve).** Untouched.
- **P4 (no capability is purchasable).** Untouched.
- **§8 (fork/exit).** Strengthened for the same reason as P1: a wrong frozen
  hashing rule would be inherited by every fork.
- **§9 (protocol as commons).** A longer release-candidate period is more
  opportunity for outside review before the rules become permanent.
