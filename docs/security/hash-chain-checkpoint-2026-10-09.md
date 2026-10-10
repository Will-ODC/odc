# Hash-chain security and context checkpoint

**Verdict: REQUEST CHANGES before T9 can clear.** This is a progress review,
not the independent phase-gate re-audit. Passing tests do not resolve the
contract questions below.

**Initial checkpoint:** 2026-10-09. **Latest validation:** 2026-10-10 UTC.
**Latest merged tree checked:** `f13c8cd`.
**PR #203 conflict resolution examined:** `83a6224`, merged as `25ff5af`.

## Scope and boundaries

Read the core memory, contracts, charter guidance, original T9 audit, retained
attack documentation, current PR descriptions and dependency/CI configuration.
Performed black-box checks of both merged CLIs and the local pipeline after
#222. Neither verifier's implementation source was opened for this checkpoint.
The original independent audit
remains `audit-phase-0.md`; this context has read design discussions and cannot
substitute for its required fresh-context successor.

Ledger is not implemented and must remain untouched until T9/T9a. No HTTP
linkage-leak or storage-authority audit of ledger/identity is possible today.
The operator is merging pending PRs; Claude completed #222's conflicts and owns Pulse,
and Codex owns this core checkpoint. Pulse files and memory are unchanged.
The old local Codex verifier scratch checkouts mentioned in memory are not
available in this cloud checkout and were not recovered or merged.

## Checkpoint 1: #203

**Self-review: APPROVE.** Rebased the one-commit EV-15 clarification onto
`151c36d`, preserving both its evolution v6 changelog entry and #202's fixtures
v13 entry. Only `contracts/evolution.md` and `CONTRACTS-CHANGE.md` differ from
that base. Stage A names EX-21–EX-23; EX-24 remains a tool-output requirement,
not a new verdict rule. No fixture bytes, hash construction or event fields
changed. Pushed `83a6224` with an explicit force-with-lease on the old PR tip.

Local checks passed: formatting, lint, typecheck, all workspace tests with
required PostgreSQL tests enabled, Go tests, contracts guard, diff-size,
memory-index and 39 guard tests. The pre-push hook passed after activating the
prepared tools and creating the cloud checkout's missing local `master` ref.
The hook selected no package tasks for this documentation-only diff; the
separate workspace test run executed the tests. The five required remote checks were confirmed green on `83a6224` through
GitHub's public checks page, not inferred from the old commit's results.

## Current progress and merge order

Phase 3 is complete: #202 added `099`–`108`. #222 added `109`–`115`, giving
**115 fixtures** (21 VALID, 4 PARTIAL, 90 INVALID), fixtures v14.
The phase-2 count of 98 and phase-3 count of 108 are historical. #201 fixed
unordered PARTIAL lines in the rehearsal judge. #219 fixed TS internal errors
being labelled INVALID. #220 merged Go chain identity/reporting in `85f767f`.

**Context update:** #221 merged as `b3491e3`, #203 as `25ff5af` and #222 as
`660201a`. #222's final merge contains fixture/generator work and fixture-runner
coverage, with no carried verifier implementation changes. Both fixture runners
and the manifest check pass. Recheck master before each operation: merges are concurrent.

