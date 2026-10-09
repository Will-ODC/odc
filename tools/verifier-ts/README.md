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
alone — but the CLI note fixes this scheme so the two verifiers agree, and
`test/report-shape.test.ts` asserts every row of it):

| Verdict                | stdout                          | exit |
| ---------------------- | ------------------------------- | ---- |
| VALID                  | `VALID`                         | 0    |
| INVALID (line N)       | `INVALID at line N[: <reason>]` | 1    |
| PARTIAL (lines …)      | `PARTIAL at lines a, b`         | 2    |
| tool error (bad args…) | message on stderr               | ≥ 3  |

**The verdict is exactly ONE line**, and any advisory reason (EV-17, EV-21) sits
after a colon on that same line — never on a second line. Consumers parse the
verdict with a single-line regex, so a wrapped reason makes them throw rather
than mismatch. Length is the other half of that shape: `type` (ES-10) and
payload strings (EX-9) are unbounded, so a value interpolated into a reason goes
through `excerpt` (64 code points) and every rendered reason is capped as a
backstop. `src/report.ts` is the single place that renders it and strips any
line terminator a reason could carry; `test/report-shape.test.ts` pins the shape.

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
- **Stage B (per registered `(type, version)`):** payload key-set (including
  `genesis`'s two OPTIONAL ancestry keys `ancestor_chain` / `ancestor_head` and
  the ET-9f presence rule between them — format-checked, never resolved), the
  ET-9d distinctness of the two `genesis` keys, Ed25519
  signatures under the type's named key (with the ET-4a/ET-4b canonical-encoding
  and ET-4c prime-order checks run on the raw bytes _before_ the verify
  primitive), title/`choice_count`/`choice` bounds, the `ballot_batch_interval_ms`
  and `ballot_batch_min` floors an `issue_created` declares (ET-14b), `issue_id`
  back-references, and the ballot publication discipline of `event-types.md`
  v10 (`src/batching.ts`):
  - **ET-23** — a `vote_cast`'s `ts`, converted exactly to epoch milliseconds
    (proleptic Gregorian, no leap seconds; exact in a JS number over all of
    ES-20's range), is a multiple of its issue's declared interval; rejected
    at that ballot.
  - **ET-24** — every batch (an issue's ballots at one `ts`) holds at least the
    issue's declared minimum, except the issue's last batch. Blamed on the
    first ballot of that issue after the under-size batch — the ballot that
    leaves it.
  - **ET-24a** — a batch, once left, is closed: taking one issue's ballots in
    `seq` order, a ballot that changes instant MUST NOT return to an instant
    that issue has already left; rejected at the returning ballot. Per issue
    only — other events and other issues' ballots may fall between one batch's
    members.

  Because ET-24a makes every batch one run of its issue's ballots, both
  batching rules are decided at the ballot that changes instant, in file order:
  one Map and one Set lookup per ballot, so cost stays linear and there is no
  end-of-scan pass. `ts` values are compared for equality only (ES-21 v5).
  Only registered `(vote_cast, 1)` ballots count; an unregistered `vote_cast`
  joins no batch, closes none and proves none not-last (ET-24a, "Which ballots
  count"). ET-25 is unverifiable by the contract's own statement and
  has no check. A well-formed but unregistered `(type, version)` yields
  `PARTIAL` for that line, never `INVALID` (EV-8) — **except at line 1**, where
  an unregistered `genesis` is `INVALID at line 1` (EV-20, the sole exception),
  because an unreadable `genesis` payload leaves every later signature
  uncheckable.

## Tests

```sh
pnpm --filter @odc/verifier-ts test
```

Eight files (seven suites and one shared builder), and the split between them is deliberate — **`contracts/fixtures/`
is the sole oracle for what a given input verifies to.** `fixtures.test.ts` is
the conformance suite; `robustness.test.ts`, `extreme-values.test.ts` and
`report-shape.test.ts` assert only that a verdict of the right _shape_ came back
at all. `genesis-ancestry.test.ts` is the one exception and says so in its own
header: it asserts verdict values for rules the fixture corpus does not yet
cover, from synthetic chains, and is superseded by a fixture the day one lands;
`ballot-batching.test.ts` is the second such exception, on the same terms.
Anything else that froze an expected verdict outside the fixture corpus would be
inventing conformance in a file no reviewer treats as normative.

- **`test/fixtures.test.ts`** — drives every vector in
  `contracts/fixtures/index.json` and asserts the declared verdict token and
  line number(s) only. This is the conformance suite.
- **`test/robustness.test.ts`** — regression pins for the two unbounded
  `f(...array)` defects found in the T7b review (`Math.min(...invalidLines)` and
  `String.fromCodePoint(...cps)`). Node throws `RangeError` once a spread array
  passes ~130k elements.
- **`test/genesis-key-distinctness.test.ts`** — ET-9d: a `genesis` declaring the
  same key as both `operator_pk` and `registrar_pk` is `INVALID at line 1`. Pins
  the accept side too (two distinct keys still verify), since a check written
  over-broadly would reject every genesis and a negative-only suite would not
  notice. Same synthetic-chain caveat as the file below.
- **`test/genesis-builder.ts`** — not a suite: the shared synthetic-`genesis`
  builder those two files use, plus `signedEventLine`, the
  general signed-event builder the ballot suite uses, kept in one place so two
  signing harnesses cannot drift apart. Its `rawExtra` option writes a payload value as a raw
  JSON token rather than a string, which is the only way to build a well-formed
  payload whose value has the wrong TYPE (`{"ancestor_chain":1}`) — correct
  order, hash and signature, so only the schema's own type rule can reject it.
- **`test/genesis-ancestry.test.ts`** — ET-9e/ET-9f (the two optional `genesis`
  ancestry keys) and EV-20. The fixture corpus carries **no** vector for these
  rules yet, so this file builds its own chains; they are synthetic and
  self-consistent (hashed and signed by the functions under test), which the
  file's header states plainly. They are a harness, not an oracle: a fixture
  for these rules supersedes them the day one exists.
- **`test/ballot-batching.test.ts`** — ET-23, ET-24 and ET-24a
  (`event-types.md` v10). When written, no fixture cited ET-23 or ET-24a and
  none had an issue whose ballots span more than one batch, so the conformance
  suite could not tell whether any of the three exists. Synthetic,
  self-consistent chains (built with `genesis-builder.ts`'s `signedEventLine`),
  asserting verdict and blamed line in both directions: off-by-one-millisecond
  `ts`, declared (not floor) interval and minimum, a batch exactly at the
  minimum, the legal under-size final batch, interleaved issues, lastness by
  `seq` rather than `ts`, a ballot returning to a left instant (mid-chain, at
  the very end, two batches back, after an under-size batch), other issues'
  ballots and other events between one batch's members, unregistered
  `vote_cast` versions in between, interaction with other faults and `--head`,
  a linear-cost budget, and the CLI's line and exit status. `epochMs` is
  checked against `Date` (via `setUTCFullYear`, which unlike `Date.UTC` does
  not remap years 0–99) over every year of ES-20's range.
- **`test/report-shape.test.ts`** — the CLI output contract: exactly one verdict
  line, advisory reason after a colon on that same line, of bounded length. A
  reason on a second line makes a single-line consumer regex **throw** rather
  than mismatch, and no valid input would surface that, so it is pinned
  directly — at the renderer and through a real child process. It also asserts
  the process **exit status** (0/1/2, and ≥ 3 for a tool-level error): nothing
  else in the suite reads `$?`, so without these the whole scheme could be
  inverted with every other test still green. The VALID and PARTIAL inputs are
  read out of `contracts/fixtures/index.json` by declared verdict, so no verdict
  value is invented here.
- **`test/key-scaling.test.ts`** — a wall-clock budget pinning that payload key
  handling stays sub-quadratic in key count. The parser compares each key
  against the immediately preceding key only, which EX-8's ascending-order
  requirement makes sufficient for both the duplicate rule (HA-6) and the order
  rule; a seen-keys rescan would be O(n²) and could wedge the verifier for
  minutes on a few megabytes of input without changing any verdict. Measured on
  the 128k-key payload the test uses: ~115 ms as written, ~634 s (10.5 minutes)
  with the quadratic shape — the budget sits between them with ~30x headroom
  over the former. Its reach is the parser, the HA-7 preimage and all of Stage
  A, through to the entry of Stage B — **not** Stage B's own per-key work,
  which no such payload can reach: `(genesis, 1)` defines seven payload keys,
  so the ES-18/ES-34 key-set check rejects the first undefined one on sight.
  Stage B's key handling is bounded by the key set, not by the input.
- **`test/extreme-values.test.ts`** — value-level fuzzing for that same class.
  Generates structurally valid exports carrying extreme values (huge strings
  where byte length, code point count and UTF-16 length diverge; integers
  straddling 2^53; extreme line counts; deep nesting; many-key payloads) and
  asserts only that the verifier does not throw and returns exactly one
  well-formed verdict of the three (EV-17). Generation is a fixed-seed LCG, so a
  failure reproduces from the case index in the assertion message.

**Why `robustness.test.ts` and `extreme-values.test.ts` exist as a category.** Both known defects of this class were
**wrong-verdict** bugs, not crashes-only: one returned no verdict at all, and
the other was swallowed by a catch-all as a silent `INVALID` on a line that
parses fine. A byte-level fuzzer cannot find them — flipping bytes in a valid
export does not grow the input, so it never reaches the limit. If you add a call
that spreads an array whose length comes from the input, add a case here.

**Not yet covered: the Go verifier.** `extreme-values.test.ts` fuzzes this
implementation only. The equivalent for `services/verifier/` is owed and is not a
port — Go has no argument-spread limit, so the analogous risks are stack growth
on deep nesting and `bufio.Scanner`'s token limit on long lines.
