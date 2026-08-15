# ADR-0014: Ballot batching — a fixed mechanism with governable parameters

- **Status:** accepted
- **Date:** 2026-08-15
- **Phase:** 0

## Context

T9 finding **F2** (`docs/security/audit-phase-0.md`), rated blocking. ET-21
argued receipt-freeness holds structurally because the ballot carries no voter
fingerprint. **That is correct about what it claims and incomplete about what
receipt-freeness requires:** it proves the voter retains no artifact, and
coercion does not need the voter to retain anything — it needs the _coercer_ to
be able to check.

The coercer can. `ts` is pinned by ES-20 at mandatory millisecond precision and
is hash-covered; `seq` is arrival order (ES-8); `choice` is in the clear; and
RA-12/RA-13 make the tail cheaply pollable by anyone, unauthenticated, by design.
So: "vote for choice 1, from this room, at 10:03", then poll `GET /events?since=N`
and read the ballot that appears. The voter cannot lie, cannot equivocate, and
cannot point at a decoy, because the proof is in the coercer's hands, not theirs.

The spec was **silent**, which is worse than either answer: a ledger that appends
each ballot the instant the registrar signs it is fully conformant and fully
coercible, and a ledger that publishes shuffled hourly batches is _also_ fully
conformant. Two conforming implementations differing on whether the system is
receipt-free is the failure class this project has been bitten by before.

Timing: this must precede the freeze because it **tightens** an existing rule
(the legal values of `ts`), which EV-1 bars post-freeze. It is also a requirement
landing _before_ the code — `services/ledger/` holds only README and CLAUDE — so
it is not a retrofit.

## Decision

**The contract fixes the mechanism permanently; the log carries the numbers; the
contract floors them.**

1. **Mechanism (permanent).** `event-types.md` ET-23–ET-25:
   - **ET-23** — a ballot's `ts` MUST be an exact multiple of its issue's
     `ballot_batch_interval_ms`, in milliseconds since the epoch on the proleptic
     Gregorian calendar with no leap seconds (ES-20 already rejects a `60` second,
     so the conversion is identical in Go and TypeScript). That quantized value is
     the **batch instant**.
   - **ET-24** — a **batch** is the set of ballots sharing one `issue_id` and one
     `ts`. Every batch MUST hold at least the issue's `ballot_batch_min` ballots,
     except the batch containing the issue's highest-`seq` ballot, which may be
     smaller because an issue that closes before its final batch fills must still
     publish what it has. So at most one under-size batch per issue, and only as
     its last.
   - **ET-25** — the internal order of a batch MUST NOT be arrival order.
2. **Parameters (on the log, votable).** `issue_created` gains
   `ballot_batch_interval_ms` and `ballot_batch_min`, both required integers
   (**ET-14b**). Adding keys to `issue_created` is legal **now** because only
   `genesis` is version-pinned (ET-6); after the freeze the same change would
   require an `issue_created` **v2** under EV-1/EV-2 — additive, but a second
   registered `(type, version)` that every verifier and every fixture then has to
   carry. That is the whole reason this lands before the tag.
3. **Floors (permanent existence, drafting-decision values).**
   `ballot_batch_interval_ms ≥ 60000`; `ballot_batch_min ≥ 3`.

### Why those two numbers

They are judgement calls, so the reasoning is recorded rather than the numbers
alone.

**Interval ≥ 60000 ms (one minute).** The channel being closed is an observer who
knows _when_ a voter voted. A coercer's instruction and a coercer's observation
are both wall-clock and human-grained — "vote at 10:03", a glance at a screen, a
household schedule, a shift start. One minute is the coarsest unit in which
people actually state and check times, so quantizing to it removes from the log
every bit of timing resolution finer than what the coercer already had. Below it
the published `ts` starts _re-supplying_ resolution the coercer lacks: at 1000 ms
the log tells them which second, which their own observation did not. It is also
bounded liveness — at the floor a ballot appears within a minute of casting — and
a round number in the unit the key is named in. Communities wanting an hour vote
for an hour; nobody may vote for a millisecond.

