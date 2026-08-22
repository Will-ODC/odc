# Open Questions

Unresolved design questions. Move each to an ADR when decided; delete when moot.

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

| #   | ADR                                         |
| --- | ------------------------------------------- |
| F1  | ADR-0013 chain identity is the genesis hash |
| F2  | ADR-0014 ballot batching                    |
| F3  | ADR-0015 unregistered genesis version       |
| F4  | ADR-0016 genesis `ancestor_head`            |
| F5  | ADR-0017 sentiment plane bar                |
| F6  | ADR-0018 distinct genesis keys              |

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
   multi-batch VALID (F2); genesis at version 1000000 (F3); `ancestor_head`
   valid/64-zero/malformed/unresolvable (F4); same-key genesis (F6). F5 gets none
   by construction — a coverage-report note instead; ET-25 likewise.
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

| #   | Decision                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Chain identity is the **`genesis` event hash**. Demote `chain_id`, fix ET-7's "stable identifier" wording, add `--chain <hash>` to both verifiers. **No genesis field needed.**   |
| F2  | **Batching before the freeze:** ballot `ts` quantized to a published interval, batch order independent of arrival, minimum batch size. **Quorum deferred** (see below).           |
| F3  | An unregistered `genesis` `(type, version)` is **`INVALID` at line 1**, with a message distinguishing "verifier out of date" from "chain corrupt". Needs a fixture — none exists. |
| F4  | **Add an optional `ancestor_head` key to `genesis`.** This is the one genesis change; the door does not reopen.                                                                   |
| F5  | Permanent `evolution.md` bar on registering any sentiment / survey / monetizable-response type on the governance chain, in the ET-22/EV-13 register.                              |
| F6  | Require **`registrar_pk != operator_pk`**.                                                                                                                                        |

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
- **Q-D — DECIDED → ADR-0016.** _How does a forked community record its
  ancestor head?_ (F4.) Charter §8 grants forking as a **right** — re-declare
  genesis anchored to the old chain's head — but the contract had no slot for
  it (`prev_hash` fixed at 64 zeros, genesis key set closed, genesis version
  pinned to 1): a charter violation, unaddable after freeze. **Answer: optional
  `ancestor_head` key added to `genesis` (ET-9e)**, format-checked only — a
  recorded claim, not a verified link, since the verifier cannot fetch the
  ancestor chain to confirm it — with the 64-zero anchor explicitly barred as a
  value (one meaning, one representation, not two byte-forms of "no ancestor").
  **This is the only key `genesis` will ever gain again**; ES-18/ET-6/EV-1
  close the door permanently after this one use.
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

- ~~Canonical JSON serialization~~ → DECIDED: fixed-field-order byte
  construction, strict rejection (D3/D5 in docs/plans/phase-0.md; ADR in T3).
- ~~Signature scheme~~ → DECIDED: Ed25519 (D2; ADR in T3).
- **Ballot unlinkability vs. signed `vote_cast`** → DECIDED (ADR-0004): voter-held ballot keys removed entirely; `vote_cast` is registrar-signed, no voter-held artifact can prove any ballot.
- **Registrar-side ballot privacy (Phase 1 identity design, from ADR-0004).**
  In v1 the registrar (identity service) necessarily sees `{who, issue,
choice}` at eligibility-check time — trust-by-policy per charter §10 v1,
  removed by blind-signature credentials in identity v2. Phase 1 must design:
  registrar key custody (separate from `operator_pk`, held only by identity);
  one-human-one-issue enforcement and its audit trail (off-log); and the
  no-receipt discipline — identity and web MUST NOT return or display any
  per-ballot confirmation artifact binding a voter to a specific log line
  (no signed receipts, no "your vote is seq N" attestations).
