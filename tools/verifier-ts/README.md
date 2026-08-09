# @odc/verifier-ts — second, independent ODC export verifier (TypeScript)

A standalone CLI that verifies an ODC NDJSON export against the frozen
`contracts/`. It is the **TypeScript** counterpart to the Go verifier: the two
are built in hard-isolated contexts from `contracts/` alone, so that agreement
between them is agreement about the _spec_, not a shared author's reading. This
package therefore imports **no** workspace package. Its only third-party runtime
dependency is `@noble/curves`, used **only** for the ET-4c prime-order subgroup
check (the one check `node:crypto` cannot do); every other primitive —
SHA-256, the Ed25519 verify predicate, the ET-4a/ET-4b integer comparisons — is
Node standard library.

## Usage

```sh
pnpm --filter @odc/verifier-ts build
node dist/src/cli.js verify <export.ndjson> [--head <64-lowercase-hex>]
```

Output and process exit codes (the exit code is **not** conformance-checked —
`evolution.md` EV-17 pins conformance on the verdict token and line number(s)
alone — but the CLI note fixes this scheme so the two verifiers agree):

| Verdict                | stdout                  | exit |
| ---------------------- | ----------------------- | ---- |
| VALID                  | `VALID`                 | 0    |
| INVALID (line N)       | `INVALID at line N`     | 1    |
| PARTIAL (lines …)      | `PARTIAL at lines a, b` | 2    |
| tool error (bad args…) | message on stderr       | ≥ 3  |

`--head` supplies the out-of-band anchored head. It is the ONLY way to detect
clean end-truncation, which is invisible from the export alone
(`export-format.md` EX-16): a prefix of a valid chain is itself a valid chain.

## What it checks

Two stages, per `evolution.md` EV-6/EV-15:

- **Stage A (type-agnostic, every line):** NDJSON framing and the single
  canonical byte form of each line (`export-format.md`), envelope well-formedness
  and strict rejection (`event-schema.md`), `seq` contiguity, `ts` calendar
  validity, `prev_hash` linkage, and `hash` recomputation over the byte-exact
  preimage (`hashing.md`). Parsing is done on the raw bytes, **not** via
  `JSON.parse`, which would silently accept duplicate keys, `1e2`/`1.0`, and lose
  key order.
- **Stage B (per registered `(type, version)`):** payload key-set, Ed25519
  signatures under the type's named key (with the ET-4a/ET-4b canonical-encoding
  and ET-4c prime-order checks run on the raw bytes _before_ the verify
  primitive), title/`choice_count`/`choice` bounds, and `issue_id`
  back-references. A well-formed but unregistered `(type, version)` yields
  `PARTIAL` for that line, never `INVALID` (EV-8).

## Tests

`test/fixtures.test.ts` drives every vector in `contracts/fixtures/index.json`
and asserts the declared verdict token and line number(s) only.

```sh
pnpm --filter @odc/verifier-ts test
```
