# ADR-0015: An unregistered `genesis` version is `INVALID` at line 1

- **Status:** accepted
- **Date:** 2026-08-15
- **Phase:** 0

## Context

T9 finding **F3** (`docs/security/audit-phase-0.md`), rated blocking, and an
independent rediscovery of an entry that had been open in
`memory/OPEN-QUESTIONS.md` since T5f — the auditor could not read that file, so
the overlap is a signal rather than an echo.

The two-stage model (EV-6/EV-15) puts every signature check in **Stage B**, which
runs only for `(type, version)` pairs the verifier registers. The chain's
verification keys live in the `genesis` **payload**, and reading a payload is
itself Stage B. So a chain whose `genesis` sits at an unregistered version leaves
a verifier unable to extract `operator_pk` or `registrar_pk` at all, and every
later signature becomes uncheckable.

EV-7's `PARTIAL` definition — "Stage A passes for the whole chain and no
registered event fails Stage B" — does not say whether an event whose key is
_unavailable_ has failed Stage B or merely gone unchecked. **Both readings are
defensible from the text**, and they differ by more than a line number: `PARTIAL`
means "integrity confirmed, some semantics unchecked", announced over a chain on
which nothing was ever authenticated.

The audit measured the divergence rather than predicting it. Its
`downgrade.ndjson` — a genesis at the EV-19 reserved version signed by an
attacker key, followed by attacker-signed events at registered versions — gets
`INVALID` at line 2 from **both** verifiers. But **no normative sentence produces
that verdict**; the Go verifier's reason string cites no rule id because there is
no rule to cite. The two agree by convergent reasoning, not by rule — precisely
the failure mode ADR-0011 was written to eliminate, and a third implementation
reading EV-8 and EV-15 literally can reach `PARTIAL` at line 1 instead.

The earlier open-questions entry judged this additively resolvable post-freeze
and therefore not a freeze blocker. That judgement is not contradicted: it is
about the freeze, and additive resolution is still available. T9 rates it
blocking for the **RELEASE CANDIDATE** gate, which is the gate in front of us.

## Decision

**`evolution.md` EV-20:** a chain's `genesis` event MUST carry a `(type,
version)` the verifier registers; a chain whose first line does not is
**`INVALID` at line 1**.

This is the **single exception to EV-8** and a **Stage A promotion for `genesis`
alone** — ES-9/ES-11 registration, Stage B everywhere else, is Stage A at line 1.
The justification is structural: `genesis` is the only event whose payload a
verifier must read in order to check any other event. Nothing about EV-8's
general posture changes, because a chain that has legally grown past a verifier
(the fork/exit case EV-8 exists for) still _starts_ at a `genesis` that verifier
registers.

**`evolution.md` EV-21** carries the second half the operator asked for: the
reason text SHOULD distinguish **"this verifier does not register `(genesis,
<version>)` — it may be out of date for this chain"** from **"this chain's
genesis is corrupt or hostile"**. Same verdict, honest explanation. From the log
alone the two are indistinguishable, so the guidance is to say _that_, naming the
version encountered and the versions the verifier registers, rather than picking
one. It is written as **guidance, not a conformance requirement**, because
T4a/EV-17 makes reason text advisory and conformance the verdict token plus line
number alone; wording it as a MUST would have quietly created the reason-code
registry EV-17 refused.

### Why not `PARTIAL` at line 1

`PARTIAL` is a claim about integrity ("hash and position confirmed, semantics
unchecked"). Here the _semantics that could not be checked_ include every
signature on the chain, so the reassurance the token carries is exactly the
reassurance a reader must not be given. EV-16 already establishes the shape of
this argument for payload-shape failures — a verdict is unavailable when its
rationale does not hold — and EV-20 applies the same test at the one position
where the rationale fails hardest.

## Consequences

- **`contracts/`** — `evolution.md` (v3 → v4, shared with ADR-0014/ADR-0017):
  EV-20 and EV-21 added in a new §5; EV-8 gains the exception clause; EV-15's
  exhaustive stage split records the line-1 promotion; rule-index and acid-test
  updated. `event-types.md` ET-2a gains the matching cross-reference, so a reader
  who arrives from the type registry rather than from `evolution.md` is not
  misled (the same treatment EV-9 received in T4a).
- **Owed fixture (EV-5), not written in this pass — and it is not just an
  addition.** A chain whose `genesis` is at `version` **1000000** (EV-19's
  reserved value; EV-18's `x_` prefix cannot express this case, since the type
  name must stay `genesis`), followed by at least one later event at a registered
  version, pinning **`INVALID` at line 1**. Note this is the audit's
  `downgrade.ndjson` scenario with the verdict corrected from what both verifiers
  currently produce (`INVALID` at line **2**), so it is also a conformance fix for
  both of them.
- **A guard must be inverted, not merely extended.**
  `tools/fixtures-gen/test/conformance.test.ts:189` asserts _"no vector freezes a
  verdict for an unregistered genesis version"_ — written deliberately, while the
  question was open, to stop a fixture foreclosing it. This ADR answers the
  question, so that test now blocks the fixture that pins the answer. The fixture
  pass MUST replace it with its inverse: a check that the genesis-version vector
  exists and asserts `INVALID` at line 1. Deleting it silently would lose the
  reasoning; leaving it would make the owed fixture unlandable.
- **Owed verifier work (both verifiers, isolated passes):** report `INVALID` at
  line **1** rather than line 2, and adopt the EV-21 reason text. Both currently
  reach the right verdict token by convergent reasoning at the wrong line.

### Documents reconciled

- `docs/implementation-plan.md` §Services/`verifier` — describes the three
  verdicts and `PARTIAL`'s purpose but enumerates no `INVALID` cases, so nothing
  in it becomes false. **Checked, no change needed.**
- `docs/charter.md` §8 (the fork/exit right that EV-8 serves) — EV-20 does not
  narrow it: a fork still starts at a registered `genesis`. **No change needed.**
- `services/*/CLAUDE.md` — `services/verifier/CLAUDE.md` states the verdict set
  and the advisory status of reason text, both still accurate; it says nothing
  about registration. **No change needed** — and it is out of scope for this pass
  in any case (see ADR-0013 for the verifier-document deferral).
- No other document outside `contracts/` states what verdict an unregistered
  version receives.

## Charter check

- **P1 (the log is the only truth; trust comes from verifiability).** The failure
  mode was a verifier announcing a _partially good_ result over a chain it had
  authenticated in no part. EV-20 makes the verdict match the evidence.
- **Charter §4 ("a stranger can write an independent verifier in an afternoon").**
  This is the finding's real bite: the stranger's verifier and ours agreed by
  coincidence, on a verdict no sentence assigned. EV-20 makes the agreement follow
  from a rule, and EV-21 makes the stranger's tool explain itself the same way
  ours does.
- **Charter §8 (exit is a right).** Protected explicitly: EV-20 is scoped to
  `genesis` alone so that a forked chain which has added types still verifies as
  `PARTIAL` under an old verifier rather than being condemned.
- **P2/P3/P4.** Untouched.
