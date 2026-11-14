# TypeScript verifier test-quality audit — cf07079

Assessment: substantial, useful coverage, but the green suite does not establish several important rejection and decoding properties. Three deliberately incorrect verifier mutations survived the full suite. Strengthen these tests before treating conformance green as evidence that the corresponding checks remain implemented. This is a test-assurance audit, not a claim that the unmodified verifier currently mishandles these examples.

## Scope and isolation

Fresh independent verifier context. Audited only `/workspace/odc-audit-ts`: all 15 `tools/verifier-ts/test/*.test.ts` suites, both shared builders, all ten verifier source modules, verifier README/package/tsconfig, applicable root and `.claude` role/testing/review instructions, `contracts/` normative verification rules and fixture metadata, `docs/charter.md` §4, and required root/.github build metadata. No ledger, other verifier, fixtures-generator, rehearsal, or other service/tool source was read. No delegation, issue creation, commit, or verifier fixes. Only temporary verifier-source fault injections were performed, with byte-for-byte restoration in `finally`.

There is no verifier-local CLAUDE.md in this sparse tree. The verifier-builder isolation exception overrides the root memory-reading protocol. No forbidden cross-implementation comparison contributed to these findings.

## Prioritized findings

### 1. [P2] ES-20 hour/minute rejection can disappear without a failing test

Locations: `tools/verifier-ts/src/parse.ts:248` and `:275`; `tools/verifier-ts/test/ballot-batching.test.ts:95`; `tools/verifier-ts/test/fixtures.test.ts:52`. Contract: `contracts/event-schema.md:116` (ES-20).

The exhaustive year/month/leap-boundary Date comparison is for **epoch conversion of already valid timestamps**, not for the parser's rejection of impossible calendar instants. Golden vectors 030–032 test format, February 30, and leap second, but no hour-24 or minute-60 rejection. These are actual untested boundaries, not merely uncited rules: ES-20 is cited and tested elsewhere.

**M1, confirmed full-suite survivor:** changed only `if (hour > 23)` to `if (hour > 99)` and `if (min > 59)` to `if (min > 99)`. `pnpm --filter @odc/verifier-ts test` still passed **404/404** (54.886 s). A correctly hashed `x_calendar` event at line 2 after fixture 001, with either `2026-01-01T24:00:00.000Z` or `2026-01-01T23:60:00.000Z`, then incorrectly returned `PARTIAL [2]`, whereas ES-20 requires `INVALID at line 2`.

Add parser rejection tests and correctly hashed full-export cases for hour 23/24 and minute 59/60, alongside valid controls. Expand month/day lower and upper bounds and non-leap century dates using the same isolation principle; those additional holes are a review hypothesis, not individually mutation-proven here. A malformed timestamp appended with a stale hash is weaker because HA-14 could hide a missing calendar gate.

### 2. [P2] Explicit canonical crypto gates are not independently tested

Locations: `tools/verifier-ts/src/crypto.ts:32` and `:45` (original source); `tools/verifier-ts/test/fixtures.test.ts:52`; golden metadata entries 078–080 in `contracts/fixtures/index.json`. Contracts: ET-4a/ET-4b/ET-5, `contracts/event-types.md:46`, `:70`, `:149`.

No suite directly imports the canonical-key or canonical-signature predicates. Golden 079 and 080 explicitly call themselves **non-discriminating**: Node's verification primitive already rejects their invalid S/R. Golden 078's noncanonical identity encoding is now also rejected by the subsequent prime-order check. Thus end-to-end INVALID assertions can remain green after removing the checks the contract requires to run on raw bytes before the primitive.

**M2, confirmed full-suite survivor:** inserted unconditional `return true` at the start of **both** `isCanonicalKeyEncoding` and `isCanonicalSigEncoding`; all **404/404** tests still passed. This is evidence of a gate/order assurance gap, not proof of a currently accepted bad signature under Node 20. The downstream primitive and curve library mask the missing explicit checks on this runtime; relying on them defeats the contract's stated purpose of making library-dependent noncanonical behavior unreachable.

