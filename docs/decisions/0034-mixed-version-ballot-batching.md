# ADR-0034: Mixed-version ballot batching — one ballot per event, conservative uncertainty

- **Status:** accepted. The operator chose option 2 of
  `docs/plans/hash-chain-unknown-ballot-batching.md` (#225) on 2026-10-10, and
  answered the open questions that drafting raised the same day (decisions 6 to
  9). A fresh-context review of ET-24b approved it with nits, which are folded
  in.
- **Date:** 2026-10-10
- **Phase:** 0
- **Amends:** in part ADR-0029 ("Which ballots count") and ADR-0006 (what
  `PARTIAL` enumerates)

## Context

`event-types.md` v11 ET-24/ET-24a counted only the registered `(vote_cast, 1)`.
An unregistered `vote_cast` "joins no batch, ends none, and proves none
not-last" (ADR-0029). That is coherent while version 1 is the only ballot, and it
fails in two ways once a newer version exists:

1. **Old verifiers condemn conforming chains.** With `ballot_batch_min` 3: two v1
   ballots and one newer-version ballot of the same issue at T1, then three v1
   ballots at T2. A reader who registers the newer version counts three at T1 and
   says `VALID`. A v11 verifier counts two and says `INVALID` at the first T2,
   only because it cannot read one event. `evolution.md` EV-8 forbids exactly
   that.
2. **Nothing binds future ballots to batching.** ET-14b and ADR-0014 call the
   batching mechanism permanent, but no sentence required a future `vote_cast`
   version to name one issue, count as one ballot, or be batched at all.

Two naive fixes do not work. Reading `issue_id` from the unreadable payload
assumes a schema EV-8 says a verifier may not assume. Switching off every later
batch check once an unreadable ballot appears lets one such event hide known
violations, such as a known ballot returning to an instant its issue has
already left.

The proposal (#225) offered a permanent constraint and an **exact** uncertainty
rule: a registered ballot's batch failure is `INVALID` only if it occurs under
every possible assignment of the unreadable ballots to issues. It left the
algorithm open and asked for an operator decision. `memory/OPEN-QUESTIONS.md`
held the question as "Future `vote_cast` versions and ballot batching".

## Decision

**1. Adopt the permanent constraint as written (ET-22a).** Every `vote_cast`
version that any contracts version registers identifies exactly one issue and represents exactly one
ballot. It carries `issue_id` with the ID-8/ET-18 meaning and obeys its issue's
interval, minimum batch size and closed-instant discipline. No future version may
remove these constraints or count one event as several ballots. It is in the
register of ET-22: no contracts version and no community vote may remove it.
ET-24/ET-24a now apply to every **registered** `vote_cast` version (in v12,
still version 1 alone). A verifier MUST NOT inspect an unregistered version's
payload for batch membership, even if it looks familiar.

**2. Decide uncertainty by a conservative rule, not the exact one (ET-24b).**
If an unreadable ("opaque") `vote_cast` could change a registered ballot's batch
check, that check is **unresolved** and the chain is `PARTIAL`, unless a failure
that holds whatever the opaque ballots are makes it `INVALID`. Uncertainty never
strengthens a verdict to `INVALID`, and it never erases known batch history:
known closed instants and off-interval known timestamps stay enforceable.

**3. "Could change" is a decidable test on `seq` and `ts`.** The operator's words
were "its envelope timestamp is compatible with that check". ET-24b makes that
precise, so that two isolated builders implement the same set of lines. For one
registered issue _I_ (created at `seq` _c_, interval _Δ_, minimum _m_):

- **Candidate.** An opaque ballot _U_ is a candidate of _I_ iff `seq(U) > c`
  and `ts(U)` is a multiple of _Δ_ (ET-23's test). Nothing else narrows it.
- **Known terms.** Evaluate ET-24/ET-24a over _I_'s registered ballots alone, as
  v11 did. For a registered ballot _L_, _P(L)_ is _I_'s previous registered
  ballot. _L_ is a run start if `ts(P(L)) ≠ ts(L)`. For a run start, _R_ is the
  known run ending at _P(L)_, _f_ its first ballot, _w_ = `seq(P(f))` (or _c_),
  and _t_ = `ts(P(L))`.
- **Definite failure → `INVALID` at _L_.** A known ET-24a failure, always. A
  known ET-24 failure iff `|R| + F < m`, where _F_ counts candidates with
  `w < seq(U) < seq(L)` and `ts(U) = t`. The one-ballot bound is what makes _F_
  a valid bound.
- **Unresolved → listed in `PARTIAL`.** Either a known ET-24 failure with
  `|R| + F ≥ m`, or a known pass where some candidate _U_ before _L_ satisfies:
  - _L_ not a run start: `seq(U) > seq(P(L))` (or `> c`) and `ts(U) ≠ ts(L)`;
  - _L_ a run start: `ts(U) = ts(L)`, or `seq(U) > seq(f)` and `ts(U) ≠ t`.
- **Otherwise resolved**, and it passes.

The rule is sound in both directions that matter. A definite failure breaks
ET-24 or ET-24a at or before _L_ under every assignment of opaque ballots to
issues. A resolved check passes under every assignment. The rule is
conservative only in what it calls unresolved, and in not proving the failures
that need a search over assignments. Every test at _L_ reads only earlier lines,
so a one-pass verifier decides each line when it reaches it, and EX-16's prefix
property survives.

**4. `PARTIAL` names both kinds of line (EV-7, EV-17).** It names the opaque
lines and the registered lines ET-24b leaves unresolved, ascending and without
duplicates. An opaque line that affects nothing is still listed. EV-8 gains a
paragraph saying a verifier does not report `INVALID` because it cannot read an
event that a registered check depends on.

**5. `ts` use is named in ES-21.** ET-24b applies ET-23's multiple test and `ts`
equality to an opaque ballot's `ts`, only to decide whether a registered check is
unresolved. `event-schema.md` ES-21 lists permitted uses of `ts`, so it names
this one. Two earlier builders flagged ES-21 when ET-24 used `ts` without being
named there (ADR-0029). ES-21's ban on selecting events by `ts` now names the
candidacy test as its one exception, rather than redefining "select".

The operator answered the questions the draft left open on 2026-10-10:

**6. A definite shortfall stays `INVALID`.** When the candidates at a run's
instant are too few to cure an under-size run (`|R| + F < m`), the failure is
`INVALID` at its line, as in the "insufficient even optimistically" case. The
one-ballot bound is what makes this provable, and the operator confirmed that
the conservative rule should use it.

**7. Vectors pin only cases where the two rules agree.** A golden vector for
ET-24b MUST pin only a chain on which the conservative rule and the exact
all-assignments rule give the same verdict and the same lines. The rule can then
be tightened to the exact one later without contradicting a frozen vector. ET-24b
says so in its text.

**8. A ballot of an issue the verifier cannot read is unresolved (ET-18b).** A
registered `vote_cast` whose `issue_id` names an `issue_created` at a version the
verifier does not register passes ET-18. That issue is still a prior
`issue_created`. Its ET-18a, ET-23, ET-24 and ET-24a checks are unresolved: the
line is enumerated in `PARTIAL` (EV-7, EV-17), and never `INVALID` on that
ground. Its signature and other checks apply as usual. Such a ballot takes no
part in ET-24b for any issue.

**9. Two more permanent clauses in ET-22a**, in the register of ET-22/EV-13:

- **Only `vote_cast` carries ballots.** No other event type, present or future,
  may represent a ballot. Otherwise a new type could escape ET-22, ET-22a and
  batching entirely, and a verifier could not even tell that it was a ballot.
- **An issue's batch parameters are fixed at `issue_created`.** An issue's
  interval and minimum are exactly those its `issue_created` declares, and no
  later event may change them. Otherwise a verifier that could not read the
  amending event would count candidates and minimums against the wrong numbers.

### The proposal's eight cases under this rule

Every case has a genesis and two registered issues, so ballots start at line 4.
`ballot_batch_min` is 3, and T1/T2 are legal instants of both issues. `U` is
`vote_cast` version 1000000 (EV-19). These are the declared expectations for the
vectors owed below. They are not vectors, and none is added here.

| Case                             | Sequence                   | v11             | v12 (this ADR)     |
| -------------------------------- | -------------------------- | --------------- | ------------------ |
| opaque member                    | A@T1, A@T1, U@T1, A@T2×3   | INVALID line 7  | PARTIAL lines 6, 7 |
| payload must stay opaque         | same; U's payload names B  | INVALID line 7  | PARTIAL lines 6, 7 |
| insufficient even optimistically | A@T1, U@T1, A@T2×3         | INVALID line 6  | INVALID line 6     |
| opaque closure                   | A@T1×3, U@T2, A@T1         | PARTIAL line 7  | PARTIAL lines 7, 8 |
| definite resumed instant         | A@T1×3, A@T2×3, U@T1, A@T1 | INVALID line 11 | INVALID line 11    |
| already full batch               | A@T1×3, U@T1, A@T2×3       | PARTIAL line 7  | PARTIAL line 7     |
| known-only control               | A@T1×2, A@T2×3             | INVALID line 6  | INVALID line 6     |
| definite quantization error      | U@T1, A at T1 + 1 ms       | INVALID line 5  | INVALID line 5     |

Each v12 entry equals the proposal's declared expectation for the exact rule.
On these eight cases the conservative rule loses nothing. The cases where it does
differ are named under Consequences.

### Rejected options

- **The exact all-assignments rule** (the proposal's own rule). It is the best
  answer in principle, and it is too costly to build twice. A naive version is
  exponential in the number of opaque ballots. A bounded streaming version, as
  the proposal asked, needs each of two isolated builders to invent an
  equivalent incremental algorithm and prove it against an exhaustive oracle.
  Since EV-17 makes the enumerated lines conformance surface, any disagreement
  between those two algorithms is a verdict divergence. The conservative rule is
  a few counters per issue, and its definition is its own oracle.
- **Defer the decision.** ET-24's v11 wording would reach the release candidate
  unchanged, and the first `vote_cast` v2 would face a choice between breaking
  every deployed verifier (false `INVALID`) and escaping batching. Deferring in
  effect freezes the ballot format at version 1. Richer ballots are a charter
  §5 roadmap item, and the ceiling ADR (part B) is still owed.
- **Option (b) alone** from the open question: report `PARTIAL` for an ET-24
  finding when an opaque ballot falls between the run and its terminator. It
  fixes what old verifiers say but not permanence. Without ET-22a, nothing makes
  the opaque ballot a ballot of one issue, so treating it as a possible batch
  member has no basis.
- **Option (a) alone**: the constraint without an uncertainty rule. It fixes
  permanence, but old verifiers still report the false `INVALID` above.

## Consequences

- **The `INVALID` set narrows, and only on chains holding an unregistered
  `vote_cast` or `issue_created`.** Where no unregistered `vote_cast` is a
  candidate of any issue and no registered ballot names an unregistered
  `issue_created`, v12 verdicts and lines equal v11's. A v11 verifier that
  rejected a ballot of an unregistered issue version under ET-18 now reports
  `PARTIAL` (ET-18b). No committed vector holds such a ballot. Some v11 `INVALID` results with an opaque
  ballot become `PARTIAL`, and some v11 `PARTIAL` results name more lines. No
  committed vector contains an unregistered `vote_cast`. The ones that use
  version 1000000 (`009`, `070`, `096`) put it on `participant_registered` or
  `genesis`, so no corpus verdict changes. `contracts/` is DRAFTING (ADR-0007),
  where this is still cheap.
- **The over-reporting is real and bounded.** The conservative rule can list a
  registered line that no assignment changes, for example a candidate at
  `ts(L)` just before a run start _L_. It reports `PARTIAL` where only a search
  could prove `INVALID`, most plainly on a single-issue chain, where every
  candidate must belong to that issue. Both err toward the weaker claim.
- **Tightening to the exact rule later stays possible, and decision 7 keeps it
  cheap.** Tightening would shrink some `PARTIAL` line sets and turn some
  `PARTIAL` verdicts into `INVALID`, and both are conformance surface (EV-17).
  After the freeze, ADR-0008 makes vectors add-only, so a vector pinning a line
  set the exact rule would not produce would be the time bomb EV-18/EV-19 were
  written to prevent. **ET-24b vectors therefore pin only cases on which the
  conservative and exact rules agree** (all eight above do). The
  over-reporting is covered by verifier unit tests, never by golden vectors.
  Whoever writes the vectors must show agreement for each case, for example by
  running the exact rule's exhaustive search on that small chain.
- **ET-22a is permanent and binds whoever designs `vote_cast` v2.** A ranked or
  multi-issue ballot cannot be one event. It must be one `vote_cast` per ballot
  per issue, batched under its issue's rules, and no other type may carry it.
  This narrows the design space of ballot-expressiveness ADR part B, alongside
  ET-22. Changing an issue's interval or minimum after creation is also ruled
  out for good; a community that wants different parameters opens a new issue.
- **Owed, in order** (fixtures may never precede verifiers):
  1. A fresh-context review of this ADR and the three spec amendments,
     specifically of ET-24b's soundness argument and its line sets.
  2. Both verifiers implement ET-22a's scope change, ET-18b and ET-24b, each in its own
     isolated sparse worktree. Hand the builders the unmerged spec as
     scratchpad copies. On the committed corpus the new logic is a no-op,
     because no vector holds an opaque `vote_cast`, so each PR can land alone.
     Each builder must test the lines ET-24b defines against a brute-force
     reading of the definition on generated chains. That reading is
     quadratic, so this needs no exhaustive oracle.
  3. Vectors, each a case where the conservative and exact rules agree: the
     eight cases above, a registered ballot naming an unregistered
     `issue_created` version (`PARTIAL` naming both lines), plus multiple opaque ballots, an opaque
     ballot before an issue's first registered ballot, several issues sharing
     instants, an opaque `ts` that is a multiple of one issue's interval and not
     another's, an opaque ballot created before an issue (not a candidate),
     and a malformed opaque payload (`INVALID`, EV-16). Run the rehearsal
     chain through both verifiers first, per the standing caution.
  4. `docs/security/attacks/check-unknown-batching-proposal.py`'s `proposed`
     mode now matches the ratified expectations. It can join required CI once
     both verifiers pass it.
- **Nothing from the draft's open questions remains open.** The operator
  settled all three on 2026-10-10 (decisions 8 and 9).

### Documents reconciled

- `contracts/event-types.md` v11 → v12: ET-18b and ET-22a added; ET-24, ET-24a and "Which
  ballots count" widened to every registered version; ET-24b added; the
  section intro, degrees-of-freedom table and acid-test walkthrough updated.
- `contracts/evolution.md` v6 → v7: EV-7 (what `PARTIAL` enumerates), EV-8
  (new paragraph), EV-15 (ET-22a outside the split, ET-18b and ET-24b in Stage B), EV-17
  (the enumeration set), the table and the walkthrough.
- `contracts/event-schema.md` v5 → v6: ES-21 names ET-24b's use of `ts`.
- `contracts/export-format.md`: **unchanged**. ET-24b item 5 says an unresolved
  check counts as not failed for EX-15/EX-22's "registered semantic checks
  pass" condition, as an unregistered event already does. EX-16 still holds,
  because ET-24b decides each line from earlier lines.
- `contracts/fixtures/README.md`: **unchanged**. Its conformance table
  ("`PARTIAL` + `lines`") already fits a larger line set. No vector is added.
- `docs/plans/hash-chain-unknown-ballot-batching.md`: status line now reads
  DECIDED (ADR-0034, option 2), **in this change**. Its body keeps the record of
  the proposal.
- `docs/decisions/0029-a-ballot-batch-once-left-is-closed.md`: status line
  notes the amendment of its "Which ballots count" bullet, **in this change**.
  Its body is a record and keeps its text.
- `docs/decisions/0006-verifier-scope-and-forward-compatibility.md`:
  **unchanged**. Its `PARTIAL` definition ("enumerate the affected line
  numbers") is refined, not contradicted. `evolution.md` is the normative
  home it names.
- `services/verifier/API.md` (ballot batches section) and
  `tools/verifier-ts/README.md` (ET-24a, "Which ballots count") still describe
  v11's "joins no batch" behaviour, which is what the code does. **Not changed
  here**: this change touches no verifier. The isolated verifier PRs that
  implement ET-24b update them in the same change, as ADR-0029's did.
- `docs/implementation-plan.md` and `services/ledger/CLAUDE.md`: **unchanged**.
  They describe the producer's batching duties, which ET-22a extends to future
  versions without changing anything a v1 ledger does.
- `memory/STATE.md` and `memory/OPEN-QUESTIONS.md`: updated on master at merge
  time, per `odc-pipeline`. The open question "Future `vote_cast` versions and
  ballot batching" moves to the archive with a pointer here. No new open
  question is left.

## Charter check

- **P1 (the log is the only truth; anyone recomputes):** strengthened. An old
  verifier no longer reports a chain that grew past it as tampered with. It says
  which lines it could not settle, and it still proves what the registered
  events alone prove.
- **P2 / §5 (ballot plane secret, equal, unlinkable):** strengthened. ET-22a
  makes batching, the rule that hides a ballot among others (ADR-0014), binding
  on every future ballot version. Before this, a v2 ballot could escape it
  entirely. "One event, one ballot" also keeps the canonical count one human,
  one vote, with no event carrying several ballots.
- **P3 (characterize, never weigh):** `PARTIAL` with an honest line list
  characterizes what the verifier could not check. It neither accepts nor
  condemns what it cannot read.
- **P4 (floors, not ladders):** not touched. Nothing here gates participation
  or weights a ballot. No wire format, payload key or hashing rule changes.
- **§8 (exit and fork):** a fork that adds a ballot version stays verifiable
  by the original verifier as `PARTIAL`, not condemned as `INVALID`.
