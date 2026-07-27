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
    right key verifies, wrong key does not — which is what pins ET-9a's
    separation of operator from registrar. ET-21 held structurally: a ballot's
    payload keys are exactly `{choice, issue_id, sig}`.
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

**Everything opened this session is merged** (#14, #19–#22). `contracts/fixtures/`
exists on master with 7 `VALID` vectors, the T5e review fixes are in, and the
T5a HA-2 fix is in. **Two slices of T5 remain: T5f and T5g.**

Both remaining slices are written and verified on `wip/T5fg-material`:

1. **T5f** — the 4 `PARTIAL` vectors, `conformance.test.ts` (EV-17/EV-18
   policy), and the 30 envelope `INVALID` vectors. ~467 lines.
2. **T5g** — framing, `--head`, Stage B and precedence vectors. ~403 lines.
   Also reconcile `contracts/fixtures/README.md`, which carries slice-transient
   prose ("currently holds the `VALID` vectors", a worked example keyed on
   `037-hash-mismatch`) that becomes false at the freeze.
3. **Carry finding 2 forward:** no committed preimage exercises the **integer**
   payload tag `0x69` — vector 001's payload is all strings, so a wrong `ENC_INT`
   or swapped tag (HA-9) surfaces only as a digest mismatch with nothing to diff.
   Add `preimages/` for the `issue_created` at seq 3. Additive, so legal even
   post-freeze, which is why it was deferred out of #19.

**`wip/T5fg-material` holds T5f/T5g's modules**, verified as a whole (66/66
tests, all 69 vectors regenerating byte-identically). It is **not a merge
candidate** — it sits on T5e's old branch and the no-stacking rule forbids
merging from it. Re-cut each slice from master and extract.

**Slices cannot be prepared in advance.** Each needs the previous one's
`shared.ts`/`index.ts` on master to compile, and stacking is forbidden because
squash-merge orphans the child silently (see the #11 note above).

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
- **Fresh-context review coverage is partial.** T5a and T5e are reviewed (both
  found real defects). **T5b and T5c/T5d are not** — their reviewers failed
  repeatedly on API 529s and were never re-run. Both are merged. T5b is the
  canonical line form (EX-7–EX-9), which decides the stored byte form of every
  vector, so it is the remaining review worth running; T5c/T5d are builders and
  mutators whose output the T5e review already exercised end to end.
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
