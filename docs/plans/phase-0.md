# Phase 0 Plan — Contracts, Enforcement, Genesis

**Written by:** odc-architect (Fable), 2026-07-18, from the full scaffolding
session's context. This document is self-sufficient: an Opus session holding
only one ticket below plus the listed reading should be able to complete it.

**Phase 0 exit:** contracts drafted → enforcement live → genesis rehearsal
passes clean → security audit → freeze (README flip + tag `contracts-v1` +
contracts-guard active). Only then does Phase 1 begin.

---

## Required reading, per session

Every ticket session reads, in order: `CLAUDE.md` → `memory/STATE.md` → this
plan (its own ticket at minimum) → `.claude/skills/odc-contracts/SKILL.md`.
Tickets touching CI/hooks also read `.claude/skills/odc-pipeline/SKILL.md`.
Tickets touching fixtures or the rehearsal also read
`.claude/skills/odc-testing/SKILL.md`. T7 (verifier) reads ONLY what its
ticket lists — its isolation rules override this section.

## Pinned decisions (made this session — do not relitigate; record as ADRs in T3)

| #   | Decision                                                                                                | Rationale (short)                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Hash: **SHA-256**, output **lowercase hex**                                                             | RFC 6962 / CT lineage; Merkle upgrade stays drop-in; stdlib in both languages (`crypto/sha256`, Node `crypto`)                                               |
| D2  | Signatures: **Ed25519**                                                                                 | Stdlib in both languages; small keys/sigs; deterministic signing                                                                                             |
| D3  | Preimage: **explicit byte-string construction with fixed field order** — NOT general canonical-JSON/JCS | JCS demands ECMAScript number serialization in Go (subtle, error-prone); a spelled-out byte layout is trivially implementable and testable in both languages |
| D4  | Hashed payloads: **no floats** — integers and UTF-8 strings only                                        | Removes the entire cross-language number-formatting problem                                                                                                  |
| D5  | Non-canonical input is **REJECTED**, never re-canonicalized                                             | One representation is valid; verifier verifies stored bytes as-is; "equivalent JSON" is INVALID                                                              |
| D6  | `ts`: RFC 3339 UTC, millisecond precision, trailing `Z`; advisory only (seq orders)                     | Pin one textual form so bytes are unique                                                                                                                     |
| D7  | NDJSON: UTF-8, no BOM, LF only, **final newline required**                                              | Every line identical in construction; no special last-line case                                                                                              |
| D8  | Repo goes **public on GitHub** before T5                                                                | Charter §9 (protocol as commons); unlimited free CI                                                                                                          |

Anything in `contracts/` not covered by D1–D8 is a drafting decision for T3–T4,
governed by the acid test: _could two conforming implementations produce
different bytes? Then the spec is not done._

## Ticket stack

Rules of engagement: one ticket = one branch = one PR = one session
(`odc-pipeline`). Branch names `contracts/T3-event-schema` style. Every PR
fresh-context reviewed (`odc-code-review`). Diff limits apply to code tickets;
spec tickets are exempt from line limits but not from review.

Order: T1 → T2 may run in parallel with T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10.
T4 blocks T5/T6. T6 blocks T7/T8. Nothing after T2 merges without CI green.

---

### T1 — Local hooks + PR template + workspace hygiene · odc-implementer

**✅ DONE 2026-07-19 — PR #1, squash `874bb4f`.** eslint uses typescript-eslint
(non-type-checked recommended) so `.ts` is actually linted while pre-commit
stays ~1.6s; `contracts/`, the Go verifier, and mockups excluded from both
prettier and eslint. Reviewed APPROVE WITH NITS; both [SHOULD]s fixed pre-merge.

- `lefthook.yml`: pre-commit = format+lint on staged files (<5s); pre-push =
  unit tests of changed services. `lefthook` added as root devDependency;
  `pnpm lefthook install` documented in README quickstart.
- `.github/PULL_REQUEST_TEMPLATE.md`: three sections — what changed / how
  tested / which contract version targeted.
- Root `package.json` scripts: `format`, `format:check`, `lint`, `typecheck`
  wired to turbo; prettier + eslint (flat config) added at root.
- Acceptance: fresh clone → `pnpm i && pnpm lefthook install` → a commit with
  a lint error is blocked locally; `pnpm lefthook run pre-commit` runs clean
  on the untouched repo.

### T2 — CI skeleton: contracts-guard + repo checks · odc-implementer

