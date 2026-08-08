# ODC Build State

> Single source of session-to-session truth. Read first, update last, keep short.
> History belongs in git and ADRs, not here — per-ticket detail is in the cited
> squash commits, normative decisions in `docs/decisions/`, and recurring
> review-defect shapes in session memory (`odc-review-lessons`).

## Current phase

**Phase 0 — Contracts.** Nothing may be implemented in services/ until
contracts/ passes the genesis rehearsal and reaches **RELEASE CANDIDATE**
(ADR-0007). The `contracts-v1` freeze is deferred until real operational use —
T5–T9 proceed on schedule; only the tag waits. `contracts/` is **DRAFTING**.

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
- **The Ed25519 canonical-encoding predicate was NOT part of this ticket** — see
  "Next" #1. ET-9b is hex-string format only; the RFC 8032 divergence question is
  still open.

## Direction decisions — see the ADRs; carry-forward consequences below

- **ADR-0007** — freeze deferred to operational use; three states DRAFTING →
  RELEASE CANDIDATE (entered at T9; Phase 1 builds against it, no tag, specs stay
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

**T5j COMPLETE (#64).** Remaining Phase 0, in order:

1. **Ed25519 verification predicate — DECIDE BEFORE T7 STARTS.** NOT closed by
   T5j: `ET-9b` fixed only the genesis keys' hex-string format (case/length). The
   RFC 8032 divergence is still open — non-canonical `R`/`A`/`S` encodings,
   small-order / non-prime-order public keys, and cofactored vs cofactorless
   verification. Go's `crypto/ed25519` and Node's `node:crypto` can disagree on
   identical bytes, both conformant, and nothing in `contracts/` pins ours; T7 (Go)
   and T7b (TS) would each silently take their library's default. Direction set
   (OPEN-QUESTIONS): **measure, do not reason from memory** (Go 1.24.7 + Node in
   the container); prefer making the divergence **unreachable** (reject
   non-canonical / non-prime-order keys as a format check, à la ET-14a) over
   adjudicating a predicate. Any vectors go under EV-5, built T5j-style (each fails
   for ONE reason). **No v1 fixture may freeze a verdict that depends on these
   edge cases** — a wrong frozen verdict is unfixable. Full write-up in
   `OPEN-QUESTIONS.md`.
2. **Then:** T7 (Go verifier, fresh-context isolation) → T7b (2nd TS verifier) →
   T8 (rehearsal loop) → T9 (security audit) → T9a (RC → Phase 1). T10 deferred.

**Owed with no ticket (how the last backlog rotted):** the **structure-aware fuzz
as a committed test** — value-level, not byte-level (a byte fuzzer misses the
crash class a value fuzz finds instantly). Bundle with #57's six deferred
envelope-guard survivors (`verify.ts:93-102`, same class) and point both at
T7/T8's briefs.

**Coverage is thinner than 77 vectors suggests.** ~60 of ~125 rule ids have no
citing vector. Real gaps for T7's brief: `ES-30`–`ES-32` (sig field), `ET-3`–
`ET-5`, `EX-14` (head), most of `ids.md`, `EV-11`–`EV-14` (correction/retraction,
incl. EV-13's ballot-plane prohibition). **`HA-7` is cited by no vector** despite
six notes invoking it. Strong on what it covers, silent elsewhere — not a
complete conformance suite.

**Two known fixture warts, deliberately unfixed** (`016-seq-gap` and
`040-line-deleted` overlap at line 3; `016`'s bytes carry `seq [1,2,4,4]`).
Recorded so a reader does not re-flag them; fix only if the set is renumbered
before freeze.

**Owed by the operator, not a session:** the ballot-expressiveness ceiling ADR
part B (part A landed; default until argued otherwise is "ballots stay
one-choice") and the other queued direction ADRs. **Read the ET-22 warning in
`OPEN-QUESTIONS.md` before writing the first.**

**Four unlanded branches deliberately KEPT** (`contracts/` untouched by all):

| branch                                        | for                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `claude/odc-security-posture-audit-urgrjs`    | T9 input (creates `docs/security/`)                                         |
| `claude/review-memory-context-skills-383f6i`  | `odc-keys-and-signatures` skill + `odc-code-review` rewrite, still unlanded |
| `claude/skills-agents-memory-mr-29f4dt`       | forbids agent-performed merges; may be a live session                       |
| `claude/golden-fixtures-voting-verify-7urqku` | fully mined 2026-08-02 — **deletable**                                      |

## Blockers & live cautions

- **Branch protection ON** (`protect-master`): PR required, four strict checks
  (`format / lint / typecheck`, `diff-size`, `guard-tests`, `guard`), linear
  history, no bypass. **STATE.md updates ride their own follow-up PR** — feature
  branches conflict, so update this file after the ticket merges.
- **Every reviewed slice has had a real defect — fifteen for fifteen.** Treat a
  clean review as the surprise. (Defect shapes: session memory
  `odc-review-lessons`; PR/merge handoff: `pr-handoff`.)
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
