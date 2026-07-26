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

**T5 — Fixture generator + golden fixtures (TypeScript)** (`odc-implementer`),
per `docs/plans/phase-0.md`. **Nothing blocks it** — every prerequisite is on
master as of 2026-07-25. Start by reading `contracts/evolution.md` §4 (EV-15–
EV-18) and `contracts/export-format.md` §5 (EX-18–EX-20); those are the rules
the vectors encode. Settled inputs, already decided — do not relitigate:

- **~40 vectors, not ~116.** "One per normative sentence" over-scopes: many are
  definitional and exercised by every vector, and hand-review is the real gate —
  a reviewer checks 40 carefully and skims 116. Cover the four v1 types, the full
  tamper matrix, the `odc-contracts` adversarial set, and boundary values.
- **Byte-exact vectors are committed as raw files**, protected by a SHA-256
  manifest verified in CI plus `contracts/fixtures/** -text` in `.gitattributes`.
  Detection, not encoding, closes the silent-corruption hole.
- **Each vector asserts verdict token + line number(s) only** (EV-17). The
  unregistered-type vector MUST use an `x_` type (EV-18).
- `contracts/fixtures/README.md` documents the record format — it must live
  inside `fixtures/` so T7, which may read only `contracts/`, can see it.
- Do **not** use `genesis` for the unknown-version vector — see the
  unregistered-genesis-version item in `OPEN-QUESTIONS.md`. Use
  `participant_registered` version 2, a leaf type nothing references.
- Golden values never regenerate to make anything pass (`odc-testing`).
- Two bits of plumbing T5 must not forget: add `tools/` to
  `pnpm-workspace.yaml` (it lists only `services/*` today, so a
  `tools/fixtures-gen` package will not resolve), and confirm `diff-size`
  tolerates the committed vectors — markdown is exempt, JSON is not.

Then T6 (rehearsal builder) → T7 (Go verifier, fresh-context isolation) → T8
(rehearsal loop) → T9 (security audit) → **T9a (release candidate → Phase 1)**.
T10 (freeze) is deferred past Phase 1.

**Also queued, not blocking T5:** the direction ADRs — definitional-vs-provisional
constraints, the ballot-expressiveness ceiling, and the two-plane clarification.
**Read the ET-22 warning in `OPEN-QUESTIONS.md` before writing the first of
them:** a draft classifies receipt-freeness constraints as community-governable,
which contradicts merged normative text that says they survive any community vote.

Ticket discipline: one ticket = one branch = one PR = one session; fresh-context
review before merge; squash-merge. **STATE.md update note:** branch protection
now blocks direct pushes to master, so this file can no longer be committed
straight to master — update it in a small follow-up PR right after the ticket
merges (still separate from the feature branch, so parallel agents don't
conflict). Required checks to go green: `format / lint / typecheck`,
`diff-size`, `guard-tests`, `guard`.

## Blockers

- **None for T5.** Branch protection is **ON** (2026-07-19, ruleset
  `protect-master`): PR required, four status checks strict, linear history, no
  bypass. Both Phase-0 user actions are complete — T2's documented rules are
  now actually enforced.
- Not a blocker, but standing: **`hashing.md` has never been independently
  validated.** No review, audit, or ADR in this repo has checked the byte-level
  spec. It is settled only by T7's fresh-context Go verifier reproducing the
  fixtures and by T8's cross-language comparison. Do not let "T4 is merged" read
  as "the hashing is known correct".
- Housekeeping, no impact: seven merged/superseded branches remain on the remote
  (`chore/diff-size-exempt-docs`, `chore/model-routing-opus`,
  `claude/context-next-steps-fyd7uj`, `claude/hash-chain-schema-identity-7ngj28`,
  `claude/next-phase-prep-7i36uu`, `claude/t4-continuation-context-av08rn`,
  `contracts/T3-event-schema`). All content is on master or superseded. The
  session git proxy returns 403 on ref deletion, so these need deleting from the
  GitHub UI. Enabling "Automatically delete head branches" in repo settings
  prevents recurrence.