- **Verifier reason codes** → DECIDED (T4a / EV-17, 2026-07-25): no reason-code registry for v1; reason text is advisory, conformance judged on verdict token + line number alone.
- **⚠️ Before writing the "definitional vs provisional constraints" ADR.** A
  draft of that ADR classifies three things as _provisional_ and therefore fair
  game for future community governance: the absence of a voter field in
  `vote_cast`, the no-re-vote rule, and `choice_count`'s ceiling of 64. **Two of
  those contradict merged normative text.** `event-types.md` ET-22 and
  `evolution.md` EV-13 each state their bar "survives any future community vote
  (charter §8)". The correct cut is finer:
  - **Permanent:** the entire ET-22 bar (no voter-held key, no voter-key
    signature, no unbounded voter-chosen value); the ballot plane's exclusion
    from all correction mechanisms (EV-13); _that a bound on `choice_count`
    exists at all_.
  - **Provisional:** the registrar's one-ballot-per-human policy, which EV-13
    itself calls policy; and the specific number **64**.
    Writing it the draft's way would read as license to revisit receipt-freeness
    by vote.
- **Ed25519 verification predicate** → DECIDED (ADR-0009 + ADR-0010, 2026-08-08).
  Pinned at the encoding level: `event-types.md` **ET-4a** (canonical `sig`:
  `S < L`; `R` masked `< p`) and **ET-4b** (canonical verification key `A` masked
  `< p`), checked on the raw decoded bytes before the verify primitive, rejected
  never repaired (D5) — makes RFC 8032's underdetermination unreachable. **AND
  pinned at the subgroup level: ET-4c requires every verification key to be
  prime-order — `[L]A == 𝒪 AND A != 𝒪`** (rejects all small-order AND mixed-order
  keys), so key legitimacy is verifiable from the log, not trusted-by-policy.
  **ADR-0010 REVERSES ADR-0009's prime-order exclusion** after a measurement
  resolved its two blockers: the two audited curve libraries
  (`filippo.io/edwards25519` Go, `@noble/curves` TS) AGREE on the predicate for
  all 11 points tested, and the stdlib-only rule is relaxed to permit one such
  library per verifier for the ET-4c check ALONE. Worded `[L]A == 𝒪 AND A != 𝒪`,
  NOT bare "torsion-free": noble's `isTorsionFree()` returns true for the identity
  (the `A != 𝒪` clause is load-bearing). Fixtures: `078` (ET-4b, discriminating),
  `079`/`080` (ET-4a, verdict-pinning), `081` small-order + `082` mixed-order
  (ET-4c, both discriminating), each isolating one rule under EV-5. Version-bound;
  the T10 re-audit re-measures.
- **`registrar_pk` ET-4b/ET-4c timing at genesis — the one place two conforming
  verifiers can diverge.** → **DECIDED (ADR-0011, 2026-08-09): check at
  declaration (Option A).** `ET-9c` added to `event-types.md` (v6 → v7); fixture
  `083` (small-order `registrar_pk`, no `vote_cast`) pins `INVALID` at line 1.
  Context and carry-forward retained below. (Found by the fresh-context Opus
  review of T7, 2026-08-09.) At the `genesis` line, `registrar_pk` is _declared_ but is not used
  to verify anything — genesis is operator-self-signed (ET-8). It is first used to
  verify at the first `vote_cast` (ET-17). T7's Go verifier therefore applies only
  the **ET-9b format** check to `registrar_pk` at genesis and defers the canonical
  (ET-4b) and prime-order (ET-4c) checks to that first `vote_cast`. The reading is
  well-grounded — ET-4b/4c parenthesise `registrar_pk` with **(ET-17)** and site the
  check "before the ET-5 verify primitive", which for `registrar_pk` is only reached
  at `vote_cast` — but the spec's word "decodes" does not say whether the bare
  genesis declaration counts. **No fixture disambiguates:** 076/077 are format-only,
  and 078–082 are all on `participant_registered.pubkey` at line 2, never on
  `registrar_pk` at genesis. So a verifier that instead ran ET-4b/4c on
  `registrar_pk` at genesis is equally conformant today, and the two would diverge
  on a real input — **verdict** (a no-`vote_cast` chain whose genesis carries a
  non-canonical or small-order `registrar_pk`: one says `INVALID` at line 1, the
  other `VALID`) or **line number** (a chain that does vote). ADR-0007 §5 makes "two
  independent verifiers agree" a freeze-readiness signal; here they would agree only
  by coincidence of independent readings, not by construction — exactly what T7b
  exists to expose (phase-0 T7b, "the overlap is the signal").
  **Resolved (ADR-0011): check at declaration.** `ET-9c` fixes the timing, and
  fixture `083` is the recommended disambiguating vector's no-`vote_cast`
  small-order variant (INVALID at line 1) — added additively under EV-5 with no
  earlier verdict frozen wrong, so the "provided no v1 fixture freezes a wrong
  verdict first" caveat held. **Carry-forward:** the T7 Go verifier currently
  defers ET-4b/ET-4c on `registrar_pk` to `vote_cast`, so against `083` it reports
  `VALID` — a queued conformance fix (its own isolated `odc-verifier-builder`
  ticket; no Go/verifier CI job yet, so it surfaces at the T8 rehearsal — the T5j
  ordering, fixtures first). T7b is hard-isolated and cannot read this file, so its
  ticket text (phase-0 T7b) states the ET-9c timing explicitly.
