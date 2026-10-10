# ADR-0029: A ballot batch, once left, is closed

- **Status:** accepted — revised 2026-10-09 by its own review fixes (`event-types.md`
  v11): a batch is a run, not a set. #176 merged the first draft before the
  fresh-context review's blocking finding was fixed; the follow-up PR carries
  the fix, and this body describes the decision as finally specified.
- **Date:** 2026-10-08
- **Phase:** 0
- **Amends:** in part ADR-0014 (ET-24a: a batch instant, once left, is closed)

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
no committed verdict depends on the question. The first builds of both
verifiers agreed on verdict and blamed line for 6,000 generated chains that
included resumed batches, but they agreed on the set reading, which is the
reading that breaks EX-16.

## Decision

**A batch is a run, not a set.** ET-24 now defines a batch as a maximal run, in
`seq` order among one issue's registered ballots, of ballots sharing one `ts`. A
batch ends at the issue's next registered ballot whose `ts` differs, and if it is
under-size, that ballot is the fatal line.

Add **ET-24a**: no two batches of one issue may share a `ts`. A ballot whose
`ts` differs from its issue's previous registered ballot MUST NOT equal the `ts`
of any earlier registered ballot of that issue. A verifier rejects the chain **at
the line of the returning ballot**. On every chain that satisfies ET-24a, runs
and sets coincide, so ET-24's v9 meaning is unchanged wherever it was
well-defined.

Both halves are needed. ET-24a alone, over a set-defined ET-24, still leaves the
blamed line open on a chain that breaks ET-24a. Take `ballot_batch_min` 3 and one
issue's ballots at T1, T1, T2, T2, T2, T1. Under the run definition, the fatal
line is the first T2, where the run of two ends. Under the set definition, the T1
set is three ballots, so ET-24 never fires, and only ET-24a fires, at the
returning T1. The fresh-context review of this ADR's first draft found this;
EV-17 checks the line, so it was blocking.

- **Per issue, not per file.** Other events, including other issues' ballots, MAY
  fall between one batch's ballots.
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

The v9 sentence "Membership and lastness are decided by `seq`" made no literal
sense, because v9 membership was by `ts` equality. Under the run definition both
membership and lastness are decided by `seq` order, and `ts` is compared only for
equality, to tell where a batch ends.

**A new producer obligation.** Nothing before v10 required a ledger never to
revisit a batch instant; ES-21 does not order by `ts`. ET-24a now says a producer
whose clock steps backwards across a batch boundary MUST hold or advance the
instant, because a chain that breaks ET-24a is permanently `INVALID` in an
append-only log. The ledger's own guidance is updated to match (below).

**Rejected: keep the set reading and qualify EX-16.** That would keep both
verifiers unchanged, but it makes ET-24 the one rule whose verdict a prefix can
contradict. A streaming verifier would have to buffer every batch to the end of
the chain before it could report any ET-24 line. The shape it protects, a batch
resumed after a later one started, is not one a ledger publishing each batch as a
unit (ADR-0014) means to write. The one realistic way to write it, a clock
stepping backwards, is better caught at the line where it happens than tolerated.

## Consequences

- With the run definition and ET-24a, both rules are **per-line** checks. At any
  ballot, a verifier knows whether that line is fatal from the lines before it,
  and no later line can change that. EX-16 holds again without qualification.
  The builders' other two ambiguities go away by definition rather than by
  appeal to EV-7. A fault after the blamed line cannot matter, because the blamed
  line depends only on lines before it. A ballot that fails another check cannot
  fill an earlier batch, because a batch ends at the first registered ballot with
  a different `ts`, and a returning ballot starts a new batch rather than
  rejoining an old one.
- **This narrows the set of `VALID` chains.** A chain with a resumed batch was
  `VALID` under v9 and is `INVALID` under v10. Root `CLAUDE.md` rule 3
  ("additive-only, version-bumped, never retroactive") binds after the freeze;
  `contracts/` is DRAFTING (ADR-0007), where specs may still change, and ADR-0014
  set the precedent of narrowing the `VALID` set before it. Here,
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
     ET-23 off-interval ballot. Also the review's counterexample, one issue at
     T1, T1, T2, T2, T2, T1 with `ballot_batch_min` 3 (`INVALID` at the first T2,
     not the returning T1), and this ADR's own example, T1, T2, T2, T2, T1, T1
     (`INVALID` at the first T2). None of these exists yet, and neither ET-24a nor
     the run definition is covered by any vector until they land.

### Documents reconciled

- `contracts/event-types.md` v9 → v10: ET-24 redefined as runs, ET-24a added, the
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
- `services/ledger/CLAUDE.md` and `docs/implementation-plan.md`: both described
  the ledger's batching duties as "ET-23–ET-25". Both now name ET-24a and the
  clock-regression obligation, **in this PR**.
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