Pushed follow-ups, rebased after #222: `codex/core-security-checkpoint-20261009`
([#223](https://github.com/Will-ODC/odc/pull/223)),
`codex/hash-chain-anchor-policy` ([#224](https://github.com/Will-ODC/odc/pull/224), `942d00c`) and
`codex/hash-chain-unknown-batching-proposal` ([#225](https://github.com/Will-ODC/odc/pull/225), `86cc615`). Merge in that order,
then decide the batching details before isolated implementations and fixtures.
These PRs are pending merge. GitHub API access was initially blocked by the
environment proxy, then recovered on the final recheck, allowing draft PR creation.
Required remote checks must pass on each current head before readiness/merge;
consult live PR results rather than inferring success from an earlier head.
A narrow `api.github.com` addition and reusable setup instructions are saved in
the environment draft; publishing the setup remains a separate user action.

## Decisions and security findings still outstanding

1. **[DECIDED; amendment pending merge] EX-24 reporting on broken input.**
   `contracts/export-format.md` EX-24 says to report the genesis hash and head
   "it computed", while EX-14/EX-21 define the stored first/last hash fields.
   A genesis-only file with its `hash` field changed is INVALID, but the merged
   Go CLI reports that changed field as both genesis and head, not the original
   recomputed hash. This matches #220's documented policy; it is not evidence
   that the reported values were verified. For unparseable endpoint lines,
   #220 reports `unavailable`, which the contract has not defined.

   Approved decision: explicitly identify reports as claimed stored fields,
   define unavailable values, and require consumers to use them with the verdict.
   Any recomputed value should have a distinct label. Do not call a value
   authenticated merely because it appears in stderr. Amend the versioned
   contract, then pin hash mismatch, unparseable/missing endpoints and
   VALID/INVALID/PARTIAL reporting in each independent verifier's tests.

2. **[DECIDED; amendment pending merge] Expected-chain precedence.** EX-22/EX-23
   require a wrong expected chain to be INVALID at line 1; unlike EX-15's head
   comparison, they do not say to wait until file checks pass. The merged Go
   CLI preserves an existing error at line 2 when a wrong `--chain` is also
   supplied. #220/#221 disclose this choice, and #222 deliberately omits the
   ambiguous cases. #203 fixes the stage map, not this ordering question.

   Approved decision: preserve structural parse/link errors before comparing
   external anchors, documenting that condition explicitly as for `--head`.
   Once a structurally usable export reaches anchor comparison, a wrong chain
   should dominate a wrong head at line 1. Specify semantic-error precedence
   explicitly: the operator chose to preserve existing semantic errors too. Pin wrong-chain
   plus structural error, wrong-chain plus semantic error, both flags wrong,
   and PARTIAL plus wrong-chain before treating the policy as settled.

3. **[BLOCKING before RC] Unknown ballot versions can change batch verdicts.**
   The recorded question in `memory/OPEN-QUESTIONS.md` remains unresolved.
   Example: two v1 ballots and an unknown v2 ballot at T1, then three v1 ballots
   at T2, with minimum three. An old reader ignores the v2 payload and can
   reject at the first T2; a newer reader may count v2 and accept. EV-8 forbids
   INVALID solely because an event version is unknown.

   Recommended direction: permanently require batching for every registered
   ballot version, and define how an old verifier propagates uncertainty from
   opaque ballots into batch counting/closure. The uncertainty includes whether
   an unknown ballot ends a run or resumes a closed instant, not just whether
   it adds a third member. Decide the full policy before implementing it in
   isolated verifier contexts and adding discriminating fixtures.

4. **[SHOULD, operator decisions] Resolve the recorded contract contradictions.**
   Resource-limit/error policy, EV-21's impossible newer-genesis advice, ET-7a's
   apparent both-or-neither ancestry wording, and ET-9f's naming rationale are
   still recorded as open. Distinguish resource/tool failures from INVALID and
   PARTIAL. Reconcile adjacent normative sentences and version/log amendments;
   a prose change without verdict impact still matters to a third implementer.

5. **[SHOULD, retained privacy risks] Batching is not complete unlinkability.**
   ET-21 already records the registrar-controlled signature subliminal channel
   and adjacency between registration and ballots. Distinct genesis keys do not
   prove separate custody. Low-turnout tally inference is separate from batch
   minimums. Preserve these disclosed v1 trust limits; do not claim the chain
   proves anonymity or honest registrar behaviour. The read API's RA rules
   require later HTTP conformance/privacy tests, not NDJSON-only fixtures.

## Personal-information and dependency checks

An initial targeted scan examined **318 tracked files** in `contracts/`,
`services/`, `tools/`, `docs/`, `memory/`, CI and agent guidance. It checked
email literals, user-directory paths, Claude session links, private-key headers
and common GitHub/AWS/OpenAI token forms, reporting locations rather than secret
values. It found no matching token literals, private-key headers or session URLs.
The four non-reserved-domain email matches were in Pulse mockups and were left
for that workstream. No such email match occurred in the hash-chain scope.

Six machine-specific Desktop checkout references in core memory were removed
while retaining branch names and commit provenance. These were unnecessary
local context, not evidence of leaked credentials. Published deterministic test
seeds and synthetic participant keys are deliberately public test material;
they must remain clearly labelled and must never become production keys.

This scan is not a comprehensive secret audit, a check of untracked credential
files, or a rewrite of Git author metadata/history. Real names, indirect personal
information and unrecognised credential formats are not ruled out by these
patterns. No history was rewritten. `pnpm audit --prod` reported zero known
advisories across its workspace production dependency set at this checkpoint;
that does not assess Go dependencies or prove cryptographic correctness.
A follow-up token/private-key-header scan of 322 tracked files, including the
merged #220 files and this checkpoint, also found zero matching literals.

## Reproducing the reporting observations

Build from `services/verifier` with the prepared Go toolchain:

```sh
go build -o /tmp/odc-verify .
```

From the repository root, run:

```sh
python3 docs/security/attacks/probe-phase4-reporting.py /tmp/odc-verify
```

The probe uses existing immutable fixtures and a temporary hash-mismatch file.
It never regenerates golden data. It asserts established verdict/report shape
and prints the observed outcomes for the unresolved policy choices above.

## Operator decisions during this checkpoint

The operator approved formalising stored-claim/unavailable reporting and
structural-error precedence, then chose to preserve existing registered-event
semantic errors ahead of anchor mismatch too. These are authorised for a
separate versioned contract amendment; the amendment is not yet merged.
The operator also approved preparing a mixed-version batching proposal and
regression cases, not silently treating that proposal as a ratified protocol.
Claude completed #222's conflict resolution. New contract/changelog work follows
the merged #203/#222. After #221 merged, the same reporting probe
was run against its built TS CLI and reproduced both observations.

## Checkpoint 2: approved anchor policy

**Self-review: APPROVE.** `codex/hash-chain-anchor-policy` versions
`export-format.md` to v5, records ADR-0032 and preserves #203/#222 changelog
entries. Stored endpoint claims are distinguished from verified hashes; missing
or unparseable claims are unavailable. Existing structural and semantic errors
retain their line ahead of either anchor. Both wrong anchors on an otherwise
eligible export are INVALID at line 1. Both CLIs pass all 16 policy checks,
including PARTIAL reports and malformed endpoints. Required CI now runs these
functional checks in that branch. Golden bytes and verifier sources are unchanged.

## Checkpoint 3: mixed-version batching proposal

**Self-review: APPROVE as a proposal, not protocol ratification.**
`codex/hash-chain-unknown-batching-proposal` declares eight reproducible cases
outside the golden corpus. Both current CLIs pass all eight baseline cases and
fail the same three proposed expectations (membership, opacity, closure).
Generators reproduce byte-for-byte. The permanent one-ballot bound, uncertainty
algorithm and expanded PARTIAL attribution require a decision and independent
implementations. This is not evidence of a complete streaming algorithm.

Local pipeline-equivalent checks on `f13c8cd` passed: formatting, lint,
typecheck, all workspace tests (1,234 total, no skips, including required
PostgreSQL tests), Go tests/vet, manifest, contracts/diff guards, memory-index,
39 guard tests and the 9 scenarios × 2 verifiers rehearsal. Script-specific
lint and both black-box suites passed. No new remote CI result is inferred from
these local results. This review leaves the T9 gate closed.

## Next checkpoint

Review the three follow-up PRs and verify required remote checks
on each current head before merging. Record merged outcomes without promoting
pending work to Done. Resolve the remaining contract questions, with isolated
implementation/review where needed, and rerun
the complete pipeline and rehearsal. A fresh-context T9 auditor must approve
the final tree before RC; no ledger implementation or `contracts-v1` tag belongs
in this work.