- **⚠️ Ballot expressiveness vs receipt-freeness — a live contradiction in
  merged text.** (Recovered 2026-08-02 from
  `claude/golden-fixtures-voting-verify-7urqku`, never landed.) `docs/charter.md`
  §5 promises "multiple aggregation methods in parallel (approval,
  ranked-choice/STV, quadratic, others) computed from the same ballots", in the
  present tense and unqualified. `event-types.md` **ET-22** permanently bars any
  "unbounded voter-chosen value" in a ballot payload, and ADR-0004 ratified that
  as surviving any future community vote. **A quadratic ballot is definitionally
  a voter-chosen vector of magnitudes.** So the two cannot both stand as written.
  Three ways through, none chosen: hard-bound the value space; move intensity
  into the sentiment stream (which never shares a store or a pipe with ballots);
  or accept a permanently nominal tally. **Counter-intuitive point worth keeping:
  ranked-choice is the WORSE covert channel, not the better one** — N! orderings
  carry more marker capacity than a bounded quadratic budget. The branch also
  carries a proposed `charter.md` §5 edit resolving this in §8's favour;
  **that edit is deliberately NOT applied here.** The charter governs everything
  else and its own author marked the commit "subject to operator ratification" —
  it needs an operator decision, most likely as the queued
  "ballot-expressiveness ceiling" direction ADR, not a routine docs merge.
  **PART A DONE 2026-08-02 (operator-ratified).** `charter.md` §5 now marks the
  aggregation-method list as **roadmap, not a v1 property**, states that a v1
  ballot is one choice from a small bounded set (plurality only), and fixes the
  ordering: where expressiveness and receipt-freeness collide, receipt-freeness
  wins. That much is honesty — §5 had promised in the present tense something
  the merged contract cannot compute from a single integer.
  **PART B IS STILL OPEN: where exactly the ceiling sits.** Deliberately NOT
  settled in the charter edit. The branch's proposed wording went further than
  ratified text supports — it would have required a richer ballot to "keep its
  value space small enough that a ballot cannot single out its caster", which is
  **stricter than ET-22**: a bounded-but-large space (10 options ranked = 3.6M
  orderings) satisfies ET-22's letter while failing that test. **That stricter
  criterion is the right starting point for the ADR**, but it is a new
  constraint, so it needs deciding rather than inheriting. Three options as
  framed: ballots stay one-choice forever and intensity lives in the sentiment
  stream; or richer ballots capped by a k-anonymity rule relating the number of
  distinct legal ballots to expected turnout; or defer until real turnout data
  exists.
  **OPERATOR INTENT STATED 2026-08-19 — the old default is withdrawn.** This
  entry previously read "default until someone argues otherwise: stay
  one-choice". Someone argued otherwise: the operator's stated intention is to
  introduce a **wide variety of voting options**, and the ceiling question is
  **deliberately kept open, to be decided later** rather than settled by
  inaction. So option 1 (one-choice forever) is no longer the resting position,
  and a session MUST NOT read silence here as a decision for it. What is decided
  is only the direction of travel; nothing about v1 changes — a v1 ballot is
  still one choice from a small bounded set (charter §5, ET-14a), because the
  richer ballots are a later additive change and no contract text is being
  loosened now.
  **The unresolved substance is unchanged, and it is arithmetic, not permission.**
  ET-22 does **not** bar ranked-choice or approval: it bars an _unbounded_
  voter-chosen value, and 10 options ranked (3.6M orderings) is bounded. What
  such a ballot fails is the stricter k-anonymity criterion above — with 3.6M
  legal ballots and a few hundred voters, essentially every ballot is unique, and
  a unique ballot is a demandable receipt. Note the counter-intuitive ordering
  recorded earlier in this entry: **ranked-choice is the worse covert channel,
  not the better one.** So the live question is whether to adopt a rule capping
  the number of distinct legal ballots relative to expected turnout.
  **Open timing question, worth settling inside the ADR rather than assuming
  either way.** A new MUST added after the freeze can retroactively invalidate
  previously conforming chains (EV-1/EV-4) — the argument that promoted F4/F6 to
  blocking. It is **not established** that it bites here: richer ballots need a
  new `vote_cast` `(type, version)` anyway, which is additive, so the cap could
  ride with that version at the time it is registered. Whether the constraint
  must be a permanent evolution rule stated up front (like ET-22) or can be
  attached per-version later is itself part of what the ADR must decide. Do not
  treat this entry as evidence for either answer.
