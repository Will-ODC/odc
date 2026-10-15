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
node dist/src/cli.js verify <export.ndjson> [--head <64-lowercase-hex>] [--chain <64-lowercase-hex>]
```

Output and process exit codes (the exit code is **not** conformance-checked —
`evolution.md` EV-17 pins conformance on the verdict token and line number(s)
alone — but the CLI note fixes this scheme so the two verifiers agree, and
`test/report-shape.test.ts` and `test/cli-exit-codes.test.ts` assert every row):

| Verdict                | stdout                          | exit |
| ---------------------- | ------------------------------- | ---- |
| VALID                  | `VALID`                         | 0    |
| INVALID (line N)       | `INVALID at line N[: <reason>]` | 1    |
| PARTIAL (lines …)      | `PARTIAL at lines a, b`         | 2    |
| tool error (any cause) | one line on stderr              | ≥ 3  |

On a verdict over a non-empty input, stderr also carries the two EX-24
stored-claim lines (below); a tool error never does. A tool error is an
unreadable file, bad usage, a malformed anchor, an internal error, or a limit
reached under EV-24 (below).

## Limits (EV-23, EV-24)

`evolution.md` §7 fixes two minimums every verifier accepts — a line of
**65536** bytes (without its LF) and a nesting depth of **64**, depth counted
over the line's bytes — and forbids any fixed limit on the number of lines or
the size of the input. This verifier (`src/input.ts`):

- **Reads the file in 1 MiB chunks**, never whole, and verifies one record at
  a time. `readFileSync` refuses files over 2 GiB, which would be a fixed limit
  on input size. After a fatal line it stops verifying but keeps reading, only
  to find EX-24's last candidate.
- **Has one within-line limit: 64 MiB per line** (`MAX_LINE_BYTES`, 1024 × the
  minimum). A longer line, when no earlier line has decided the verdict, is a
  tool-level failure: exit 3, `odc-verify-ts: limit reached: …` on stderr, no
  verdict line and no EX-24 report. After an earlier fatal line, it changes
  nothing: that `INVALID` stands, and if the long line is an endpoint its claim
  is `unavailable` (EV-24 allows that for a limit reached only while
  recovering a claim). The limit exists so a line far past any conforming one
  is refused on purpose, rather than by V8's string-length cap.
- **Needs no depth limit for verification.** The line parser is one
  non-recursive pass that rejects the first `{` or `[` opening a third level
  (ES-17, EV-16), so any line deeper than 2 is `INVALID` at that line before
  depth could matter — the verdict EV-24 says is established before any limit.
- **Bounds claim recovery** at the same 64 MiB and at depth 1024
  (`CLAIM_MAX_DEPTH`, by EV-23's byte scan) before `JSON.parse` sees a
  candidate. Past either, that claim is `unavailable`.
- **Keeps no per-line state in a capped built-in.** V8 caps a `Map` or `Set`
  at 2^23 (8,388,608) entries and a pushed array at 2^26 elements, so each of
  these would be a fixed line-count limit. The issue maps, the PARTIAL list
  and every `BallotBatches` collection (issues, intervals, opaque ballots by
  instant and each instant's list, each issue's left instants) are instead a
  `ShardedMap`, `ShardedSet` or `ChunkedList` (`src/collections.ts`), split
  across built-ins kept under their caps. Checked by hand: fixture 001's
  genesis then 8,388,700 opaque `vote_cast` lines at distinct instants is
  `PARTIAL` naming all 8,388,700, at about 3.9 GB resident (97 s); before
  this it was exit 3, `Map maximum size exceeded`.
- **Renders a PARTIAL line in pieces**, so a list of line numbers longer than
  V8's longest string still prints. Line numbers are JS numbers, exact to
  2^53 − 1.

Running out of memory is EV-24's host-resource exemption; V8 aborts the
process and no report is possible.

**The verdict is exactly ONE line**, and any advisory reason (EV-17, EV-21) sits
after a colon on that same line — never on a second line. Consumers parse the
verdict with a single-line regex, so a wrapped reason makes them throw rather
than mismatch. Length is the other half of that shape: `type` (ES-10) and
payload strings (EX-9) are unbounded, so a value interpolated into a reason goes
through `excerpt` (64 code points) and every rendered reason is capped as a
backstop. `src/report.ts` is the single place that renders it and strips any
line terminator a reason could carry; `test/report-shape.test.ts` pins the shape.

The CLI sets `process.exitCode` and lets the process end on its own instead of
calling `process.exit()` right after verifying. This is a workaround for a
crash that was **observed, not proven**: on one machine (Node v24.7.0, macOS),
a child running the verify path and then calling `process.exit()` died with
SIGSEGV (status `null`, empty stderr) in 9 of 300, 6 of 400 and 2 of 400 runs
across three variants, roughly 0.5–3%. That made the process-level tests flaky.
The same verification with `process.exit()` stubbed out died 0 of 400 times,
and the CLI with natural exit 0 of 1000. A separate review could not reproduce
the crash in about 600 runs of each variant, so treat the cause as unconfirmed.

`--head` supplies the out-of-band anchored head. It is the ONLY way to detect
clean end-truncation, which is invisible from the export alone
(`export-format.md` EX-16): a prefix of a valid chain is itself a valid chain.

`--chain` supplies the out-of-band expected **genesis hash**, the chain's
identity (EX-21, EX-22): `--chain` fixes _which chain_, `--head` fixes _how much
of it_. They are independent and may be given together. A malformed value
(anything but 64 lowercase hex) for either is a tool error, exit 3.

Which verdicts the two anchors can override (`export-format.md` v5, EX-15 /
EX-22 / EX-23): both are compared at the same point, only after every other
file-validity check has passed — framing, each event's structural checks and
every registered event's semantic checks. Unknown events yielding `PARTIAL` do
not prevent the comparison. So a mismatch turns `VALID` or `PARTIAL` into
`INVALID` — `--chain` at line 1 (EX-23), `--head` at the last line (EX-19) —
but never replaces an `INVALID` a file check already established; that line
number stands. When both mismatch on a file eligible for comparison, the
verdict is the chain mismatch, `INVALID at line 1` (EX-23).

**Stored claims on stderr (EX-24).** On every run that produces a chain
verdict over non-empty input, whatever the verdict, the CLI writes two lines to
**stderr**, one per endpoint, after the verdict line is on stdout:

```
genesis hash (stored claim): <64-lowercase-hex | unavailable>
head hash (stored claim): <64-lowercase-hex | unavailable>
```

These are **stored claims**: the decoded JSON string value of the `hash` field
in the first and the last candidate record, with no normalisation beyond JSON
decoding — never a recomputed or verified hash. On a structurally
valid export they coincide with the genesis hash (EX-21) and head (EX-14); on an
`INVALID` export they are only what the file asserts and are **not** verified
chain anchors. Read them with the verdict and an independently trusted
`--chain` / `--head`; the report alone proves no integrity or identity.

- **Candidates.** The input is split at LF. One terminal LF ends the last
  record and adds no empty candidate; an additional trailing blank record _is_
  a candidate (so `…\n\n` reports the head `unavailable`). Without a final LF,
  the final fragment is the last candidate. These rules apply even when
  framing or any other file check fails (a CRLF export still reports both).
- **Availability.** A claim is available only if its candidate is strict UTF-8
  and decodes (`JSON.parse`) as a JSON **object** with a top-level `hash` string
  of exactly 64 lowercase hex characters; otherwise that endpoint is
  `unavailable`, and the other endpoint is still reported. A repeated top-level
  `hash` key uses its last occurrence. Keys and values are compared as decoded
  JSON strings, so `"hash"` is the key `hash` and a `\u`-escaped value
  that decodes to 64 lowercase hex is available. Nothing is normalised beyond
  JSON decoding — no lowercasing, trimming, BOM stripping or U+FFFD
  substitution. Recovery is not a
  canonical-form check: a non-canonical but well-formed JSON object still
  yields its claim.
- **When.** Not for an empty input (no endpoints), and not on a tool error,
  where no verdict was produced: an unreadable file, bad usage, a malformed
  anchor, an internal error (#194: exit 3, one stderr line, empty stdout), or
  an EV-24 limit.
- **Limits.** A candidate longer than 64 MiB or deeper than 1024 is
  `unavailable` (EV-24; see Limits above).

stdout stays exactly the one verdict line. These lines are **tool output, not
conformance surface**: EV-17 judges conformance on the verdict token and line
number(s) alone, and EX-24 leaves labels, order and format free, so no fixture
asserts them and another verifier may print them differently.
`test/chain-and-report.test.ts` pins this CLI's behaviour.

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
  the ET-9f presence rule between them, both or neither since v13 —
  format-checked, never resolved), the
  ET-9 bound on `genesis.contracts` (1 to 64 bytes of the decoded value's
  UTF-8 encoding, not escaped line bytes and not UTF-16 `.length`), the
  ET-9d distinctness of the two `genesis` keys, Ed25519
  signatures under the type's named key (with the ET-4a/ET-4b canonical-encoding
  and ET-4c prime-order checks run on the raw bytes _before_ the verify
  primitive), title/`choice_count`/`choice` bounds, the `ballot_batch_interval_ms`
  and `ballot_batch_min` floors an `issue_created` declares (ET-14b), `issue_id`
  back-references, and the ballot publication discipline of `event-types.md`
  v12 (`src/batching.ts`):
  - **ET-23** — a `vote_cast`'s `ts`, converted exactly to epoch milliseconds
    (proleptic Gregorian, no leap seconds; exact in a JS number over all of
    ES-20's range), is a multiple of its issue's declared interval (zero and
    negative multiples count); rejected at that ballot.
  - **ET-24** — a batch is a maximal run, in `seq` order among one issue's
    registered `vote_cast` events (every registered version; in v12 that is
    version 1 alone, ET-22a), sharing one `ts`. Every batch holds at
    least the issue's declared minimum, except the issue's last batch. An
    under-size batch is blamed on the ballot that ends it (the issue's next
    registered ballot at a different `ts`) on every chain. Example: T1, T1, T2,
    T2, T2, T1 with minimum 3 is INVALID at the first T2, not the returning T1.
  - **ET-24a** — a batch, once left, is closed: no two batches of one issue
    share a `ts`, so a ballot that changes instant MUST NOT return to an
    instant that issue has already left; rejected at the returning ballot. Per issue
    only — other events and other issues' ballots may fall between one batch's
    members.
  - **ET-24b** — how ET-24 and ET-24a are decided beside **opaque ballots**
    (a `vote_cast` at a version this verifier does not register; ADR-0034).
    Of an opaque ballot only its envelope `seq` and `ts` are used — its payload
    is never read, even if it names an issue. It is a **candidate** of every
    registered issue created before it (`seq > c`) whose interval its `ts` is
    a multiple of. ET-24 and ET-24a are first evaluated over the registered
    ballots alone (the v11 "known" result). A known ET-24a failure is definite;
    a known ET-24 failure is definite only if `|R| + F < m`, where F counts the
    candidates at the under-size run's instant since the ballot before that run.
    A definite failure is `INVALID` at that ballot. Otherwise the ballot's batch
    check is **unresolved** when it has a non-definite known failure, or when a
    candidate could have changed it (item 4(b): one at another instant inside
    its run, or, at a run start, one at its own instant, or one at another
    instant since the run it ends began). An unresolved check is not a failure:
    the line is listed in `PARTIAL` and the scan goes on.
  - **ET-18b** — a registered ballot whose `issue_id` names an `issue_created`
    at a version this verifier does not register passes ET-18. Its ET-18a,
    ET-23, ET-24 and ET-24a checks are unresolved, so its line is listed in
    `PARTIAL`, never `INVALID` on that ground; its signature (ET-17), key set
    (ES-18) and integer `choice` (ET-19) are checked as usual. It is neither a
    registered ballot of any issue nor a candidate for ET-24b.

  Every definite failure is decided at the ballot that ends a run or returns,
  in file order, from earlier lines only, so EX-16's prefix property holds and
  there is no end-of-scan pass. `ts` values are compared for equality and
  ET-23's multiple test only (ES-21). Cost: a registered ballot is a few
  Map/Set lookups plus one binary search; an opaque ballot costs one modulus
  per **distinct** interval among the registered issues (it updates an O(1)
  summary per interval, not each issue), so the worst case is
  O(opaque ballots × distinct intervals): about 0.2 s at 10k × 10k, 1.7 s at
  30k × 30k, and roughly 20 s at 100k × 100k, measured on that step alone.
  `test/ballot-batching.test.ts` pins that growth as a ratio (60k against 6k
  opaque ballots over 1k intervals must stay under 25×, ~10× today), which
  does not depend on machine speed. A
  sub-quadratic candidacy test is an **open follow-up**.

  _Which ballots count_ (v12): ET-24 and ET-24a read only registered
  ballots of registered issues. An opaque ballot joins no _known_ run, but it
  is no longer disregarded as it was up to v11 ("joins no batch, ends none,
  proves none not-last"): under ET-22a it is one ballot of one issue, so where
  it could change a registered ballot's batch check, that check is unresolved.
  `PARTIAL` lists every unregistered line and every unresolved registered
  `vote_cast` line, ascending and each once (EV-7, EV-17). Wherever EX-15 and
  EX-22 require every registered event's checks to have passed, an unresolved
  check counts as not failed, so `--head` and `--chain` are still compared on
  such a chain. ET-25 is unverifiable by the contract's own statement and
  has no check. A well-formed but unregistered `(type, version)` yields
  `PARTIAL` for that line, never `INVALID` (EV-8) — **except at line 1**, where
  an unregistered `genesis` is `INVALID at line 1` (EV-20, the sole exception),
  because an unreadable `genesis` payload leaves every later signature
  uncheckable. Its reason text follows EV-21 (v8): it names the version found
  and says that, since ET-6 pins `genesis.version` at 1, the chain is corrupt,
  hostile or not an ODC chain. It does not suggest a newer verifier: none
  registers another `genesis` version.

## Tests

```sh
pnpm --filter @odc/verifier-ts test
```

Seventeen files (fifteen suites and two shared builders), and the split between them is
deliberate — **`contracts/fixtures/` is the sole oracle for what a given input
verifies to.** `fixtures.test.ts` is the conformance suite; `robustness.test.ts`,
`extreme-values.test.ts` and `report-shape.test.ts` assert only that a verdict
of the right _shape_ came back at all, and `cli-exit-codes.test.ts` only the
exit status. `genesis-ancestry.test.ts`, `genesis-key-distinctness.test.ts` and
`genesis-contracts.test.ts` are exceptions and say so in their own headers: they assert verdict values for
rules the fixture corpus does not yet cover, from synthetic chains, and are
superseded by a fixture the day one lands; `ballot-batching.test.ts`,
`opaque-ballots.test.ts` and `opaque-bruteforce.test.ts` are further such
exceptions, on the same terms, and `chain-and-report.test.ts` asserts the
anchor-precedence verdicts EX-15/EX-22/EX-23 fix on byte-level edits of golden
exports. Anything else that froze an expected verdict outside the fixture corpus
would be inventing conformance in a file no reviewer treats as normative.

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
  ancestry keys: both or neither, so each alone is `INVALID` at line 1, and
  the format-gate cases carry both so only the gate can reject) and EV-20.
  Committed vector `086-ancestor-chain-alone` still declares `VALID` (v12's
  rule) and fails `fixtures.test.ts` until the corpus follows v13; vectors
  088 and 090 carry `ancestor_chain` alone, so under v13 they no longer
  isolate the ET-9e format gate they cite. This file builds its own chains;
  they are synthetic and self-consistent (hashed and signed by the functions
  under test), which the file's header states plainly. They are a harness,
  not an oracle: where a fixture covers the same rule, the fixture wins.
- **`test/ballot-batching.test.ts`** — ET-23, ET-24 and ET-24a
  (`event-types.md` v11; its unregistered-version chains re-read under v12's
  ET-24b). When written, no fixture cited ET-23 or ET-24a and
  none had an issue whose ballots span more than one batch, so the conformance
  suite could not tell whether any of the three exists. Synthetic,
  self-consistent chains (built with `chain-builder.ts`),
  asserting verdict and blamed line in both directions: off-by-one-millisecond
  `ts`, declared (not floor) interval and minimum, a batch exactly at the
  minimum, the legal under-size final batch, interleaved issues, lastness by
  `seq` rather than `ts`, a ballot returning to a left instant (mid-chain, at
  the very end, two batches back, after an under-size batch), other issues'
  ballots and other events between one batch's members, opaque `vote_cast`
  versions in between (now `PARTIAL` with the unresolved lines), ET-24 winning over ET-24a on the contract's
  own T1, T1, T2, T2, T2, T1 example, three batches at exactly the minimum
  (the per-batch counter reset), the EX-16 truncation residual with and
  without `--head`, interaction with other faults and `--head`,
  a linear-cost budget, the opaque-ballot cost bound, and the CLI's line and exit status. `epochMs` is
  checked against `Date` (via `setUTCFullYear`, which unlike `Date.UTC` does
  not remap years 0–99) over every year of ES-20's range.
- **`test/chain-builder.ts`** — not a suite: the `Chain` builder the three
  ballot suites share (genesis, issues at any version, interval and minimum,
  ballots at any version and `ts`), built on `signedEventLine`.
- **`test/opaque-ballots.test.ts`** — ET-24b and ET-18b (`event-types.md` v12,
  ADR-0034): ADR-0034's eight-case table verbatim, then ET-18b (both lines in
  `PARTIAL`, ET-17/ES-18 still `INVALID`, an unquantized `ts` or out-of-range
  `choice` unresolved, not a candidate), and ET-24b shapes: several opaque
  ballots adding up in F, F counting only after w, opaque ballots before an
  issue's first ballot and before the issue itself (`seq ≤ c`), issues sharing
  instants, a `ts` that is a multiple of one issue's interval and not another's,
  an unquantized opaque `ts`, a malformed opaque payload (EV-16), a definite
  failure after an unresolved line, an unregistered event that is not a
  `vote_cast` (an `x_` type, `participant_registered` at an unregistered
  version) never being a candidate (ET-22a), run-start state reset per run,
  `--head` on a `PARTIAL` chain, every prefix
  of one chain (EX-16), and the CLI's `PARTIAL` line and exit 2.
- **`test/opaque-bruteforce.test.ts`** — a differential test: 3000 random
  chains of up to 30 events (sfc32 PRNG, fixed seed), with opaque ballots and
  non-ballot unregistered events placed at an issue's current, next or left
  instants, compared with a deliberately naive, quadratic
  reading of ET-18b/ET-23/ET-24/ET-24a/ET-24b written in the test itself. It
  prints the verdict distribution and fails if any class (`VALID`, `INVALID`,
  `PARTIAL` with and without unresolved registered lines) is under 5%.
- **`test/chain-and-report.test.ts`** — `--chain` (EX-22/EX-23) and the v5
  anchor precedence: both anchors wrong on an eligible (VALID or PARTIAL) file
  blames line 1, PARTIAL does not block either comparison, and an earlier
  file-check `INVALID` (a tampered hash, a framing fault) keeps its line under
  wrong anchors. Also the EX-24 stored-claim report: exact labels, candidate
  extraction (terminal LF, extra blank record, no final LF, CRLF), claim
  availability (last repeated `hash`, no normalisation, strict UTF-8, BOM,
  non-objects, nested keys), each endpoint independent of the other, and no
  report on empty input or any tool error.
- **`test/genesis-contracts.test.ts`** — ET-9's 64-byte bound on
  `genesis.contracts`, both sides of the boundary in each unit where bytes,
  UTF-16 length and escaped line length differ: ASCII, two-, three- and
  four-byte characters, `\u0001` and short escapes counted once, surrogate-pair
  escapes (non-canonical under EX-9 whatever their length), empty and integer
  values. Also EV-21's reason text for a `genesis` at version 2 and 1000000.
  Synthetic chains, on the same terms as `genesis-ancestry.test.ts`.
- **`test/limits.test.ts`** — EV-23/EV-24: a line of exactly 65536 bytes
  reaching its verdict (library and CLI, with its claim), lines past the limit
  (a tool-level failure, exit 3, no report, including after a line that is
  only `PARTIAL`, since `PARTIAL` is settled only at the end; or an earlier
  `INVALID` kept with the endpoint `unavailable`), a 1 MiB line reaching a verdict, depth 3, 64,
  65, 100000 and 1000000 (`INVALID` at the line, no throw), the EV-23 depth
  scan, claim recovery at and past `CLAIM_MAX_DEPTH`, 300,000 lines all listed
  in `PARTIAL`, the PARTIAL line rendered in pieces, the chunked reader against
  the in-memory split at chunk sizes down to one byte, and a directory as an
  unreadable file. Its temporary files (several over 64 MiB) are removed
  after the run, as are every other suite's.
- **`test/collections.test.ts`** — the uncapped collections: `ShardedMap`,
  `ShardedSet` and `ChunkedList` against the built-ins' behaviour across shard
  and chunk boundaries, one real `ShardedMap` past 2^23 entries, and the
  verifier and `BallotBatches` run with tiny caps — every growing collection
  must span several shards and every prefix of a busy chain must reach the
  same verdict as under the default caps.
- **`test/cli-exit-codes.test.ts`** — issue #194: a throw inside the CLI's work
  (forced in-process through `run`'s injectable verify) exits 3 with one
  stderr line and empty stdout, never 1; usage errors exit 3 with `usage:`.
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
