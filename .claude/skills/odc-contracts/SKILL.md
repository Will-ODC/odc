---
name: odc-contracts
description: Spec-writing and canonical-hashing discipline for contracts/, including the genesis rehearsal gate. Use this skill whenever drafting or editing anything in contracts/, defining event schemas, hashing rules, serialization, export formats, or fixtures, and when preparing or running the genesis rehearsal before freeze.
---

# ODC Contracts Discipline

The one domain where a confident agent will produce something subtly wrong,
and where wrong is permanent by the project's own definition. Slow down here.

## Spec style

- Normative RFC-2119 language (MUST/MUST NOT/SHOULD). No "typically" or "usually".
- Every normative sentence is paired with a test vector in `contracts/fixtures/`.
- Acid test before calling a spec done: **could two conforming implementations
  produce different bytes? Then the spec is not done.**
- Specs must be implementable in TypeScript AND Go from the text alone.
  Anything that only works in one language is a spec bug.

## Serialization pitfalls checklist (all MUST be pinned explicitly)

- The hash preimage is spelled as a **byte-string construction**, never
  "hash the JSON".
- UTF-8 only. Key ordering rule stated. Unicode normalization stated.
- No floats in hashed payloads — integers or decimal strings only.
- Hex is lowercase. `ts` format pinned (RFC 3339 UTC, precision stated).
- NDJSON: LF only, no trailing whitespace, final-newline rule stated.
- Empty vs null vs absent field: distinguished explicitly, per field.
- Semantically-equal JSON with different bytes: decide whether it hashes
  differently or is REJECTED as non-canonical — and say which, with a vector.

## Golden fixtures

Every rule gets a vector in `contracts/fixtures/`: canonical events with
precomputed hashes, plus at least one adversarial vector per pitfall above.
Fixtures are consumed by every service's CI (`golden-fixtures` stage) and by
the verifier. **Cross-language gate:** identical fixture hashes must be
independently reproduced in TypeScript and Go before freeze.

## Genesis rehearsal (the exit gate — a checklist, not a vibe)

1. Build a throwaway chain against the draft contracts (one context).
2. Export it. Verify it with a throwaway Go verifier built by
   `odc-verifier-builder` from the drafts ALONE (fresh context).
3. Run the tamper matrix — each case must yield INVALID at the right line:
   byte flip · line deletion · line reordering · truncation · duplicated seq ·
   wrong prev_hash · re-serialized-but-equivalent line · wrong `--head`.
4. Every ambiguity either implementation hit becomes a spec edit; then the
   rehearsal RERUNS from step 1.
5. Freeze = status flip in `contracts/README.md` + git tag `contracts-v1` +
   `contracts-guard` CI live. All three, same day, or it isn't frozen.

Keep the rehearsal scripts: they seed `just smoke` and the nightly chain-smoke.