**Minimum ≥ 3.** This floor is honestly a floor on _decorativeness_, not a
promise of anonymity. At 1 the rule is vacuous — every ballot is its own batch. At
2 each ballot is one of a pair, and if the pair agrees, both voters' choices are
exposed to anyone who knows either of them voted. 3 is the smallest size
conventionally treated as a group at all (it is the usual small-cell suppression
threshold in disclosure control), and it stays satisfiable by a community of a
dozen people — a floor a small community cannot meet would block publication
entirely, which is a worse failure than the one being fixed. **No value of this
parameter makes a batch anonymous**: a unanimous batch reveals every voter in it
regardless of size. That is arithmetic, not timing (see below).

### The permanent / provisional split, stated explicitly

Mirroring the cut `memory/OPEN-QUESTIONS.md` already draws for `choice_count` —
_that a bound exists at all_ is permanent, _the number 64_ is provisional:

- **Permanent** (register of ET-22 and EV-13, surviving any future community
  vote): the mechanism ET-23–ET-25, and the **existence** of a floor on each
  parameter. Without a floor, "governable" means an operator sets 1 ms and 1 and
  the batching rule becomes decorative while remaining perfectly conformant.
- **Provisional / votable:** the two floor _numbers_ (raisable by a later
  `issue_created` version, never lowerable to where the rule stops binding), and
  the per-issue values above the floor — which is the point of putting them in
  the payload at all. The batch size must be open to community vote later, like
  almost everything about this project.

### What is checkable, and what is not

Say it plainly, because this rule must not read as fully enforced:

| Rule                         | Checkable from the export?                        |
| ---------------------------- | ------------------------------------------------- |
| ET-14b parameters and floors | **Yes** — values are on the `issue_created` line  |
| ET-23 quantized `ts`         | **Yes** — arithmetic against the issue's interval |
| ET-24 minimum batch size     | **Yes** — group by `(issue_id, ts)`, count        |
| ET-25 order within a batch   | **No. Ever.**                                     |

A shuffled batch and an arrival-ordered batch are indistinguishable to every
reader, now and permanently. ET-25 is therefore an obligation on the ledger
implementation and on nothing else — no verifier can report a violation, no
fixture can pin one, and `evolution.md` EV-15 is amended to place it in neither
verification stage. It is written normatively anyway because the implementation
owes it, and because without it a conforming ledger could publish `seq`-ordered
batches and hand the coercer back precisely the arrival ordering ET-23 removed
from `ts`. The hash chain enforces no content rule; it gives tamper-evidence.
With one writer and no consensus, enforcement is public detection, never
prevention.

**Line attribution** for an under-size batch is pinned in ET-24, because it is
not obvious and two verifiers would otherwise diverge on the line number: the
violation is not detectable at the batch, only at the **first later ballot of the
same issue** that proves the batch was not the last. That line is the fatal one.

### Quorum is deferred and is NOT solved here

A **minimum turnout below which a vote publishes nothing** is a Phase 1
`issue_created` **v2** concern and is out of scope for this ADR beyond this
forward reference. The reasoning, recorded in `memory/OPEN-QUESTIONS.md`:
small-turnout exposure is **arithmetic on the tally, not timing** — five ballots
at 3–2 with four choices known reveals the fifth; 5–0 reveals everyone — so no
interval, batch size or shuffle addresses it, and none of this mechanism should
later be mistaken for having done so. ET-14b carries an informative note saying
exactly that, so a reader of `contracts/` alone cannot make the mistake either.
The accepted trade for deferring it is a **warning shown to voters before
casting** that early low-turnout votes may be identifiable — owed to the Phase 1
identity/web work, and recorded here so it is not lost with the deferral. The
irreversible part is not the rule but the data: ballots published under low
turnout stay public forever, so early votes stay low-stakes.

## Consequences

- **`contracts/`** — `event-types.md` (v7 → v8): `issue_created` table gains two
  keys; ET-14b, ET-23, ET-24, ET-25 added; ET-21's residuals rewritten to name
  timing correlation as the residual this addresses and to name the two it does
  not (the registrar's subliminal signature channel, and public-plane/ballot
  adjacency in `seq`). `event-schema.md` (v2 → v3): ES-21 amended — `ts` still
  never orders or selects, but ET-23 constrains its _value_, which the old
  wording forbade outright. `evolution.md` (v3 → v4): EV-15's exhaustive stage
  split amended to place ET-25 (and, for the same reason, the boundary statements
  ET-20–ET-22) outside both stages.
