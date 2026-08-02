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

**What FROZEN actually means, split by file kind** (ADR-0008, 2026-08-02, PR #49,
squash `a9f99d6`). The blanket "nothing under `contracts/fixtures/` may be
modified" rule made **adding a vector impossible after the tag**, which
`evolution.md` EV-5/EV-14 require — so no post-freeze event type could ever have
shipped. Adding one vector also rewrites `index.json`, `MANIFEST.sha256` and the
fixtures README. **Second instance of this deadlock: PR #9 fixed the vector-files
half and missed the aggregate files**, and both instances share a cause — the
rule was stated over a _directory_ while the property it protects belongs to a
_kind of file_. Now four rules: golden data add-only; `index.json` may gain lines
but never lose one, ids unique, no object repeating a key; `MANIFEST.sha256`
regenerable but not deletable, correctness checked instead of its diff;
`fixtures/README.md` exempt.

**Two consequences to carry forward.** Fixture `note` prose is now **frozen with
everything else** — the rule is deliberately a dumb line rule, because it is the
only thing holding the freeze up and a cleverer comparator fails open, so
**correct a wrong note BEFORE the tag or it is permanent**. And `index.json`'s
FORMATTING is frozen too, so the generator's output format for that file is
fixed at the tag (safe today: `.prettierignore` excludes `contracts/`).

**It was invisible the whole time, and that is the transferable part.** The
entire freeze branch is gated on a tag that does not exist, so CI was green and
would have stayed green until the first post-freeze additive change — the worst
possible moment to discover it. `guards.test.sh` now tags throwaway repos
`contracts-v1` so the post-tag rules are exercised today; 19 → 30 scenarios.

## Next

### ▶ START HERE (handoff, 2026-08-02)

Four decisions were made and recorded but **not executed**. Do them in this
order — the first three are small and clear the deck; the fourth is the phase
resuming.

1. **T6d — finish T6.** `just rehearsal-build`, CLI wiring (including
   `--case`), README. **And the self-verify property test T6 still owes**:
   nothing merged recomputes an event hash, checks `prev_hash` linkage beyond
   genesis, or verifies a signature. T6's acceptance names exactly those three
   plus attributing a failure to a line. T6c did not land it either. **A green
   test count in `tools/rehearsal` is not evidence this exists.**
2. **T5j — `ET-9b`, plus the Ed25519 predicate.** Two things in one contracts
   change, because both open `event-types.md` and one review is cheaper than
   two. Full write-ups in `OPEN-QUESTIONS.md`; the short form:
   - `ET-9b` gives the genesis key format a numbered home, with **uppercase-hex**
     vectors — verified to isolate the format rule alone, since an uppercase key
     decodes to the same 32 bytes so `chain_id`, the signature and the `hash` all
     still check out.
   - **Ed25519: measure first, do not reason from memory.** Go 1.24.7 and Node
     are both in the container. Preferred shape is to make the divergence
     unreachable (reject non-canonical encodings and non-prime-order keys before
     verification) rather than adjudicate a predicate.
3. **The HA-9 example fix** — one sentence in `hashing.md`, verified, cheap, and
   **impossible after the tag** since `hashing.md` is immutable then. Can ride
   along with T5j.
4. **Then the phase resumes:** T7 → T7b → T8 → T9 → T9a. T10 stays deferred.

**Owed by the operator, not by a session:** the ballot-expressiveness ceiling
ADR (part B — part A landed 2026-08-02; default until argued otherwise is
"ballots stay one-choice"), and the other queued direction ADRs.

**The four surviving branches, and what each is still for.** `contracts/` is
untouched by all of them.

