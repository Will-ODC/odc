# ADR-0017: No sentiment or monetizable-response type may ever be registered on the governance chain

- **Status:** accepted
- **Date:** 2026-08-15
- **Phase:** 0

## Context

T9 finding **F5** (`docs/security/audit-phase-0.md`), rated blocking.

Four documents already say the planes are separate. Charter §6: "votes and
sentiment stay separate primitives … they are never conflated." Charter §8:
"monetizable data is a separate, labeled stream", and "ballots are outside
commerce, by construction and forever … guaranteed structurally, not by policy."
Repo non-negotiable rule 7: "ballot events and sentiment events never share a
store or a pipe." `implementation-plan.md`: the sentiment service's "separation
from ballots is a Phase 0 schema decision even though the service comes much
later."

`evolution.md` is the rulebook that actually decides what may be added, and the
rule was **not in it**. EV-1 permits any new event type additively. ET-22 and
EV-13 show the project knows exactly how to write a permanent bar — they do it
for receipt-bearing ballot changes and for ballot corrections, in language that
explicitly "survives any future community vote" — and the mirror for the
sentiment plane was simply absent. As written, a future `sentiment_response` type
was legal here, and it would then share the store (one log), the pipe (one
export, one `GET /events`) and the seq space with ballots: a rule-7 violation
reached entirely through conforming, additive evolution, with the F2 correlation
channel already present and sentiment events plausibly identity-attributed.

A "Phase 0 schema decision" that exists in four prose documents and in none of
the seven specs is a decision nobody has to obey.

## Decision

**`evolution.md` EV-22**, in the permanent register of ET-22 and EV-13: no
contracts version — v1 or any successor — may register on the governance chain an
event type whose payload carries a **response**: a sentiment, survey, poll,
rating or other opt-in monetizable answer given by a person, or any value from
which such an answer can be recovered by a party holding material outside this
log. It survives any future community vote (charter §8).

### Getting the line right in both directions

This was the whole risk in this finding: too tight and the sentiment service
cannot do the one thing the plan says it does — "commits only anonymous hashes to
`ledger`"; too loose and sentiment content reaches the ballot plane, which is the
violation. EV-22 therefore states what remains **permitted**, in three clauses a
future type must satisfy together:

1. **a commitment** — a fixed-width one-way digest over material held in the
   sentiment store, from which no response is recoverable without that material;
2. **aggregate, never per-respondent** — one commitment per instrument, batch or
   snapshot, never one per respondent or per response;
3. **no respondent identifier**, and no value derived from one.

Clause (2) is the one that is easy to miss and load-bearing. A hash _is_ a
one-way function, so a naive reading of clause (1) alone would admit "one
commitment per response" — and a digest of a single answer drawn from a small
answer space is **invertible by enumeration**. A per-response commitment is a
response in disguise. Stating (2) explicitly is what stops the bar being
satisfiable in form while breached in substance.

The payload may also carry values describing the commitment itself — which
instrument, when, how many responses it binds, which licence event authorized it.
Those are facts about the instrument, not answers given by anyone, and without
them the commitment is unusable for the audit trail charter §8 promises
("all revenue mappable to licensed chain events").

### The bar is directional, and that is deliberate

It blocks **sentiment content reaching the ballot plane**, which is the direction
in which protection is lost. It does **not** try to stop a sentiment-shaped
question being run _as a ballot_. Such a question **gains** ballot protections
rather than losing them: it is wasteful of one-human-one-vote capacity and it
clutters the governance chain, but it is not a security fault. The contract
cannot distinguish "should we fund plan Y?" from "do you like plan Y?" and should
not try — that is a governance and moderation matter, and the charter already
makes moderation a public event (§9). A rule that attempted the distinction would
be unenforceable, would invite a verifier to judge the _meaning_ of a title, and
would collide with P3 (the platform characterizes, it never weighs).

## Consequences

- **`contracts/`** — `evolution.md` (v3 → v4, shared with ADR-0014/ADR-0015): new
  §6 with EV-22; rule-index and acid-test updated, the latter with the concrete
  pair a reader can test the rule against (`sentiment_response` carrying an
  answer: never; `sentiment_batch_committed` carrying one aggregate digest and the
  instrument it covers: yes).
- **No event bytes change and no verdict moves.** EV-22 constrains what a _future
  contracts version_ may register; it adds no check to any v1 verifier.
- **Owed fixtures (EV-5) — honestly, close to none, and that is worth saying.**
  EV-22 is not verifier-checkable by construction: a v1 verifier's registry
  contains four types, and a hypothetical barred type would be unregistered and
  reach `PARTIAL` on its own merits (EV-7/EV-8), which is the correct behaviour
  and has nothing to do with EV-22. The rule binds the **authors of future
  contracts versions**, and its enforcement mechanism is review at the point of
  registration, not a vector. `EV-5`'s "every additive change MUST ship golden
  fixtures" reads oddly here — this is precisely the case the open question about
  narrowing EV-5 to _byte-changing_ changes describes, and this ADR is a live
  instance of it rather than an argument against EV-5. **What is owed instead:**
  the fixture pass should record, in the rule-to-vector coverage report the audit
  asks for, that EV-22 is deliberately unpinned and why.
- **Owed verifier work: none.**
- **Binding on the future sentiment service.** When `sentiment` is built, its
  commitment event type is designed against EV-22's three clauses, and the type is
  registered only if it satisfies all three. The threshold-custody roadmap
  (charter §8) is unaffected — it governs the store, not this chain.

### Documents reconciled

- `docs/implementation-plan.md` (deferred services, `sentiment`) — said its
  separation from ballots "is a Phase 0 schema decision" without naming any
  schema rule, which is what made the decision unfindable. Now names EV-22 and
  what it permits. **In this PR.**
- `docs/charter.md` §6 and §8 — state the principle EV-22 implements; both remain
  true and neither is narrowed. **Checked, no change needed.**
- `services/*/CLAUDE.md` — there is no `sentiment` service directory yet, and no
  existing service CLAUDE.md mentions sentiment. **Checked, no change needed.**
  When the service is scaffolded, its `CLAUDE.md` must carry EV-22.
- Root `CLAUDE.md` non-negotiable rule 7 already states the principle and is not
  contradicted; it is agent guidance rather than a normative spec, and is left
  alone.

## Charter check

- **P2 (one verified human, two planes — "secrecy where power could coerce;
  accountability where money and advocacy live").** This is the structural
  guarantee behind the two planes. Without EV-22 the split was policy dressed as
  architecture: conforming additive evolution could put monetizable, plausibly
  identity-attributed responses in the same seq space as ballots.
- **Charter §8 (ballots are outside commerce, "by construction and forever …
  guaranteed structurally, not by policy").** "Structurally" is what this ADR
  delivers, and "forever" is why the bar is written to survive a community vote:
  a guarantee a majority can repeal is not a guarantee for the minority it
  protects.
- **P3 (the platform characterizes, it never weighs).** Honoured by what EV-22
  deliberately does _not_ do: it never asks any component to judge whether a
  question is "really" sentiment. It bars a data shape, not a meaning.
- **P1/P4.** Untouched.