- **`hashing.md` HA-9's example does not demonstrate what HA-9 claims. Pre-tag
  fix.** (Recovered 2026-08-02 from the same branch; **verified empirically**.)
  HA-9 says the 1-octet type tag is load-bearing "because the integer value `1`
  and the string value `\"1\"` under the same key encode to different bytes".
  They do — but by LENGTH: `ENC_INT(1)` is 8 octets `0000000000000001` and
  `ENC_STR("1")` is 9 octets `000000000000000131`. They would differ with no tag
  at all, so the example proves nothing about the tag. The case that actually
  proves it is **int `0` vs string `""`**: both encode to 8 zero octets, byte
  identical, and ONLY the tag separates them. Swapping the example changes no
  byte, no digest and no fixture — but `hashing.md` is immutable once
  `contracts-v1` is tagged, so it must land before the tag or the spec keeps a
  worked example that does not support its own sentence.
- **A security posture audit exists on a branch and has never landed.**
  **Largely RESOLVED 2026-08-14 by T9** — `docs/security/` now exists, created by
  the T9 branch with `audit-phase-0.md` as its first report and `README.md` as its
  boundary, exactly as this entry and the T9 ticket specified. The posture audit
  was mined as input and **not** merged; T9 records where it disagrees with it
  (notably S2, where T9 argues the prior audit was wrong to call admission-time
  knowledge the only human-to-ballot artifact). What remains open is only whether
  the branch is now deletable — it has been mined twice, and nothing on it is
  referenced except as a dated citation. The rest of this entry is kept for the
  reasoning, which still governs how `docs/security/` is used.
  `claude/odc-security-posture-audit-urgrjs` holds `docs/security/posture-audit.md`
  (406 lines). It is explicitly NOT
  the T9 audit — it inventories the four secrets the system will eventually hold
  (operator key, registrar key, the private linkage map, and the registrar's
  `{who, issue, choice}` knowledge — none of which exist yet), ranks ten
  findings, and proposes a milestone-keyed concealment timeline on the principle
  "conceal keys and identity linkage; never conceal rules, formats, or logic".
  **Its top finding is already fixed** (2026-08-02): the ledger docs described
  the pre-ADR-0004 voter-signed ballot. The rest is unreviewed and its "tree
  audited" line is 20+ PRs stale.
  **DECIDED 2026-08-02 (operator). The audit is INPUT to T9, never merged as-is,
  and T9 creates `docs/security/` with its OWN output as the first file.** Both
  now written into the T9 ticket. Merging a stale audit would create a document
  that reads as authoritative and is not — the same disease this session spent
  the day curing, and deliberately doing it to a security document would be
  worse than the accidents. Its raw material is genuinely good and should not be
  re-derived, so T9 reads it the way a reviewer reads a previous review: useful,
  dated, not authoritative. The directory's boundary is stated in the same
  ticket — threat models and posture reviews, never secrets — which is
  consistent with charter §9.
  **The doc-drift gap is fixed at its source, not by a sweep.** The obvious
  reaction was to add "check docs outside `contracts/`" to T9. Rejected: it is
  unbounded (so it gets skimmed), it is an accuracy job wearing a security
  ticket's clothes (diluting the audit at the one gate you want sharp), it runs
  at the LAST possible moment since Phase 1 begins right after T9a, and a sweep
  is a snapshot rather than a guard. **The failure did not happen at T9 — it
  happened at ADR-0004**, which changed the ballot model and left two documents
  stating the old one. So:
  1. `docs/decisions/0000-template.md` gains a **"Documents reconciled"**
     subsection: every ADR must list the documents outside `contracts/` that
     stated what it changes and fix them in the same PR, or say explicitly that
     none needed changing. Prevention, in the PR where the author still has the
     context, and the only person who reliably knows the answer.
  2. **T9a** gains a bounded backstop over the only three things that state
     normative behaviour outside `contracts/` — `docs/implementation-plan.md`,
     `docs/charter.md`, `services/*/CLAUDE.md`. A named list, checkable in an
     hour, at the moment Phase 1 starts building from them.
     A CI grep for now-false phrases was considered and rejected: it needs updating
     on every ADR, and a stale denylist gives false confidence, which is the
     disease rather than the cure.