Add independent raw-byte unit boundaries for masked A/R at p−1 and p, S at L−1 and L, both sign-bit cases, and length failures. Use literal boundary integers from the contract rather than the implementation constants. A focused seam test should also establish that malformed encodings do not reach the primitive; direct predicate tests alone would not catch removal of their call sites. Preserve end-to-end golden tests as the verdict oracle.

### 3. [P2] Extreme-value tests accept silent corruption and mostly stop before their named behavior

Locations: `tools/verifier-ts/test/extreme-values.test.ts:85`, `:118`, `:188`, `:214`; `tools/verifier-ts/test/robustness.test.ts:29`; `tools/verifier-ts/src/parse.ts:106`. Contracts: HA-2 and EV-23/EV-24.

The extreme generator has 19 cases, not broad semantic fuzzing. Its genesis builder uses a placeholder hash/signature and equal placeholder keys. Every generated input is already INVALID on its first line: huge strings stop at HA-14, non-1 sequence cases at parsing/contiguity, many-line cases at their first malformed/incorrectly hashed record, deep nesting at parsing, and many-key cases at HA-14. The `many-valid-lines` case repeats seq 1 and prev_hash zero. Since verification stops on the first fatal record, it never grows per-line semantic/PARTIAL state, regardless of how many lines the Buffer contains. The 300,000-line limits test does reach that state correctly; this finding does not erase its coverage.

`assertWellFormedVerdict` deliberately accepts any VALID/INVALID/PARTIAL value. It therefore cannot detect the class of silently wrong INVALID that the file's own introduction says motivated it. The separate 200,000-character parser regression asserts exact value preservation, but only for ASCII.

**M3 reproduction:** at the parser's 8192-code-point flush, replace any chunk containing non-ASCII with the same number of `?` characters, leaving ASCII untouched. A canonical unknown event carrying `"pad":"é"` repeated 9000 times is only **18,246 bytes**, within the compulsory 65536-byte minimum. Independently constructed HA-1/HA-5/HA-7/HA-11 bytes and SHA-256 give its correct hash. The mutant changes the parsed value and returns `INVALID at line 2` (HA-14) instead of required `PARTIAL [2]`. **M3 also survived the full suite: 404/404 passed (52.582s).**

Use valid fixture-genesis + correctly hashed unregistered-event contexts for unbounded strings and keys; assert preserved parser values and PARTIAL line sets. Include multi-byte/astral/escape-heavy values crossing the internal chunk boundary. For integer range tests, use an unregistered payload value so seq contiguity does not mask numeric-boundary behavior. Crash-only cases are still useful, but their names and documentation should state the stage reached.

### 4. [P3] Supersession comments are stale; some synthetic coverage now duplicates independent fixtures

Locations: `tools/verifier-ts/test/genesis-contracts.test.ts:8`, `tools/verifier-ts/test/genesis-key-distinctness.test.ts:10`, `tools/verifier-ts/test/ballot-batching.test.ts:7`, `tools/verifier-ts/test/genesis-ancestry.test.ts:5`.

The contracts suite says no committed vector reaches 64 bytes and the longest is 12. Goldens 137–142 and 145 now independently cover ASCII, four-byte, escaped-control and empty contracts boundaries. The distinctness header says no vector cites ET-9d, but golden 094 does. The ancestry header still describes 086 as declared VALID although the current index declares INVALID. The batching introduction's assertion that conformance cannot tell if batching is implemented has also been superseded by 099–108 and 116–134.

These comments obscure which behavior genuinely remains owed. Refresh the mapping and consolidate exact duplicate synthetic cases where their only value was a missing golden. Preserve distinct extra boundaries (two-/three-byte strings, mixed fault isolation, negative epoch, interval/minimum variants, opaque-state transitions). Do not delete whole suites merely because some goldens arrived. The distinctness test at `:63` also advertises full-string-versus-prefix discrimination while generating ordinary random keys; its own explanatory comment admits it does not construct a shared prefix. Rename that case or construct a feasible short-prefix control.

