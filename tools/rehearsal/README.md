# `@odc/rehearsal`

Build tooling for the Phase 0 genesis rehearsal. Never shipped, never imported
by a service.

It builds a throwaway hash-chained event log from a seed, exports it as
canonical NDJSON, damages it in one of eight documented ways, and checks its own
output. Its purpose is to give T7's Go verifier a chain that is larger and less
tidy than the 75 hand-built vectors in `contracts/fixtures/`, and to give T8 a
cross-language comparison target.

## What it is not

**There is no verifier here, and none is coming.** `selfVerify` checks the chain
this package just built. It emits no `VALID`/`INVALID`/`PARTIAL` verdict,
executes none of the 75 fixture verdicts, and implements no `EV-17` precedence.
T7's Go verifier — written in a fresh context from `contracts/` alone — is the
first thing in this repo that judges an export.

That is a deliberate constraint, and the reason is independence rather than
effort. A TypeScript verifier written by a context that has already read
`encode.ts` and `serialize.ts` inherits whatever misreading those files contain,
so it agrees with itself and proves nothing. `docs/plans/phase-0.md` T6 records
the decision; ADR-0007's freeze signal wants two _independent_ verifiers, and a
second TypeScript one is ticketed separately as **T7b**.

## Usage

```bash
just rehearsal-build              # seed 1, default shape, export to stdout
just rehearsal-build 7            # seed 7
just rehearsal-build 7 "--case byte-flip --out tampered.ndjson"
just rehearsal                    # both verifiers, clean + all eight tampers
just rehearsal 7                  # reproduce the complete loop with seed 7
node tools/rehearsal/dist/src/cli.js --help
```

`just rehearsal` is the T8 gate. It builds the Go verifier and the standalone
TypeScript verifier, then invokes both as external processes over the clean
export and every tamper case. It compares only EV-17's verdict token and line
attribution; advisory reason text is deliberately ignored. No verifier source
or workspace implementation is imported into the other.

The export goes to stdout (or `--out FILE`); the summary goes to stderr, so
piping the export stays byte-clean.

| flag                                          | meaning                                         |
| --------------------------------------------- | ----------------------------------------------- |
| `--seed N`                                    | chain seed; the whole chain is a function of it |
| `--participants N`, `--issues N`, `--votes N` | the chain shape                                 |
| `--case NAME`                                 | apply one tamper case                           |
| `--tamper-seed N`                             | seed for `--case` (defaults to the chain seed)  |
| `--out FILE`                                  | write the export here                           |

Exit codes: `0` ok, `2` usage error, `3` the tool contradicted itself.

## The eight tamper cases

`byte-flip`, `line-deletion`, `line-reordering`, `truncation`, `duplicated-seq`,
`wrong-prev-hash`, `reserialized-line`, `wrong-head` — the matrix in
`.claude/skills/odc-contracts`. Each leaves **exactly one** defect, and reports
the 1-based line a verifier must attribute it to.

Two of them are worth knowing about because they change no event values:
`reserialized-line` transposes two envelope keys, so the line still parses to
the same event and its hash still verifies — only `EX-7`'s byte-exact reading
rejects it. `wrong-head` mutates no bytes at all; the export is untouched and
the head is wrong.

## Modules

| file        | what it owns                                                         |
| ----------- | -------------------------------------------------------------------- |
| `rng.ts`    | SplitMix32. Seeded, deterministic, and the only source of randomness |
| `build.ts`  | which events a chain contains — never how they are encoded           |
| `tamper.ts` | which line each attack lands on — never how the bytes are cut        |
| `verify.ts` | recompute hashes, walk `prev_hash`, verify signatures, name the line |
| `cli.ts`    | flags, and the cross-check that `run` and `selfVerify` agree         |

Every byte is constructed by `@odc/fixtures-gen`: event building, hashing,
signing and serialization all live there, so this package cannot drift into a
second implementation of `hashing.md`.

## Testing notes

Two rules this package's history earned the hard way, both in `odc-testing`
terms and both worth re-reading before changing anything here:

**Do not pin a seed as a regression test.** T6b pinned five, and the same commit
changed how many draws `maxLengthTitle` consumed, which shifted the whole
downstream stream. The seeds silently stopped having the property they guarded
and four mutations survived a green suite. Sweep thousands of seeds and assert a
structural invariant instead.

**Assert generator constants against the spec's literals**, not against values
that happened to be drawn. Widening `MAX_CHOICE_COUNT` from 64 to 65 once stayed
green, because six seeds × five issues has a ~62% chance of never drawing the
illegal value. A bound checked only by sampling is not checked.
