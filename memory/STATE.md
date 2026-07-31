# ODC Build State

> Single source of session-to-session truth. Read first, update last, keep short.
> History belongs in git and ADRs, not here.

## Current phase

**Phase 0 — Contracts.** Nothing may be implemented in services/ until
contracts/ passes the genesis rehearsal and reaches **RELEASE CANDIDATE**
(ADR-0007). The `contracts-v1` freeze itself is deferred until real operational
use — T5–T9 proceed on schedule; only the tag waits.

## Done

- Charter and implementation plan finalized (docs/).
- Monorepo scaffolded: skills, agents, memory, toolchain stubs (2026-07-18).
- **T1 — local hooks + PR template + workspace hygiene** (2026-07-19, PR #1,
  squash `874bb4f`). lefthook (pre-commit format+lint on staged files,
  check-mode blocking ~1.6s; pre-push tests of changed services), prettier +
  eslint (typescript-eslint) flat config at root, `format`/`format:check`/
  `typecheck` scripts. `contracts/`, the Go verifier, and mockups excluded from
  both tools. Reviewed APPROVE WITH NITS; both [SHOULD]s fixed pre-merge.
- Repo is public at github.com/Will-ODC/odc, remote set, default branch
  **master** (docs say master everywhere; do not assume `main`).
