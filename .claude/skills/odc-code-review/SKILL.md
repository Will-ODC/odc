---
name: odc-code-review
description: Review procedure and checklist for ODC — code, specs in contracts/, and ADRs. Use this skill whenever reviewing a PR, diff, branch, or any change in the ODC monorepo, whenever the user asks "review this", and as the required pre-merge step for every change. Review runs in a FRESH context that did not write the change.
---

# ODC Review

The fresh-context review is this project's substitute for a second engineer. It
is the only gate between an agent's confident output and a permanent record, so
it has to actually find things — an approval that read nothing costs more than
no review at all.

## Inputs and isolation

- A fresh Opus session that did **not** write the change. Input: the diff, the
  PR description, the target service's `README.md`/`API.md`, `contracts/`, and
  `docs/charter.md`. **Never** the implementation conversation.
- If the diff touches `services/verifier/`, the reviewing context must never
  have opened `services/ledger/` or any other service's source — verifier
  independence is a property of what a context has _seen_. If yours has, say so
  and stop; the review needs a different session.
- Read the PR description first. If you cannot tell what changed, why, how it
  was tested, and which contract version it targets, that alone is
  `[BLOCKING]` — do not reverse-engineer intent from the diff and review the
  change you inferred.

## Method: verify, don't read

Reading a diff and agreeing with it is not a review. For anything checkable,
check it:

- **Recompute, never trust.** Any hash, preimage, digest, `participant_id`, or
  signature in a diff or a spec's worked example gets reproduced independently
  from `contracts/` — with your own tool, not by reading the author's number
  twice. A worked example that "looks right" is the failure mode this project
  cannot afford.
- **Run the tests, then break them.** Confirm a test that claims to cover the
  change actually fails without it (for a bug fix, that the regression test was
  written first). A test that passes against the old code proves nothing.
- **Trace one full path** end to end rather than skimming every file evenly —
  for an endpoint, request → auth → validation → storage → response.
- Check claims in the PR description against the diff. "Tests added" and "no
  contract change" are claims, not evidence.

## Output format

Verdict first: **APPROVE** / **APPROVE WITH NITS** / **REQUEST CHANGES**.
Then findings, each tagged:

- `[BLOCKING]` correctness, security, charter, or boundary violation
- `[SHOULD]` worth fixing now, wouldn't block alone
- `[NIT]` style/preference — author may ignore

Every `[BLOCKING]` cites file:line, names the rule, contract sentence
(`ES-7`, `HA-14`), or charter principle it violates, and says concretely what
to change. Max ~10 findings; prioritize. A wall of nits is a failed review, and
so is "LGTM" on a diff you did not verify.

## Always blocking, regardless of category

- Any UPDATE/DELETE on event tables, or a code path that could produce one.
- Linkage-map data in any response, log line, metric, or error message.
- Ballot and sentiment data touching the same store, queue, or endpoint.
- Any way for a voter to PROVE a ballot's contents to a third party — including
  a returned `seq`, event `hash`, or signature echo.
- Free-text user content written into the log (MVP).
- **A changed golden value**: any modification to an existing file under
  `contracts/fixtures/`, or an edited hash/signature constant in a test. Golden
  values are never regenerated to make something pass (`odc-testing`) — a
  mismatch means the code is wrong or the contract changed illegally. Additions
  are legal; edits, deletions and renames are not.
- `memory/STATE.md` edited on a feature branch (it is updated on master at
  merge time — `odc-pipeline`).

## Checklist — every diff

- **Boundaries:** no reads of another service's tables or private modules; no
  imports from another service's source; shared types come from `contracts/`.
- **Contracts:** no schema, hashing, or serialization drift — or a legal
  additive change with a version bump and a `CONTRACTS-CHANGE.md` entry.
  Reinterpreting an existing sentence is not additive.
- **Docs:** new/changed endpoints reflected in `API.md`; behavior changes
  reflected in `README.md`.
- **Scope:** one reviewable idea; diff within `odc-pipeline` limits; unrelated
  changes split out.

## Checklist — code diffs

- **Security:** every mutating endpoint authenticates; signatures verified
  before append (`odc-keys-and-signatures` for anything touching a key, `sig`,
  or `pubkey`); parameterized queries only; keys and secrets never logged,
  never in fixtures, never in error output.
- **Storage:** migrations explicit and forward-only; runtime role has no
  UPDATE/DELETE on event tables; grants live in the migration
  (`odc-storage`).
- **Tests:** the cases `odc-testing` requires are present and assert behavior,
  not implementation details; names state behavior.
- **Failure handling:** errors handled at boundaries; no swallowed exceptions;
  messages actionable and free of internal identifiers.

## Checklist — spec and ADR diffs (`contracts/`, `docs/decisions/`)

Most of Phase 0 is prose, and prose is where the permanent mistakes are made.

- **The acid test, per changed sentence:** could two conforming implementations
  produce different bytes or different verdicts? Then the spec is not done.
- RFC-2119 language, every normative sentence numbered, no "typically"/"usually",
  no TODOs.
- Implementable from the text alone in **both** TypeScript and Go. A rule that
  leans on one language's semantics is a spec bug.
- Cross-references resolve, and the sentences they point at still say what the
  new text claims (`odc-contracts`).
- **Nothing contradicts already-merged normative text.** If it does, that is
  `[BLOCKING]` even when the new wording is better — the conflict gets resolved
  deliberately, not silently by the newer file. Check `memory/OPEN-QUESTIONS.md`
  for standing warnings before approving.
- An ADR states context, decision, consequences, and a charter check; a decision
  that changes phase status also says so.

## After the review

- Record the verdict on the PR. `[BLOCKING]` and `[SHOULD]` findings are fixed
  **before** merge, not tracked as follow-ups; `[NIT]`s are the author's call.
- Re-review after fixes only if the fix changed logic, spec bytes, or a test's
  meaning — not for wording or formatting.
- A finding that needs design work rather than an edit goes in
  `memory/OPEN-QUESTIONS.md` (or an ADR) and is named in the review, so it
  outlives the PR thread.