- **`RETIRED.md` valve — deferred, deliberately not foreclosed.** There is no
  mechanism to withdraw a golden fixture that turns out to be wrong after the
  freeze; adding a fixture cannot neutralise a bad one, so a wrong vector would
  break conformance permanently. Post-freeze _additions_ are legal (PR #9, as
  corrected by **ADR-0008**), so a `contracts/fixtures/RETIRED.md` could be
  introduced later if a wrong vector is ever actually found. Not built now: with
  no concrete case to reason about it is premature, and a withdrawal lever is
  morally the same act as regenerating a golden hash, which `odc-testing`
  forbids. Revisit only with a real instance.
  **Amended 2026-08-02 (ADR-0008): this valve is now MORE load-bearing, not
  less.** The freeze rules make fixture `note` prose immutable along with the
  verdicts, so a vector later found wrong can no longer be annotated in place —
  `RETIRED.md` becomes the only route to flagging it. That was an accepted cost
  of keeping the freeze rule dumb enough not to fail open, but it removes the
  cheap intermediate option this entry previously had in reserve.
- **Is EV-5's "every additive change MUST ship golden fixtures" too broad?** For a
  new type or a new `(type, version)` — new bytes, never hashed before — a fixture
  is load-bearing. For a pure prose clarification that changes no bytes it proves
  nothing. Narrowing EV-5 to byte-changing changes is worth considering; not
  urgent, and it does not affect the post-freeze addition path (PR #9, corrected
  by ADR-0008), which is required under even the narrowest reading.
