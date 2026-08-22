# Open Questions

Unresolved design questions for the **ODC core**. Move each to an ADR when
decided; delete when moot. (Pulse's open decisions are in `memory/pulse.md`.)

> **Do not read this file end to end.** It is ~50 KB and mostly settled
> reasoning kept on purpose. Use the index below, then read the one entry you
> need. Entries are addressed by their **bold title**, which is stable — grep
> for it rather than trusting a line number.

## Index

**Still open — these are the actual open questions:**

| Question                                                                                             | Where                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Q-F** — the registrar's signature as a subliminal channel                                          | "Q-F — What mitigates the registrar's signature…"            |
| **⚠️ Ballot expressiveness vs receipt-freeness** — a live contradiction between charter §5 and ET-22 | **Archive file**; read before writing the ceiling ADR part B |
| Does `read-api.md` (RA-1…RA-13, **zero** conformance coverage) need vectors before Phase 1?          | "Added by the T9 orchestration, not by the auditor"          |
| Registrar key custody and the no-receipt discipline in Phase 1 identity                              | Archive file: "Registrar-side ballot privacy"                |
| `RETIRED.md` valve; EV-5's fixture breadth; an HA-2 fixture                                          | Archive file, three adjacent bullets                         |
| Sanction/negative events; money/attestation/capability events (Phase 2+)                             | Archive file, deferred — **not** freeze blockers             |

**Settled, kept for the reasoning:**

| Topic                                             | Where                                                        |
| ------------------------------------------------- | ------------------------------------------------------------ |
| The six T9 blocking findings F1–F6                | "Blocking the T9 gate" → "DECIDED by the operator" → Q-A…Q-H |
| What each became                                  | ADR-0013…0018 in `docs/decisions/`                           |
| Traps left by the ADR pass and by fixture phase 1 | The two "Traps left by…" sections                            |
| The charter §4 anchoring edit                     | "Charter §4 edit — RATIFIED 2026-08-15"                      |
| Everything decided before T9                      | `memory/OPEN-QUESTIONS-archive.md`                           |

**Where a new question goes:** a new bullet **in this file**, with a bold title
and a date, or its own `##` section if it needs one. It moves to the archive file
only once it is settled. If you
settle one, replace its body with the ADR number and keep the title — the title
is what other documents cite.

## Blocking the T9 gate (raised 2026-08-14, `docs/security/audit-phase-0.md`)

The T9 audit returned **REQUEST CHANGES**. Each of these must be decided before
`contracts/` advances to RELEASE CANDIDATE. Full reasoning is in the audit; only
the question is restated here.

These six are new — established by checking each against the entries already in
this file, not by the auditor's isolation. The isolation is why the read was
_independent_; it is not evidence of novelty, and the four "independently
rediscovered" amendments further down are the proof, since those are cases where
a cold auditor landed on something already filed.

The audit carries **six blocking findings, F1–F6**. Five map to the questions
below (F1→Q-A, F2→Q-B, F4→Q-D, F5→Q-E, F6→Q-H); F3 is blocking but amends the
existing unregistered-`genesis`-version entry further down rather than opening a
new one. Q-F and Q-G come from findings the audit rates SHOULD (S2, S5) and are
listed here because they need design work, not because they gate the RC.

## DECIDED by the operator, 2026-08-15 — all six

Worked through one at a time in session.

**IMPLEMENTED 2026-08-15 as ADR-0013…0018** (branch
`claude/context-memory-review-zjojus`, commits `9f9a81f`…`47001f3`). Specs bumped:
`event-types.md` v7→**8**, `evolution.md` v3→**4**, `export-format.md` v2→**3**,
`event-schema.md` v2→**3**; one `CONTRACTS-CHANGE.md` entry with six subsections.
Both verifier suites still pass — they and the fixtures are internally consistent
and now **behind** the spec, which is expected until the two passes below land.

| #   | ADR                                                                                               |
| --- | ------------------------------------------------------------------------------------------------- |
| F1  | ADR-0013 chain identity is the genesis hash                                                       |
| F2  | ADR-0014 ballot batching                                                                          |
| F3  | ADR-0015 unregistered genesis version                                                             |
| F4  | ADR-0016 genesis `ancestor_head`, **amended in part by ADR-0019** (`ancestor_chain` added; ET-9f) |
| F5  | ADR-0017 sentiment plane bar                                                                      |
| F6  | ADR-0018 distinct genesis keys                                                                    |

**F2's parameters are governable, per the operator's instruction that batch size
be votable "like almost everything about this project".** `issue_created` carries
`ballot_batch_interval_ms` and `ballot_batch_min`, so the values live in the log
and change per issue by vote; the contract fixes only the mechanism. Permanent
floors — interval **≥ 60000 ms**, minimum **≥ 3** — because without one,
"governable" means the operator sets 1 ms / 1 and the rule becomes decorative.
Floors are deliberately low: they are floors, not defaults, and a community votes
upward. This is the ET-22 / `choice_count` split reused — _that a bound exists_ is
permanent, the number is provisional.

### Owed before the T9 gate can reopen

1. **Fixtures.** The batch parameters are **required** on `issue_created` (optional
   would let a chain omit them and run unbatched, defeating F2), so **54 of 83
   vectors carry an `issue_created` and need regeneration**. Legal — nothing is
   frozen, no `contracts-v1` tag — and precisely why ADR-0007 deferred the freeze.
   **Verdicts must survive regeneration unchanged**: a vector testing a seq gap
   must still test a seq gap. New vectors owed: `--chain` match/mismatch and the
   two-chain pair (F1); non-quantized `ts`, undersize batch proven by a later
   ballot, legal undersize _final_ batch, below-floor interval, below-floor minimum,
   multi-batch VALID (F2); genesis at version 1000000 (F3); fork ancestry —
   **both keys** well-formed, `ancestor_chain` alone (VALID, pinning the
   deliberate asymmetry), `ancestor_head` alone (INVALID line 1, ET-9f), either
   key 64-zero, either key malformed, a well-formed pair naming an
   unresolvable chain, and **`ancestor_chain` == `ancestor_head` (VALID)** — the
   legal case a fork from a parent holding only its `genesis` produces, where the
   parent's head _is_ its genesis hash (EX-14/EX-21), and the one a naive
   implementer rejects as a duplicate (F4, as amended by ADR-0019); same-key
   genesis (F6). **Write `ancestor_head` alone first:** it is the only owed vector
   that fails against a verifier still implementing the merged ET-9e, so it is the
   single fixture proving the ADR-0019 change landed.
   F5 gets none by construction — a coverage-report note instead; ET-25 likewise.
2. **Both verifiers, in separate isolated contexts** — independence is the whole
   point of having two. `--chain <genesis-hash>`, print the computed genesis hash
   and head (EX-24, scoped as tool output not verdict, so it does not collide with
   EV-17), plus the F3 verdict, F6 key check, and F2 quantization/batch checks.
   `services/verifier/CLAUDE.md` and `tools/verifier-ts/` still state the old CLI
   surface; ADR-0013 names them so the ticket carries it.
3. **Fresh re-audit** by an isolated auditor that is not the context which wrote
   `audit-phase-0.md`. This is what actually clears T9.

### Traps left by fixture phase 1 (#104) — two more of the same shape

Recorded here rather than in the PR body, because a trap that lives only in a
GitHub comment is a trap nobody reads at the moment it fires.

- **`tools/fixtures-gen/test/fixtures.test.ts` will reject the below-floor vectors
  ADR-0014 owes.** Its corpus-wide ET-14b scan asserts presence **and** floor
  compliance, so a vector whose entire point is an interval under 60000 or a
  minimum under 3 fails the generator's own test suite. Correct today, wrong the
  moment phase 3 writes one. **Exempt vectors whose declared fault IS the floor;
  do not relax the check for everything else** — its value is catching a payload
  that quietly stopped testing what its note claims. A note to this effect is now
  in the test's docstring too.
- **`tools/rehearsal` will violate ET-24 once that rule is enforced.** It builds
  40 ballots across 5 issues at distinct seq minutes, which under ET-24 is a run of
  one-ballot batches, each under-size and not last. The rehearsal is green today
  only because no verifier enforces ET-24 yet. This is a **chain-shaping decision**
  for phase 3, not a bug to patch under time pressure — the rehearsal's ballots
  need to share batch instants the way `005-boundaries` now does.
- **No vector discriminates the ET-14b floor check.** All 55 `issue_created`
  payloads declare exactly `60000`/`3`, so a verifier that accepted the keys and
  skipped the floors passes all 83. Both isolated verifier builds reported this
  independently, and the phase-1 reviewer confirmed by differential testing that
  both implementations really do enforce it — so the check is spec-driven and
  proven, just not fixture-confirmed. The below-floor vectors close it in phase 3.

### Traps left by this change — do not lose these

- **`tools/fixtures-gen/test/conformance.test.ts:189` now blocks its own fixture.**
  It asserts _no vector may freeze a verdict for an unregistered genesis version_,
  because that was open. ADR-0015 answers it, so the guard forbids exactly the
  vector F3 requires. **Invert it, do not delete it** — deleting drops a real
  protection along with the stale assertion.
- **Fixture `057-issue-sig-wrong-key`'s `note` asserts the old ET-9a rule.** The
  verdict is unaffected; the prose is now false. Fixture notes become immutable at
  the tag (ADR-0008), so **fix it before the tag or it is permanent**.
- **ES-21 forbade validating on `ts` at all**, which ET-23 now does. Amended so it
  still never _orders_ or _selects_ on time — check the amendment holds if `ts`
  semantics are touched again.
- **ET-24 pins the blamed line** for an undersize batch at the first later ballot
  of the same issue. Without that pin two verifiers agree a chain is bad and
  disagree where, which is the T7/ET-9c divergence shape all over again.

### Landed as #98, 2026-08-15 — the PR stack was closed, not merged

The work was originally cut into three reviewable units and opened as a stack
(#99 `claude/t9-audit` → #100 `claude/t9-decisions` → #101
`claude/t9-adrs-contracts`, each based on the one before). The seam was
deliberate: #99 asks "is the audit sound", #100 asks "do we agree with these
decisions", #101 asks "is the spec text correct" — three different review
questions a single 2,500-line PR would have forced one reviewer to answer at
once.

**That is not what happened.** `#98` merged the whole combined branch
(`claude/context-memory-review-zjojus`, the everything-branch the stack was
kept in sync with) directly to `master` before the stack finished review, so
`#99`/`#100`/`#101` became redundant — their content already existed on
`master` through `#98` — and were **closed unmerged**. ADR-0013…0018 and the
`contracts/` edits landed via #98.

**CI was checked, not assumed.** The concern that the combined branch would fail
CI does not hold — every required check passes locally against the stack tip,
run uncached: `format:check`; `npx eslint .` **run directly, because `turbo`
caches `lint` and a green cached run right after moving files is not
trustworthy**; `typecheck`; `turbo run test --force` 10/10; `go test -count=1`;
the rehearsal at 9 scenarios × 2 verifiers; `fixtures-manifest` 87 files;
`diff-size` at 382 counted lines against a 1000 ceiling (markdown is exempt,
which is why 2,500 changed lines score 382); `contracts-guard`; and
`guards.test.sh` 30/30. The split is for reviewability, which `odc-pipeline`
requires anyway — one branch, one reviewable idea — not to rescue a failing
build.

### Charter §4 edit — RATIFIED 2026-08-15

The anchoring bullet says a chain's **identity** (its genesis hash) and its
**head** must be published **together**, because a head names a position on
_some_ chain, so publishing it alone lets an operator run two chains and anchor
one. The content follows from the ratified F1 decision (ADR-0013) and the
independent assessment below Q-A. **The operator ratified the wording on
2026-08-15**, per this project's standing rule that charter edits are an
operator decision, not a routine docs merge (see the ballot-expressiveness
entry, where part A was likewise explicitly marked operator-ratified).
`memory/STATE.md` records the ratification. Landed via #98.

| #   | Decision                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Chain identity is the **`genesis` event hash**. Demote `chain_id`, fix ET-7's "stable identifier" wording, add `--chain <hash>` to both verifiers. **No genesis field needed.**                                                                                        |
| F2  | **Batching before the freeze:** ballot `ts` quantized to a published interval, batch order independent of arrival, minimum batch size. **Quorum deferred** (see below).                                                                                                |
| F3  | An unregistered `genesis` `(type, version)` is **`INVALID` at line 1**, with a message distinguishing "verifier out of date" from "chain corrupt". Needs a fixture — none exists.                                                                                      |
| F4  | **Add optional fork-ancestry keys to `genesis`:** `ancestor_chain` (the parent's genesis hash — the name) and `ancestor_head` (the parent's head at the fork — the position), head requiring chain (ET-9f, ADR-0019). Nothing may be added to `genesis` after the tag. |
| F5  | Permanent `evolution.md` bar on registering any sentiment / survey / monetizable-response type on the governance chain, in the ET-22/EV-13 register.                                                                                                                   |
| F6  | Require **`registrar_pk != operator_pk`**.                                                                                                                                                                                                                             |

**Carried decisions and reasoning worth keeping:**

- **F2 splits in two, and only half is urgent.** Batching must precede the freeze
  because it tightens an existing rule, which EV-1 bars post-freeze. **Quorum —
  a minimum turnout below which a vote publishes nothing — is deferred**, because
  only `genesis` is version-pinned (ET-6); `issue_created` can take a v2 with a
  `min_turnout` key at any time, and a new `(type, version)` is additive. Accepted
  trade: warn users that early low-turnout votes may be identifiable, **shown
  before casting**. The irreversible part is not the rule but the data — ballots
  published under low turnout stay public forever, so keep early votes low-stakes.
- **Small-turnout secrecy is arithmetic, not timing.** 5 votes at 3–2 with four
  known reveals the fifth; 5–0 reveals everyone. No batching, shuffling or
  quantization touches this. Recorded so it is not "solved" by the F2 mechanism
  later. The charter already carries the principle (§8, k-anonymity floors).
- **F2 is enforced in the ledger, which does not exist yet** (`services/ledger/`
  holds only README/CLAUDE). So this is a requirement landing _before_ the code,
  not a retrofit. Three of the four rules are verifier-checkable from the log
  (quantized `ts`, batch size, turnout vs. a declared threshold); **the shuffle is
  not checkable** and remains implementation trust. Know which is which.
- **The hash chain enforces no content rule.** It gives tamper-evidence only.
  Rules are followed by the ledger and _detected_ by the verifier; with one writer
  and no consensus, enforcement is public detection, never prevention.
- **F5 blocks the direction that hurts, and only that one.** Sentiment content
  reaching the ballot plane loses protection — barred. A sentiment-shaped question
  run _as_ a ballot gains ballot protection and is harmless: wasteful of
  one-human-one-vote capacity and cluttering, but not a security fault. The
  contract cannot distinguish "should we fund Y?" from "do you like Y?" and should
  not try; that is a governance/moderation matter, and the charter already makes
  moderation a public event. **Word the bar to block sentiment content while still
  permitting the anonymous commitment hashes the sentiment service is meant to
  commit here** (`implementation-plan.md:81`).
- **F6 is necessary, not sufficient**, and was approved on that basis: two distinct
  keys can still be held by one party and the log cannot tell. It blocks the
  blatant collapse only.

### The six findings, one entry each (Q-A … Q-H)

- **Q-A — DECIDED → ADR-0013.** _What is a chain's identity, and what does an
  anchor publish?_ (F1, S3.) `chain_id` is `sha256(operator_pk)` with, in
  ET-7's own words, "no free parameter" — so it is **identical across every
  chain that operator ever starts**. The audit built two complete chains
  differing only in a 1 ms genesis `ts`, reaching opposite outcomes on the same
  question, carrying the _same_ `chain_id`, both `VALID` under both verifiers.
  **Answer: a chain's identity is the `hash` of its `genesis` event**, not
  `chain_id`, which is demoted to a mere restatement of `operator_pk`. ET-7a
  states identity normatively; `--chain <genesis-hash>` is a new verifier input
  (`INVALID` at line 1 on mismatch, EX-21–EX-23); every verifier run MUST now
  print the genesis hash and head it computed (EX-24) — a tool that only says
  `VALID` was answering "is _some_ chain valid". No new `genesis` field: the
  genesis hash already commits to `operator_pk`, `registrar_pk`, `contracts`
  and `ts`, so the cheaper option (declare identity, don't add a nonce) won,
  and it was the only option available after the freeze in any case (ES-18
  closes the genesis key set, ET-6 pins `genesis.version` to 1, EV-1 forbids
  altering a frozen `(type, version)`).

  **INDEPENDENT ASSESSMENT, 2026-08-15.** The operator challenged both the
  severity and the fix, so the question went to a separate model with no stake in
  the audit, given both positions unattributed and told a conclusion contradicting
  both would be a good outcome. It contradicted both. Findings, with the sources
  it cited:
  - **Key-derived log identity is conventional — under an invariant we lack.**
    CT v1 (RFC 6962) defines LogID as SHA-256 of the log's SubjectPublicKeyInfo,
    exactly our construction. But CT v2 (RFC 9162) states a log **MUST NOT** use
    the same keypair as any other log, and moved identity off the key to per-log
    OIDs. C2SP's checkpoint format (Sigstore, Go sumdb, Sigsum) gives every
    checkpoint an `origin` line — a per-log identifier separate from the key — and
    witnesses key their state on it. Chrome treats cross-log key reuse as an
    incident. So the rule everywhere is **one key, one log**; we permit one key to
    start many chains, which is the actual defect. ET-7's claim that `chain_id`
    "binds the chain's identity to its operator key" is false as written — it binds
    the _operator's_ identity.
  - **The "a diligent observer catches this today" argument is wrong**, and it was
    the orchestrator's, not the audit's. Three reasons: no anchor exists, so there
    is no shared reference point; the verifier prints only `VALID` and never emits
    the genesis or head hash it computed, so diligence has nothing to act on; and
    checking that successive heads stay consistent does **not** catch it, because
    alternating anchors from two chains sharing a `chain_id` look like one chain
    advancing unless the checker replays whole exports — and with a bare hash chain
    and no Merkle tree there are no succinct consistency proofs, so that check is
    linear-cost and no rule requires it. Recorded because the argument is
    superficially attractive and will recur.
  - **Prevention is not achievable; detection is the ceiling.** SUNDR (OSDI '04)
    establishes fork consistency: an untrusted server can always fork clients, so
    the goal is making forks detectable and permanent. Ranked by what actually
    carries weight in deployment: signed heads plus consistency checking between
    successive heads; **witness cosigning** (CoSi, Sigsum, the transparency.dev
    witness network), which is where the field converged; and **gossip, which
    failed** — `draft-ietf-trans-gossip` expired undeployed and CT ran a decade
    with essentially none. The lesson it drew for us: do not rely on observers
    spontaneously comparing notes, build explicit witnessing.
  - **Verdict: a genuine design defect, not a naming one** — because the
    identifier's one future job is to key the anchoring and witnessing layer, and
    as specified it cannot. The threat model is dishonest-operator equivocation,
    which for a governance log is the primary threat, not an edge case.
  - **Severity is worse than either position stated, but the weight moves.** Its
    closing point: _until an anchor exists, every audience is trivially forkable
    regardless of what the identifier is_. So the anchoring gap (filed as S3, a
    SHOULD, and folded into this entry) outranks the naming problem, and the two
    should be decided together.

  **Recommended resolution, superseding the audit's two-option framing — items
  1–3 are what ADR-0013 implemented:** identity = the `genesis` event hash
  (unique per chain, no schema change, matches RFC 9162's direction of
  decoupling log ID from key); ET-7's "stable identifier" language fixed
  rather than left frozen wrong; the verifier now prints the genesis hash and
  head it computed rather than only `VALID`.

  **Item 4, anchor contents, is NOT decided by ADR-0013 and remains open —
  the anchoring layer itself is a new artifact, not an event schema, and is
  safely addable post-freeze.** Recorded proposal: `(genesis_hash, seq,
head_hash, timestamp, operator signature)` as a signed checkpoint, ideally
  in C2SP signed-note format so witness tooling can be inherited later, with a
  fixed cadence and **a normative rule that a gap or regression in `seq` is
  itself an alarm** — without which a missing anchor is undetectable. This is
  the charter's real remaining omission on anchoring.

- **Q-B — DECIDED → ADR-0014.** _What publication discipline makes ballots
  receipt-free against an observer who knows when a voter voted?_ (F2.) ET-21
  proves the _voter_ retains no artifact; it does not address a **coercer
  assembling one** — with ES-20 millisecond `ts`, monotonic `seq`, and a cheap
  unauthenticated tail read (RA-12/RA-13), someone who watches you vote reads
  your `choice` in the clear. **Answer: mechanism fixed permanently
  (ET-23–ET-25 — quantized `ts`, minimum batch size, non-arrival internal
  order), parameters governable per-issue on `issue_created`, floors permanent**
  (see the operator-confirmed floors above: interval ≥ 60000 ms, min ≥ 3).
  **Quorum (a minimum-turnout publication threshold) is explicitly deferred,
  not solved by this mechanism** — small-turnout exposure is arithmetic on the
  tally (5 votes at 3–2 with four known reveals the fifth; 5–0 reveals
  everyone), not timing, so no interval/batch/shuffle addresses it. Accepted
  trade: a pre-casting warning shown to voters that early low-turnout votes may
  be identifiable, owed to Phase 1 identity/web work — the irreversible part is
  the published data, not the rule, so keep early votes low-stakes.
- **Q-D — DECIDED → ADR-0016, amended by ADR-0019.** _How does a forked
  community record its ancestor head?_ (F4.) Charter §8 grants forking as a
  **right** — re-declare genesis anchored to the old chain's head — but the
  contract had no slot for
  it (`prev_hash` fixed at 64 zeros, genesis key set closed, genesis version
  pinned to 1): a charter violation, unaddable after freeze. **Answer: two
  optional fork-ancestry keys added to `genesis` (ET-9e)** — `ancestor_chain`, the
  parent's **genesis hash**, which is the only value that can name a chain
  (ET-7a); and `ancestor_head`, the parent's **head at the fork** (EX-14), a
  position _on_ the chain `ancestor_chain` names. Both format-checked only — a
  recorded claim, not a verified link, since the verifier cannot fetch the
  ancestor chain to confirm it — with the 64-zero anchor explicitly barred as a
  value (one meaning, one representation, not two byte-forms of "no ancestor"),
  and **`ancestor_head` MUST NOT appear without `ancestor_chain`** (ET-9f):
  a position on an unnamed chain is the head-alone anchoring charter §4 rejects.
  `ancestor_chain` **may** appear alone — that asymmetry is deliberate, and is
  stated in the rule text so it is not later tidied into both-or-neither.
  **ADR-0016 originally added `ancestor_head` alone and called it "the only key
  `genesis` will ever gain again"; ADR-0019 corrected both** — the key set, and
  the claim. The permanent bar is the **tag**, not a count of keys: ET-6 pins
  `genesis.version` at `1` and EV-1 bars altering a frozen `(type, version)`, so
  **nothing may be added to `genesis` once `contracts-v1` exists**. No tag exists
  yet (`contracts/` is DRAFTING, ADR-0007), which is the only reason this
  correction was addable at all.
- **Q-E — DECIDED → ADR-0017.** _May a sentiment or monetizable event type
  ever share the governance chain?_ (F5.) Non-negotiable rule 7 and charter
  §6/§8 all said no, but `evolution.md` — the rulebook that actually decides
  what may be added — carried no bar, so a future additive type could legally
  reach it. **Answer: permanent `evolution.md` EV-22,** barring any future
  type whose payload carries a response (sentiment/survey/rating/etc.), worded
  to still permit what the sentiment service needs — an aggregate,
  never-per-respondent commitment hash with no respondent identifier (a
  per-response hash is a response in disguise, since a small answer space is
  invertible by enumeration). The bar is directional: a sentiment-shaped
  question run **as a ballot** is wasteful and clutters the chain but is not a
  security fault, and the contract deliberately does not try to judge a
  title's meaning — that is moderation's job (charter §9), not the verifier's.
- **Q-F — What mitigates the registrar's signature as a subliminal channel?**
  (from S2.) Every ballot carries 64 registrar-chosen, published, permanent
  signature bytes, into which the registrar can encode the voter's identity
  undetectably. The audit explicitly **disagrees with the prior posture audit**
  here: that document called the registrar's admission-time knowledge the only
  artifact connecting a human to a ballot, but that knowledge is transient and
  deletable, whereas this one is written to the permanent public record. Options:
  attested builds, threshold/split registrar signing, published nonce derivation.
  Also asks whether this moves blind-signature credentials off charter §11's
  deferred list.
- **Q-H — DECIDED → ADR-0018.** _Must `registrar_pk` differ from
  `operator_pk`?_ (F6, promoted from SHOULD to blocking during review — the
  timing argument that a new MUST here, added after the freeze, would
  retroactively invalidate previously-conforming chains, barred by EV-1/EV-4,
  is the same argument that carried F1/F4/F5.) **Answer: yes — ET-9d**, a
  `genesis` with `registrar_pk == operator_pk` is `INVALID` at line 1 (plain
  string comparison, after ET-9b format checks pass). **Necessary, not
  sufficient, and said so deliberately**: two distinct keys can still be held
  by one party and the log cannot tell — ET-9d blocks only the blatant,
  declared collapse. Custody of the two keys remains policy (charter §10 v1
  trust posture, hardened in identity v2); see the still-open key-custody
  entry below.

**Added by the T9 orchestration, not by the auditor** (mechanical inventory,
same date): **the entire read-api surface has zero conformance coverage.** An
exact count of rule ids across the seven specs gives **143 total, 70 cited by at
least one vector, 73 cited by none** — so the real figure is 143, not the "~130"
previously recorded, and the uncovered half includes **RA-1 through RA-13, the
whole of `read-api.md`**. That file is the public read surface, which is exactly
where identity leakage would surface, and F2 turns on RA-12/RA-13 specifically.
The gap list carried in `STATE.md` (ES-30–32, ET-3, EX-14, most of `ids.md`,
EV-11–14) does not mention `read-api.md` at all. Open question: does the read API
need conformance vectors before Phase 1 builds against it, or is it out of scope
for a fixture suite whose unit is the export line rather than an HTTP response?
Note the honest limit of a fixture suite here — vectors are NDJSON exports, so
covering RA rules may need a different instrument, which is likely why it was
never noticed.

## Archive

Settled questions, and a handful of deferred-but-open ones, live in
**`memory/OPEN-QUESTIONS-archive.md`** (~32 KB). It was split out of this file so
this one stays readable. The index above says which entries there are still open;
everything else there is DECIDED and kept only for its reasoning.
