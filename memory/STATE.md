# ODC Core Build State

> Session-to-session truth for the **charter-governed core**: `contracts/`,
> `services/` and `tools/`. Pulse has its own entry, `memory/pulse.md`. Start at
> `memory/INDEX.md`.
>
> Current state only. Per-ticket history is in the cited squash commits, the
> reasoning is in `docs/decisions/`, and settled questions are in
> `memory/OPEN-QUESTIONS-archive.md`. Slimmed 2026-10-10. The narrative ledger
> it replaced is in git (`git log -p -- memory/STATE.md`).

## Where to jump

| You need                                          | Section                                                  |
| ------------------------------------------------- | -------------------------------------------------------- |
| What phase we are in and whether the gate is open | [Current phase](#current-phase)                          |
| What happens next, and what is owed               | [Next](#next)                                            |
| Whether ticket T*n* landed, and in which PR       | [Done](#done--one-line-each-detail-in-the-squash-commit) |
| Standing consequences of past decisions           | [Standing decisions](#standing-decisions--one-line-each) |
| Traps that bite a new session                     | [Blockers & live cautions](#blockers--live-cautions)     |

## Current phase

**Phase 1: ledger, verifier, identity.** Phase 0 is finished. T9 closed on
2026-10-21: the original audit (`docs/security/audit-phase-0.md`) returned
REQUEST CHANGES, answered as ADR-0013 to ADR-0018 (#98); three fresh re-audits
followed (#407, #414, #428), each APPROVE WITH NITS with zero BLOCKING, and the
operator accepted the third as the pass. T9a merged the same day: #429 moved
`contracts/` to **RELEASE CANDIDATE** (no `contracts-v1` tag) with the third
audit's T3-1 to T3-3; #430 reconciled the service guidance and
`docs/implementation-plan.md`; #432 made four operator-approved charter wording
changes. The T10 freeze and its re-audit stay deferred until real use (ADR-0007).

**Spec versions on master (2026-10-21; read the `Version:` lines, not prose):**
`event-schema.md` v8, `event-types.md` v17, `evolution.md` v12,
`export-format.md` v6, `hashing.md` v3, `ids.md` v2, `read-api.md` v4,
`fixtures/README.md` v18 (all #429). Changes now follow the release-candidate
rule in `contracts/README.md`: additive, version-bumped, and tolerated by
services.

**Both verifiers are done for Phase 1.** Go (`services/verifier`) and TS
(`tools/verifier-ts`) pass all **150** vectors (VALID 23, PARTIAL 15, INVALID
112). Vectors `146`-`150` (ill-formed UTF-8, HA-2) came in #410 with EV-26 and
ET-25. Conformance phases 1 to 4, ADR-0034 and ADR-0038 are in both; detail is
in the Done list below. The Go CLI takes `<file>` with no subcommand; the TS CLI takes
`verify <file>` (`.github/workflows/repo.yml`).

**The ledger is half merged.** Wave 1 merged 2026-10-23: storage #444
(INSERT-only table; CHECKs tie `seq`, `type`, `version`, `ts`, `prev_hash` and
`hash` to the stored line; a migration scan refuses UPDATE/DELETE/trigger
changes), canonical hashing and parsing #445, Ed25519 #446, the EV-26 checker
#447 (all 150 vectors fed line by line, tally asserted) and the signer client
#448. Wave 2 (read API and append core, write path, batching state, batcher,
wiring and the CI verifier step) is built and being opened as PRs. Every wave-1 PR had a fresh review before merge. The ledger
is built from `contracts/` alone and runs both verifiers only as outside
programs.

**ADR-0043 is accepted** (#438, clarified in #443): identity decides who may
vote; a separate **signer** service (planned, `services/signer/`) holds the
registrar key and no linkage map, and signs a sealed batch in one call that
chains the hashes; registrations move to a position-free
`participant_registered` v2 bound to the genesis hash; the signer uses
deterministic Ed25519 from a reproducible build. Charter §10 item 6 says so
(#439). Ledger choices (operator, 2026-10-21, chosen in chat; recorded only here until wave 2's `services/ledger/API.md` documents them): operator events by conditional
append (409 if the tail moved; the ledger holds no key), registrations refused
until v2 is in the contracts, and an operator-signed "close issue" call seals an
issue's last batch.

**Identity and the signer are unstarted.**

## Next

1. **Ledger wave 2**: review each PR fresh and merge. Owed nits from wave 1 ride
   in it (direct lone-surrogate test, byte-flip line-attribution test including
   LF, PARTIAL replay test, a loud alert on a signer 400, the README note on
   which columns are tied byte for byte).
2. **Contracts PR for `participant_registered` v2**: spec text in
   `event-types.md` with scoped exceptions to ES-32 and HA-16, both verifiers
   (each built in isolation), and vectors. Verifiers land with or before the
   vectors. Until it merges the ledger refuses new registrations.
3. **ADR-0043 owes one line**: the ledger-chosen `seal_id` that makes a seal
   call idempotent (in the ledger code, marked "ledger-proposed").
4. **Signer lead** (`services/signer/`, creates its README and CLAUDE.md) and
   **identity lead** (`services/identity/`). Open signer-API points from the
   ledger: refusal codes, a cheap "batch at minimum?" read, and whether a
   timed-out sign call fixes the batch's position.

Gates on the way: an `odc-security-auditor` audit before identity's first
merge; S-D (the anchor record) before the first anchor; S-G (key rotation and
the published test keys) before the freeze.

Optional, from ADR-0034 owed item 4: `docs/security/attacks/check-unknown-batching-proposal.py`'s
`proposed` mode now matches the ratified expectations and could join required CI.

**Owed with no ticket:**

- **Cloud setup/network draft** is saved but not yet reviewed, saved and
  published by the operator, so it does not persist. Confirm or drop.
- **Conformance coverage is thinner than the vector count suggests.** Count
  taken 2026-10-21 at 150 vectors: 168 rule ids defined, 95 cited by some
  vector, **73 cited by none**, no stale citations. By prefix (cited/defined):
  RA 0/13, ID 2/10, EV 11/26, HA 8/17, ES 22/34, ET 31/44, EX 21/24. The
  count takes rule ids that open a bold bullet in `contracts/*.md` (match
  `- **XX-N`, not `- **XX-N**`: most rules are written `**XX-N.**`) and the `cites`
  arrays in `fixtures/index.json`. Citation is an upper bound on coverage, not
  coverage itself. **Recount periodically**: a rule can be implemented
  everywhere and covered by nothing, with every suite still green. The read API
  has no vectors at all, so the ledger's own tests must cover it.
- **Ballot-expressiveness ADR part B** is owed by the operator, not a session.
  Its old default ("one-choice until argued otherwise") was withdrawn on
  2026-08-19, so the ceiling is deliberately open. v1 is unchanged. Read the
  ET-22 warning in `memory/OPEN-QUESTIONS-archive.md` before drafting it.

## Done — one line each, detail in the squash commit

- T1/T2 hooks, PR template and CI skeleton (#1, #2). Verifier, fixture,
  mockup, markdown and pulse paths are exempt from diff-size. Ceiling **1000**,
  warning at 400.
- T3/T4/T4a/T4b specs, verdict surface and ADR-0007 (#4, #6, #10, #12).
- T5 fixtures and encoders (T5a-T5j, #64). T6 rehearsal builder (#55). ADR-0008
  covers fixture freeze rules.
- Ed25519 predicate: ADR-0009 (#66, ET-4a/ET-4b) and ADR-0010 (#67, ET-4c
  prime-order keys).
- `registrar_pk` timing: ADR-0011 (#72, ET-9c), conformed in #75.
- T7 Go verifier (#69). T7b independent TS verifier (#78). T8 two-verifier
  rehearsal (#95, ADR-0012); its required CI runs the Go suite and the rehearsal.
- T9 audit and answers: ADR-0013 to ADR-0018 (#98). Charter §4 anchoring edit
  ratified 2026-08-15.
- Conformance phase 1 (ET-14b regeneration): #104, #105.
- Phase 2 (fork ancestry, ADR-0019 #112): #122 rehearsal judge, verifiers #123/#124, vectors
  `084`-`098` in #136/#137.
- Phase 3 (batching, ADR-0029): #172 rehearsal batches, #176/#180 contract,
  #177/#181 Go, #178 TS, vectors in #202. #201 fixed the rehearsal judge.
- Phase 4 (`--chain` and reporting): #220, #221, #222 and #203. #219 handles the
  TS exit code. #223 checkpoint, #224 `export-format.md` v5 (ADR-0032).
- EX-24 stored-claim reporting in both verifiers: #241 (`export-format.md` v5).
- ADR-0034 mixed-version batching: contract #294; Go #324 (#319), TS #325
  (#320); vectors `116`-`134` in #327 (#321). TS sub-quadratic cost is
  follow-up #326.
- ADR-0043 (registrar signer, v2 registration): #438, charter §10 #439, one-call
  batch signing #443. Ledger wave 1: #444-#448 (2026-10-23).
- ADR-0038 (the four contradictions, #355): contract #359, `genesis.contracts`
  cap #361. Go #370 (#364), TS #371 (#365), then ET-9f in both verifiers with
  the `086` flip and vectors `135`-`145` in #372 (#366), merged 2026-10-19.
- Verifier hardening: Go input-proportional memory (#369, PR #385), toolchain
  and dependencies (#382, PRs #383/#388), lazy TS ET-24b candidacy (#326, PR
  #390; one hostile shape stays quadratic, an accepted known limit).
- T9 re-audits: #407 (fixes #410: EV-26, ET-25 sealed batch, vectors
  `146`-`150`), #414 (fixes #417: NS-1, NS-3 to NS-5), #428 (accepted as the
  pass, 2026-10-21). S-C, S-D, S-G and NS-2 filed in OPEN-QUESTIONS (#409, #416).
- T9a: release candidate #429, guidance #430, charter wording #432.
- Memory index and `memory-index` CI guard (#117, #121).

## Standing decisions — one line each

- **ADR-0007:** DRAFTING, then RELEASE CANDIDATE at T9a (no tag), then FROZEN only
  at operational use. T10 re-audits any change made after the RC.
- **ADR-0008:** after the tag, golden data is add-only and `index.json` is
  append-only. Fixture `note` prose and `index.json` formatting **freeze too**, so
  correct a wrong note before the tag.
- **Fixture verdicts are DECLARED, never computed.** The generator holds no
  verifier. Conformance is the verdict token plus line number only (EV-17), so
  fixtures must never assert reason text or exit codes. No reason-code registry.
- **When a payload table and a numbered RFC-2119 sentence disagree, the sentence
  governs** (T5i).
- **ADR-0010:** stdlib only, except one named audited curve library per verifier,
  for ET-4c alone. The T10 re-audit re-measures both libraries.
- **ADR-0014 floors, confirmed by the operator 2026-08-15:**
  `ballot_batch_interval_ms` ≥ 60000 and `ballot_batch_min` ≥ 3. Values above
  them are per-issue and votable. Do not re-litigate.
- **Three different minimums.** The interval (ET-23) sets timestamp coarseness.
  `ballot_batch_min` (ET-24) is the anonymity parameter. **Quorum /
  `min_turnout` is NOT implemented, deliberately**: it addresses tally arithmetic
  (five votes at 3-2 with four known reveal the fifth), not timing. It can be
  added as an `issue_created` v2. The interim measure is a warning before casting.
- **ADR-0016/0019/0038:** nothing may be added to `genesis` after the tag.
  ET-9f is **both ancestry keys or neither** (ADR-0038 reversed ADR-0019's
  `ancestor_chain`-alone permission).
- **ADR-0038 limits are permanent** (EV-25): 65536-byte lines and depth 64
  never change. Exceeding one is never by itself a reason for `INVALID`, and no
  vector may go past them.
- **ADR-0029:** a ballot batch is a maximal run. Once left, it is closed.
- **ADR-0032:** existing file errors (structural and semantic) come before anchor
  mismatches. Endpoint reports are stored claims or unavailable.
- **Coupling rule:** fixtures may never precede verifiers. Verifiers may land
  alone when their new checks are no-ops on the committed corpus. A change that
  makes a key _required_ deadlocks both ways and must land together.

## Blockers & live cautions

- **The root ODC stack is a stub.** Root `docker-compose.yml` is `services: {}`,
  and `just smoke`/`just verify` are TODOs. Pulse's images are separate.
- **Never open `services/verifier/` and ledger source in one context.** Build each
  verifier in a **sparse worktree**: `git worktree add --no-checkout`, then
  `git sparse-checkout set --no-cone '/contracts/' '/services/verifier/' '/docs/charter.md'`,
  then check out. For TS, run `pnpm install` before narrowing, then delete the
  leftover untracked `node_modules` in `tools/fixtures-gen`, `tools/rehearsal` and
  `apps/`. Hand unmerged specs to builders as scratchpad copies. Isolated agents
  must not run git commands that list paths outside their tree (`git stash pop`
  and `git diff --stat` have leaked filenames).
- **When verifier stdout or stderr changes, check it against the rehearsal
  judge.** `conformanceVerdict` in `tools/rehearsal` matches with a regex and has
  aborted, rather than compared, on unexpected output four times. Widen the
  judge; do not couple the two verifiers on one output string. The stored-claims
  change (#241) touches stderr only.
- **Before a verifier enforces a new rule about chain shape, run the rehearsal
  chain through it.** The rehearsal chain must verify VALID in required CI, and
  isolated builders cannot read `tools/rehearsal`.
- **Node 24 on macOS can SIGSEGV on `process.exit()` after verifying.** Use
  `process.exitCode`, as #178 does. Keep #219's exit-3 regression tests.
- **Mutate before believing a suite.** Every "test that passed while reaching
  nothing" so far was found by mutation, not by reading. Synthetic in-verifier
  chains are self-consistent by construction, so a green unit test never pins a
  fixture-owed shape. Assert that a _legal_ optional key is accepted, too. A
  differential generator can lie about coverage, so print the verdict
  distribution first. A fixture can pin the right verdict on the wrong line, as
  `095` versus `096` showed.
- **Recorded so it is not re-litigated:** loosening `registrar_pk` to OPTIONAL in
  Go is an equivalent mutant. ET-9b rejects at the same line. Fixture warts
  `016-seq-gap`/`040-line-deleted` overlap at line 3, and that is deliberate.
- **When one PR lands two ADRs that touch the same spec, compare their normative
  sentences with each other**, not only each with the spec. #98 shipped
  ADR-0013/0016 contradicting each other seven lines apart. A contradiction with
  no verdict impact is the dangerous kind.
- **A PR can merge while its review fixes are still being written.** #176/#177
  did. Mark it draft (`gh pr ready --undo`) while fixes are pending, and check
  the PR is still open after pushing.
- **A guard whose scope is a hand-maintained list is blind where it matters.**
  That is why `memory-index.sh` discovers directories with `git ls-tree`.
- **Branch protection** is the `protect-master` Ruleset. It requires a PR and five
  strict checks (`format / lint / typecheck`, `diff-size`, `guard-tests`,
  `memory-index`, `guard`) and linear history. A required check that is never
  _created_ looks the same as one still running. Merging auto-deletes the head
  branch, so a later push creates a new branch with no PR. Agent sessions can
  delete remote branches.
- **The Pulse `conversation-http` test ran at 4.4-4.8 s on CI against a 5 s
  limit** and timed out on two ledger PRs; #450 gave it 30 s. A red
  `format / lint / typecheck` on a ledger PR can still be another package's
  test: read the log before fixing the PR.
- **After a squash merge, stacked branches conflict.** Rebase with
  `git rebase --onto origin/master <old-base-branch>`.
- **Turbo lint caching is disabled** (ADR-0042, #381), because import resolution
  depends on workspace metadata, shared configuration and symlinks.
- **The untracked root `AGENTS.md`** is switched off by `agentGuidance: false`
  (#240).
- **Tell dispatched agents to use the scratchpad for worktrees**, and commit
  before running a review or mutation agent, since reviewers edit and restore the
  tree.
- **Reviews:** fifteen of the first sixteen reviewed slices had a real defect.
  Treat a clean review as a surprise.
- **Remote branches (checked 2026-10-10):** the T9 branches and
  `claude/review-memory-context-skills-383f6i` are gone, so #98's granular history
  is lost. `claude/t9-phase3-et24-contiguity` and `claude/t9-phase3-verifier-go`
  belong to merged PRs and are safe to delete.
