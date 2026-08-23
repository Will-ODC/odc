# ODC Core Build State

> Session-to-session truth for the **charter-governed core** — `contracts/`,
> `services/`, `tools/`. It does **not** cover `apps/pulse`; that workstream has
> its own entry in `memory/pulse.md`. Start at `memory/INDEX.md`.
>
> Update last, keep short. History belongs in git and ADRs, not here — per-ticket
> detail is in the cited squash commits and normative decisions in
> `docs/decisions/`. (Recurring review-defect shapes were kept in a session-memory
> note, `odc-review-lessons`, which is **not in this repo** — do not go looking for
> a file. The shapes that still matter are in Blockers below.)

## Where to jump

| You need                                          | Section                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| What phase we are in and whether the gate is open | [Current phase](#current-phase)                                                            |
| Whether ticket T*n* landed, and in which PR       | [Done](#done-ledger--detail-is-in-the-cited-squash-commit)                                 |
| Standing consequences of past decisions           | [Direction decisions](#direction-decisions--see-the-adrs-carry-forward-consequences-below) |
| What happens next, and what is owed               | [Next](#next)                                                                              |
| Traps, in-flight work, and things that bite       | [Blockers & live cautions](#blockers--live-cautions)                                       |

## Current phase

**Phase 0 — Contracts.** The T9 audit has **run** and returned **REQUEST
CHANGES** (six blocking findings, `docs/security/audit-phase-0.md`). All six were
decided and answered in the specs as **ADR-0013…0018** (#98); `event-types.md` is
at **v8**, `evolution.md` v4, `export-format.md` v3, `event-schema.md` v3.

**The gate is still closed.** Spec changes alone do not clear T9 — it reopens only
after fixtures, both verifiers, and a **fresh re-audit** (see Next). Nothing may be
implemented in services/ until then, and T9a advances `contracts/` to **RELEASE
CANDIDATE** (ADR-0007) only after that. The `contracts-v1` freeze stays deferred
until real operational use; `contracts/` remains **DRAFTING**.

**Conformance work is 1 of 4 phases done** (#104, #105). Phase 2 is next; the
phase list, and why fixtures and verifiers must land together in each one, are
under Next.

### Owed right now — must ride into the next PR that touches each

Hoisted here because the full entries live at the end of a 37 KB file, past
where anyone reliably reads. Each line links to its entry; **do not act from
this list alone.**

1. **Rebuild #109/#110, do not merge them** — they predate ADR-0019 and would go
   **green while behind the spec**, because no committed vector carries either
   optional key. → § Next, "What phase 2 still owes"
2. **Four review findings must ride into that rebuild or they are lost** — the
   `conformanceVerdict` regex with no `m` flag (a second output line makes the
   shared judge _throw_), a swap test that never swapped, self-consistent
   synthetic chains that cannot detect a preimage bug, and no assertion that a
   _legal_ optional key is accepted. → § Blockers, first entry

## Done (ledger — detail is in the cited squash commit)

**Setup & CI**

- T1 — local hooks + PR template (#1, `874bb4f`): lefthook, prettier + eslint.
- T2 — CI skeleton (#2, `fff12c4`): `repo.yml` + `contracts-guard.yml`; every
  `contracts/*.md` spec carries a `Version:` line.
- CI evolution: diff-size exempts `**/*.md` (#5); ceiling **800 → 600** (#14,
  `c017e2e`); freeze guard blocks fixture edits, not additions (#9).
- Routing → Opus (#8, `d1a41c6`): Opus plans + implements, Sonnet explores
  (`odc-navigator` only).

**Contracts specs (T3–T4)**

- T3 — event-schema / ids / event-types (#4): 7-field envelope (`ES-1…ES-33`),
  reject-don't-repair, v1 type registry, receipt-free ballots (ADR-0004).
- T4 — hashing / export-format / read-api / evolution (#6): byte-exact preimage,
  SHA-256 lowercase hex, canonical NDJSON, additive-only evolution. Ratifies
  ADR-0005, accepts ADR-0006.
- T4a — verdict report surface (#10, `587c852`): EV-15–EV-18, three verdicts,
  exit codes 0/1/2. **No reason-code registry exists or is needed — conformance
  is the verdict token + line number only; fixtures MUST NOT assert reason text
  or exit codes.**
- T4b — ADR-0007 release candidate (#12, `2a253cf`).

**T5 — fixtures & encoders (COMPLETE).** Slices T5a–T5i + the #48 follow-up.
T5 landed **75 vectors** (VALID 10, PARTIAL 4, INVALID 61); master now carries
**77** after T5j — see below. Load-bearing residue:

- `hashing.md` §6 reproduces independently (genesis `hash` `78ed980b…f6409a`),
  confirmed four ways (T4 by hand, T5a, two reviewers' RFC-8032 Python).
  **Not settled** — all the same family of reader; T7's Go verifier and T8's
  cross-language comparison are the real gate. Do not read "three
  implementations agree" as "the hashing is known correct."
- **Fixture verdicts are DECLARED, never computed** — the generator holds no
  verifier, so T7 is checked against the contract, not this tool's reading.
- EV-18/EV-19 took normative edits mid-T5, including an unreviewed third commit
  `2e775e6`. **If EV-18/EV-19 behave oddly in T7, read that commit first.**
- T5i: where a payload table and a numbered RFC-2119 sentence disagree, **the
  sentence governs** (`event-types.md` → v3; ET-14 counts scalar values).

**T6 — rehearsal builder (COMPLETE, 2026-08-06).** Slice→PR→squash map is in
session memory `t6-slicing-and-handoff`; the durable facts:

- Self-verify debt CLOSED (T6d, #55): recompute each hash, relink `prev_hash`,
  verify signatures, attribute a failure to a line.
- T6 builds **no** TS verifier by design (independence, not cost) — T7 is the
  first ticket that emits the three verdicts. A **second, independent TS verifier
  is owed = ticket T7b** (after T7, before T8; gates the freeze decision only,
  with `services/verifier/` on its exclusion list). Rationale in
  `docs/plans/phase-0.md` T6 + session memory `t6-scope-and-second-verifier`.
- ADR-0008 (#49, `a9f99d6`): the fixture freeze needs four file-kind rules.

**T5j — `ET-9b` genesis key format + HA-9 example fix (COMPLETE, #64 `c577fe7`).**

- `event-types.md` v3 → **v4**: `ET-9b` pins `operator_pk`/`registrar_pk` to
  `^[0-9a-f]{64}$` (mirrors `ids.md` ID-3), reject-don't-lowercase (D5). A
  **distinct** check from ET-7/ET-8 — an uppercase key still hex-decodes to the
  same 32 bytes, so `chain_id` still derives and the genesis self-signature still
  verifies; a verifier that skips ET-9b accepts a `genesis` it should reject with
  nothing else on the line to signal the fault.
- Vectors **076/077** (uppercase `operator_pk` / `registrar_pk`), both INVALID at
  line 1, isolating ET-9b alone. Master now carries **77 vectors** (VALID 10,
  PARTIAL 4, INVALID 63). `077` is the one an implementation likelier skips —
  `registrar_pk` never enters `chain_id` and is unused until a `vote_cast` arrives.
- HA-9 example fixed: int `0` vs string `""` (byte-identical but for the type tag)
  replaces the old int `1` / string `"1"` example, which differed by length and so
  proved nothing about the tag. No byte, digest, or fixture changed.
- **The Ed25519 canonical-encoding predicate was NOT part of this ticket** — it
  landed separately as ADR-0009/ADR-0010 (below).

**Ed25519 verification predicate — DECIDED & LANDED (ADR-0009 #66, ADR-0010 #67).**
The RFC 8032 divergence question flagged through T5j is now closed on the bytes,
per the "measure, do not reason from memory" direction:

- **ADR-0009 (#66)** pins the predicate at the **encoding** level: `event-types.md`
  **ET-4a** (canonical `sig` — `S < L`, `R` masked `< p`) and **ET-4b** (canonical
  verification key `A` masked `< p`), checked on raw decoded bytes before the verify
  primitive, reject-don't-repair (D5) — making RFC 8032's underdetermination
  unreachable. Fixtures `078` (ET-4b, discriminating), `079`/`080` (ET-4a,
  verdict-pinning).
- **ADR-0010 (#67)** adds the **subgroup** level: **ET-4c** requires every
  verification key be prime-order — `[L]A == 𝒪 AND A != 𝒪` — rejecting all
  small-order AND mixed-order keys, so key **legitimacy** is verifiable from the
  log, not trusted-by-policy. Worded with the non-identity clause deliberately
  (noble's `isTorsionFree()` returns true for the identity — the `A != 𝒪` clause is
  load-bearing). Measurement: `filippo.io/edwards25519` (Go) and `@noble/curves`
  (TS) AGREE on the predicate for all 11 points tested, so the **stdlib-only rule is
  relaxed to permit one named audited curve library per verifier, for the ET-4c
  check ALONE** (T7/T7b briefs updated in `docs/plans/phase-0.md`). Fixtures `081`
  (small-order, discriminating) + `082` (mixed-order, distinguishes a full
  prime-order check from a small-order blocklist).
- `event-types.md` → **v6**; this brought the count to **82 vectors (VALID 10,
  PARTIAL 4, INVALID 68)** — since raised to 83 by ADR-0011 (below). Version-bound;
  the **T10 re-audit re-measures** both libraries' predicate and the cofactorless
  assumption.

**T7 — Go verifier (COMPLETE, #69 `67c5d6e`).** The first tool that emits the three
conformance verdicts (`VALID` / `INVALID at line N` / `PARTIAL`), built from
`contracts/` alone in a hard-isolated fresh context (its worktree was stripped of
`memory/`, `docs/decisions/`, other services, and the T5/T6 generator — forbidden
reads made impossible, not merely disallowed). Durable facts:

- **82/82 fixtures pass**, `go test`/`go vet` green. Stdlib-only except
  `filippo.io/edwards25519`, scoped to the ET-4c prime-order check (ADR-0010).
  Hand-written byte-exact JSON parser (NOT `encoding/json`, which fails open on
  EX-7..EX-10). Verdict precedence INVALID > PARTIAL > VALID.
- **First reviewed slice with no real defect** — fresh-context Opus review APPROVE,
  no blocker, could not construct a wrong-verdict input. Breaks the
  fifteen-for-fifteen streak; treat it as earned, not as license to skip review.
  Sonnet consistency pass clean bar a stale service `CLAUDE.md`, fixed in-branch.
- **Three spec-bugs delivered** (a ticket deliverable), all in corners no fixture
  freezes. The load-bearing one — the `registrar_pk` timing divergence — is now
  **RESOLVED** (ADR-0011 / #72; see the next entry and Next).
- **Diff-size exemption (#70 `a0c4d2d`):** `services/verifier/**` and
  `tools/verifier-ts/**` are now exempt from the 600-line budget in
  `diff-size.sh` — a verifier is one isolated whole-unit build, splittable only
  into non-building pieces. Future verifier PRs won't trip diff-size; every other
  path still counts.

**registrar_pk timing — DECIDED, LANDED & CONFORMED (ADR-0011 #72 `d34dbd4`;
T7-fix #75 `b6c5c0a`).** The one divergence the T7 review found is fully closed.
**`ET-9c`** (`event-types.md` **v6 → v7**) pins the ET-4b/ET-4c checks to
`registrar_pk`'s **genesis declaration** (ET-9a), not its first use at `vote_cast`
(ET-17) — Option A (check at declaration), chosen over defer/split because ET-4c
exists so key legitimacy is verifiable from the log, it is the
strictest-now/safest-to-loosen-later choice for the ballot anchor, and it is the
most uniform rule (fewest special cases for two verifiers to read differently).
Fixture `083-genesis-registrar-pk-smallorder` (INVALID line 1) enforces it —
master carries **83 vectors (VALID 10, PARTIAL 4, INVALID 69)**; `fixtures/README`
→ v11 (#74). **T7-fix (#75) landed the Go verifier's conformance:** `stageBGenesis`
now runs ET-4b then ET-4c on `registrar_pk` before capturing it, so `083` → INVALID
line 1 and all 83 vectors pass. Applied **inline** (fixture-pinned, no ledger source
opened) rather than in a fresh `odc-verifier-builder` context — acceptable for a
one-check conformance fix, and T7↔T7b independence is unaffected (T7b is still a
separate isolated build). The Go fixture suite and two-verifier rehearsal now run
in required CI (T8, #95).

**T7b — independent TypeScript verifier (COMPLETE, #78 `b0bbd70`).** Built in a
hard-isolated context from `contracts/` alone, with no workspace imports and
`@noble/curves` confined to ET-4c. It independently enforces raw-byte canonical
JSON, hashing, signatures, payload rules, and ET-9c timing; all **83 fixtures**
pass (**86 tests**). Fresh-context review found and fixed two unbounded
argument-spread crashes before merge.

**T8 — two-verifier genesis rehearsal (COMPLETE, #95 `982bf37`; ADR-0012).**
`just rehearsal 1` built a 58-event seeded chain; the independent Go and
TypeScript CLIs both returned VALID, then agreed on EV-17 verdict tokens and line
numbers for all eight tamper cases. No contract, fixture, or golden hash changed.
Required repository CI now runs the Go fixture suite and the complete rehearsal.
Contracts remain **DRAFTING**; T9 is the next gate.

**Memory and agent infrastructure (#117, 2026-08-22).** Not a contracts ticket,
recorded here because it changed how every session starts.

- `memory/INDEX.md` is the entry point now — a ~6 KB router that holds nothing
  normative. `CLAUDE.md` points at it. Read it before this file.
- `memory/pulse.md` exists: the charter-exempt workstream had run **nineteen PRs
  (#79–#97) with no memory entry at all**, which this file admitted in its own
  blockers and never fixed.
- **The `memory-index` CI check enforces it** and is required on master. A
  top-level directory holding committed work, with no row in `INDEX.md`, fails
  the build. It checks only that the directory is _named_ — whether the entry is
  any good is review's job. What it removes is the **silent** omission.
- **It shipped with a defect worth remembering, fixed in #121.** The directory
  list was hardcoded (`apps contracts services tools docs`), which cannot catch
  the failure the guard is named after: a hardcoded list only catches a directory
  someone already thought to list, and the case that needs catching is a
  workstream nobody was thinking about. A new `packages/` sailed past it. It also
  made "would have fired on `apps/` at PR #79" true only because `apps` is in
  today's list — a guard written before `apps/` existed would have missed `apps/`.
  #121 discovers the list with `git ls-tree` instead, so untracked and gitignored
  directories drop out for free and a new directory is caught the moment it is
  committed. **The general shape: a guard whose scope is a list someone maintains
  is blind exactly where you need it.**
- `OPEN-QUESTIONS.md` split: settled entries moved to
  `OPEN-QUESTIONS-archive.md`, live file 63 KB → 31 KB. Nothing was cut.
- `.claude/skills/odc-orchestration` holds the model-routing rule; seven other
  skills were corrected where they contradicted the code they govern — most
  seriously `odc-code-review`, whose charter red flags were unconditional and
  would have made a reviewer block pulse's deliberately mutable votes.

## Direction decisions — see the ADRs; carry-forward consequences below

- **ADR-0007** — freeze deferred to operational use; three states DRAFTING →
  RELEASE CANDIDATE (entered at T9a; Phase 1 builds against it, no tag, specs stay
  fixable) → FROZEN. Added T9a; deferred T10 (which now re-audits any post-RC
  delta).
- **ADR-0008** — FROZEN split by file kind: golden data add-only; `index.json`
  append-only (ids unique, no repeated key); `MANIFEST.sha256`
  regenerable-not-deletable; `fixtures/README.md` exempt.
- **Consequences that bite:** fixture `note` prose AND `index.json` formatting
  freeze with everything else — **correct a wrong note before the tag or it is
  permanent** (the freeze rule is deliberately a dumb line rule; a cleverer
  comparator fails open). `.prettierignore` excludes `contracts/`, so that
  formatting is safe today.

## Next

**T9 ran and its six findings are answered in the specs (#98).** The conformance
work runs in four phases.

**The coupling rule this file used to state absolutely is WRONG as stated —
corrected 2026-08-20, and the correction is what let phase 2 be sequenced.** It
read: fixtures and both verifiers must land together, "there is no ordering that
avoids it." That is true of **phase 1** and does not generalise. Phase 1 made two
keys **required** on `issue_created`, which deadlocks symmetrically: an old
verifier rejects the new corpus (extra keys) **and** a new verifier rejects the old
corpus (missing required keys). Phase 2 is **purely additive at the fixture
level**, so the deadlock is one-directional:

- **fixtures first → red** (verifiers reject the new keys, nothing implements the
  new rules);
- **verifiers first → green**, because every new check is a no-op on the current
  corpus. Verified before relying on it, not assumed: no current vector has an
  unregistered genesis version (`conformance.test.ts:189` guaranteed it), none
  declares equal genesis keys, and a widened key set strictly widens.

**So the real rule is: fixtures may never precede verifiers. Verifiers may land
alone whenever their new checks are no-ops on the committed corpus** — which is
exactly when the change is additive. Check which shape a phase has before assuming
it deadlocks; the cost of assuming is a needless mega-PR.

**Phase 1 — DONE (#104, review fixes #105).** ET-14b regeneration.

- All **83 vectors regenerated**; **verdicts and line numbers unchanged**,
  verified by diffing every `id / verdict / line / lines` against the previous
  corpus. Bytes, hashes and the two `head` inputs (`003`, `053`) moved.
- Defaults are the floors, `60000` / `3`, **forced not chosen**: ballots are minted
  on whole-minute boundaries, so a coarser interval would leave them non-quantized
  under ET-23 and flip VALID vectors to INVALID.
- **`005-boundaries` needed a real fix.** Its two ballots sat on one issue at
  different minutes — two batches of one under ET-24, the earlier under-size and
  not last, making a declared-VALID vector INVALID. They now share a batch instant.
  **Verdict preserved by making the bytes conform, never by editing the
  expectation**; it cites ET-24 so nobody tidies them apart later.
- `057`'s stale ET-9a note corrected — the last cheap moment, since notes freeze
  at the tag (ADR-0008).
- Both verifiers brought to ET-14b in **separate isolated sandboxes**. The
  phase-1 review then built both CLIs and ran **25 differential cases** across the
  floor boundary: identical verdict **and** line every time.

**Phase 2 — IN FLIGHT. Its contracts half is LANDED; verifiers and fixtures are owed.** F3 (unregistered `genesis` → INVALID line 1)

- F6 (distinct genesis keys) + F4 (fork ancestry) vectors, the matching verifier
  checks, and **inverting `conformance.test.ts:189`** — which must happen _with_ the
  F3 vector, never before, since inverted alone it asserts a vector that does not
  exist. **Invert it, do not delete it, and scope the exception to the F3 vector's
  id** — a blanket "any reserved version passes" relaxation would let a future
  PARTIAL vector freeze a verdict EV-20 forbids.

**Phase 2 found two contradictions in merged normative text and stopped to fix
them — LANDED 2026-08-20 as ADR-0019 (#112, `decc152`); `event-types.md` is at
**v9**, `event-schema.md` **v4**, `export-format.md` **v4**.** Neither had any verdict impact, which is exactly why
both survived review and would have frozen wrong.

- **`ancestor_head` was specified two ways.** ET-9e made it carry a **head**;
  ET-7a listed that same key among the places "a chain must be named", held the
  genesis hash is the name, and held seven lines later that a head cannot name a
  chain. **Resolved: two optional keys** — `ancestor_chain` (the parent's genesis
  hash, the name) and `ancestor_head` (the parent's head at the fork, the
  position) — plus **ET-9f**: `ancestor_head` MUST NOT appear without
  `ancestor_chain`; `ancestor_chain` MAY appear alone, and **that asymmetry is
  deliberate and defended in the rule text** so nobody tidies it into
  both-or-neither.
- **EX-14 vs ET-7a, pre-existing:** EX-14 says "the head identifies the whole
  chain"; ET-7a says a head does **not** identify a chain — and cites EX-14 in
  support. Two senses of "identifies" (commits-to vs names) never distinguished,
  and it is the load-bearing premise for ET-9f. Fixed in the same PR.
- **ADR-0016's "the only key `genesis` will ever gain" is amended, not
  overturned** — operator-approved 2026-08-20. Its own reasoning binds on the
  **tag** (ET-6 + EV-1), not on a count of one, and no tag exists. **The permanent
  claim is: nothing may be added to `genesis` after the tag.** ADR-0016 and
  ADR-0013 keep their bodies and take status-line amendments only; an ADR is a
  record, and erasing the head-alone decision erases the reasoning a later reader
  needs before trimming `ancestor_chain` back out.

**Phase 2's vector count went 6 → 11**, ids `084`+. F3 one, F6 one, fork ancestry
the rest. Two that must not be lost:

- **`ancestor_head`-without-`ancestor_chain` (INVALID line 1) goes FIRST.** It is
  the only owed vector that fails against a verifier still implementing the merged
  ET-9e — the single fixture proving ADR-0019 landed.
- **`ancestor_chain == ancestor_head` is LEGAL and needs a VALID vector.** It is
  what a fork from a parent holding only its `genesis` produces (head = genesis
  hash, EX-14/EX-21). Nothing bars it and nothing should; it is what a naive
  implementer rejects as a duplicate.

**Two fixture-construction traps, both confirmed by review:**

- **The F6 and fork-ancestry value vectors MUST be chains signed under the faulty
  payload.** Any payload mutation also breaks the genesis self-signature (ET-8),
  so a vector that merely mutates and re-derives `hash` is satisfied by a verifier
  that checks only the signature — it freezes a verdict while catching nothing.
  `076`/`077` show `fixtures-gen` already re-signs, so this is producible.
- **The both-keys VALID vector is the corpus's first SEVEN-key genesis payload**
  and the first real exercise of HA-7's key count and HA-8's ordering (both new
  keys sort ahead of `chain_id`). `STATE.md` has long recorded HA-7 as cited by no
  vector; this closes it. **Compute its two hash values from `002-four-types`'s
  built chain in the generator — never hard-code them**, or they rot silently at
  the next regeneration and the vector asserts nothing.

**What phase 2 still owes, in order.**

1. ~~Both verifiers, rebuilt in fresh isolated passes.~~ **DONE 2026-08-23, in
   review, awaiting merge: PR #123 (Go) and #124 (TS).** Both were rebuilt by
   agents that had never seen the other's source, each briefed from `contracts/`
   alone. **#109 and #110 are CLOSED**, superseded — not merged and not updated,
   because the trap held exactly as predicted: they would have gone **green**
   while behind the spec, since no committed vector carries either ancestry key.
   All six of their review findings rode into the rebuilds.
2. **The twelve vectors — the critical path, and the only thing that turns "both
   verifiers agree" into "both verifiers are verified".** Eleven for fork
   ancestry and EV-20 (`ancestor_head`-without-`ancestor_chain` first), plus one
   for ET-9d. See the coverage entry in Blockers for why this is now urgent
   rather than tidy.
3. ~~Fresh-context review of each.~~ **DONE** — three independent reviewers, one
   per branch, none of them the author, and **no two of them allowed to see both
   verifiers**. All returned APPROVE WITH NITS; every finding was applied,
   verified and pushed. Also merged-and-owed: the phase-2 STATE.md entry, at
   merge time.

**What the phase-2 rebuild actually found — the reason this took four rounds and
not one.** Recorded because every item is the same shape: _a check that passes
while reaching nothing_.

- **A real crash, not a regression guard.** The Go parser was recursive-descent
  with **no depth limit**. A single line nesting ~1.5M deep exhausted the
  goroutine stack, and Go answers that with a runtime **fatal error**, not a
  panic — so `recover()` cannot turn it back into a verdict. The process printed
  **nothing** to stdout and exited **2**, which is that CLI's PARTIAL code: a
  consumer reading exit status alone reads a crashed verifier as "chain
  verified". An EV-17 violation reached without breaking any stated rule. Fixed
  with a depth bound of 64, verdict-preserving from ES-16/ES-17. **The
  orchestrator's own draft fuzzer tested to depth 500k and passed** — the defect
  needed a cold builder going to 3M to surface. That is the isolation rule
  earning its cost, concretely.
- **A quadratic in the Go parser.** Duplicate-key detection scanned every prior
  key per key: 200k keys took 73s, now 0.19s. Verdicts were always correct, so
  nothing failed — but "a stranger can verify the log in an afternoon" is a
  charter property, and a hostile export of modest size could wedge any public
  verifier. **The TS parser does not have it** (adjacency suffices, because EX-8
  mandates ascending order), which is itself worth knowing: the two verifiers
  had genuinely different performance characteristics and only one differed.
- **Tests that passed while reaching nothing, four separate instances.** The TS
  fuzzer's many-key cases numbered keys unpadded, so `k10` sorted before `k2` and
  the parser rejected at key two — those cases had **never** exercised a wide
  payload. The Go fuzzer's cases named for ET-14's scalar bound died in Stage A
  on a hash mismatch and never called `countScalars`. Deleting the Go required-key
  loop entirely left the **whole suite green**. And nothing anywhere asserted the
  TS CLI's **exit status** — changing INVALID from 1 to 0 passed all 116 tests.
  **Every one was found by mutation, none by reading.** Mutate before believing a
  suite.
- **One claim was unreachable in principle, not merely wrong.** The TS
  key-scaling test claimed to cover Stage B's per-key work. `(genesis, 1)` defines
  seven payload keys, so the key-set check rejects a 128k-key payload on sight:
  **no such payload can ever reach Stage B for a registered type.** Repairing the
  hash was not enough; the claim had to be narrowed. A distinct failure mode from
  the others — coverage asserted for something that cannot exist.
- **ET-9d was specified and implemented by neither verifier.** A chain declaring
  `registrar_pk` identical to `operator_pk` verified **VALID** in both. Both
  reviewers found it independently. Now implemented in both, symmetrically and in
  the same round, because an asymmetric landing means the two verifiers disagree
  on a real verdict — worse than being wrong together.

**Phase 3.** F2 batching vectors — ET-23 quantization, ET-24 batch size, and the
below-floor vectors that finally discriminate the ET-14b floors. **Reshaping
`tools/rehearsal` belongs here** (see Blockers).

**Phase 4.** F1 — `--chain <genesis-hash>` and printing the computed genesis hash
and head (EX-24, scoped as tool output not verdict, so no collision with EV-17).
The fixture index already carries per-vector inputs (`003`/`053` use `head`), so
`--chain` needs no new fixture mechanism.

**Then: fresh re-audit** by a context that did **not** write
`audit-phase-0.md` — the step that actually clears T9; acceptance is APPROVE.
**Then T9a — release candidate**: flip `contracts/README.md` DRAFTING →
RELEASE CANDIDATE, reconcile the named implementation/charter/service guidance,
and move this file to Phase 1 (ledger · verifier · identity). **Do not create a
`contracts-v1` tag.** T10 freeze and re-audit stay deferred until real
operational use.

**Operator decisions already settled, do not re-litigate.** The six findings
(ADR-0013…0018) were worked through one at a time. The F2 batch floors —
`ballot_batch_interval_ms` **≥ 60000** and `ballot_batch_min` **≥ 3** — are
**confirmed by the operator (2026-08-15): both stay as they are.** The values
above the floors are per-issue and votable, which was the explicit instruction:
batch size must be open to community vote, like almost everything here. The floors
exist only so "governable" cannot mean an operator sets 1 ms / 1 and makes the
rule decorative. Note which parameter does which job — **`ballot_batch_min` is the
anonymity parameter** (how many you are hidden among) and the interval is the
timestamp-coarseness one; publication waits on the count, so turnout drives the
delay, not the clock.

**Charter §4 anchoring edit — RATIFIED by the operator (2026-08-15).** It now
says a chain's **identity** (its genesis hash) and its **head** are published
**together**, because a head names a position on _some_ chain, so publishing it
alone lets an operator run two chains and anchor only one. Landed via #98,
reviewed before/after in session, confirmed settled. No operator decision is
outstanding on Phase 0.

**Do not confuse the three minimums — they solve different failures.**

- **`ballot_batch_interval_ms` (≥ 60000)** — how wide a batch window is. Sets how
  coarse a published `ts` is. **Implemented** (ET-23).
- **`ballot_batch_min` (≥ 3)** — how many ballots publish together in one batch.
  **The anonymity parameter**: it hides your individual vote in the stream.
  **Implemented** (ET-24).
- **`min_turnout` / quorum** — how many ballots an _issue_ needs before its result
  publishes at all. **NOT implemented, deliberately deferred.** It protects against
  the **tally arithmetic** exposing voters: five votes at 3–2 with four known
  reveals the fifth, and batching has done its job perfectly by then. Batch minimum
  solves the timing failure; quorum solves the small-numbers failure. Cheap to add
  whenever wanted — only `genesis` is version-locked (ET-6), so `issue_created`
  can take a v2. Accepted interim trade: warn users before casting that a
  low-turnout vote may be identifiable.

**Owed with no ticket — restated concretely 2026-08-15, because the previous
wording was too vague to action and that is why it never got done.**

**The defect class:** `f(...array)` in JS throws `RangeError: Maximum call stack
size exceeded` once the array passes ~130k elements. Two real instances were found
and fixed in the T7b review, both pinned now by
`tools/verifier-ts/test/robustness.test.ts`:

- `Math.min(...invalidLines)` — 200k blank lines produce 200k faults, and the
  verifier **crashed instead of returning a verdict**, violating EV-17's "exactly
  one of three verdicts".
- `String.fromCodePoint(...cps)` — a 200k-character string value crashed the
  parser, and the catch-all **swallowed it as `INVALID`**: a wrong verdict,
  silently, on a line that parses fine.

**Why value-level and not byte-level:** a byte fuzzer flips bytes in a valid file
and will essentially never build a 200k-element array, because flipping bytes does
not grow the input. A value-level fuzzer generates **structurally valid** exports
carrying **extreme values** — huge line counts, huge strings, boundary integers —
and hits this class immediately.

**The task:** generate structurally valid exports with extreme values, run both
verifiers, and assert **only** that neither throws and each returns exactly one of
the three verdicts. Do **not** assert which verdict — fixtures remain the sole
oracle for that, and inventing expectations here would be inventing conformance.
Commit as a test. A day's work, not a research project.

**HALF DONE 2026-08-22** (branch `claude/future-focused-session-p0cjqd`, unmerged).
`tools/verifier-ts/test/extreme-values.test.ts` does the above for the **TS
verifier only**; the **Go verifier is still owed** and is not a port. Full detail,
including the two Go-specific hazards (one ruled out by inspection, one open), is
in `memory/OPEN-QUESTIONS-archive.md` under the unbounded-value entry. The fuzzer found **no new
defects** — it is a regression guard, not a discovery.

**The "six more sites near `verify.ts:93-102`" this entry used to claim were
deferred DO NOT EXIST — do not re-search for them.** A repo-wide grep for
spread-into-call across all non-vendored TypeScript returns only the two
already-fixed sites (`parse.ts:200`, chunked; `verify.ts:360`, folded) and their
comments. `verify.ts:281`'s `[...faultLines]` spreads into an **array literal**,
which uses the iteration protocol and has no argument limit — safe at any length,
and the likeliest source of the miscount.

**FIVE rules are now implemented by both verifiers and covered by NO vector:
ET-9d, ET-9e, ET-9f, ES-34, EV-20** (counts verified 2026-08-23 against
`index.json`; ET-9b has 2, ET-9c has 1, these have 0). EV-17 makes fixtures the
sole conformance oracle and EV-5 wants goldens shipped with an additive change,
so **this is a live EV-5 gap, not a to-do**: two independent verifiers can
diverge silently on every one of these rules and the whole corpus still passes
both. Both PRs say so in a "what this does not close" note rather than reading
as fixture-backed. Two deadlines make it urgent: **ET-9d's own text says it must
land before the freeze** (EV-1/EV-4 bar adding it after, since conforming chains
would become retroactively invalid) — **and the same argument bars adding its
fixture afterwards**. A differential probe built with `fixtures-gen` (collapsed
genesis keys, properly signed and hashed) shows both verifiers already agree on
ET-9d, INVALID line 1, with the legal control VALID in both — so **the vectors
are producible with the generator that already exists**, in a few lines.

**Coverage is thinner than 83 vectors suggests, and the real number is worse than
"~130" said.** Counted exactly during T9: **143 rule ids, 70 cited by at least one
vector, 73 cited by none.** `ET-4a`–`ET-4c` are covered (vectors `078`–`082`).
The uncovered half includes **`RA-1`–`RA-13`, the whole of `read-api.md`** — the
public read surface, which is exactly where identity leakage would show, and which
no earlier gap list mentioned at all. Other real gaps: `ES-30`–`ES-32` (sig field),
`ET-3`, `EX-14` (head), most of `ids.md`, `EV-11`–`EV-14` (correction/retraction,
incl. EV-13's ballot-plane prohibition). **`HA-7` is cited by no vector** despite
six notes invoking it. Note the honest limit: vectors are NDJSON exports, so
covering `RA-*` may need a different instrument — likely why it went unnoticed.
And **citation is an upper bound on coverage, not coverage**: `HA-2` is cited by a
vector while its closing MUST is unfixtured. Strong on what it covers, silent
elsewhere — not a complete conformance suite.

**Two known fixture warts, deliberately unfixed** (`016-seq-gap` and
`040-line-deleted` overlap at line 3; `016`'s bytes carry `seq [1,2,4,4]`).
Recorded so a reader does not re-flag them; fix only if the set is renumbered
before freeze.

**Owed by the operator, not a session:** the ballot-expressiveness ceiling ADR
part B (part A landed) and the other queued direction ADRs. **Read the ET-22
warning in `memory/OPEN-QUESTIONS-archive.md` before writing the first.**

**Part B's old default is withdrawn (operator, 2026-08-19).** It used to read
"ballots stay one-choice until argued otherwise". The operator's stated intention
is a **wide variety of voting options**, with the ceiling **deliberately left
open to decide later** — so silence is no longer a vote for one-choice, and no
session should treat it as one. **v1 is unaffected**: a ballot is still one
choice from a small bounded set (charter §5, ET-14a), and no contract text is
loosened by this. The substance still to decide, and an unresolved question about
whether it must be settled before the freeze, are in `memory/OPEN-QUESTIONS-archive.md` under
the ballot-expressiveness entry.

**Four unlanded branches deliberately KEPT** (`contracts/` untouched by all).
All four **verified present on the remote, 2026-08-22**:

| branch                                        | for                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `claude/odc-security-posture-audit-urgrjs`    | T9 input (creates `docs/security/`)                                         |
| `claude/review-memory-context-skills-383f6i`  | `odc-keys-and-signatures` skill + `odc-code-review` rewrite, still unlanded |
| `claude/skills-agents-memory-mr-29f4dt`       | forbids agent-performed merges; may be a live session                       |
| `claude/golden-fixtures-voting-verify-7urqku` | fully mined 2026-08-02 — **deletable**                                      |

Also still on the remote and **not** in that list: the three squashed T9 branches
below (`claude/t9-audit`, `claude/t9-decisions`, `claude/t9-adrs-contracts`),
`claude/t9-fixtures-phase1`, and `pulse/4b-sign-in-routes` — an unlanded pulse
branch with no open PR, recorded in `memory/pulse.md`.

`claude/t9-phase2-verifier-go` and `claude/t9-phase2-verifier-ts` are **kept but
superseded**: their PRs (#109, #110) are **closed**, with a comment on each
recording why they were closed rather than updated. Do not reopen or rebase them.

**Three phase-2 branches are OPEN and awaiting merge, all reviewed and green
(5/5 required checks each), 2026-08-23:**

| branch                                 | PR   | contents                                                            |
| -------------------------------------- | ---- | ------------------------------------------------------------------- |
| `claude/hash-chain-context-3uaob2`     | #122 | rehearsal judge: stop aborting on verdicts it should compare        |
| `claude/t9-phase2-verifier-go-rebuild` | #123 | Go: ancestry, EV-20, ET-9d, quadratic fix, the stack-overflow crash |
| `claude/t9-phase2-verifier-ts-rebuild` | #124 | TS: ancestry, EV-20, ET-9d, one-line verdict, exit status           |

## Blockers & live cautions

- **FIVE `contracts/` contradictions are open and need an operator decision.**
  All were found by implementers or reviewers who had to _decide_ what a rule
  meant; none has any verdict impact on the committed corpus, which is precisely
  why nothing automated can find them and why they would otherwise freeze wrong.
  In priority order:
  1. **EV-9 contradicts EV-20, and EV-9 claims authority — the only one with
     real divergence potential.** EV-8 carries "with the single exception of
     `genesis`, EV-20"; **EV-9 does not**, and says a well-formed unregistered
     pair gets "the per-event `PARTIAL` treatment … **not** a structural
     `INVALID`", then calls itself "the authoritative reconciliation". So for a
     well-formed `(genesis, 2)` at line 1, EV-20 says INVALID and EV-9 says
     PARTIAL. A third implementer reading EV-9 builds a verifier that disagrees
     with both of ours on a **verdict**. Both of ours agree only because the
     briefs named EV-20 — the instruction masked the divergence rather than
     testing for it. Needs an additive amendment to EV-9's last sentence. This
     is the ADR-0019 shape again: an exception applied to one sentence and not
     its neighbour.
  2. **`contracts/` bounds nothing and says nothing about exceeding limits.** No
     sentence anywhere bounds nesting depth, line length, or key count, nor says
     what a verifier must do when input exceeds what it can process. That
     silence is what let the stack overflow above exist. The Go verifier now
     ships a depth-64 bound its builder _reasoned into existence_, with no spec
     backing — so a third implementer has no way to know what is permitted.
     Proposed sentence for `evolution.md`: a verifier MAY impose implementation
     limits provided they cannot change a verdict, and MUST report a verdict or
     a tool-level error (exit ≥ 3) rather than terminating abnormally.
  3. **EV-21's advice is unreachable.** ET-6 pins `genesis.version` at 1
     permanently, so "your verifier may be out of date" can never be true for
     genesis — yet EV-21 requires presenting both readings as indistinguishable,
     and the TS verifier now faithfully tells users to "fetch a newer verifier",
     which will always be wrong advice.
  4. **ET-7a reads as both-or-neither** ("the same pair a fork records"), which
     is exactly the tidy ET-9f forbids. ET-9e's prose resolves it, but ET-7a is
     the sentence someone would cite to break the rule.
  5. **ET-9f's stated justification does not select its own rule.** It bars
     head-alone as uncheckable — but chain-alone is equally uncheckable. The real
     criterion is **naming**: a name without a position is a weaker but coherent
     claim; a position without a name refers to nothing. Rule right, reason wrong.

- **ET-23 and ET-24 are implemented by NEITHER verifier, and ET-23 is cited by
  no vector.** Both are stated as verifier MUSTs — ET-23 ballot `ts`
  quantization, ET-24 minimum batch size — and these are the **anonymity** rules:
  ET-24's batch minimum is what hides an individual vote in the stream. The Go
  verifier enforces only the ET-14b _parameter floors_ on `issue_created`, which
  is a different thing; the TS verifier has no mention at all. Phase 3 covers
  them on paper. **Confirm that is still real rather than assumed** — a rule with
  neither implementation nor vector is the "green because nothing reaches it"
  shape one phase up.

- **The shared rehearsal judge ABORTS where it should compare — four instances,
  one family.** `conformanceVerdict` throws on any output it fails to match, and
  a throw kills the run instead of reporting agreement or disagreement, which is
  strictly worse because it hides whether the verifiers agreed. Found so far: a
  reason printed on a second line (EV-21); a single-line `PARTIAL` spelled
  "line" not "lines"; and a reason attached to `PARTIAL` at all. All fixed in
  #122. **The generalisation worth keeping: whenever a verifier's stdout changes,
  check it against that regex** — and prefer widening the judge over coupling the
  two verifiers on a shared output string, since EV-17 makes printed wording
  non-normative _on purpose_, to keep the CLI surface revisable.
  Still unfixed and out of scope there: the judge does not check EV-17's
  **ascending** line order for a multi-line PARTIAL, so it would report a
  disagreement without saying which verifier broke the ordering rule.

- **`odc-verifier-builder`'s role definition says Go, but it was used for the TS
  verifier too.** The isolation property held — no context opened both
  verifiers — but the brief and `.claude/agents/` disagree, and the agent itself
  flagged it. Fix the definition: either a separate TS builder role, or scope the
  existing one to "either verifier, never both".

- **Superseded, kept for the reasoning: the four review findings from the closed
  #109/#110.** All six rode into #123/#124 and are fixed there; recorded because
  the _shapes_ recur:
  - **[TS, BLOCKING] The CLI printed the EV-21 reason on a SECOND line.** The
    contract is **one** verdict line with the reason after a colon
    (`services/verifier/API.md`). `tools/rehearsal`'s `conformanceVerdict` regex
    has no `m` flag and `[^\n]*`, so a second line makes the shared two-verifier
    judge **throw** rather than mismatch. Nothing is red today only because no
    current tamper case produces an unregistered genesis version — **it goes live
    the moment a phase-2 EV-20 vector reaches the rehearsal.** Any verifier change
    that touches stdout must be checked against that regex.
  - **[Go] The test named for the swap failure mode did not perform the swap** —
    it substituted the legitimate optional key, not an unknown one. The reviewer
    replaced the key-set check with a count-based regression and **the entire
    suite passed**. Shipped code was correct; the guard guarded nothing.
  - **[both] Synthetic in-verifier test chains are self-consistent by
    construction** — they sign and hash with the same functions under test, so a
    VALID assertion there can never detect a preimage bug. Fine as a harness
    check, but it inverts the standing rule that verdicts are DECLARED, never
    computed. **A green verifier unit test must never be recorded as having
    pinned a fixture-owed shape.**
  - **[TS] Nothing asserted that a LEGAL optional key is accepted.** Every new
    test asserted INVALID; had the key been dropped on the floor, all of them
    still passed. Cover the positive case.
- **Isolation by deletion works, and two runs leaked through git plumbing.**
  Stripping the worktree (T7's precedent) held for reads. But `git stash pop` and
  a `git diff --stat` fallback each **printed deleted paths**, disclosing
  filenames, changed-line counts and three ADR filenames. No content, and there is
  affirmative evidence against contamination — the two builds diverged on output
  shape, which they would not had one seen the other. **Add to future isolation
  tickets: no git command that can enumerate paths outside your own tree, plumbing
  included.** Both agents self-reported; that is the behaviour to keep.
- **Agents create worktrees in the repository root unless told otherwise** —
  a review session left `wt-base/` (191M) and `wt-review/` (11M) there. Now
  ignored (#111, after #108 did the same for `.claude/worktrees/`), but the
  ignore is a backstop: **tell every dispatched agent to use the session
  scratchpad.** One of two concurrent reviewers did so unprompted and left
  nothing behind.
- **When ONE PR lands TWO ADRs touching the SAME spec, diff their normative
  sentences against each other — not just each against the spec.** #98 landed
  ADR-0013 and ADR-0016 into `event-types.md` v8; each was correct alone, they
  cross-referenced each other by number, and they still contradicted each other
  seven lines apart. Neither the PR review nor T9's audit caught it. It took an
  isolated verifier build that had to decide what the value _meant_ in order to
  implement it. **This is the cheapest available addition to the merge
  checklist**; raised here rather than edited into `odc-pipeline`, since it is a
  claim about the process the operator owns.
- **A contradiction with no verdict impact is the dangerous kind.** Both ADR-0019
  contradictions were invisible to every fixture and both verifiers, because the
  competing readings are the same 64 lowercase hex under a format-only check.
  Nothing automated could have found either. Only reading rules against each
  other does.

- **Two traps the ADR-0013…0018 pass left in the fixture work.** Both are the kind
  that read as noise later and cost a day to rediscover.
  **(a)** `tools/fixtures-gen/test/conformance.test.ts:189` asserts _no vector may
  freeze a verdict for an unregistered genesis version_, because that was an open
  question. **ADR-0015 answered it**, so the guard now forbids exactly the fixture
  F3 requires. **Invert it, do not delete it** — deleting drops a live protection
  along with the stale assertion. It must be inverted _with_ the fixture, not
  before: inverted alone it asserts a vector that does not yet exist.
  **(b)** Fixture `057-issue-sig-wrong-key`'s `note` asserts the superseded ET-9a
  rule. Verdict unaffected, prose false. Fixture notes are immutable at the tag
  (ADR-0008), so **fix before the tag or it is permanent** — cheapest to do inside
  the regeneration pass, which rewrites `index.json` anyway.
- **`apps/pulse/` and `apps/pulse-web/` are a separate, active, charter-EXEMPT
  workstream** — nineteen PRs, **#79–#97**, that this file went the whole way
  without mentioning. It now has its own memory entry: **`memory/pulse.md`**, and
  `memory/INDEX.md` routes to it. They live in `apps/`, not `services/`, so they
  do not violate the "nothing in services/ until T9" rule. The diff-size ceiling
  was raised 600→1000 in #93 for that work, so the **live ceiling is 1000**, not
  the 600 recorded in the T5-era Done entry above.
- **A squash merge leaves granular history only on the branch.** #98 squashed the
  whole T9 branch into one commit, so the per-change commit messages survive only
  on `claude/t9-audit`, `claude/t9-decisions`, `claude/t9-adrs-contracts` (PRs
  closed, content fully on master). Kept deliberately for that reason; deleting
  them is lossy, not free.
- **Branch protection ON** — it is a **Ruleset** (`protect-master`), not a classic
  branch rule; edit it under Settings → Rules → Rulesets. PR required, **five**
  strict checks (`format / lint / typecheck`, `diff-size`, `guard-tests`,
  `memory-index`, `guard`), linear history, no bypass. `memory-index` was added
  2026-08-22 with the memory index it enforces. **STATE.md updates ride their own follow-up PR** — feature
  branches conflict, so update this file after the ticket merges.
- **Fifteen of the first sixteen reviewed slices had a real defect; T7 (#69) is
  the sole clean one — and it was the most-isolated build, reviewed hardest.**
  Read that as: independence + a fresh hard-hammering review is what a clean pass
  costs, not that reviews can now be trusted to pass. Treat a clean review as the
  surprise it still is. (Defect shapes: see the header note;
  PR/merge handoff: `pr-handoff`.)
- **Merging deletes the head branch** (auto-delete ON), so a later push to that
  name silently creates a NEW branch with no PR — watch for `[new branch]` in the
  push output. **Agent sessions CAN delete remote branches** (`git push origin
--delete` succeeded 2026-08-06, falsifying the old blanket 403 claim — try it,
  don't assume).
- **A required check that is never CREATED** (e.g. `contracts-guard`
  `startup_failure`) looks identical to "still running" — there is no red check.
  Count checks against the four required before assuming CI is broken; a wedged
  `queued` run must be cancelled before it will re-run.
- **`turbo` caches `lint`** — a green `pnpm run lint` right after moving files is
  not trustworthy; run `npx eslint` directly.
- **Commit before running a review/mutation agent** — reviewers edit and restore
  the tree, and a dirty tree has been clobbered (see `no-tmp-backups`).