- **Prereq (user action): create the public GitHub repo and push `master`.**
  ✅ Done — public at github.com/Will-ODC/odc, remote set, `master` pushed.
  (Branch protection is still OFF; enable it at/after this ticket's merge —
  see "User (human) actions required" #2.)
- `.github/workflows/repo.yml`: on PR — format:check, lint, typecheck (stub
  passes with no packages yet), diff-size check (fail >800 changed lines,
  warn >400; lockfiles/generated exempt).
- `.github/workflows/contracts-guard.yml`: on PR touching `contracts/**` —
  fail unless the diff includes a version bump line in the touched spec AND a
  `contracts/CONTRACTS-CHANGE.md` entry; **hard-fail any edit to
  `hashing.md` or `fixtures/` once `contracts-v1` tag exists**.
- Branch protection documented in `docs/plans/phase-0.md` checklist for the
  user: require PR + green checks + 1 review, linear history, no direct
  pushes to master.
- Acceptance: a test PR touching `contracts/` without a changelog entry goes
  red; one with it goes green; a >800-line test PR goes red.

### T3 — Draft: event schema, IDs, event types · odc-implementer (Opus), reviewed by fresh context

- `contracts/event-schema.md`: fields `seq, type, version, payload, ts,
prev_hash, hash`; types and normative constraints per field; RFC-2119
  language; every normative sentence numbered (for fixture cross-reference).
- `contracts/ids.md`: `participant_id`, `issue_id` formats (derive from
  pubkey / from seq — drafting decision; must be case-stable and fixed-length).
- `contracts/event-types.md`: v1 registry — `participant_registered`
  (includes Ed25519 pubkey), `issue_created` (title only, operator-signed),
  `vote_cast` (signed). Payload field tables. No free-text beyond title (D4
  applies: payload values are ints/strings only).
- Write ADRs 0002 (hash+signature choice, D1/D2) and 0003 (preimage
  construction & strict rejection, D3–D5/D7) using `docs/decisions/0000-template.md`.
- Acceptance: acid-test walkthrough included per spec ("degrees of freedom
  closed" checklist from `odc-contracts` skill, each item explicitly
  addressed); no TODOs; genesis event (seq=1, prev_hash of 64 zeros —
  drafting decision, state it) defined.

### T4 — Draft: hashing, export, read API, evolution · odc-implementer, fresh session

**Prereq — resolve before drafting `hashing.md` (all three shape the frozen
bytes; see `memory/OPEN-QUESTIONS.md`):** (1) the verifier-scope / forward-compat
ADR — two-stage verification + a **generic** payload preimage over any flat
int/string payload, else future additive event types are unhashable and break
every frozen verifier (evolution rule, §8 fork/exit); (2) **ADR-0005**
(correction/retraction) human ratification — fixes whether the preimage must ever
accommodate a `supersedes` envelope field (proposed: no); (3) the
`latest-per-participant` tally inconsistency (plan §ledger vs ADR-0004's
unlinkable ballots), reconciled via ADR-0005 ballot finality.

- `contracts/hashing.md` (~1 page): the preimage as an exact byte-string
  construction (fixed field order, length-prefix or delimiter scheme —
  drafting decision, spelled byte-by-byte with a worked example); SHA-256;
  lowercase hex; what `prev_hash` of genesis is; hash covers which fields.
- `contracts/export-format.md`: hash-chained NDJSON per D7; the stored line
  IS the hashed bytes' carrier (strict mode, D5); `--head` semantics.
- `contracts/read-api.md`: `GET /events?since={seq}` — pagination, limits,
  ordering guarantee, response envelope.
- `contracts/evolution.md`: additive-only versioning; verifiers accept all
  published versions; hashing never changes retroactively.
- Acceptance: a reader can hand-compute the hash of the worked example with
  pencil and a SHA-256 tool; every normative sentence numbered; acid-test
  walkthrough included.

### T5 — Fixture generator + golden fixtures (TypeScript) · odc-implementer

- `contracts/fixtures/`: one vector per numbered normative sentence in
  T3/T4 specs + adversarial set (per `odc-contracts`: equivalent-JSON reject,
  wrong hex case, float in payload, CRLF line, missing final newline,
  reordered keys, wrong prev_hash, duplicated seq).
- `tools/fixtures-gen/` (TS, workspace package): generates vectors from the
  spec rules; committed output is reviewed by hand against the specs' worked
  examples before merge. **Golden values never regenerate to make anything
  pass** (`odc-testing`).
- Format: each vector = input event JSON + expected preimage bytes (hex) +
  expected hash + expected verdict (VALID/reason-coded INVALID).
- Acceptance: `pnpm --filter fixtures-gen test` recomputes and matches all
  committed vectors; the T4 worked example appears verbatim as vector 001.

### T6 — Rehearsal chain builder (TypeScript, throwaway) · odc-implementer

- `tools/rehearsal/`: builds a throwaway chain (register N participants,
  create issues, cast signed votes — randomized with seed), exports NDJSON,
  computes head; `just rehearsal-build` target.
- Includes the tamper tool: applies each case of the `odc-contracts` tamper
  matrix to a given export by flag.
- Chain property test per `odc-testing` (multiple seeds) against its own
  export using fixture-derived hashing code.
- Acceptance: builder round-trips (build → self-verify via TS implementation
  → all fixtures pass); tamper tool produces each matrix case
  deterministically by seed.

### T7 — Throwaway Go verifier · **odc-verifier-builder — FRESH CONTEXT, HARD ISOLATION**

- Session may read ONLY: `contracts/*.md`, `contracts/fixtures/`, its own
  `services/verifier/` dir, `docs/charter.md` §4, and this ticket's text.
  NOT T5/T6 source, NOT this plan's other tickets, NOT any prior discussion.
- Go, stdlib only. `verify <export.ndjson> [--head <hash>]` →
  `VALID` | `INVALID at line N` (+ reason code). Exit codes 0/1.
- Must pass every fixture (valid AND adversarial verdicts) from
  `contracts/fixtures/` alone.
- Every ambiguity the builder hits is reported as a numbered spec-bug list in
  the PR description — that list is a deliverable, not a failure.
- Acceptance: `go test ./...` green using only fixtures as test data;
  verifier binary correct on all fixtures; spec-bug list (possibly empty)
  delivered.

### T8 — Rehearsal execution + spec iteration loop · odc-navigator orchestrates; odc-architect (Fable) arbitrates spec edits

- Run: T6 build → export → T7 verifier → expect VALID; full tamper matrix →
  expect each INVALID at correct line; cross-language check: TS and Go
  fixture hashes byte-identical.
- Any mismatch or T7 spec-bug → Fable session edits the spec (new numbered
  sentence or amended one), T5 regenerates affected vectors (legal only
  pre-freeze), T7's builder re-runs **in a new fresh context** if
  `hashing.md` changed materially. Loop until one clean pass end-to-end.
- Wire `just rehearsal` to run the whole loop; keep scripts (they seed
  `just smoke` and nightly chain-smoke).
- Acceptance: one fully clean pass, logged as `docs/decisions/0004-genesis-rehearsal.md`
  (what iterations were needed — the record of what the prose got wrong).

### T9 — Security audit gate · odc-security-auditor — fresh context

- Target: `contracts/` + fixtures + rehearsal results. Checklist per agent
  definition, plus Phase-0-specific: does any spec field leak identity into
  the public log? Is receipt-freeness compromised by any spec artifact? Can
  the operator equivocate within the spec as written?
- Acceptance: verdict APPROVE (or findings fixed and re-audited).

### T10 — Freeze · odc-navigator, same day as T9 approval

- `contracts/README.md` status flip to FROZEN; git tag `contracts-v1`;
  contracts-guard hard-fail mode confirmed active (test PR proves it);
  `memory/STATE.md` flipped to Phase 1 with its parallel streams
  (ledger · verifier · identity); `CONTRACTS-CHANGE.md` initialized.
- Acceptance: all three freeze mechanics verifiably in place; a test PR
  touching `hashing.md` goes red.

---

## User (human) actions required

1. Before T2: create the public GitHub repo, add remote, push `master`. ✅ Done.
2. After T2: enable branch protection per the checklist below.
3. T10 is the last chance to change hashing cheaply. Skim `hashing.md` and
   the worked example before approving the freeze.

### Branch-protection checklist (enable after T2 merges)

The CI that T2 adds (`repo`, `contracts-guard`) only has teeth once master
requires it. On GitHub → Settings → Branches → add a rule for `master`:

- [ ] **Require a pull request before merging**, with **1 approving review** — no direct pushes to `master`, including the operator (odc-pipeline).
- [ ] **Require status checks to pass**, and **Require branches to be up to date** — mark required: `format / lint / typecheck`, `diff-size`, and `guard-tests` (from `repo`), and `guard` (from `contracts-guard`). `guard-tests` must be required: it protects the guard scripts themselves, so a change that quietly defangs `contracts-guard.sh` can't merge on a still-green `guard`.
- [ ] **Require linear history** — squash-merge only; matches the one-ticket-one-commit merge log (odc-pipeline).
- [ ] **Do not allow bypassing the above** — apply the rule to administrators.
- [ ] Leave **Allow force pushes** and **Allow deletions** off.

`contracts-guard`'s `guard` check runs on every PR and passes immediately when
no `contracts/` file changed, so it is safe to require without blocking
unrelated PRs. Verify with T2's own acceptance PRs before turning the rule on.

## Out of scope for Phase 0

Any code in `services/` beyond the throwaway `verifier` rehearsal build; any
Merkle tree work; blind signatures; moderation; anchoring automation (manual
anchor of head hash in the GitHub repo README is fine at genesis).
