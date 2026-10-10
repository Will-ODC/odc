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

**Phase 0, Contracts. The T9 security-audit gate is CLOSED.** T9 returned
REQUEST CHANGES (six findings, `docs/security/audit-phase-0.md`); all six were
answered in the specs as ADR-0013 to ADR-0018 (#98). Only a **fresh re-audit**
clears T9. Nothing may be implemented in `services/` until T9 and T9a. The ledger
is unstarted.

**Spec versions on master (2026-10-10; read the `Version:` lines, not prose):**
`event-schema.md` v5, `event-types.md` v11, `evolution.md` v6,
`export-format.md` **v5** (#224, ADR-0032), `hashing.md` v2, `ids.md` v1,
`read-api.md` v1, `fixtures/README.md` v14. `contracts/` is **DRAFTING**.

**Conformance phases 1 to 4 are merged.** The corpus is **115 vectors** (VALID 21,
PARTIAL 4, INVALID 90). Phase 3 batching vectors `099`-`108` came in #202; phase 4
(`--chain` and genesis/head reporting, EX-21 to EX-24) came in #220 (Go), #221 (TS)
and #222 (vectors `109`-`115`). #203 reconciled EV-15's stage map. #219 made a TS
internal error exit 3, not 1. #223 is the security checkpoint
(`docs/security/hash-chain-checkpoint-2026-10-09.md`).

## Pending fixture review (2026-10-10)

At the operator's request, `contracts/fixture-consistency-review` records an
unmerged fixture prose audit. See [fixture review](fixture-review.md) for
confirmed findings, validation, limitations, and the merge handoff. Golden
bytes and expected verdicts are unchanged; this does not clear T9.

## Next

In this order. Passing CI or a checkpoint does not clear T9.

1. **Merge #241 (Go + TS): both verifiers conform to `export-format.md`
   v5 EX-24.** stderr becomes `genesis hash (stored claim): …` /
   `head hash (stored claim): …`; strict UTF-8, last repeated `hash` wins,
   `\u` escapes decode. 504-run black-box parity. stdout is unchanged, so no
   vectors are needed (EX-24 is not conformance surface, EV-17). The decoding
   gaps are in `memory/OPEN-QUESTIONS.md` → "EX-24 claim decoding".
2. **Decide mixed-version ballot batching.** The proposal
   (`docs/plans/hash-chain-unknown-ballot-batching.md`, #225) is **PROPOSED, not
   ratified**. Its one-event/one-ballot evolution constraint, its uncertainty
   algorithm and its wider PARTIAL attribution all need an operator decision
   before anyone builds them. → `memory/OPEN-QUESTIONS.md`, "Future `vote_cast`
   versions and ballot batching".
3. **Decide the four open `contracts/` contradictions** (see Blockers).
4. Verifier implementations of what (2) and (3) decide, built in isolation. Then
   the fixtures.
5. **Fresh T9 re-audit** by a context that did not write `audit-phase-0.md`.
   Acceptance is APPROVE.
6. **T9a: release candidate.** Flip `contracts/README.md` from DRAFTING to RELEASE
   CANDIDATE, reconcile implementation/charter/service guidance, and move this
   file to Phase 1 (ledger, verifier, identity). **Do not create a `contracts-v1`
   tag.** The T10 freeze and its re-audit stay deferred until real use (ADR-0007).

**Owed with no ticket:**

- **Cloud setup/network draft** is saved but not yet reviewed, saved and
  published by the operator, so it does not persist. Confirm or drop.
- **Conformance coverage is thinner than the vector count suggests.** The last
  exact count, taken at T9 when the corpus held 83 vectors: 143 rule ids, 73
  cited by no vector. It has not been re-run since. Gaps include **all of
  `read-api.md` (RA-1 to RA-13)**, ES-30 to ES-32, ET-3, EX-14, most of `ids.md`,
  and EV-11 to EV-14. Citation is an upper bound on coverage, not coverage itself.
  **Count citations against the rule index periodically.** A rule can be
  implemented everywhere and covered by nothing, with every suite still green.
- **Ballot-expressiveness ADR part B** is owed by the operator, not a session.
  Its old default ("one-choice until argued otherwise") was withdrawn on
  2026-08-19, so the ceiling is deliberately open. v1 is unchanged. Read the
  ET-22 warning in `memory/OPEN-QUESTIONS-archive.md` before drafting it.
- **`odc-verifier-builder`'s role definition says Go only**, but it was also used
  for the TS verifier. Either add a TS builder role or scope this one to "either
  verifier, never both".

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
- **ADR-0016/0019:** nothing may be added to `genesis` after the tag. The
  `ancestor_chain`-alone asymmetry (ET-9f) is deliberate.
- **ADR-0029:** a ballot batch is a maximal run. Once left, it is closed.
- **ADR-0032:** existing file errors (structural and semantic) come before anchor
  mismatches. Endpoint reports are stored claims or unavailable.
- **Coupling rule:** fixtures may never precede verifiers. Verifiers may land
  alone when their new checks are no-ops on the committed corpus. A change that
  makes a key _required_ deadlocks both ways and must land together.

## Blockers & live cautions

- **Four `contracts/` contradictions need an operator decision.** None changes a
  committed verdict, so nothing automated will catch them.
  1. **`contracts/` bounds nothing.** No sentence limits nesting depth, line
     length or key count, or says what a verifier does past its limits. The Go
     verifier's depth-64 bound has no spec behind it. Proposed `evolution.md`
     text: a verifier MAY impose limits that cannot change a verdict, and MUST
     report a verdict or a tool error (exit ≥ 3) instead of crashing.
  2. **EV-21's advice is unreachable for `genesis`.** ET-6 pins it at version 1,
     yet the TS verifier tells users to "fetch a newer verifier".
  3. **ET-7a reads as both-or-neither** for the ancestry keys, which is the tidy
     version ET-9f forbids.
  4. **ET-9f's stated justification does not select its rule.** The real
     criterion is naming: a name without a position is coherent, but a position
     without a name refers to nothing.
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
- **`turbo` caches `lint`.** Run `npx eslint` directly after moving files. turbo's
  untracked root `AGENTS.md` is switched off by `agentGuidance: false` (#240).
- **Tell dispatched agents to use the scratchpad for worktrees**, and commit
  before running a review or mutation agent, since reviewers edit and restore the
  tree.
- **Reviews:** fifteen of the first sixteen reviewed slices had a real defect.
  Treat a clean review as a surprise.
- **Remote branches (checked 2026-10-10):** the T9 branches and
  `claude/review-memory-context-skills-383f6i` are gone, so #98's granular history
  is lost. `claude/t9-phase3-et24-contiguity` and `claude/t9-phase3-verifier-go`
  belong to merged PRs and are safe to delete.
