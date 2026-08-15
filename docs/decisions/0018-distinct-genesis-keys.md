# ADR-0018: `registrar_pk` MUST differ from `operator_pk`

- **Status:** accepted
- **Date:** 2026-08-15
- **Phase:** 0

## Context

T9 finding **F6** (`docs/security/audit-phase-0.md`), promoted from `[SHOULD] S1`
to blocking during the audit's own review.

ET-9a said: "The contract imposes no relation between `registrar_pk` and
`operator_pk`. Operationally they SHOULD be distinct keys … This separation is
policy, not verifier-enforced."

So a conforming chain may declare the same key twice. The holder can then mint
issues **and** forge every ballot on them, and a verifier reports `VALID` with
nothing on the line to signal it. That is the argument ET-9b already makes for
the lowercase-hex check — "a verifier that omits this format check accepts a
`genesis` that ET-9b requires it to reject, with nothing else on the line to
signal the fault" — applied to a far larger fault: charter P2's "two planes" and
P3's "never selects" collapsing into one party.

The auditor's own correction of its severity rating is the reasoning that
matters. It had rated this SHOULD on the strength of the check being
necessary-not-sufficient — "which is an argument about how much the fix buys, not
about when it can be made", and the _when_ argument is the one that made F1, F4
and F5 blocking. Adding `registrar_pk != operator_pk` as a MUST **after** the
freeze would make previously conforming chains retroactively `INVALID` at line 1;
EV-1 ("an existing frozen `(type, version)` schema MUST NOT be altered") and EV-4
both bar that. The constraint is not merely cheaper before the freeze, it is
**unavailable** after it.

## Decision

**`event-types.md` ET-9d:** a `genesis` whose `registrar_pk` is byte-identical to
its `operator_pk` is `INVALID` at the `genesis` line.

The comparison is on the two 64-character lowercase-hex strings, after ET-9b has
passed on both — one string equality, no key material, no decoding, no curve
arithmetic. ET-9a's closing sentence changes accordingly: **custody** of the two
keys is still policy; their **distinctness** is now verifier-enforced.

### Necessary, not sufficient — and the ADR says so rather than overclaiming

The operator approved this explicitly on that basis, and the record should not
read as more than it is. **Two distinct keys can still be held by one party, and
the log cannot tell.** Nothing in an export distinguishes a genuinely separated
registrar from an operator who generated both keypairs and kept both. ET-9d
blocks the _blatant_ collapse — the one that is visible in the log because it is
declared there — and the sufficient version is undecidable from the log
entirely.

That is a familiar shape here rather than a compromise: ET-9b (format) and ET-4b
(canonical encoding) are both necessary-not-sufficient checks adopted on exactly
this reasoning. A cheap check that closes the declared case is worth having; a
check that claims to close the undeclared case would be a lie in the spec.
Custody remains charter §10's v1 trust-by-policy posture, hardened in identity
v2, and `memory/OPEN-QUESTIONS.md` already carries registrar key custody as
Phase 1 design work.

### Why not a SHOULD

A SHOULD is what ET-9a already had, and it produced a contract under which the
collapsed configuration is fully conforming and silently invisible. The choice
here is not between MUST and SHOULD on the merits of enforcement — it is between
a MUST now and **nothing, permanently**.

## Consequences

- **`contracts/`** — `event-types.md` (v7 → v8, shared with
  ADR-0013/0014/0016): ET-9d added; ET-9a's "no relation … policy, not
  verifier-enforced" sentence replaced; the `registrar_pk` payload-table row,
  rule-index and acid-test updated.
- **No existing fixture changes verdict.** All 83 vectors were checked: none
  declares `operator_pk == registrar_pk` (the corpus uses the `hashing.md` §6
  test keys, seeds `0x01…` and `0x02…`, which differ). So this rule condemns
  nothing already written — which is exactly the property that makes it legal now
  and illegal later.
- **Owed fixture (EV-5), not written in this pass:** a `genesis` whose
  `registrar_pk` equals its `operator_pk`, otherwise entirely well-formed and
  correctly self-signed under that key, pinning **`INVALID` at line 1**. It must
  be well-formed in every other respect, or it pins ET-9b or ET-8 instead of
  ET-9d. A chain with no `vote_cast` is the right shape, so that nothing else can
  be blamed.
- **Owed verifier work (both verifiers, isolated passes):** one string comparison
  at the genesis line, alongside the ET-9b/ET-9c checks already sited there.
- **Operational consequence for Phase 1.** `identity` holds `registrar_pk`'s
  private key and MUST NOT hold `operator_pk`'s. ET-9d cannot check that, but it
  makes the _intent_ unambiguous in the artifact Phase 1 builds from, and it means
  a deployment that tries to shortcut key management fails at genesis rather than
  succeeding quietly.

### Documents reconciled

- `docs/implementation-plan.md` §Services/`ledger` (MVP authorization) — listed
  the three signing keys without stating that the operator and registrar keys must
  differ. Amended. **In this PR.**
- `services/ledger/CLAUDE.md` — same list, same gap; this is the file the Phase 1
  ledger implementer reads first. Amended. **In this PR.**
- `services/identity/CLAUDE.md` — describes the linkage map and registration
  ordering; says nothing about which keys it holds, so nothing in it is
  contradicted. Registrar custody is Phase 1 design work already filed in
  `memory/OPEN-QUESTIONS.md`. **Checked, no change needed.**
- `docs/charter.md` §P2/§P3/§10 — state the separation as a principle and a v1
  trust posture; ET-9d strengthens the contract toward them and contradicts
  neither. **Checked, no change needed.**

## Charter check

- **P2 (one verified human, two planes).** The collapsed configuration destroys
  the split at its root: one holder decides what is asked _and_ which ballots are
  admitted. ET-9d makes the destroyed case detectable from the log.
- **P3 (the platform characterizes; it never weighs — "it never selects").** A
  single key holding both roles lets one party set the questions and manufacture
  the answers, which is selection with extra steps.
- **P1 (trust comes from verifiability, not authority).** Partially served, and
  the limit is stated in ET-9d itself: the _declaration_ is now verifiable, the
  _custody_ is not, and the spec says which is which instead of implying the
  stronger claim.
- **P4.** Untouched.
