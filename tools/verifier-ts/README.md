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
  primitive), title/`choice_count`/`choice` bounds, the `ballot_batch_interval_ms`
  and `ballot_batch_min` floors an `issue_created` declares (ET-14b), and `issue_id`
  back-references. A well-formed but unregistered `(type, version)` yields
  `PARTIAL` for that line, never `INVALID` (EV-8).

One event escapes that split. At **line 1** the registration check is Stage A
(EV-15/EV-20): a `genesis` whose `(type, version)` this verifier does not
register is `INVALID` at line 1, never `PARTIAL`, because `operator_pk` and
`registrar_pk` are declared in a genesis payload the verifier could not read, so
nothing on the chain could be authenticated. That rejection carries an advisory
reason (EV-21) naming the version encountered and the `genesis` versions this
verifier registers, and saying plainly that "my registry is old" and "this
genesis is hostile" are indistinguishable from the log alone. Reason text is
never conformance-checked (EV-17).

The `genesis` payload key set is **not** an exact set: `ancestor_head` is
OPTIONAL (ES-34, ET-9e) — absent, or present as 64 lowercase hex that is not the
64-zero anchor — and is a recorded claim the verifier checks the format of and
nothing else. A key outside required ∪ optional is still rejected (ES-18). The
two genesis keys must also be distinct (ET-9d): one string equality on the
lowercase hex, no key material involved.

## Tests

`test/fixtures.test.ts` drives every vector in `contracts/fixtures/index.json`
and asserts the declared verdict token and line number(s) only. It is the sole
conformance oracle: `test/robustness.test.ts` and `test/rules.test.ts` invent no
`VALID` verdict and sign nothing. `test/rules.test.ts` records this
implementation's reading of EV-20 / ET-9d / ET-9e until the vectors for those
land, and labels each case as discriminating or not.

```sh
pnpm --filter @odc/verifier-ts test
```