## Complete test-file inventory

All files below were read in full. Line counts are conventional LF line counts at the audited revision. The inventory covers every test-directory file, including the two non-suite builders.

| File (`tools/verifier-ts/test/`)   | Lines | Assertions, oracle and usefulness                                                                                                                                                                                                                 | Limitations / excess                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fixtures.test.ts`                 |    62 | 150 immutable vectors; exact verdict and INVALID/PARTIAL lines; forwards both anchors; independent expected values from index.                                                                                                                    | Excellent conformance backbone; count=150 requires intentional maintenance on additive vectors. Does not independently exercise implementation gates hidden behind equivalent later rejection.                                                                                                         |
| `robustness.test.ts`               |    56 | 200k blank lines INVALID1; 200k-character parser result equals input.                                                                                                                                                                             | Correct direct regression, stronger than a no-throw assertion. Long string is ASCII only (finding 3). Blank lines overlap extreme cases.                                                                                                                                                               |
| `extreme-values.test.ts`           |   232 | Fixed-seed magnitudes, 19 cases; throws fail; any verdict shape accepted.                                                                                                                                                                         | Early-fault contexts and weak semantic assertions, finding 3. NOT 19 independent conformance checks. INVALID shape does not even require integer line; PARTIAL shape does not require sorted/unique lines.                                                                                             |
| `genesis-ancestry.test.ts`         |   225 | Positive no-ancestry/both/equal/unresolvable; negative either alone, uppercase/short/zero, integer values, unknown key, unregistered genesis.                                                                                                     | Good type-gate isolation with both ancestry fields. Several repeated no/both/alone cases; stale fixture description. Does not independently validate signing/preimage.                                                                                                                                 |
| `genesis-key-distinctness.test.ts` |   116 | Reject equal keys; accept distinct; ancestry combinations and uppercase rejected.                                                                                                                                                                 | Golden094 now overlaps equality; random distinct-key case does not prove prefix distinction. Positive controls are useful.                                                                                                                                                                             |
| `genesis-contracts.test.ts`        |   123 | Both sides of byte boundaries for ASCII, 2/3/4-byte Unicode, controls/short escapes; empty/integer; surrogate escapes; EV-21 reason content.                                                                                                      | Strong boundary tests, extra Unicode cases useful beyond goldens. Existing comments claiming absent goldens are false.                                                                                                                                                                                 |
| `ballot-batching.test.ts`          |   888 | ET-23/24/24a positives/negatives, declared parameters, per-issue separation, exact minimum/reset/last batch, time versus seq, first failure, prefix/head, CLI; Date oracle across 10k years; direct batching cache cases and counted cost bounds. | Good independent Date conversion reference; valid-date enumeration does not test parser rejection. Cost counters prove only instrumented operations, as comments explicitly admit. Some old opaque cases duplicate separate suite and fixtures.                                                        |
| `opaque-ballots.test.ts`           |   493 | Eight contract-example shapes, payload opacity, ET-18b applicable versus unresolved checks, candidate windows/F bounds, per-issue intervals, non-vote exclusion, first fatal line after unresolved, prefixes, head, real CLI.                     | Strong precise line assertions and contrasts; many examples now independently golden. Heading says every prefix, but explicit map tests six selected prefixes (5,6,7,9,10,11), not all. Other suites do exercise every prefix in another chain.                                                        |
| `opaque-bruteforce.test.ts`        |   308 | 3000 fixed-seed small chains, independent quadratic scan oracle, exact token/line list, >=5% for six distribution classes.                                                                                                                        | Valuable differential state-machine check; shared author/spec reading is not external validation. Generator has bounded instants, 3 intervals, min3/4, valid signatures and schemas; cannot cover parser/crypto/CLI defects.                                                                           |
| `chain-and-report.test.ts`         |   552 | Real CLI anchor combinations/order/precedence, file/semantic/framing INVALID priority; malformed chain; endpoint reports and JSON recovery; strict UTF-8/BOM/duplicate hash, independent endpoints; injected internal errors.                     | Strong contract/product boundary layering. Injector is only for otherwise inaccessible errors, not a mocked happy verifier. Invalid-head format matrix is narrower than chain matrix, though shared code and one malformed-head case exist.                                                            |
| `cli-exit-codes.test.ts`           |    68 | Injected Error/non-Error path must exit3, no stdout, one stderr line; real usage-error processes.                                                                                                                                                 | Appropriate narrow dependency seam. No missing-signature/network mocks. Some internal-error overlap with chain/report suite.                                                                                                                                                                           |
| `report-shape.test.ts`             |   298 | Pure rendering exact values/regexes, hostile multiline/control reasons, clipping/codepoints; real CLI all exit classes, empty export, huge type.                                                                                                  | Appropriately tests presentation separately from conformance. Several exact diagnostic-word assertions are product choices and may change without protocol changes. Headless-vector selector does not exclude `chain`, a latent maintenance risk if index order changes.                               |
| `limits.test.ts`                   |   484 | Exact65536 boundary, above chosen cap tool failure/no report, earlier INVALID versus PARTIAL, CLI depth cases, claim cap, 300k PARTIAL lines, split/chunk equivalence down to1 byte, drain and unreadable directory.                              | Strong boundary and real I/O coverage. 300k list checks count/first/last but not every interior number against an independent range; CLI output compared to same library result. Toy pieces case checks separators, but does not assert maximum piece size. Not proof of arbitrary line-count support. |
| `collections.test.ts`              |   202 | Tiny-shard behavior versus built-ins; real default caps beyond2^23 keys; default list crossing; verifier every-prefix differential with tiny caps and structure-count probes.                                                                     | Excellent targeted collection coverage. Tiny/default differential shares bugs common to both; independent built-in unit comparisons compensate. Large stress belongs in a clearly selectable slow tier if fast-save feedback is intended.                                                              |
| `key-scaling.test.ts`              |   153 | Parser reaches all128k keys; exact adjacent-comparison count; preimage sort comparison bound; StageB entry probe.                                                                                                                                 | Purpose and limits documented honestly. StageB assertion depends on advisory reason `/Stage B/`, so diagnostic rewording can fail an algorithm test. Counts do not prove total algorithmic complexity.                                                                                                 |
| `genesis-builder.ts`               |   235 | Two-pass signed/hash-correct synthetic builder; Node key generation/sign; raw JSON value overrides; token/line helper.                                                                                                                            | Explicitly shares production parser/hash/signing-preimage, so provides reach, not an independent hashing oracle. Raw quoted string helper requires caller to provide canonical escape text.                                                                                                            |
| `chain-builder.ts`                 |   210 | Shared Chain creation, issues/votes/unregistered versions/nonballots, intentional faults, prefixes.                                                                                                                                               | Proper shared factory, no duplicate signing harness. Real random Ed25519 keys make chain bytes nondeterministic; fixed structural PRNG still reproduces semantic cases, sufficient here.                                                                                                               |

## Contract coverage and expected-value independence

- **Framing/envelope/canonical integers and strings:** golden012–052 plus malformed Unicode146–150 cover many negative forms with exact lines; valid multibyte and escapes goldens006/007 support positive decoding. Explicit parser rejection gaps remain (finding1), and the long-Unicode chunk boundary is not covered by those short positive fixtures (finding3). A cited ES-20 or HA-2 therefore does not imply every boundary is exercised.
- **Hashing/signatures:** golden001 calibrates the worked genesis, other goldens cover registered type signatures, wrong keys, links, altered hashes, raw-byte corruption. Synthetic builders reuse production hashing and signing preimages, so those tests cannot prove HA byte layout independently; this limitation is documented and is reasonable for semantic gate tests. Raw canonical-encoding predicates/order still need direct tests (finding2). No evidence that prime-order rejection itself is wholly untested: golden081/082/083 exercise identity/mixed/declaration cases.
- **Schema semantics:** contracts byte length, optional ancestry presence/types, key distinctness, title bounds/scalars/controls, choice_count and choice ranges, wrong keys, prior issue lookup, batching floors are exercised. Positive/negative exact-boundary tests generally avoid negative-only false confidence. Rules absent from fixture citations were not automatically labeled untested: e.g. converter epoch endpoints/negative values and many state-cache cases have meaningful synthetic/direct coverage.
- **Batch state/opaque events:** strongest area, combining independent fixture values, hand-derived sequences, a differently implemented quadratic oracle, exact line lists, real CLI examples, every-prefix differential chains and operation counters. Distribution assertions prevent a dead random generator from quietly testing only one verdict. This remains finite exploration, not a proof of all opaque assignments.
- **CLI/precedence/errors:** VALID0 / INVALID1 / PARTIAL2 / tool>=3, missing files/directories, malformed anchors, bad usage, internal throws, anchor independence and both-wrong priority, INVALID priority over anchors/PARTIAL, no report on tool errors, and EX-24 stored-claim recovery are meaningfully tested. No reason to demand database/HTTP tests for this standalone file CLI; there are no such runtime seams here.
- **Producer-only rules:** ET-20 eligibility/one-person uniqueness, ET-21a receipt behavior, ET-25 release/seal/arrival order, EV-25/26 producer admission rules cannot be determined by this export verifier. Their lack of verifier tests is not missing verifier coverage. `participant_id` is derived but not carried as a field in the registered participant event; no phantom payload field test is owed.

## Test cost, layering and actionable excess

Baseline full suite took 62.636 s wall time with test files concurrent. Individual reported test times are overlapping and must not be added as wall time: quadratic-oracle 3000 signed chains 35.934 s; 300k-line library+CLI test 25.716 s; real >2^23 map test 10.558 s; extreme shape fuzz 4.638 s; tiny-cap every-prefix integration 3.901 s. These are useful stress proofs, not blanket candidates for deletion, but the one package `test` command runs all of them and does not provide the testing skill's fast-save unit tier.

Prefer separate selectable fast and stress tiers while keeping both mandatory in CI. The best immediate reduction is obsolete first-line-invalid extreme line-count duplication and exact synthetic cases now independently golden, after preserving their genuinely distinct boundaries. Keep counted algorithm regressions rather than flaky timing ratios. Consolidate a few duplicate CLI helpers only if this improves readable stderr/signal/error diagnostics; do not build a generic harness that hides each assertion's input/expected provenance.

## Commands, mutation accounting and limitations

Runtime: Node v20.20.2 via `/workspace/.local/bin`, package's local pnpm/TypeScript. No installs or network required. `pnpm --filter @odc/verifier-ts build` passed. The unchanged package test command compiles then runs `node --test dist/test/*.test.js`.

| Run                                                            | Result                                                                                   | Interpretation                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial sandbox package test                                   | 9 file entries pass / 6 fail; child `spawnSync` reported EPERM and empty captured output | Environment limitation, not a verifier regression. A standalone child console-log reproduction had the same EPERM.                              |
| Baseline with subprocess-capable execution                     | **404 pass, 0 fail**, 62.636s                                                            | Includes all150 golden vectors; 15 suite files, not404 independent rule proofs.                                                                 |
| M1: hour/minute upper checks relaxed to99                      | **404 pass, 0 fail**, 54.886s                                                            | Real wrong PARTIAL on impossible timestamp; confirmed surviving non-equivalent mutation.                                                        |
| M2: canonical A and R/S predicates unconditional true          | **404 pass, 0 fail**, 79.489s                                                            | Explicit gates gone; downstream checks mask verdicts on this runtime. Two simultaneous gate bypasses, not two independent mutation campaigns.   |
| M3: non-ASCII chunks silently replaced at8192-code-point flush | **404 pass, 0 fail**, 52.582s                                                            | Independently correct-hash 18,246-byte reproduction wrongly INVALID2.                                                                           |
| Final restored-source build and fixture suite                  | Build passed; **151/151** fixture tests passed (150 vectors + index guard)               | Both impossible times restored to INVALID2; long Unicode restored to exact value and PARTIAL[2]; canonical malformed buffers restored to false. |

This is a focused manual mutation audit, not exhaustive mutation testing: three deliberately chosen source transformations, including two compound transformations, cannot supply a mutation score. No line/branch coverage percentage was collected; full source/test reading and observed mutation survival provide behavioral evidence, not a numerical coverage claim. No Go or cross-service suites were run. No changes to contracts or golden bytes. No claim that malformed-library runtime behavior is portable beyond this measured Node version. Stress tests do not establish unbounded sizes, 2^53 line-number precision, or every possible library/host failure. Additional branch gaps suggested above remain hypotheses until isolated.

Restoration verified by byte equality and SHA-256 of original versus final source:

- `src/parse.ts`: `cea0b5d7933d5e245e0b2bd97e9c17b4f25642e96cd74891e6142866e1148149`
- `src/crypto.ts`: `4c1cdda9a80942cee6f30127a9b121d5e97adb2fdb897d4c93926ee6ea599ae8`

`git diff --exit-code -- tools/verifier-ts` passed after restoration. The final build regenerated untracked/ignored dist from restored source. Only this report is intended to remain outside the audit worktree; temporary audit logs and backups inside the verifier were removed.

### Reproduction details

M1 changes the two calendar comparisons described in finding1. M2 inserts `return true;` immediately inside each of the two functions named in finding2. M3 replaces **only the first** `value += String.fromCodePoint(...cps);` (the internal flush, original parse.ts:106) with:

```ts
value += cps.some((cp) => cp >= 0x80)
  ? "?".repeat(cps.length)
  : String.fromCodePoint(...cps);
```

For each temporary source change, run `PATH=/workspace/.local/bin:$PATH pnpm --filter @odc/verifier-ts test` from the isolated worktree, then restore original bytes and rebuild before another run. All three full test runs above were actually executed, not predicted survivors. Do not alter fixtures.

The following independent byte constructor reproduces the observed M3 difference after a build. It deliberately imports no production hashing/parser code to compute the expected hash. Run with Node's `--input-type=module` from the audit worktree:

```js
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { verifyExport } from "./tools/verifier-ts/dist/src/verify.js";
const genesis = readFileSync(
  "contracts/fixtures/vectors/001-genesis-only.ndjson",
  "utf8",
);
const prev = JSON.parse(genesis).hash;
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
const str = (s) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u64(b.length), b]);
};
const pad = "é".repeat(9000),
  ts = "2026-01-01T00:00:00.000Z";
const pre = Buffer.concat([
  Buffer.from("ODC1"),
  u64(2),
  str("x_unicode"),
  u64(1),
  u64(1),
  Buffer.from("s"),
  str("pad"),
  str(pad),
  str(ts),
  str(prev),
]);
const hash = createHash("sha256").update(pre).digest("hex");
const line = JSON.stringify({
  seq: 2,
  type: "x_unicode",
  version: 1,
  payload: { pad },
  ts,
  prev_hash: prev,
  hash,
});
console.log(Buffer.byteLength(line)); // 18246
console.log(verifyExport(Buffer.from(genesis + line + "\n")));
// Original: PARTIAL, lines [2]. M3: INVALID at line 2, HA-14.
```

For M1, use an empty payload encoded as `u64(0)` in the same construction, change type to `x_calendar`, and ts to either impossible instant in finding1. Original: INVALID2. M1: PARTIAL[2]. This independent reconstruction was also run after restoration and confirmed the original outcomes.
