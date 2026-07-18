---
name: odc-code-review
description: Code review procedure and checklist for ODC. Use this skill whenever reviewing a PR, diff, branch, or any code in the ODC monorepo, whenever the user asks "review this", and as the required pre-merge step for every change. Review runs in a FRESH context that did not write the code.
---

# ODC Code Review

## Procedure

1. Reviews run in a fresh session (Opus or Fable) that did not implement the
   change. Input: the diff, the PR description, the service's `API.md`, and
   `contracts/`. Not the implementation conversation.
2. Read the PR description first; if you can't tell what/why/how-tested,
   that alone is a blocking finding.
3. Walk the checklist below, then read the diff once more top-to-bottom for
   anything the checklist missed.

## Output format

Verdict first: **APPROVE** / **APPROVE WITH NITS** / **REQUEST CHANGES**.
Then findings, each tagged:
- `[BLOCKING]` correctness, security, charter, or boundary violation
- `[SHOULD]` worth fixing now, wouldn't block alone
- `[NIT]` style/preference — author may ignore
Every `[BLOCKING]` cites file:line and says concretely what to change.
Max ~10 findings; prioritize. A wall of nits is a failed review.

## Checklist

**Boundaries & contracts**
- No reads of another service's tables or private modules.
- No event schema drift: fields, types, hashing untouched, or a legal
  additive contracts change is included with version bump.
- New/changed endpoints are reflected in the service's `API.md`.

**Charter red flags (always blocking)**
- Any UPDATE/DELETE on event tables, or code paths that could produce one.
- Linkage-map data in any response, log line, metric, or error message.
- Ballot and sentiment data touching the same store, queue, or endpoint.
- Any way for a voter to PROVE a ballot's contents to a third party.
- Free-text user content written into the log (MVP).

**Security**
- Every mutating endpoint authenticates; signatures verified before append.
- Parameterized queries only; no string-built SQL.
- Keys and secrets never logged, never in fixtures, never in error output.

**Quality**
- Tests required by `odc-testing` are present and meaningful (assert
  behavior, not implementation details).
- Errors handled at boundaries; no swallowed exceptions; failure messages
  actionable.
- Diff size within `odc-pipeline` limits; unrelated changes split out.
