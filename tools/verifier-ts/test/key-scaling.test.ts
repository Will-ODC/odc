// Regression guard: payload key handling must stay SUB-QUADRATIC in key count.
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
// that fails if someone "simplifies" the adjacency comparison into a
// seen-keys scan.
//
// It is a WALL-CLOCK BUDGET, deliberately loose. Measured here: ~0.9 us/key
// parsing and ~2.3 us/key end to end, i.e. ~0.3 s for 128k keys. The budget is
// ~30x that, so ordinary machine-speed variation cannot trip it, while a
// quadratic implementation misses it by two orders of magnitude. No verdict
// value is asserted — `contracts/fixtures/` remains the oracle for those.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport } from "../src/verify.js";
import { parseEventLine, type ParsedEvent } from "../src/parse.js";
import { computeHash } from "../src/hashing.js";
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
 * budget below measured strictly less than its name claimed.
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
const BUDGET_MS = 10_000;

test("the parser reaches every key of a large well-ordered payload", () => {
  // Guards the guard: if the generator emitted mis-ordered keys the timing
  // tests below would pass trivially by failing at key 2.
  const parsed = parseEventLine(manyKeyLine(KEY_COUNT));
  assert.notEqual(parsed, null, "a well-ordered many-key payload must parse");
  assert.equal(parsed?.payload.length, KEY_COUNT);
});

test(`parses a ${KEY_COUNT}-key payload well inside ${BUDGET_MS}ms (sub-quadratic duplicate-key check)`, () => {
  const bytes = manyKeyLine(KEY_COUNT);
  const t0 = process.hrtime.bigint();
  const parsed = parseEventLine(bytes);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.notEqual(parsed, null);
  assert.ok(
    ms < BUDGET_MS,
    `parsing ${KEY_COUNT} payload keys took ${ms.toFixed(0)}ms (budget ${BUDGET_MS}ms) — ` +
      `the per-key work is no longer O(1); check parsePayload's key comparison`,
  );
});

test(`verifies a ${KEY_COUNT}-key export well inside ${BUDGET_MS}ms (nothing downstream is quadratic either)`, () => {
  // Covers the parser, the HA-7 preimage build (a pass over every key) and all
  // of Stage A — seq, ts, the prev_hash anchor and the HA-14 hash comparison —
  // through to the entry of Stage B. A per-key linear scan added anywhere in
  // that stretch (a `find` over the payload inside a per-key loop, say) shows
  // up here and not in the parser-only budget above.
  //
  // WHAT IT DOES NOT COVER: Stage B's own per-key work. The hash is correct, so
  // Stage B IS entered — but `(genesis, 1)` defines seven payload keys, so the
  // ES-18/ES-34 key-set check rejects `k000000000` on sight and nothing further
  // runs. No 128k-key payload can do better for a registered type: every key
  // past the defined set is rejected at the first comparison, by construction.
  // Stage B's key handling is bounded by the key set, not by the input.
  const bytes = Buffer.concat([manyKeyLine(KEY_COUNT), Buffer.from("\n")]);
  const t0 = process.hrtime.bigint();
  const verdict = verifyExport(bytes);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(
    ["VALID", "INVALID", "PARTIAL"].includes(verdict.verdict),
    "EV-17: exactly one of the three verdicts",
  );
  // A COVERAGE PROBE, not an oracle: advisory reason text is never
  // conformance-checked (EV-17), and `contracts/fixtures/` remains the only
  // authority on what an input verifies to. It is asserted here because it is
  // the one signal that this timing spans what the comment above says it does
  // — a stale or placeholder `hash` would report HA-14 instead, and the budget
  // would quietly stop measuring most of the path.
  assert.match(
    verdictLine(verdict),
    /Stage B/,
    `expected verification to reach Stage B, got: ${verdictLine(verdict)}`,
  );
  assert.ok(
    ms < BUDGET_MS,
    `verifying a ${KEY_COUNT}-key export took ${ms.toFixed(0)}ms (budget ${BUDGET_MS}ms)`,
  );
});
