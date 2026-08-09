# ADR-0011: `registrar_pk` key-validation timing — check at genesis, not at first use

- **Status:** accepted
- **Date:** 2026-08-09
- **Phase:** 0

## Context

`event-types.md` ET-4b (canonical verification-key encoding) and ET-4c
(prime-order verification key) require a verifier to reject any verification key
that is non-canonically encoded or not in the prime-order subgroup. Both rules
name the same three keys: `operator_pk`, `registrar_pk`, and
`participant_registered.pubkey`. Both site the check "on the raw decoded key
octets, **before** the verification primitive (ET-5)."

For two of those keys the timing is unambiguous, because the key is _used to
verify a signature on the very line it is declared_: `operator_pk` verifies the
genesis self-signature (ET-8), and `participant_registered.pubkey` verifies its
own event's self-signature (ET-10). Declaration and first use are the same line,
so "before ET-5" pins the check to that line either way.

`registrar_pk` is the exception. It is **declared** at `genesis` (ET-9a) but the
genesis is _operator_-self-signed (ET-8), so `registrar_pk` is not used there. It
is first **used** to verify only at the first `vote_cast` (ET-17). The spec text,
read literally, sites the ET-4b/ET-4c checks at the verification primitive —
which for `registrar_pk` is reached only at `vote_cast` — while ET-9b already
checks `registrar_pk`'s _format_ at genesis. The spec did not say whether the
ET-4b/ET-4c checks fire at the genesis declaration or are deferred to first use.

The fresh-context Opus review of T7 (the Go verifier) surfaced this as the **one
place two conforming verifiers can diverge**, and no fixture disambiguated it:
vectors 078–082 all place the bad key on `participant_registered.pubkey` at line
2, where declaration and use coincide. The gap was recorded in
`memory/OPEN-QUESTIONS.md`. T7 shipped reading it the deferred way (ET-9b format
at genesis; ET-4b/ET-4c deferred to `vote_cast`).

Two conforming verifiers reading it differently would disagree on a real input:

- **Verdict**, on a chain whose `genesis` declares an illegitimate `registrar_pk`
  and has no `vote_cast`: `INVALID at line 1` (eager) vs `VALID` (deferred).
- **Line number**, on a chain that does vote: `INVALID` at line 1 (eager) vs at
  the `vote_cast` line (deferred).

ADR-0007 §5 makes "two independent verifiers agree" a freeze-readiness signal.
Here they would agree only by coincidence of independent readings — exactly what
T7b (the second, independent verifier) exists to expose.

## Decision

**Check at declaration.** ET-4b and ET-4c apply to `operator_pk` and
`registrar_pk` at the `genesis` line where each is declared (ET-9a), on the raw
decoded key octets — not deferred to a key's first later use to verify. A
`genesis` whose `registrar_pk` decodes to a non-canonical point (ET-4b) or a
small-order or mixed-order key (ET-4c) is `INVALID` at the genesis line on **any**
chain, including one with no `vote_cast`.

This is recorded normatively as **ET-9c** in `event-types.md` (v6 → v7), with the
ET-4b/ET-4c parentheticals, the rule-index, and the acid-test walkthrough updated
to match, and pinned by fixture **`083-genesis-registrar-pk-smallorder`**
(INVALID at line 1).

### Alternatives considered

- **Deferred / check at first use** (what the literal wording most nearly says,
  and what T7 does today). Rejected: it leaves the ballot-integrity anchor's
  legitimacy latent until a vote arrives, which is the weakest place to be lax;
  it is the _looser_ choice, and tightening it after the freeze would be a
  non-additive prohibition; and it requires every verifier to implement a
  "declared-but-unused key" special case, which is _more_ divergence surface, not
  less.
- **Split by property class** (ET-4b at genesis, ET-4c at first use). Rejected:
  most spec surface and the most nuanced rule to state, so the most room for two
  builders to diverge, for little gain — the opposite of what this decision is
  for.

The full options-and-tradeoffs analysis is summarized in
`memory/OPEN-QUESTIONS.md`.

## Consequences

- **The Go verifier (T7) must be brought into conformance.** It currently defers
  the ET-4b/ET-4c checks on `registrar_pk` to the first `vote_cast`, so against
  fixture 083 it would report `VALID` where ET-9c now requires `INVALID at line
1`. This is a small, well-scoped correctness fix, queued as its own ticket for
  `odc-verifier-builder` (fresh context). There is **no Go/verifier job in CI
  yet**, so landing fixture 083 does not turn CI red; the deferred-vs-eager
  mismatch is surfaced at the T8 genesis rehearsal — the same ordering T5j used
  (fixtures land first, the verifier is built/fixed to satisfy them).
- **T7b (the second, independent verifier) inherits an unambiguous contract.**
  Fixture 083 forces both verifiers to the eager behaviour by `contracts/` rather
  than by coincidence, which is the point of building a second verifier at all.
  T7b is hard-isolated and cannot read this ADR or OPEN-QUESTIONS, so its ticket
  text must state the ET-9c timing explicitly.
- **Additive under EV-5.** ET-9c adds a rule and a fixture; it changes no existing
  fixture verdict. It does make some previously-underdetermined inputs definitively
  `INVALID`, which is a legitimate pre-freeze spec tightening (the rehearsal loop
  exists to turn ambiguities into spec edits). Version-bound like ET-4c; the T10
  re-audit re-measures nothing new here, as ET-9c adds no curve arithmetic.

### Documents reconciled

- `contracts/event-types.md` — ET-9c added; ET-4b/ET-4c parentheticals,
  rule-index, and acid-test walkthrough updated; `Version:` 6 → 7. **In this PR.**
- `contracts/CONTRACTS-CHANGE.md` — entry added. **In this PR.**
- `contracts/fixtures/` — fixture 083 added (generator + regenerated
  `index.json`/`MANIFEST.sha256`). **In this PR.**
- `memory/OPEN-QUESTIONS.md` — the open `registrar_pk`-timing entry is resolved by
  this ADR; it is marked DECIDED as part of the memory reconciliation (updated on
  master at merge time per the STATE.md protocol), **not** on this contracts
  branch.
- `docs/plans/phase-0.md` — the queued T7 conformance fix and the T7b timing note
  are recorded with the memory reconciliation, not here.
- No document outside `contracts/` stated the deferred reading as settled, so none
  is contradicted by this change.

## Charter check

- **P1 (the log is the only truth; trust comes from verifiability, not
  authority).** Directly served. ET-4c exists so a reader can confirm a
  verification key's legitimacy _from the log itself_. Checking `registrar_pk` at
  the line where the log declares it — rather than trusting it until a vote
  happens to exercise it — is what makes that legitimacy verifiable at the point
  of declaration, honouring "a stranger can write an independent verifier in an
  afternoon" and get the same verdict as everyone else.
- **P2/P3/P4.** Untouched. This is an encoding/subgroup-timing rule on a public
  key; it does not affect the two-plane split, characterization-not-weighing, or
  participation floors.