- **This is the one change in this pass that moves existing fixture bytes, and it
  moves a lot of them.** Two required keys on `issue_created` change that event's
  payload, hence its `hash`, hence every `prev_hash` after it: **54 of the 83
  vectors carry an `issue_created`** and must be regenerated, along with
  `index.json` digests, `MANIFEST.sha256`, and the `002-four-types-seq3.hex`
  preimage. This is legal and cheap-ish today — nothing is tagged, `fixtures/` is
  not yet immutable (ADR-0007/ADR-0008), and `tools/fixtures-gen` regenerates
  rather than anyone hand-editing — and it is **impossible after the tag**. No
  vector's _verdict_ should change; the regeneration pass must assert that.
  `hashing.md` is untouched and its §6 worked example is a `genesis`, so the one
  hand-verifiable digest in the specs is unaffected.
- **Owed fixtures (EV-5), not written in this pass:** the whole-corpus
  regeneration above, plus new vectors for a non-quantized ballot `ts` (`INVALID`
  at the ballot line, ET-23); an under-size batch followed by a later ballot of
  the same issue (`INVALID` at that later line, ET-24 attribution — this vector
  exists to pin the line number, so it must contain at least one legal batch
  first); a legal under-size **final** batch (`VALID`, the exception); a
  below-floor `ballot_batch_interval_ms` and a below-floor `ballot_batch_min`
  (`INVALID` at the `issue_created` line, ET-14b — one each, since a vector that
  breaks both pins neither); and a multi-batch `VALID` chain as the positive
  case. ET-25 gets **no** fixture, by construction.
- **Owed verifier work (both verifiers, isolated passes):** track each issue's
  two parameters alongside its `choice_count`; the ET-23 epoch-ms arithmetic; and
  ET-24's grouping with its line attribution. This is the largest verifier change
  of the six findings.
- **Liveness cost, accepted.** A voter's ballot does not appear immediately: at
  the floor, up to one minute plus however long the batch takes to reach three
  ballots. On a quiet issue that can be a long time, and the last batch only
  clears when the issue closes. That is the price of the property, and it is the
  charter's stated ordering — where expressiveness or convenience collides with
  receipt-freeness, receipt-freeness wins (§5, §8).

### Documents reconciled

- `docs/implementation-plan.md` §Services/`ledger` — the write-path bullets
  described immediate per-ballot appends with no batching obligation. A batching
  bullet is added, naming what is verifiable and what is implementation trust.
  **In this PR.**
- `services/ledger/CLAUDE.md` — same gap, and this is the file the Phase 1 ledger
  implementer reads first. Batching rule added, including that the shuffle is
  theirs alone to honour. **In this PR.**
- `services/tally/CLAUDE.md` — found stale while reconciling the ballot
  documents: it still said "v1 = approval counting, latest-vote-per-participant",
  both of which ADR-0004 made false and `implementation-plan.md` §tally already
  corrects (plurality; latest-per-participant is not computable without a voter
  field). Fixed in the same pass rather than left for the next reader.
  **In this PR.**
- `docs/charter.md` §5 ("Receipt-free by design", "no one can prove how they
  voted, even voluntarily") — checked; it states the property, which this ADR
  makes more nearly true. Nothing in it was contradicted, so it is **not**
  changed.
- `contracts/read-api.md` — RA-12/RA-13 are the polling surface the attack uses,
  but neither states anything this ADR changes: the constraint is on what the
  ledger appends, and the read surface inherits it. **No change.**
- `services/web/CLAUDE.md` — no stale statement; the pre-casting low-turnout
  warning is owed to Phase 1 work under the _quorum_ deferral, and is recorded
  above rather than added here.

## Charter check

- **P2 (one verified human, two planes — "secrecy where power could coerce").**
  The finding was a direct breach of it: the ballot plane's secrecy failed
  against an observer with a clock. ET-23–ET-25 close the timing half. The
  adjacency half (a registration line next to a ballot line) is named as a
  remaining residual in ET-21 rather than papered over.
- **P1 (the log is the only truth).** Served, with a caveat stated in ET-25 and
  above: two of three rules are verifiable _from the log_, which is the standard
  P1 sets; the third cannot be, and is declared rather than implied.
- **P3 (the platform characterizes, it never weighs).** Untouched — batching
  changes when ballots are published, never what any ballot means or counts for.
- **P4 (floors, not ladders).** The parameter floors are floors in P4's sense
  too: they set the minimum protection every participant gets regardless of which
  community they are in, and a community may raise its own protection but not
  lower anyone's below the floor.
