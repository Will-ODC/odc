// Value-level fuzzing for the unbounded-value defect class.
//
// WHY THIS EXISTS, and why it is not a byte fuzzer. A byte fuzzer flips bytes
// in a valid export and will essentially never build a 130k-element array,
// because flipping bytes does not grow the input. The two real defects this
// class produced (pinned in `robustness.test.ts`) both needed a
// *structurally valid* export carrying an *extreme value*: 200k lines, or a
// 200k-character string. That is what this file generates.
//
// Both of those defects were wrong-verdict bugs, not crashes-only:
//   - `Math.min(...invalidLines)` threw, so the verifier returned NO verdict,
//     violating EV-17's "exactly one of three verdicts".
//   - `String.fromCodePoint(...cps)` threw inside the parser, and the
//     catch-all swallowed it as `INVALID` — a silently wrong verdict on a
//     line that parses fine.
//
// WHAT IS ASSERTED, and deliberately nothing more: that the verifier does not
// throw, and returns exactly one well-formed verdict of the three. The
// verdict *value* is NOT asserted. `contracts/fixtures/` remains the sole
// oracle for which inputs are VALID/INVALID/PARTIAL; asserting a verdict here
// would be inventing conformance in a file no reviewer treats as normative.
//
// Generation is deterministic (a fixed-seed LCG), so a failure is reproducible
// from the case index printed in the assertion message.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport, type Verdict } from "../src/verify.js";

/** Deterministic 32-bit LCG (Numerical Recipes). No dependency, reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ZERO64 = "0".repeat(64);
const HEX64 = "1".repeat(64);
const HEX128 = "2".repeat(128);

/**
 * Extreme scalar values. Each is structurally legal JSON in the position it is
 * used; the point is magnitude, not malformedness. Boundary integers are
 * included because a verifier that reaches for a float somewhere silently
 * loses precision past 2^53 rather than failing loudly.
 */
function extremeStrings(rng: () => number): string[] {
  const bigLen = 150_000 + Math.floor(rng() * 60_000); // straddles the ~130k limit
  return [
    "",
    "a".repeat(bigLen),
    "é".repeat(bigLen), // 2-byte UTF-8: byte length != code point count
    "\u{1f600}".repeat(Math.floor(bigLen / 2)), // surrogate pairs: cp count != UTF-16 length
    "\\u0000".repeat(20_000), // escape-heavy: decoder allocates per escape
  ];
}

const EXTREME_INTS = [
  0,
  1,
  -1,
  9007199254740991, // 2^53 - 1
  9007199254740992, // 2^53      — indistinguishable from the above as a double
  -9007199254740992,
];

function line(fields: Record<string, string>): string {
  return (
    "{" +
    Object.entries(fields)
      .map(([k, v]) => `"${k}":${v}`)
      .join(",") +
    "}"
  );
}

