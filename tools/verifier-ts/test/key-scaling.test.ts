// Regression guard on the EXISTING payload key comparison sites: the parser's
// adjacency check stays one comparison per key, and the preimage sort stays
// within a comparison sort's bound. It counts those two sites only.
//
// WHY. "A stranger can write a verifier and check the log in an afternoon" is a
// charter §4 property, so a hostile export of modest size must not be able to
// wedge a verifier. The classic way to lose that is a duplicate-key check that
// scans every previously-seen key for each new key: O(n²) comparisons, which at
// ~130k keys in one payload is ~8x10^9 comparisons — tens of seconds from an
// input of a few megabytes — while changing no verdict, so no correctness test
// would ever notice.
//
// The parser does NOT have that shape today: EX-8 requires payload keys to be
// in ascending UTF-8-byte order, so `parsePayload` compares each key against
// the IMMEDIATELY PRECEDING key only. That single comparison decides both rules
// at once — equal means a duplicate (HA-6), descending means mis-ordered
// (EX-8) — because in an ascending sequence a duplicate can only ever be
// adjacent. One comparison per key, no set, no rescan.
//
// This file exists so that property cannot be lost silently: it is the test
// that fails if someone "simplifies" the adjacency comparison itself into a
// seen-keys scan. It does NOT prove key handling sub-quadratic as a whole: an
// uncounted rescan added beside the counted comparison, or an uncounted
// O(n^2) pass elsewhere (in encPayload, say), would pass.
//
// It COUNTS the work rather than timing it. It was a 10 s wall-clock budget;
// a timed bound on a shared CI runner is noise (two sibling cost tests in
// ballot-batching.test.ts flaked that way), so the parser's key comparisons and
// the preimage sort's comparisons are counted through test-only counters
// (`keyComparisonCount`, `payloadSortComparisonCount`) and asserted against
// the key count. A seen-keys rescan makes ~n^2/2 comparisons; the bounds below
// are n - 1 and n * ceil(log2 n). No verdict value is asserted —
// `contracts/fixtures/` remains the oracle for those.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport } from "../src/verify.js";
import {
  keyComparisonCount,
  parseEventLine,
  type ParsedEvent,
} from "../src/parse.js";
import { computeHash, payloadSortComparisonCount } from "../src/hashing.js";
import { verdictLine } from "../src/report.js";

const ZERO64 = "0".repeat(64);

/**
 * A canonical event line whose payload carries `n` distinct keys in ascending
 * UTF-8-byte order (EX-8). The index is ZERO-PADDED so lexicographic order and
 * numeric order agree: unpadded `k10` sorts before `k2`, which the parser
 * rejects at the second key — a generator that forgets this never reaches many
 * keys at all and silently tests nothing.
 *
 * The `hash` is the REAL one, recomputed over the finished line. An earlier
 * version of this generator hard-coded a placeholder, and verification then
 * stopped at the HA-14 mismatch — Stage B was never entered at all, so the
 * test below measured strictly less than its name claimed.
 */
function manyKeyLine(n: number): Buffer {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(`"k${String(i).padStart(9, "0")}":1`);
  const withHash = (hash: string): string =>
    `{"seq":1,"type":"genesis","version":1,"payload":{${parts.join(",")}},` +
    `"ts":"2026-01-01T00:00:00.000Z","prev_hash":"${ZERO64}","hash":"${hash}"}`;
  const draft = parseEventLine(Buffer.from(withHash(ZERO64), "utf8"));
  assert.notEqual(
    draft,
    null,
    "the many-key generator built an unparsable line",
  );
  return Buffer.from(withHash(computeHash(draft as ParsedEvent)), "utf8");
}

const KEY_COUNT = 128_000;
/**
 * Any comparison sort's worst case for ONE sort, far below a rescan's ~n^2/2.
 * It is checked against the whole verify run's total, which is stricter: a run
 * that builds more than one preimage must fit them all under it.
 */
const SORT_BOUND = KEY_COUNT * Math.ceil(Math.log2(KEY_COUNT));

test("the parser reaches every key of a large well-ordered payload", () => {
  // Guards the guard: if the generator emitted mis-ordered keys the counting
  // tests below would pass trivially by failing at key 2.
  const parsed = parseEventLine(manyKeyLine(KEY_COUNT));
  assert.notEqual(parsed, null, "a well-ordered many-key payload must parse");
  assert.equal(parsed?.payload.length, KEY_COUNT);
});

test(`parses a ${KEY_COUNT}-key payload with one key comparison per key (the adjacency comparison site)`, () => {
  const bytes = manyKeyLine(KEY_COUNT);
  const before = keyComparisonCount();
  const parsed = parseEventLine(bytes);
  const comparisons = keyComparisonCount() - before;
  assert.notEqual(parsed, null);
  assert.equal(
    comparisons,
    KEY_COUNT - 1,
    `parsing ${KEY_COUNT} payload keys made ${comparisons} key comparisons — ` +
      `the per-key work is no longer O(1); check parsePayload's key comparison`,
  );
});

test(`verifies a ${KEY_COUNT}-key export within the counted comparison sites' bounds`, () => {
  // Covers the parser, the HA-7 preimage build (a pass over every key) and all
  // of Stage A — seq, ts, the prev_hash anchor and the HA-14 hash comparison —
  // through to the entry of Stage B, and counts the two comparison sites on
  // that path.
  //
  // WHAT IT DOES NOT COVER: Stage B's own per-key work. The hash is correct, so
  // Stage B IS entered — but `(genesis, 1)` defines seven payload keys, so the
  // ES-18/ES-34 key-set check rejects `k000000000` on sight and nothing further
  // runs. No 128k-key payload can do better for a registered type: every key
  // past the defined set is rejected at the first comparison, by construction.
  // Stage B's key handling is bounded by the key set, not by the input.
  //
  // WHAT THE COUNTS COVER: the two per-key loops in that stretch, the parser's
  // ordering comparison and the HA-7 preimage's defensive sort, totalled over
  // the whole run (see SORT_BOUND). A new per-key scan elsewhere, including an
  // uncounted one beside these, would not be counted; it is a counted guard on
  // the comparison sites that exist, not a timer over the whole path.
  const bytes = Buffer.concat([manyKeyLine(KEY_COUNT), Buffer.from("\n")]);
  const parse0 = keyComparisonCount();
  const sort0 = payloadSortComparisonCount();
  const verdict = verifyExport(bytes);
  const parsed = keyComparisonCount() - parse0;
  const sorted = payloadSortComparisonCount() - sort0;
  assert.ok(
    ["VALID", "INVALID", "PARTIAL"].includes(verdict.verdict),
    "EV-17: exactly one of the three verdicts",
  );
  // A COVERAGE PROBE, not an oracle: advisory reason text is never
  // conformance-checked (EV-17), and `contracts/fixtures/` remains the only
  // authority on what an input verifies to. It is asserted here because it is
  // the one signal that these counts span what the comment above says it does
  // — a stale or placeholder `hash` would report HA-14 instead, and the counts
  // would quietly stop measuring most of the path.
  assert.match(
    verdictLine(verdict),
    /Stage B/,
    `expected verification to reach Stage B, got: ${verdictLine(verdict)}`,
  );
  assert.equal(
    parsed,
    KEY_COUNT - 1,
    `verifying made ${parsed} parser key comparisons for ${KEY_COUNT} keys`,
  );
  assert.ok(
    sorted > 0 && sorted <= SORT_BOUND,
    `verifying made ${sorted} preimage sort comparisons (bound ${SORT_BOUND})`,
  );
});
