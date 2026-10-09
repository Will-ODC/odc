# ADR-0029: A ballot batch, once left, is closed

- **Status:** accepted
- **Date:** 2026-10-08
- **Phase:** 0

## Context

ADR-0014 introduced ballot batching, and `contracts/event-types.md` ET-24 defines
a **batch** as "the set of all `vote_cast` events on a chain sharing both an
`issue_id` and a `ts`". Nothing required a batch's ballots to be consecutive among
its issue's ballots. An issue's ballots could sit at instant T1, move to T2, and
come back to T1, and the returning ballots joined the T1 batch.

Phase 3 built ET-23 and ET-24 into both verifiers, each in an isolated context.
**Both builders independently reported the same contradiction**, and both chose
the same reading of it. With a batch that can be resumed, three statements cannot
all hold:

1. ET-24's attribution: the fatal line is "the line at which the chain first
   violates this rule and the line a verifier scanning in file order reaches
   first".
2. ET-24: an under-size batch "becomes one only when a later ballot of the same
   issue proves it was not the last".
3. `export-format.md` EX-16: "A prefix of a valid chain is itself a valid chain."

Example, `ballot_batch_min` 3, one issue: ballots at T1, T2, T2, T2, T1, T1. Every
batch ends with three ballots, so under the set definition the chain is `VALID`.
But the prefix that stops at the first T2 has a T1 batch of one that is not its
issue's last, which is `INVALID`. A verifier that judges each prefix as it scans,
which is what most third-party implementers will write, rejects the whole chain
at the first T2 ballot. Both of ours accept it. A real verdict divergence was one
fixture away.

The rehearsal (#172) and every committed vector publish each batch as one run, so
no committed verdict depends on the question. Both verifiers agree on 6,000
generated chains that include resumed batches, but they agree on the set reading,
which is the reading that breaks EX-16.

## Decision

Add **ET-24a**: an issue's ballots MUST NOT return to a batch instant they have
left. Taking one issue's `vote_cast` events in `seq` order, a ballot whose `ts`
differs from that issue's previous ballot MUST NOT equal the `ts` of any earlier
ballot of that issue. A verifier rejects the chain **at the line of the returning
ballot**.

- **Per issue, not per file.** Other events, including other issues' ballots, MAY
  fall between one batch's ballots. A batch is a run of its issue's ballots.
- **Equality only.** The rule compares `ts` values for equality and never orders
  them. `event-schema.md` ES-21 is amended to name this equality comparison
  alongside ET-23's value check, because ET-24's grouping by equal `ts` was
  already, read literally, a use of `ts` that ES-21 forbade. Both builders flagged
  that too.
- **Which ballots count.** ET-24 and ET-24a read a ballot's `issue_id`, so they
  apply only to the registered `(vote_cast, 1)`. An unregistered `vote_cast`
  version gets EV-8's treatment, so its payload is not read and it cannot be
  assigned to any batch. Both verifiers already do this. It is stated here
  because both builders had to infer it.

ET-24's text is tightened in two places. The sentence "Membership and lastness are
decided by `seq`" made no literal sense, because membership is by `ts` equality.
It now says lastness is decided by `seq` and `ts` is compared only for equality.
The attribution paragraph now says why its two descriptions of the fatal line
coincide: ET-24a.

**Rejected: keep the set reading and qualify EX-16.** That would keep both
verifiers unchanged, but it makes ET-24 the one rule whose verdict a prefix can
contradict. A streaming verifier would have to buffer every batch to the end of
the chain before it could report any ET-24 line. And it protects a shape no
honest producer writes, because a ledger publishes each batch as one unit
(ADR-0014, ET-25).

## Consequences

- With ET-24a, both ET-24 and ET-24a are **per-line** checks. At any ballot, a
  verifier knows whether that line is fatal from the lines before it. EX-16 holds
  again without qualification. The builders' other two ambiguities go away: the
  rule no longer needs a precedence statement for faults after the blamed line,
  and the question of whether a failed line can fill a batch is answered by EV-7,
  because verification stops at the first fatal line.
- **This narrows the set of `VALID` chains.** A chain with a resumed batch was
  `VALID` under v9 and is `INVALID` under v10. `contracts/` is DRAFTING (ADR-0007),
  no committed vector carries a resumed batch, and no ledger exists, so nothing
  that was published changes verdict. After the RC this would be a breaking
  change; it is cheap only now.
- **Owed, in order** (fixtures may never precede verifiers):
  1. Both verifiers implement ET-24a, each in its own isolated context, in the
     phase-3 verifier PRs. The behaviour change is only on resumed batches, which
     the committed corpus does not contain, so those PRs stay green alone.
  2. Phase-3 vectors: a resumed batch (`INVALID` at the returning line); another
     issue's ballots between one batch's members (`VALID`); an under-size batch
     proven not-last (`INVALID` at the next ballot of its issue); the legal
     under-size last batch with other issues' ballots after it (`VALID`); and an
     ET-23 off-interval ballot. None of these exists yet, and ET-24a is not
     covered by any vector until they land.

### Documents reconciled

- `contracts/event-types.md` v9 → v10: ET-24 tightened, ET-24a added, the
  section intro (four rules, three verifiable), the degrees-of-freedom table, and
  the acid-test walkthrough.
- `contracts/event-schema.md` v4 → v5: ES-21's exception names the equality
  comparison.
- `contracts/export-format.md` EX-16: **unchanged**. Its text is true again
  under ET-24a.
- `contracts/evolution.md`: **unchanged**. EV-15 already assigns every ET rule
  to Stage B, which covers ET-24a.
- `docs/decisions/0014-ballot-batching.md`: status line notes this amendment.
  Its body is a record and keeps its text. Its verifiability table ("group by
  `(issue_id, ts)`, count") remains true.
- `services/verifier/API.md` and `tools/verifier-ts/README.md`: on master they
  do not mention ET-24 yet. The phase-3 verifier PRs that add ET-24 describe
  ET-24a in the same change.
- `memory/STATE.md`: updated at merge time on master, per `odc-pipeline`.

## Charter check

- **§4, the record** ("a stranger can write an independent verifier in an
  afternoon"): this strengthens it. Without ET-24a, a verifier had to hold every
  batch to the end of the export before it could attribute an ET-24 line, and
  two careful strangers reading the text could reach different verdicts. With
  it, every verdict is reachable in one streaming pass, and the prefix property
  the truncation story rests on (EX-16) holds.
- **§5, the ballot plane** ("secret, equal, unlinkable"): ET-24's minimum batch
  size is the rule that hides a ballot among others. ET-24a does not weaken it.
  It constrains only how a producer groups appends, which a conforming ledger
  already does in one unit.
- **P1–P4:** none is touched. No wire format, payload key or hashing rule
  changes, and nothing new is stored outside the log.