| branch                                        | status                                                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude/odc-security-posture-audit-urgrjs`    | **KEEP until T9** — T9 reads it as input and creates `docs/security/` with its own output                                                                                                                 |
| `claude/review-memory-context-skills-383f6i`  | **KEEP — still unlanded**: the `odc-keys-and-signatures` skill file and an `odc-code-review` rewrite ("verify, don't read"). Only the Ed25519 _finding_ was mined out; the artifacts are still only there |
| `claude/skills-agents-memory-mr-29f4dt`       | **KEEP** — forbids agent-performed merges; not on master, may be a live session                                                                                                                           |
| `claude/golden-fixtures-voting-verify-7urqku` | **FULLY MINED 2026-08-02** — implementation-plan fix applied, charter part A applied, HA-9 and expressiveness recorded. Deletable                                                                         |

**A caution the same day proved twice.** The doc-drift sweep found the ledger
docs describing pre-ADR-0004 voter-signed ballots — and then a _second_ pass over
the same file found two more: the verifier section listed only two verdicts
(missing `PARTIAL`, ADR-0006) and the tally section specified "approval counting,
latest-vote-per-participant", which is both the wrong method (one `choice` yields
plurality, not approval) and an uncomputable one (ET-21 leaves nothing to group
by). **My own first sweep missed them.** That is the argument for T9a's named
three-document list over an ad-hoc scan, and for the ADR template's new
"Documents reconciled" section over catching it later.

---

**T5 IS COMPLETE**, through T5i plus the 2026-08-02 follow-up. Master carries
**75 vectors** (VALID 10, PARTIAL 4, INVALID 61), **109/109** `fixtures-gen`
tests and **146/146** rehearsal. (`wip/T5fg-material`, the spent holding
branch this line used to point at, was deleted 2026-08-02.)

- **T5h — T7 preflight** (2026-07-28, PR #34, squash `4d90d2f`). The `0x69`
  integer preimage, astral vectors, ET-14's counting unit. Cleared item 1 of
  the "still owed" list below.
- **T5i — ET-14 counts scalar values** (2026-07-30, PR #35, squash `f1b4b20`).
  The `issue_created` payload table said "1–200 UTF-8 **characters**" while
  ET-14's numbered sentence said "1–200 Unicode **scalar values**" — a factor
  of 4 apart on astral titles. **Where a table and a numbered RFC-2119 sentence
  disagree, the sentence governs.** `event-types.md` → v3. Legal only because
  `contracts/` is still DRAFTING.
- **T5 follow-up — the five live review findings, and T7b** (2026-08-02, PR #48,
  squash `5dbff50`). Closes the `[SHOULD]`/`[NIT]` backlog #26 deferred and never
  ticketed. Three were one defect — **a mutator that FAILS OPEN**, returning
  canonical bytes under an `INVALID` declaration: `swapLines(a===b)` and
  byte-identical lines; `editLine`'s identity replacement; and `tsAt`'s
  `.replace(/\.\d{3}Z$/, ".000Z")`, the third repair-instead-of-reject after
  `encode.ts` (#22) and `serialize.ts` (#26). The chain builders now enforce
  ET-14/ET-14a/ET-18/ET-18a, with deliberate breaches DECLARED via
  `{ violates: [...] }` and reconciled for set equality **in both directions**.
  Vectors 73 → **75**: `074-title-del` (`INVALID`) and `075-title-c1` (`VALID`).
  Also tickets **T7b**, the second independent TS verifier.
- **ADR-0008 — the fixture freeze needs four rules, not one** (2026-08-02,
  PR #49, squash `a9f99d6`). See Direction decisions below.

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
**A second, independent TS verifier is owed before the freeze** — fresh context,
contracts-only, the same treatment T7 gets. It is now **ticket T7b**
(`docs/plans/phase-0.md`, added 2026-08-02 in #48), sitting after T7 and before
T8, with `services/verifier/` added to its exclusion list so it cannot be a
transliteration of T7 — independence is per-context, not per-language. It gates
the **freeze decision** only, not T8/T9/T9a. Until #48 it lived in prose in two
documents and in `OPEN-QUESTIONS.md`, with no ticket number anywhere.

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
   **No fixture exercises it:** all **75** vectors were checked and none asserts
   `INVALID` on a malformed key, so a T7 verifier that omits the format check
   passes 75/75 with no signal. **Now ticketed as `T5j`** (2026-08-02,
   `docs/plans/phase-0.md`), slotted after T6d and **before T7** — not merely
   before the tag, because these fixtures exist to catch T7's build omitting the
   check, and landing them afterwards obliges T7's builder to re-run in a new
   fresh context. The vectors use an **uppercase-hex** key: still valid hex
   decoding to the same 32 bytes, so `chain_id`, the signature and the `hash` all
   stay correct and the CASE is the only defect. A wrong-length key would break
   three rules at once and isolate nothing. Full write-up in the ticket and in
   `OPEN-QUESTIONS.md`; recorded here because the context protocol has every
   session read this file first.
1. ~~**The `0x69` integer-tag preimage.**~~ **DONE in T5h (#34)**, together with
   the astral vectors and ET-14's counting unit. T7 inherits both.
2. ~~**The ~8 `[SHOULD]`/`[NIT]` findings from T5b/T5c/T5d.**~~ **DONE
   (2026-08-02, #48).** Three had closed incidentally — `M34` by T5h's astral
   vectors, ES-5's upper bound, `insertBlankLine` by #31 — which nobody had
   noticed, because nothing was tracking the list. The five still live are now
   fixed. **The lesson is the tracking, not the code:** these sat for weeks
   because `STATE.md` recorded "no PR covers them yet" and no ticket ever
   existed. A deferred finding with no ticket is a finding you have decided not
   to fix.
3. **Two known fixture warts, deliberately not fixed** (found by the T5g
   duplicate sweep, both in already-merged slices): `016-seq-gap` and
   `040-line-deleted` both fail at line 3 on an ES-7 gap and overlap heavily;
   and `016`'s bytes carry `seq [1,2,4,4]`, a duplicate as well as the gap its
   note advertises. Changing them would re-litigate merged work for no
   verifier-visible gain. **Recorded so a later reader does not rediscover them
   as defects** — but if the set is ever renumbered before the freeze, fix them
   then.

**Coverage is thinner than 75 vectors suggests.** A citation sweep found ~60 of
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
review before merge; squash-merge. **Process lessons:**

- **Check a PR's state before assuming a push updated it.** #19 was merged while
  its review was still running; the head branch was then auto-deleted, so a
  force-push silently created a _new_ branch and the review fixes ended up on a
  branch with no PR. A merged PR cannot carry follow-up work.
- **`turbo` caches `lint`.** A green `pnpm run lint` right after moving files is
  not trustworthy — run `npx eslint` directly.
- **Commit before running a review agent (2026-08-02).** Reviewers that
  mutation-test have to edit the tree and restore it. One destroyed uncommitted
  work outright (recovered from the throwaway commit it left behind); another
  had the guard mutated at the moment of a commit, briefly pushing a disabled
  check. Neither is the reviewer's fault — reviewing a dirty tree is the bug.
- **Two tickets on one branch fails `diff-size`, correctly (2026-08-02).** The
  T5 follow-up (572 counted) and ADR-0008 (339) each passed alone and totalled 911. Split, as T5 did rather than raise the ceiling. **When two PRs both edit
  `fixtures/README.md`, the second needs a real `Version:` bump in its OWN
  diff** — inheriting one through a merge leaves the file correct-looking and
  fails the guard's per-file check.

**STATE.md update note:** branch protection blocks direct pushes to master, so
update this file in a small follow-up PR after the ticket merges (separate from
the feature branch, so parallel agents do not conflict). Required checks:
`format / lint / typecheck`, `diff-size`, `guard-tests`, `guard`.

## Blockers

- **None for T6.** (T5 is complete; this line tracked T5 until 2026-08-02.)
  Branch protection is **ON** (2026-07-19, ruleset
  `protect-master`): PR required, four status checks strict, linear history, no
  bypass. Both Phase-0 user actions are complete — T2's documented rules are
  now actually enforced.
- **Review coverage: fourteen slices reviewed, fourteen with real defects** — every
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
- ~~**Still open from those reviews: the ~8 `[SHOULD]`/`[NIT]` findings.**~~
  **CLOSED 2026-08-02 (#48).** All three repair-instead-of-reject instances are
  now fixed (`encode.ts` #22, `serialize.ts` #26, `tsAt` #48). **Three
  occurrences in a codebase whose entire subject is reject-don't-repair was a
  pattern, not a coincidence** — when adding any normalization step here, ask
  whether the spec says repair or reject. The remaining item, `head()`/EX-14
  being cited by no vector, is part of the wider coverage gap below, not a loose
  end from these reviews.
- **Two shapes from #48 worth recognising again, both about tests that cannot
  fail.**
  - **An unfalsifiable guard is not coverage.** `tsAt`'s shape check, written
    inline, could never fire for any input its own base produced — the mutation
    survived a green suite. It is now a named `assertWholeMinute` a test can
    kill. The same reasoning deleted an "is python3 installed" arm from
    `contracts-guard` in #49: no test in an environment that HAS python3 can
    make it fire, and a missing interpreter already fails into the same branch.
  - **Assert on the RESULT, not on the input shapes you can imagine.**
    `editLine` was fixed by requiring the line to actually move, which is
    exhaustive; enumerating bad arguments would have missed that a `replace`
    string containing `$&` reproduces the match and changes nothing.
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
- **Housekeeping, corrected 2026-08-02.** The 2026-07-26 note claimed "the stale
  remote branches are deleted". That was read as _handled_, and it was not:
  eleven stale branches were live on 2026-08-02, every one carrying commits not
  on master. **Auto-delete only reaches branches whose PR MERGES.** Abandoned
  branches — the ones actually worth cleaning — are exactly the ones it never
  touches, so they accumulate silently while the note says otherwise.
  "Automatically delete head branches" IS enabled and works; that half was true,
  and it fired three times on 2026-08-02.
  Note the consequence, which has now bitten twice: merging a PR deletes its
  head branch, so a later push to that name silently creates a _new_ branch with
  no PR attached. **The push succeeds and nothing warns you** — on 2026-08-02 it
  was caught only by noticing `[new branch]` in the push output.
  **AGENT SESSIONS CANNOT DELETE REMOTE BRANCHES.** `git push origin --delete`
  returns `HTTP 403`. **Diagnosed precisely, because the obvious attribution is
  wrong:** this is NOT the agent egress proxy. `origin` is the session's local
  git relay on `127.0.0.1`, which sits inside the proxy's own `noProxy` range,
  so that traffic never reaches the proxy at all — and the proxy's
  `recentRelayFailures` is empty, confirming it never saw the request. The relay
  permits ref creation and updates (every push in this session worked) and
  refuses ref DELETION. There is no GitHub MCP delete-branch tool either — it
  has `create_branch` and `list_branches` and nothing that removes a ref. So
  branch cleanup is a **human action**, and it is a capability limit of the
  session's git access, not an org policy an admin would change. This is the
  likeliest reason the 2026-07-26 note claimed a cleanup that had not happened:
  an agent tried, was refused, and recorded the intent as the outcome.
  **Seven branches were audited and DELETED on 2026-08-02** — assessed, then
  independently re-verified (including a blob-hash cross-branch check for
  content living only on two doomed branches, of which none was found), then
  **deleted by the operator**, since the session could not:
  `chore/state-ci-startup-failure-note`, `chore/state-post-t5g`,
  `chore/state-t5-progress`, `agent/odc-candidate-mockups`,
  `contracts/T5-fixtures`, `contracts/T5e-generator-and-first-vectors`,
  `wip/T5fg-material`. **Five refs remain: `master` plus the four below.**
  **Four are deliberately KEPT — they hold work that never landed**, now recorded
  in `OPEN-QUESTIONS.md`: `claude/odc-security-posture-audit-urgrjs` (the posture
  audit), `claude/review-memory-context-skills-383f6i` (the Ed25519 predicate gap
  and an `odc-code-review` rewrite), `claude/golden-fixtures-voting-verify-7urqku`
  (the ballot-expressiveness tension, a proposed charter edit awaiting operator
  ratification, and the HA-9 nit) and `claude/skills-agents-memory-mr-29f4dt`
  (dated 2026-08-02, forbids agent-performed merges — likely still live).
  **The audit paid for itself:** it surfaced that `docs/implementation-plan.md`
  and `services/ledger/CLAUDE.md` still described the pre-ADR-0004 voter-signed
  ballot that ET-22 permanently forbids. Fixed 2026-08-02. A Phase 1 implementer
  reading either would have built the one thing the charter calls
  non-negotiable — **so stale branches are not only clutter; they were the only
  place that defect was written down.**