function jstr(s: string): string {
  // Only the escapes a canonical line may carry (EX-9); the generator's job is
  // extreme *values*, so it must not emit syntactically broken strings.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/** A structurally valid genesis-shaped line carrying one extreme value. */
function genesisLine(contracts: string, seq: number | string): string {
  return line({
    seq: String(seq),
    type: '"genesis"',
    version: "1",
    payload:
      `{"chain_id":"${HEX64}","contracts":${jstr(contracts)},` +
      `"operator_pk":"${HEX64}","registrar_pk":"${HEX64}","sig":"${HEX128}"}`,
    ts: '"2024-01-01T00:00:00.000Z"',
    prev_hash: `"${ZERO64}"`,
    hash: `"${HEX64}"`,
  });
}

/** Every generated case: a name (for reproducibility) and the export bytes. */
function* cases(rng: () => number): Generator<{ name: string; bytes: Buffer }> {
  // 1. Extreme string values in a payload position.
  for (const [i, s] of extremeStrings(rng).entries()) {
    yield {
      name: `huge-string-${i}(len=${s.length})`,
      bytes: Buffer.from(genesisLine(s, 1) + "\n", "utf8"),
    };
  }

  // 2. Boundary integers in the `seq` position, where precision loss bites.
  for (const n of EXTREME_INTS) {
    yield {
      name: `extreme-seq(${n})`,
      bytes: Buffer.from(genesisLine("odc/v1", n) + "\n", "utf8"),
    };
  }

  // 3. Extreme LINE COUNTS of well-formed lines — the shape that broke
  //    Math.min(...invalidLines). Each line is structurally valid, so the
  //    fault array grows with the input rather than with malformedness.
  for (const count of [130_000, 200_000]) {
    const body = genesisLine("odc/v1", 1) + "\n";
    yield {
      name: `many-valid-lines(${count})`,
      bytes: Buffer.from(body.repeat(count), "utf8"),
    };
  }

  // 4. Extreme line counts of *faulting* lines — one fault per line, which is
  //    exactly how the original RangeError was reached.
  for (const count of [130_000, 200_000]) {
    yield {
      name: `many-fault-lines(${count})`,
      bytes: Buffer.from("{}\n".repeat(count), "utf8"),
    };
  }

  // 5. Deep nesting — an unbounded value in the *structural* dimension rather
  //    than the length one, where a recursive-descent parser blows the stack.
  for (const depth of [10_000, 100_000]) {
    const nested = "[".repeat(depth) + "]".repeat(depth);
    yield {
      name: `deep-nesting(${depth})`,
      bytes: Buffer.from(
        line({
          seq: "1",
          type: '"genesis"',
          version: "1",
          payload: `{"contracts":${nested}}`,
          ts: '"2024-01-01T00:00:00.000Z"',
          prev_hash: `"${ZERO64}"`,
          hash: `"${HEX64}"`,
        }) + "\n",
        "utf8",
      ),
    };
  }

  // 6. Many keys in one payload object. The index is ZERO-PADDED so the keys
  //    are in ascending UTF-8-byte order (EX-8) and the parser actually walks
  //    all n of them: with an unpadded index `k10` sorts before `k2`, so the
  //    line was rejected at the SECOND key and this case never reached a many-
  //    key payload at all.
  for (const n of [50_000, 150_000]) {
    const keys = Array.from(
      { length: n },
      (_, i) => `"k${String(i).padStart(9, "0")}":1`,
    ).join(",");
    yield {
      name: `many-payload-keys(${n})`,
      bytes: Buffer.from(
        line({
          seq: "1",
          type: '"genesis"',
          version: "1",
          payload: `{${keys}}`,
          ts: '"2024-01-01T00:00:00.000Z"',
          prev_hash: `"${ZERO64}"`,
          hash: `"${HEX64}"`,
        }) + "\n",
        "utf8",
      ),
    };
  }
}

/** EV-17: exactly one of three verdicts, each with its required shape. */
function assertWellFormedVerdict(v: Verdict, name: string): void {
  switch (v.verdict) {
    case "VALID":
      return;
    case "INVALID":
      assert.equal(
        typeof v.line,
        "number",
        `${name}: INVALID must name a line number`,
      );
      assert.ok(v.line >= 1, `${name}: line number must be 1-based`);
      return;
    case "PARTIAL":
      assert.ok(Array.isArray(v.lines), `${name}: PARTIAL must name lines`);
      assert.ok(v.lines.length > 0, `${name}: PARTIAL needs at least one line`);
      return;
    default:
      assert.fail(
        `${name}: returned something that is not one of the three verdicts: ${JSON.stringify(v)}`,
      );
  }
}

test("value-level fuzz: extreme values never crash the verifier or skip a verdict", () => {
  const rng = makeRng(0x0dc0_1234);
  let n = 0;
  for (const { name, bytes } of cases(rng)) {
    n += 1;
    let result: Verdict;
    try {
      result = verifyExport(bytes);
    } catch (err) {
      // A throw is the defect itself: EV-17 requires a verdict, and a
      // RangeError here is exactly what shipped twice before.
      assert.fail(
        `case ${n} "${name}" threw instead of returning a verdict: ${String(err)}`,
      );
    }
    assertWellFormedVerdict(result, `case ${n} "${name}"`);
  }
  assert.ok(n > 0, "the generator produced no cases");
});
