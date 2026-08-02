# Phase 0 Plan — Contracts, Enforcement, Genesis

**Written by:** odc-architect (Fable), 2026-07-18, from the full scaffolding
session's context. This document is self-sufficient: an Opus session holding
only one ticket below plus the listed reading should be able to complete it.

**Phase 0 exit (amended 2026-07-25, ADR-0007):** contracts drafted → enforcement
live → genesis rehearsal passes clean → security audit → **RELEASE CANDIDATE**.
Phase 1 begins there. The **freeze** — README flip to FROZEN, tag `contracts-v1`,
guard hard-fail active — is a separate, later event gated on real operational use,
not on T9 alone. See ADR-0007 for the readiness signals and the required
re-audit.

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
  expected hash + expected verdict. The verdict is a token plus line
  attribution — `VALID`, `INVALID` at line N, or `PARTIAL` at lines [...] —
  per `contracts/evolution.md` EV-7/EV-17. **A vector MUST NOT assert reason
  text or a process exit code**: conformance is judged on verdict token and
  line number alone, and no reason-code registry exists (EV-17). Vectors
  exercising the unregistered-type path MUST use an `x_`-prefixed `type`
  (EV-18).
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
- Acceptance: builder round-trips (build → self-verify → the chain property
  test above passes across multiple seeds against the builder's own export);
  tamper tool produces each matrix case deterministically by seed.
- **T6 does NOT build a TypeScript verifier** (decided 2026-07-28). "Self-verify"
  means: recompute each event's hash, check the `prev_hash` links and the
  signatures of the chain this builder just built, and attribute a failure to a
  line. It does NOT mean emitting the three conformance verdicts or executing
  the 73 declared fixture verdicts — T7 is the first ticket that emits those
  conformance verdicts (the ticket order itself is unchanged: T6 → T7 → T8).
  The reason is **independence, not cost**: a TS verifier written by a context
  that has already read `encode.ts`/`serialize.ts` inherits any misreading those
  files contain, so it self-verifies green and proves nothing. ADR-0007's freeze
  signal wants two _independent_ verifiers; building one here spends the
  independence before it can be collected. Note that T8's "cross-language check"
  compares fixture **hashes**, not verdicts, and is already satisfiable with
  `fixtures-gen`. A second, independent TS verifier gets its own ticket — fresh
  context, contracts-only, the same treatment T7 gets — before the freeze.
  **That ticket is now `T7b` below** (added 2026-08-02).

### T5j — `ET-9b`: the genesis key format, and the vectors that pin it · odc-implementer

**Why this ticket exists.** `genesis`'s `operator_pk` and `registrar_pk` are
constrained to `^[0-9a-f]{64}$` **only in the `genesis` payload table**. No
numbered `ET-n` sentence states it. `ids.md` ID-3 does exactly this job for the
other public key on the chain — `participant_registered.pubkey` — and nothing
does it for these two. ID-1/ID-2 do not reach them either: those govern
_identifiers_ (`participant_id`, `issue_id`, `chain_id`), and a public key is not
an identifier.

**The constraint is already normative** — `CONTRACTS-CHANGE.md` (T5i) ruled that
payload tables are normative and named this exact case as one where the table is
the sole source. So this ticket does not _create_ a rule. It gives an existing
one a numbered home so a fixture can cite it, and — the part that actually
protects anything — **ships the fixtures that make omitting it detectable.**
Today no vector asserts `INVALID` on a malformed genesis key, so a verifier that
skips the check passes 75/75 with no signal.

**Deadline.** `evolution.md` EV-1 forbids altering a frozen `(type, version)`
schema, so `ET-9b` cannot be added after the `contracts-v1` tag — deferring past
the tag does not postpone it, it makes it unaddable and leaves the constraint
table-only permanently. Note the asymmetry ADR-0008 introduced: post-tag you
could still add the _vectors_, but not the _sentence_, leaving fixtures citing a
rule that does not exist.

**Run it before T7, not merely before the tag.** T7 builds the Go verifier from
`contracts/` alone in hard isolation, and these fixtures exist precisely to catch
that build omitting the check. Landing them afterwards means T7 was written blind
to them, T8 surfaces it, and a material spec change obliges T7's builder to
re-run **in a new fresh context** — spending the isolation twice for something
avoidable.

- **The sentence.** Add `ET-9b` to `event-types.md`, worded to mirror `ids.md`
  ID-3 rather than invented fresh: both keys are 32-byte raw Ed25519 keys
  (RFC 8032) carried as 64-lowercase-hex strings, rejected and never lowercased
  to conform (D5). `event-types.md` v3 → v4, plus a `CONTRACTS-CHANGE.md` entry.
  No byte, preimage or existing verdict changes, so nothing regenerates.
  (`ids.md` is a defensible alternative home, since ID-3 is the precedent; the
  decision here is to keep the genesis rules together with ET-7/ET-8/ET-9a.)
- **Two vectors, and the malformation is the design.** Use an **uppercase-hex**
  key. It is still valid hex decoding to the same 32 bytes, so `chain_id` still
  derives correctly (ET-7), the genesis self-signature still verifies (ET-8), and
  the line is canonical with a matching `hash` — **the ONLY thing wrong is the
  case.** That is the isolation `033-prev-hash-uppercase` and `036-hash-uppercase`
  already have for their fields. A wrong-LENGTH key does not isolate: it breaks
  hex decoding, so the derivation and the signature fail too, reproducing `042`'s
  problem of a vector that cannot separate the rule it names from the ones it
  trips incidentally.
- **One vector per key, not one for both.** `registrar_pk` is the one an
  implementation forgets — it does not enter `chain_id` and is unused until a
  ballot arrives. Same asymmetry `074`/`075` exist to catch.
- **The generator wrinkle, which is where the work actually is.** Since PR #22
  `chainId()`/`participantId()` REJECT uppercase hex, so the builder cannot
  simply be handed one; and uppercasing after the fact with `editLine` is wrong,
  because `hash` covers the payload string, so the digest would mismatch and the
  vector would fail for two reasons. `genesis()` needs an option that writes a
  differently-cased key string into the payload while signing and deriving from
  the real decoded key — the same shape as how `059-chain-id-not-derived` builds
  a deliberately wrong `chain_id`. Reuse that mechanism; do not re-derive it.
- **The construction above is verified, not assumed** (2026-08-02, while writing
  this ticket). Building a `genesis` whose payload carries the uppercase key
  while signing and deriving from the decoded key gives: `hash` recomputes,
  signature verifies under that key, `chain_id` equals `sha256(decoded bytes)`,
  and the string fails `^[0-9a-f]{64}$` while matching `^[0-9a-fA-F]{64}$`. And
  `chainId()` does reject the uppercase string, so the builder option really is
  needed — it is not an accident of the current code that can be skipped.
- Acceptance: `ET-9b` merged with `event-types.md` at v4 and a changelog entry;
  two new vectors whose declared verdict is `INVALID` at line 1; each verified to
  fail for the format rule ALONE — hash, signature and `chain_id` all valid on
  the same line; `fixtures-gen` and `fixtures-manifest` green; fresh-context
  review before merge.

### T7 — Throwaway Go verifier · **odc-verifier-builder — FRESH CONTEXT, HARD ISOLATION**

- Session may read ONLY: `contracts/*.md`, `contracts/fixtures/`, its own
  `services/verifier/` dir, `docs/charter.md` §4, and this ticket's text.
  NOT T5/T6 source, NOT this plan's other tickets, NOT any prior discussion.
- Go, stdlib only. `verify <export.ndjson> [--head <hash>]` → one of the three
  verdicts in `contracts/evolution.md` EV-7/EV-17: `VALID`, `INVALID at line N`,
  or `PARTIAL` naming the affected lines. Exit codes 0/1/2 respectively, ≥3 for
  tool-level errors. Any reason text is advisory and is not conformance-checked
  — do not invent a reason-code registry; none exists (EV-17).
- Must pass every fixture (valid AND adversarial verdicts) from
  `contracts/fixtures/` alone.
- Every ambiguity the builder hits is reported as a numbered spec-bug list in
  the PR description — that list is a deliverable, not a failure.
- Acceptance: `go test ./...` green using only fixtures as test data;
  verifier binary correct on all fixtures; spec-bug list (possibly empty)
  delivered.

### T7b — Second independent verifier (TypeScript) · **odc-implementer — FRESH CONTEXT, HARD ISOLATION**

**Why this ticket exists.** ADR-0007 §5 names two independent verifiers agreeing
on a non-synthetic chain as a freeze-readiness signal, and T6's scope decision
closes with "a second, independent TS verifier gets its own ticket — fresh
context, contracts-only, the same treatment T7 gets — before the freeze." Until
now that commitment lived only in prose and in `memory/OPEN-QUESTIONS.md`, with
no ticket number and no slot in the stack. This is that slot. (Found by the
fresh-context review of T6a, 2026-07-29; ticketed 2026-08-02.)

**Isolation is the entire deliverable.** A TS verifier written by a context that
has already read `tools/fixtures-gen/src/encode.ts` or `serialize.ts` inherits
whatever misreading those files contain, self-verifies green, and proves
nothing. Two implementations that agree because they share an author's
misreading are one implementation wearing two hats.

- Session may read ONLY: `contracts/*.md`, `contracts/fixtures/`, its own new
  directory, `docs/charter.md` §4, and this ticket's text. **NOT**
  `tools/fixtures-gen/` (any file), **NOT** `tools/rehearsal/`, **NOT**
  `services/verifier/` (T7's Go source), **NOT** this plan's other tickets,
  **NOT** `memory/STATE.md`, **NOT** any prior review or discussion.
- The isolation is against `services/verifier/` too: T7b must not be a
  transliteration of T7. Independence is per-context, not per-language.
- New directory, outside both existing tool packages — suggested
  `tools/verifier-ts/`. Do not extend `@odc/fixtures-gen`; sharing a package
  invites sharing an import.
- TypeScript, Node stdlib only (`node:crypto` for SHA-256 and Ed25519). No
  dependency on any workspace package. Same CLI contract as T7:
  `verify <export.ndjson> [--head <hash>]` → `VALID`, `INVALID at line N`, or
  `PARTIAL` naming the affected lines (`evolution.md` EV-7/EV-17); exit codes
  0/1/2, ≥3 for tool-level errors. Reason text is advisory and is NOT
  conformance-checked — no reason-code registry exists (EV-17).
- **Two TS-specific traps this ticket exists to catch**, both invisible to a
  reader who has internalised the JS defaults:
  - `JSON.parse` silently accepts input the spec rejects (duplicate keys keep
    the last, `1e2` and `1.0` parse as numbers, key order is lost). The
    canonical-bytes checks (EX-7/EX-8/EX-10) cannot be delegated to it.
  - String length in JS is UTF-16 code units, but ET-14 counts Unicode scalar
    values. Vectors 072/073 decide this; a `.length` implementation fails them.
- Must pass every fixture from `contracts/fixtures/` alone, on the declared
  verdict token and line number only.
- Every ambiguity hit is reported as a numbered spec-bug list in the PR
  description — a deliverable, not a failure. **Where that list overlaps T7's,
  the overlap is the signal**: two isolated readers tripping on the same
  sentence means the sentence is wrong, not the readers.
- Acceptance: `pnpm test` green using only fixtures as test data; correct on all
  73 vectors; spec-bug list (possibly empty) delivered; a reviewer can confirm
  from the diff that no workspace package is imported.

**Ordering.** After T7, before T10. It is NOT a blocker for T8 — T8's
cross-language check compares fixture **hashes**, not verdicts, and is already
satisfiable with `fixtures-gen`. It IS owed before the freeze decision, since
ADR-0007 §5's "two independent verifiers" signal cannot otherwise be evaluated.
Per ADR-0007 §5 that signal is "a signal for a human judgment call, not an
automated gate" — so T7b gates the freeze decision, not T9 or T9a.

### T8 — Rehearsal execution + spec iteration loop · odc-navigator orchestrates; odc-architect arbitrates spec edits

- Run: T6 build → export → T7 verifier → expect VALID; full tamper matrix →
  expect each INVALID at correct line; cross-language check: TS and Go
  fixture hashes byte-identical.
- Any mismatch or T7 spec-bug → `odc-architect` session edits the spec (new numbered
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

### T9a — Release candidate · odc-navigator, same day as T9 approval

**This, not T10, is what immediately follows the audit** (ADR-0007).

- `contracts/README.md` status flip DRAFTING → **RELEASE CANDIDATE**;
  `memory/STATE.md` flipped to Phase 1 with its parallel streams
  (ledger · verifier · identity). **No tag.** `contracts-guard`'s freeze branch
  stays dormant, so specs remain fixable while Phase 1 builds on them.
- Phase 1 services build against the release candidate and MUST tolerate an
  additive contracts change during this period.
- Acceptance: status flipped, Phase 1 unblocked, no `contracts-v1` tag exists.

### T10 — Freeze · odc-navigator — **deferred; gated on operational use, not on a date**

Do **not** schedule this after T9. It runs when the ADR-0007 readiness signals
hold: roughly three binding votes on a live chain, four weeks with no
event-shape change, two independent verifiers agreeing on a **non-synthetic**
chain (T7's Go verifier and **T7b**'s TypeScript one — T7b must have landed, or
this signal cannot be evaluated at all), and a clean T9 re-audit of the exact
tree to be tagged.

- Re-run the T9 audit on the delta accumulated since release candidate. A clean
  re-audit with an empty delta is cheap; skipping it is not an option, because
  T9's original approval covered a tree that may since have changed.
- `contracts/README.md` status flip RELEASE CANDIDATE → FROZEN; git tag
  `contracts-v1`; contracts-guard hard-fail mode confirmed active (test PR
  proves it).
- Acceptance: all three freeze mechanics verifiably in place; a test PR touching
  `hashing.md` goes red; a test PR **adding** a new fixture goes green (the
  freeze blocks edits, not additions).

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