- **T2 — CI skeleton** (2026-07-19, PR #2, squash `fff12c4`). `repo.yml`
  (format/lint/typecheck + diff-size fail>800/warn>400 + guard-tests) and
  `contracts-guard.yml`. Guard enforces, on any `contracts/` touch, a
  `CONTRACTS-CHANGE.md` entry + a per-spec `Version:` bump; `hashing.md` and
  `fixtures/` hard-freeze once the `contracts-v1` tag exists. Guard runs on
  every PR (skips clean when no contracts change) so it is safe as a required
  check. Convention introduced: each `contracts/*.md` spec carries a `Version:`
  line — T3/T4 authors must include it. Reviewed APPROVE WITH NITS; both
  [SHOULD]s (per-file version check; guard-tests required) fixed pre-merge.
- CI fix (2026-07-22, PR #5): `diff-size` now exempts `**/*.md` from the
  changed-line count (specs/docs are governed by review, not a code budget) —
  unblocked T3/T4's large spec diffs.
- **T3 — event-schema.md, ids.md, event-types.md** (2026-07-22, PR #4). Seven-
  field envelope (`ES-1…ES-33`), strict reject-don't-repair, flat int/string
  payloads; content-addressed `participant_id`/`issue_id`; v1 type registry
  (`genesis`, `participant_registered`, `issue_created`, `vote_cast`).
  Receipt-free ballots (ADR-0004): `vote_cast` registrar-signed, no
  voter-held key. ADRs 0002–0004 accepted; ADR-0005 (correction/retraction)
  drafted proposed pending ratification. Reviewed APPROVE WITH NITS (one
  [SHOULD], ES-5 sign/range contradiction, fixed pre-merge).
- **T4 — hashing.md, export-format.md, read-api.md, evolution.md** (2026-07-24,
  PR #6). Byte-exact preimage (DOMAIN + BE ints + length-prefixed strings +
  generic per-type-agnostic payload rule), SHA-256 lowercase hex; canonical
  NDJSON line form; `GET /events` pagination; additive-only evolution rule.
  Real hand-verifiable genesis worked example (seeds fixture 001, T5). Same
  PR ratifies **ADR-0005** (envelope never carries correction machinery —
  corrections are additive payload conventions) and accepts **ADR-0006**
  (two-stage verification + `PARTIAL` verdict for well-formed-but-unregistered
  types, generic payload preimage) — both pre-freeze gates from
  `OPEN-QUESTIONS.md` are now closed. `contracts/` stays DRAFTING; freeze
  still gated on genesis rehearsal (T6–T8) + security audit (T9).

- **Routing → Opus** (2026-07-25, PR #8, squash `d1a41c6`). `odc-architect` moves
  Fable → Opus. Standing default until further notice: Opus plans, Opus
  implements, Sonnet explores (`odc-navigator` only).
- **CI: freeze blocks fixture edits, not additions** (2026-07-25, PR #9, squash
  `36627d9`). The guard hard-failed any path under `contracts/fixtures/`
  including additions, making `evolution.md` EV-5/EV-14 impossible to satisfy —
  no post-freeze event type could ever ship. Now modifications, deletions and
  renames fail; additions pass (`--no-renames`, so a rename still trips the
  delete half). 15/15 guard tests.
- **T4a — verdict report surface** (2026-07-25, PR #10, squash `587c852`).
  `evolution.md`/`export-format.md`/`event-schema.md`/`event-types.md` → v2.
  EV-15 (exhaustive Stage A/B split, EX-11's `sig` clause excluded as Stage B),
  EV-16 (payload-shape failure is INVALID even on an unknown type), EV-17
  (verdict precedence, line attribution, advisory reason text), EV-18 (`x_`
  prefix reserved and fixtures bound to it), EX-18–EX-20 (line attribution for
  empty export, `--head` mismatch, framing). Ticket text in `phase-0.md` T5/T7
  and `odc-verifier-builder.md` reconciled to three verdicts + exit codes 0/1/2.
  Fresh-context review: REQUEST CHANGES → all ten findings applied.
  **No reason-code registry exists or is needed** — conformance is judged on the
  verdict token and line number alone; fixtures MUST NOT assert reason text or
  exit codes.
- **T4b — ADR-0007, release candidate** (2026-07-25, PR #12, squash `2a253cf`).
  See Direction decisions below. _Process note:_ this first went out as PR #11
  stacked on #10's branch; #10 squash-merged first, orphaning that base, so #11
  merged into a dead branch and never reached master. Re-landed as #12. **Do not
  stack PRs in this repo** — squash-merge breaks the stack silently, and the
  child PR reports "merged" while delivering nothing.

- **CI: diff-size ceiling 800 → 600** (2026-07-26, PR #14, squash `c017e2e`).
  600 is the common industry ceiling; 800 predated any real ticket. T5 was the
  first measured against it (2232 counted lines) and split rather than raise it.
  Two scenarios pin the change: 700 must fail (it passed under 800), 500 must
  pass. 17/17 guard tests.
- **T5 is being delivered in slices, not one PR.** At 2232 counted lines it was
  ~4x the ceiling. Merged so far:
  - **T5a — preimage encoder** (PR #15, `43ec7b8`). `hashing.md`'s byte-exact
    construction (HA-1–HA-17) plus `ids.md` ID-4/ID-5. **`hashing.md` §6 now
    reproduces independently**: both public keys from their seeds, `chain_id`,
    the 459-octet signing preimage and its digest, the Ed25519 signature bit for
    bit, and the 607-octet hash preimage hashing to `78ed980b…f6409a`. Also adds
    `tools/*` to `pnpm-workspace.yaml` and the `pnpm run test` CI step — the
    first time CI ran any test in this repo.
  - **T5b — canonical line form** (PR #16, `63e7a4a`). `export-format.md` §1–2,
    hand-written rather than delegating to `JSON.stringify` so EX-9 is traceable
    sentence by sentence. Solidus literal, non-ASCII literal, lowercase `\u00xx`
    asserted including the negative case.
  - **T5c — event builders** (PR #17, `a23439f`). The four v1 types, each signed
    under the key its own type names. Signature tests assert both directions —
    right key verifies, wrong key does not — pinning ET-13 and ET-17, the two
    per-type signing rules. (**Corrected 2026-07-27:** this entry used to say the
    tests pin "ET-9a's separation of operator from registrar". They do not, and
    cannot: ET-9a ends "This separation is policy, not verifier-enforced". The
    same false claim had propagated into vector `057`'s note; see the T5g entry.)
    ET-21 held structurally: a ballot's payload keys are exactly
    `{choice, issue_id, sig}`.
  - **T5d — adversarial mutations** (PR #18, `0b67938`). The tamper matrix.
    `editLine` THROWS when its target is absent: a mutation that silently no-ops
    would emit a valid file claiming an `INVALID` verdict, which reads as a
    verifier bug rather than a fixture bug.
  - **T5e — generator + first 7 `VALID` vectors** (PR #19, `85f5f67`).
    `contracts/fixtures/` exists: `index.json`, `derivations.json`, vector 001's
    607-octet preimage, `MANIFEST.sha256`, and a `README.md` inside `fixtures/`
    so T7 (which may read only `contracts/`) can see it. **Verdicts are declared,
    never computed** — the generator contains no verifier, so T7 is checked
    against the contract rather than against this tool's reading of it.
  - **T5f — `PARTIAL` vectors, envelope `INVALID` vectors, EV-19** (2026-07-27,
    PR #28, squash `b67869a`). Vectors go 7 → **42** (VALID 7, PARTIAL 4,
    INVALID 31), plus `tools/fixtures-gen/test/conformance.test.ts`. 84/84 tests.
    Vector 001 and its preimage are byte-identical to before, so nothing already
    shipped moved. Carried **two normative edits to `evolution.md` (v2 → v3)**
    that were not in the original plan: **EV-19** (no contracts version may ever
    register a `version` >= 1000000; a fixture exercising the unregistered-
    _version_ path MUST use **1000000 exactly** — open-ended reservation, single
    fixture value, so no vector strains a `version` parser near ES-5's 2^53-1),
    and **EV-18 narrowed** so its `x_` obligation binds the unregistered-_type_
    path only, pointing at EV-19 for the other.
  - **T5g — framing, `--head`, Stage B and precedence vectors** (2026-07-27,
    PR #30, squash `fd6626a`), **completing the set at 70 vectors**. Adds
    `framing.ts` (043–052: the export framing and canonical line form, all
    invisible at the object level) and `semantics.ts` (053–070: the `--head`
    pair, the four per-type signing rules, the title/choice bounds, and verdict
    precedence). Ids shifted +1 from the `wip/T5fg-material` numbering because
    #28 had taken `042`. **Review fixes merged as #31** (below); `README.md` → v4.
- **T5g's review found the framing test asserted coverage it did not have.**
  The `FRAMING_ANOMALY` table pinned 4 of 10 framing vectors while a comment
  claimed the other six were "covered unchanged" — they were not covered at all.
  Three mutations shipped green, the worst being `048`'s `editLine` becoming an
  identity, so that vector emitted **perfectly canonical bytes under an
  `INVALID` declaration**. `editLine` throws only when `find` is ABSENT, so a
  replacement equal to the original is silent. Fixed in #31 by asserting each
  defect positively: `048`–`052` must parse AND differ from `serializeEvent()`
  of what they parse to; `045`'s blank must sit at its declared line.
  **`insertBlankLine` now bounds-checks** — the last mutator failing open.
- **Two claims in shipped fixture prose were false, and both are now fixed.**
  `070` duplicated `042` (same construction, a float on an unregistered _type_)
  while its note called it "the other side" of EV-16; it is rebuilt as the
  unregistered-_version_ path, a registered type name at EV-19's reserved
  version 1000000. And `057`'s note claimed it showed "the separation ET-9a
  describes, enforced" when `event-types.md` ET-9a closes with **"This
  separation is policy, not verifier-enforced"** — a note that would have
  pushed T7 into rejecting a chain where `operator_pk == registrar_pk`, which
  the contract permits. **Fixture notes are frozen data T7 reads; a false one is
  a spec bug with a long fuse.**
- **T5f took two fresh-context reviews, both REQUEST CHANGES, and merged with a
  third round unreviewed.** Review 1: vector 009 violated EV-18, a rule live
  since T4a. Review 2: a surviving mutation _inside the fix for review 1_, plus
  a justification sentence in the new EV-19 text that was false as written. The
  third commit (`2e775e6`) fixed review 2 and **changed normative spec text
  again** — narrowing EV-18, tightening EV-19 — and no fresh context ever read
  it. **If EV-18/EV-19 behave oddly in T7, read that commit first.**
  **Lesson, now twice over: re-review after a substantive fix**, especially one
  that touches normative text. Both times, the fix carried the next defect.
- **T5a was reviewed by a fresh context: REQUEST CHANGES** — one blocking
  finding, fixed in **PR #22** (not merged as of this write). `UTF8` used
  `Buffer.from(s, "utf8")`, which _repairs_ an unpaired surrogate to U+FFFD
  instead of rejecting it, against HA-2's closing MUST. That collided two
  distinct payloads on one preimage — `hash(title="\uD800")` equalled
  `hash(title=U+FFFD)` — defeating HA-9's guarantee, and it was a **live
  cross-language divergence**: the reviewer's Python raised, and Go will reject
  rather than replace, so T5 and T7 would have disagreed on attacker-controlled
  input. Also fixed: `ENC_PAYLOAD`'s string branch was a catch-all (a byte array
  encoded identically to the equivalent string, ES-16); `participantId("zz")`
  returned sha256 of the empty string because Node's hex decoder truncates
  silently, so a malformed `operator_pk` could mint an authentic-looking
  `chain_id`; uppercase hex was accepted rather than rejected (ID-2).
- **The T5a review mutation-tested the test suite, and four mutations survived
  it.** Three were wrong key sorts — the HA-8 ordering test used only ASCII keys,
  where UTF-8 byte order and UTF-16 code-unit order coincide, so `keys.sort()`
  would have passed CI and silently corrupted bytes. The fourth: injecting
  `.normalize("NFC")` survived everything, because the only non-ASCII fixture
  string is already NFC — HA-2's most emphatic prohibition had **zero coverage
  anywhere in the repo**. PR #22 closes all four and mutation-verifies the fixes.
  **Lesson: for a spec rule, ask whether the test can fail, not whether it
  passes.** A test that asserts what the code already does is not coverage.
- **T5e was reviewed by a fresh context: APPROVE WITH NITS**, no blocking
  findings. The reviewer reimplemented the preimage in Python and Ed25519 from
  RFC 8032 and confirmed vector 001 byte for byte — **the third independent
  confirmation of `hashing.md`**, after T4's hand derivation and T5a. It found
  two real holes in the fixture protections; **#19 merged before the fixes were
  written, so they are in PR #20**, not on master yet.

## Direction decisions (2026-07-25)

**The freeze is deferred and gated on operational experience** (ADR-0007), not on
T9 approval. `contracts/` now has three states: DRAFTING → **RELEASE CANDIDATE**
(entered at T9; Phase 1 builds against it; no tag, so specs stay fixable) →
FROZEN (`contracts-v1` tag; `hashing.md` + `fixtures/` immutable). This resolved
a deadlock: freezing on real use requires services, and three documents forbade
service code until frozen. New **T9a** ticket; **T10 deferred**, and it now
requires a re-audit of any delta accumulated since release candidate.

T5–T9 keep their schedule. Only the tag waits.

## Next

**T5 IS COMPLETE**, through T5i. Master carries **73 vectors** (VALID 9,
PARTIAL 4, INVALID 60) and **92/92** `fixtures-gen` tests. `wip/T5fg-material`
is spent and can be deleted.

- **T5h — T7 preflight** (2026-07-28, PR #34, squash `4d90d2f`). The `0x69`
  integer preimage, astral vectors, ET-14's counting unit. Cleared item 1 of
  the "still owed" list below.
- **T5i — ET-14 counts scalar values** (2026-07-30, PR #35, squash `f1b4b20`).
  The `issue_created` payload table said "1–200 UTF-8 **characters**" while
  ET-14's numbered sentence said "1–200 Unicode **scalar values**" — a factor
  of 4 apart on astral titles. **Where a table and a numbered RFC-2119 sentence
  disagree, the sentence governs.** `event-types.md` → v3. Legal only because
  `contracts/` is still DRAFTING.

**T6 IS IN PROGRESS.** Sliced against the 600-line ceiling, one PR each:

- **T6a — package scaffold + PRNG** (2026-07-30, PR #36, squash `287952d`).
  `tools/rehearsal/` (`@odc/rehearsal`), SplitMix32 seeded generator,
  27 rehearsal tests. Also lands the T6 scope decision in the plan (below) and
  gives `@odc/fixtures-gen` an `exports` map + `declaration: true`.
- **T6b — randomized chain builder + export/head** (2026-07-30, PR #38, squash
  `b527bf6`). Seeded chain (genesis + N participants + interleaved
  issues/ballots), canonical NDJSON export, head. 120 rehearsal tests.
  Reuses `fixtures-gen` for all construction, hashing and serialization — it
  chooses WHAT events exist, never HOW they are encoded.
  **Two properties are now guaranteed rather than sampled**, both because a
  review caught them being probabilistic: ballots always precede the final
  issue (the builder holds one issue back until a vote is cast), and every
  max-length title carries an astral scalar, a `"` and a `\`. The astral part
  is the **M34** gap — Go emits literal 4-byte UTF-8 where a TS regression would
  emit `\u` surrogate escapes, and nothing in `fixtures-gen` sits above U+FFFF.
- **T6b's second review found the shape to remember.** The fix for round 1's
  blocking finding (guarantee interleaving) was correct, but **its regression
  test was inert**: forcing astral characters changed `maxLengthTitle`'s RNG
  consumption from ~200 draws to ~397, on the first issue of every chain, which
  shifted the whole downstream stream and silently un-pinned the five seeds
  pinned to guard it. All four mutations of the new logic survived a green
  suite. **Pinning a seed pins nothing if anything upstream changes how many
  draws are consumed** — the replacement is a structural property test (2,000
  seeds x two shapes) that is immune to stream drift. Expect this again in T6c:
  the tamper tool will consume draws too.
- **T6c — tamper tool** (2026-07-31, PR #44, squash `0f9aaab`). The 8
  `odc-contracts` matrix cases live as `applyTamper(target, case, seed)` in
  `tools/rehearsal/src/tamper.ts`, reusing `fixtures-gen`'s mutators for the
  byte-level work and adding two new ones: `flipPrevHashChar` (mid-line, so
  `flipHashChar`'s end-anchored pattern can't reach it — and it keeps the
  `"prev_hash":` prefix on purpose, since a ballot's `issue_id` can legitimately
  equal `prev_hash` and sits earlier in the line) and `swapEnvelopeKeys`
  (transposes two adjacent EX-7 fields via `editLine`, asserting the
  reconstruction equals `serializeEvent`'s bytes first so a codec drift throws
  instead of silently reserializing wrong). `head` is computed per case, not
  passed through, so each case leaves exactly one defect; `truncation` reports
  the TRUE head (only it detects the truncation) and `wrong-head` leaves bytes
  untouched and flips the head. No pinned seeds — determinism and "the seed
  actually selects the target" are both asserted structurally over 82 seeds x 2
  chain shapes, per the T6b stream-drift lesson. 12/12 mutation-tested.
  fixtures-gen 95/95 (was 92), rehearsal 146/146 (was 120).
  **CLI wiring was cut to stay under the diff-size ceiling** (589 counted
  lines) — `TAMPER_CASES`/`isTamperCase` ship as data, T6d parses `--case`.
  Three spec-shaped (non-blocking) findings went into the PR description for a
  later ticket: the matrix's "byte flip" is narrower than a uniformly-random
  byte offset would be; "line reordering" has no dedicated rule id (attribution
  to the earlier line follows EV-17's precedence but isn't stated); `EX-14`'s
  "head" is defined on events, not on the bytes of a possibly-tampered file.
- **T6d — `just rehearsal-build`**, CLI wiring (including `--case`), README. NEXT.

**T6's self-verify property test is still OWED.** Nothing merged so far
recomputes an event hash, checks `prev_hash` linkage beyond genesis, or verifies
a signature — T6b builds and exports chains and T6c tampers with them, neither
checks them. T6's acceptance defines self-verify as exactly those three plus
attributing a failure to a line. A green test count in `tools/rehearsal` is
**not** evidence the acceptance criterion is met; a comment at the top of
`build.test.ts` says so too. **T6c did not land it either** (confirmed in its PR
description) — it is T6d's alone now.

**T6 does NOT build a TypeScript verifier** (decided 2026-07-28, now recorded
in `docs/plans/phase-0.md` T6 rather than only in session memory). "Self-verify"
means recompute hashes, check `prev_hash` links and signatures of the chain the
builder just built, and attribute a failure to a line. It does NOT mean emitting
the three conformance verdicts or executing the 73 declared fixture verdicts —
T7 is the first ticket that emits verdicts. The reason is **independence, not
cost**: a TS verifier written by a context that has already read
`encode.ts`/`serialize.ts` inherits any misreading those files contain, so it
self-verifies green and proves nothing. T8's cross-language check compares
fixture **hashes**, not verdicts, and is already satisfiable with `fixtures-gen`.
**A second, independent TS verifier is owed its own ticket before the freeze** —
fresh context, contracts-only, the same treatment T7 gets. No such ticket exists
in the T1–T10 stack; it is recorded in `OPEN-QUESTIONS.md` and nowhere else.

**Then T7** (Go verifier, fresh-context isolation) → **T8** (rehearsal loop) →
**T9** (security audit) → **T9a** (release candidate → Phase 1).

**A CI bug T6a fixed, worth knowing if it recurs.** `turbo.json` declared
`typecheck` with no `dependsOn`, and CI runs typecheck before the only task that
triggers `^build`. So on a cold checkout there is no `dist/`, and any
cross-package import fails `TS2307` — while passing for every developer with a
warm `dist/`. It is now `"typecheck": { "dependsOn": ["^build"] }`, and
`tools/rehearsal/test/workspace.test.ts` exists specifically to cross the
package boundary so the failure can never again be invisible.

**Still owed, none of it blocking T6:**

0. **`ET-9b` — the one item here with a HARD DEADLINE.** `genesis`'s
   `operator_pk` and `registrar_pk` are pinned to `^[0-9a-f]{64}$` **only** in
   the `genesis` payload table; no numbered `ET-n` sentence states the format.
   `evolution.md` EV-1 forbids altering a frozen `(type, version)` schema, so
   adding `ET-9b` after the `contracts-v1` tag would alter frozen `genesis`/v1 —
   deferring past the freeze does not postpone the fix, it makes it **unaddable**
   and leaves the constraint table-only permanently. **Must land before T9.**
   **No fixture exercises it:** all 73 vectors were checked and none asserts
   `INVALID` on a malformed key, so a T7 verifier that omits the format check
   passes 73/73 with no signal. It needs a vector alongside it under EV-5. Full
   write-up in `OPEN-QUESTIONS.md`; recorded here because the context protocol
   has every session read this file first.
1. ~~**The `0x69` integer-tag preimage.**~~ **DONE in T5h (#34)**, together with
   the astral vectors and ET-14's counting unit. T7 inherits both.
2. **The ~8 `[SHOULD]`/`[NIT]` findings from T5b/T5c/T5d.** See Blockers. `M34`
   (astral code points) is the one that matters for T7. `insertBlankLine`'s
   missing bounds check is **now fixed** in #31; `tsAt`'s repair-instead-of-
   reject at `chain.ts:39` is still live.
3. **Two known fixture warts, deliberately not fixed** (found by the T5g
   duplicate sweep, both in already-merged slices): `016-seq-gap` and
   `040-line-deleted` both fail at line 3 on an ES-7 gap and overlap heavily;
   and `016`'s bytes carry `seq [1,2,4,4]`, a duplicate as well as the gap its
   note advertises. Changing them would re-litigate merged work for no
   verifier-visible gain. **Recorded so a later reader does not rediscover them
   as defects** — but if the set is ever renumbered before the freeze, fix them
   then.

**Coverage is thinner than 70 vectors suggests.** A citation sweep found ~60 of
~125 defined rule ids have no vector citing them. Many are definitional and
outside the Stage A/B split by EV-15's own terms, but some are real gaps worth
knowing before T7: `ES-30`–`ES-32` (the `sig` field rules), `ET-3`–`ET-5`,
`EX-14` (the definition of "head", though EX-15/16/19 are well covered), most of
`ids.md`, and `EV-11`–`EV-14` (the correction/retraction rules, including
EV-13's prohibition on ballot-plane correction pointers). **`HA-7` is cited by
no vector at all**, despite being the rule six vectors' notes invoke by name.
Treat the fixture set as strong on what it covers and silent elsewhere, not as
a complete conformance suite.

Then T6 (rehearsal builder) → T7 (Go verifier, fresh-context isolation) → T8
(rehearsal loop) → T9 (security audit) → **T9a (release candidate → Phase 1)**.

**Also queued, not blocking:** the direction ADRs — definitional-vs-provisional
constraints, the ballot-expressiveness ceiling, the two-plane clarification.
**Read the ET-22 warning in `OPEN-QUESTIONS.md` before writing the first.**

Ticket discipline: one ticket = one branch = one PR = one session; fresh-context
review before merge; squash-merge. **Two process lessons from T5:**

- **Check a PR's state before assuming a push updated it.** #19 was merged while
  its review was still running; the head branch was then auto-deleted, so a
  force-push silently created a _new_ branch and the review fixes ended up on a
  branch with no PR. A merged PR cannot carry follow-up work.
- **`turbo` caches `lint`.** A green `pnpm run lint` right after moving files is
  not trustworthy — run `npx eslint` directly.

**STATE.md update note:** branch protection blocks direct pushes to master, so
update this file in a small follow-up PR after the ticket merges (separate from
the feature branch, so parallel agents do not conflict). Required checks:
`format / lint / typecheck`, `diff-size`, `guard-tests`, `guard`.

## Blockers

- **None for T5.** Branch protection is **ON** (2026-07-19, ruleset
  `protect-master`): PR required, four status checks strict, linear history, no
  bypass. Both Phase-0 user actions are complete — T2's documented rules are
  now actually enforced.
- **Review coverage: eight slices reviewed, eight with real defects** — every
  reviewed slice of T5 has come back with something real. Treat a clean review
  as the surprise, not the expectation.
- **Two PRs merged while their review was still running** (#29 and #30, both on
  2026-07-27). It cost nothing this time only because `contracts-v1` is untagged,
  so `070` was still rebuildable and the framing test still fixable. **After the
  tag, a fixture defect found post-merge is permanent.** Wait for the review, or
  accept that the finding becomes a follow-up PR at best.
  T5b and T5c/T5d were re-run on 2026-07-26 after the earlier 529 failures; both
  returned **REQUEST CHANGES**. **All five blocking findings are now fixed on
  master (PR #26, squash `8d96736`)** — 78/78 tests, up from 67. What they were,
  since each is a shape worth recognizing again:
  - **T5b** — `jsonString` repaired ill-formed UTF-16 instead of rejecting it;
    `"A\ud800B"`, `"A\udfffB"` and a literal `"A�B"` all emitted the same bytes.
    Same defect as #22, one module over. The fix makes the surrogate scan **one
    shared helper** (`assertWellFormed` in `encode.ts`, called by both `UTF8()`
    and `jsonString()`) rather than a third variant — copy it, don't re-derive it.
  - **T5c** — `custom()`'s signer had zero coverage; replacing it with
    `undefined` left the suite green.
  - **T5c** — `issue()`/`vote()` signed with module constants, ignoring the keys
    the chain's own genesis declares (ET-13/ET-17/ET-9a). The builder now records
    the genesis-declared keys and signs from those; the module constants remain
    the pre-`genesis()` default, which the headless vectors need.
  - **T5d** — `deleteLine` and `truncate` had no bounds checks, so an
    `INVALID`-declared vector could be emitted with perfectly valid bytes. Both
    now throw.
- **Still open from those reviews: the ~8 `[SHOULD]`/`[NIT]` findings.** #26
  deferred them deliberately; **no PR covers them yet.**
  - **M34 is the one that matters for T7.** Emitting astral code points as `\u`
    surrogate-pair escapes survives the entire suite, because no string anywhere
    in the repo has a character above U+FFFF. Go emits literal 4-byte UTF-8, so
    nothing here would notice if the TS side stopped doing so. Fix needs an
    astral character in the `ESC` vector, not just a unit assertion.
  - ES-5's upper bound untested; DEL and the C1 range untested; `head()` (EX-14)
    untested and unimported; `swapLines(L,2,2)` / `editLine` with
    `find === replace` / unbounded `insertBlankLine` can each silently produce a
    valid file; the chain builders enforce none of ET-14/ET-14a/ET-18a.
  - **`tsAt`'s `.replace(/\.\d{3}Z$/, ".000Z")` at `chain.ts:39` is the third
    instance of repair-instead-of-reject** and is still live — after `encode.ts`
    (#22) and `serialize.ts` (#26). Three occurrences in a codebase whose entire
    subject is reject-don't-repair is a pattern, not a coincidence: when adding
    any normalization step here, ask whether the spec says repair or reject.
- Standing, and substantially addressed: **`hashing.md` had never been
  independently validated.** Four derivations now agree on §6 — T4 by hand, T5a,
  and both reviewers in Python with their own RFC 8032 Ed25519 (the T5a reviewer
  also agreed on 4000/4000 randomized differential cases covering what §6 misses:
  `ENC_INT` in a payload, the `0x69` tag, astral keys, prefix keys, `2^53-1`).
  **The HA-2 collision is the useful counter-example:** four agreeing derivations
  still missed a normative MUST, because agreement on §6 says nothing about
  inputs §6 does not exercise. Read that as evidence the cross-language gate is
  load-bearing, not as evidence hashing is settled. Still not settled: those are all readings of the same
  prose by the same family of reader. T7's fresh-context Go verifier and T8's
  cross-language comparison remain the real gate — do not let "T4 is merged" or
  "three implementations agree" read as "the hashing is known correct".
- **CI failure mode to recognize, not debug (seen 2026-07-26 on PR #13).** A
  required check that is never _created_ blocks merge indefinitely and looks
  identical to "still running" — there is no red check to click. It happened when
  `contracts-guard` hit `startup_failure`: the run never started, so the required
  `guard` check was absent rather than failing, and `mergeable_state` sat at
  `blocked`. The `repo` run wedged in `queued` for ~15h in the same incident.
  Nothing in the repo caused it or fixes it. **The fix is cancel-and-rerun:** a
  run stuck in `queued` refuses to re-run (`403 already running`), so cancel it
  first. Count the checks against the four required ones before assuming CI is
  broken.
- Housekeeping **done** (2026-07-26): the stale remote branches are deleted and
  "Automatically delete head branches" is enabled. Note the consequence, which
  bit once: merging a PR deletes its head branch, so a later push to that branch
  name silently creates a _new_ branch with no PR attached.