- **Unregistered `genesis` version — Stage B key extraction.** If a chain's
  `genesis` carries a `(genesis, version≠1)` a verifier does not register, that
  verifier has no spec-defined way to extract `operator_pk`/`registrar_pk`, and so
  cannot run Stage B on _later, registered_ events that depend on them. Genuinely
  unresolved. Additively resolvable in `evolution.md` post-freeze, so not a freeze
  blocker — **provided no v1 fixture freezes a verdict for this case.** T5 must
  therefore not use `genesis` for its unknown-version vector; use
  `participant_registered`, a leaf type nothing references.
  **Amended 2026-07-26 (T5f, PR #28):** the version to use is
  **`RESERVED_VERSION` (1000000), not 2.** The original note reasoned only about
  genesis key extraction and missed EV-18, which requires every `PARTIAL` fixture
  to use a reserved placeholder — and version 2 is not reserved, so a frozen
  `PARTIAL` on `participant_registered` version 2 would be contradicted the day
  EV-1 registers that version for real. **EV-19** now reserves the `version` range
  `>= 1000000` for exactly this, mirroring EV-18's `x_` type prefix. The genesis
  question itself is untouched and still open; `conformance.test.ts` enforces that
  no vector freezes a verdict for it, and EV-19 does not relax that.
  **Escalated 2026-08-14 by the T9 audit (F3 / Q-C), which rediscovered this
  independently** — the auditor could not read this file, so the overlap is a
  signal, not an echo. Two things it adds. First, the severity is worse than
  "cannot extract keys": because the genesis payload is read in Stage B, a chain
  with an unregistered `genesis` version can be walked to a verdict **without a
  single signature ever being checked**. Second, it measured the divergence risk
  rather than predicting it — its `downgrade.ndjson` gets `INVALID` line 2 from
  **both** verifiers, but no rule assigns that verdict, and `PARTIAL` at line 1 is
  a defensible conforming reading. The two agree by convergent reasoning, not by
  rule, which is precisely the failure mode ADR-0011 was written to eliminate.
  T9 rates this **blocking for the RELEASE CANDIDATE gate**; the earlier "not a
  freeze blocker" judgement above is about the freeze and is not contradicted —
  additive resolution is still available.

  **DECIDED 2026-08-15 → ADR-0015.** `evolution.md` **EV-20**: a `genesis` at
  an unregistered `(type, version)` is `INVALID` at line 1 — the single
  exception to EV-8, a Stage A promotion for `genesis` alone, because it is
  the one event whose payload every other check depends on. Not `PARTIAL`:
  that token claims "integrity confirmed, semantics unchecked" over a chain
  where no signature was ever checked, which is the wrong reassurance.
  **EV-21** adds advisory (non-conformance) guidance that reason text
  distinguish "verifier out of date" from "chain corrupt". Both verifiers
  currently reach `INVALID` at line **2** by convergent reasoning with no rule
  behind it — a conformance fix, not just a new fixture. **Fixture still
  owed** (tracked in "Owed before the T9 gate can reopen" above: genesis at
  version 1000000).

- **The unbounded-value defect class — HALF DISCHARGED 2026-08-22, and one
  claim about it in `STATE.md` is FALSE.** (Branch
  `claude/future-focused-session-p0cjqd`, unmerged at the time of writing.)
  **The false claim first, because it costs a day:** `STATE.md`'s "owed with no
  ticket" entry says six more sites of the `f(...array)` shape "were found and
  deferred around `verify.ts:93-102`" and that locating them is part of the job.
  **They do not exist.** A repo-wide grep for spread-into-call across all
  non-vendored TypeScript returns only the two already-fixed sites —
  `parse.ts:200` (chunked at 8192) and `verify.ts:360` (folded instead of
  `Math.min`) — plus their own explanatory comments. The one other construct that
  matches on sight, `verify.ts:281`'s `[...faultLines]`, is an array spread into
  an **array literal**, which uses the iteration protocol and has **no** argument
  limit; it is safe at any length and is the likeliest source of the "six".
  Retire the note; do not re-search for them.
  **What landed:** `tools/verifier-ts/test/extreme-values.test.ts` — the
  value-level fuzzer the entry asks for. Structurally valid exports carrying
  extreme values (huge strings where byte length, code point count and UTF-16
  length all diverge; integers straddling 2^53; extreme line counts of both
  well-formed and faulting lines; deep nesting; many-key payloads), asserting
  **only** no-throw plus exactly one well-formed verdict of the three (EV-17).
  No verdict value is asserted — `contracts/fixtures/` stays the sole oracle, per
  the entry's own instruction. Deterministic (fixed-seed LCG), so a failure
  reproduces from the printed case index. It found **no new defects**: it is a
  guard against regression, not a discovery, and should not be reported as
  having hardened anything that was not already correct.
  **What is still owed: the Go verifier.** The entry says "run **both**
  verifiers" and only one was done. This is **not a port** — Go has no
  argument-spread limit, so the defect this fuzzer pins cannot occur there, and
  the corpus must be driven through the CLI over generated files rather than
  called in-process.
  **Two Go-specific hazards, one ruled out by inspection and one still open.**
  The obvious suspect is `bufio.Scanner`, which silently stops at 64 KiB per
  token unless `Buffer` is called — a **truncation** hazard rather than a crash,
  i.e. the same wrong-verdict shape in a different language. **It does not
  apply:** `main.go:74` reads the whole export with `os.ReadFile` and there is no
  `bufio` import anywhere under `services/verifier/`. Checked 2026-08-22; recheck
  only if the reader is ever changed to stream. What remains genuinely untested is
  **stack growth on deep nesting** — Go grows goroutine stacks dynamically up to
  `runtime/debug.SetMaxStack` (1 GB default on 64-bit) and then **fatal-errors
  rather than panicking**, so a recursive-descent payload parser cannot recover
  it with `recover()`: it exits the process with no verdict, violating EV-17
  exactly as the JS `RangeError` did. The `deep-nesting` cases in the TS fuzzer
  are the ones to port first.

- **Should HA-2's reject-don't-repair be pinned by a fixture, not only a unit
  test?** (Raised by the T5a review, 2026-07-26.) HA-2's closing MUST — reject a
  string whose decoded value is not well-formed UTF-8 — is now covered by a unit
  test in `tools/fixtures-gen`, but nothing in `contracts/fixtures/` exercises it,
  so **T7's Go verifier has no vector telling it to reject rather than repair**.
  A vector would have to carry genuinely ill-formed bytes (e.g. a bare `0xED
0xA0 0x80` surrogate sequence inside a JSON string), which is expressible —
  vectors are read as raw bytes — but interacts with EX-2's UTF-8 requirement and
  EX-9's escaping rule in ways nobody has worked through: is such a line an
  `INVALID` at HA-2, at EX-2, or is it unparseable framing under EX-20? Whichever
  it is, it needs deciding before a vector freezes an answer. Not urgent, and
  additive later, but it is exactly the class of divergence T8 exists to catch —
  and the one place a repair-vs-reject disagreement would surface as a mysterious
  verifier bug rather than a fixture bug. Two mechanics to note when it is taken
  up: the generator can no longer emit such a vector by its normal path (its
  encoder now throws), so it must be built as a post-encode `editLine` mutation,
  the mechanism T5d established; and conformance asserts verdict token + line
  number only (T4a), so the vector is cheap to add but proves nothing unless it
  fails for the intended reason — which is what the EX-2/EX-9/EX-20 question
  above decides. Natural home: **T5f**, with the envelope `INVALID` vectors.
  **Partly answered 2026-08-14 by the T9 audit (S4), independently rediscovered.**
  The auditor built the vector this entry describes — `illutf8.ndjson`, raw
  ill-formed bytes in a title — and ran it: **both verifiers return `INVALID` at
  line 2.** So the three-way question above (HA-2 vs EX-2 vs unparseable under
  EX-20) has a de facto answer from two independent implementations, which is the
  evidence needed to write the vector without freezing a guess. T9 also names the
  concrete hazard: the reference stdlib substitutes U+FFFD silently, collapsing
  distinct values onto one preimage — so an implementer who reaches for the
  obvious library gets the wrong behaviour and no error.
- Operator key + identity service key management for MVP: file, env, or KMS?
  (Needed by Phase 1 identity/ledger tickets, not Phase 0.)
  **Widened 2026-08-14 by the T9 audit (S5 / Q-G).** Custody is only half of it;
  there is no **compromise** story. Nothing in `contracts/` describes rotation or
  revocation, so the question a frozen verifier faces — what to do on encountering
  a future rotation or revocation event it does not register — is undefined, and
  under F3 that is not a safe default. T9 also notes the published test seeds from
  `hashing.md` §6 remain the path of least resistance: it signed the F1
  demonstration chains with them in about a minute. That is correct for fixtures
  and dangerous the moment any deployment reuses them.
- Anchoring cadence and venue for the chain head in v1 (manual README anchor
  at genesis per phase-0 plan; automation cadence is a Phase 1+ question.)
  **Upgraded 2026-08-14 by the T9 audit (S3) and folded into Q-A above.** This
  was filed as a scheduling question; T9 shows it is a correctness one. An anchor
  publishes a **head**, which names a position, not a chain — so anchoring cannot
  deliver charter §4's non-equivocation while F1 stands and there is no chain
  identity to anchor _to_. Two further gaps: EX-15 makes `--head` a `MAY`, and
  **neither verifier reports the head it computed**, so a user has nothing to
  compare against an anchor even when one exists. A missing anchor must itself be
  detectable, which needs a stated cadence, not just a venue.
- **Correction/retraction model** → DECIDED (ADR-0005, PR #6): no `supersedes` field; corrections are additive payload conventions (EV-11–EV-14); ballot plane permanently excluded (ET-22, ADR-0004).
- **Verifier scope & forward compatibility** → DECIDED (ADR-0006, PR #6): two-stage verification — chain/envelope checks type-agnostic, registry checks per `(type, version)`; unregistered types get `PARTIAL` (EV-6–EV-10). Cross-references landed in T4a (PR #10).
- **Sanction/negative events (Phase 2, deferred — NOT a freeze blocker).**
  Contribution-style derived views only count up until negative events exist;
  charter §7 requires failure/fraud to crater standing and §9 makes
  moderation a public event. Additive event types + interpreter formula
  change cover this post-freeze; recompute-over-whole-log means no retrofit
  is needed. Design belongs to the Phase 2 reputation/moderation tickets.
- **Money/attestation/capability event design (Phase 2+, deferred).** From
  unratified external notes, the parts that survived review: money
  authorization events on-log with `payment_settled` referencing its
  authorization by event hash (P1 — settlement _records_ are on-log even
  though the transfer is real-world); attestation events record method/
  attestor/time as facts (strength mappings are a view/policy concern, P3 —
  do not encode a strength number in the event); capabilities = grant/revoke
  events + derived policy over contribution and attestations, never
  purchasable (§7); no "nullable" fields ever — absence is expressed by a
  later per-type `version` bump, not a null (ES-3/ES-16). Attestation tiers
  may gate _execution_ capabilities and which parallel tallies a ballot
  feeds — never ballot access itself (P4).
- **`event-types.md` unit contradiction (ET-14 characters vs. scalar values)** → DECIDED (T5i): normative sentence ("Unicode scalar values") governs over the payload table; table corrected, `event-types.md` → v3. No fixture verdict shifted; T7's start unblocked.
- **`genesis`'s `operator_pk` and `registrar_pk` have no numbered format rule.**
  Both are pinned to `^[0-9a-f]{64}$` only in the `genesis` payload table; no
  `ET-n` sentence states it. ET-7 derives `chain_id` from `operator_pk_bytes`
  and ET-9a describes `registrar_pk`'s role, but neither gives the format, and
  `ids.md` ID-3 reaches only `participant_registered.pubkey`. Found by the T5i
  review (2026-07-28) while testing the claim that tables are advisory — they
  are not, and here the table is the sole source. T7 must enforce a constraint
  with no numbered home. **Resolution is a new `ET-9b`**; not made in T5i,
  which is a one-cell correction and would otherwise have carried an
  unreviewed new normative sentence. Not blocking T7 the way ET-14 was — the
  constraint is at least _stated_, and no fixture contradicts it.
  **Ticketed 2026-08-02 as `T5j`** in `docs/plans/phase-0.md`, to run after T6d
  and before T7. **It MUST land before the freeze, not merely should.** `evolution.md` EV-1:
  "An existing frozen `(type, version)` schema MUST NOT be altered." Adding
  `ET-9b` after the `contracts-v1` tag would alter frozen `genesis`/v1, so
  deferring past the freeze does not postpone the fix — it makes it unaddable
  and leaves the constraint table-only permanently. Do not let it slip past T9.
  **No fixture exercises it.** All 73 vectors checked: none asserts `INVALID`
  on a malformed `operator_pk`/`registrar_pk`. `055-genesis-sig-wrong-key` is a
  wrong _signing_ key (ET-8) and the `chain_id` vectors are derivation
  failures — neither is a bad-format key. A T7 verifier that omits the format
  check passes 73/73 with no signal, so `ET-9b` needs a vector alongside it
  under EV-5 ("every additive change MUST ship its own golden fixtures").
- **A second, independent TS verifier has no ticket** → DECIDED: ticketed as **T7b** in `docs/plans/phase-0.md` (2026-08-02), slotted after T7 and before T8, same fresh-context/contracts-only isolation as T7 (extended to exclude `services/verifier/`). Gates the freeze decision (ADR-0007 §5).
