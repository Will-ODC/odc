// Regression tests for the unbounded `f(...array)` argument-spread defect:
// Node throws `RangeError: Maximum call stack size exceeded` once a spread
// array exceeds ~130k elements. Two call sites were affected — this file
// pins both so they cannot silently regress.
//
// These are robustness checks, NOT invented conformance verdicts: fixtures
// (`test/fixtures.test.ts`) remain the sole oracle for what verifies VALID.
// Neither test below signs anything or asserts a full-chain VALID verdict.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport } from "../src/verify.js";
import { parseEventLine } from "../src/parse.js";

test("verifyExport on ~200000 blank lines returns INVALID at line 1 and does not throw", () => {
  // Every blank line is a framing fault (EX-5); frame() pushes one fault per
  // line, so this previously built an invalidLines array far past the
  // argument-spread limit and crashed Math.min(...invalidLines) with an
  // uncaught RangeError instead of returning a verdict (violating EV-17: a
  // verifier must return exactly one of the three verdicts).
  const bytes = Buffer.from("\n".repeat(200_000), "utf8");
  const result = verifyExport(bytes);
  assert.deepEqual(result, { verdict: "INVALID", line: 1 });
});

test("the canonical line parser accepts a syntactically valid line with a ~200000-char payload string", () => {
  // The spec places no length bound on string values (ET-9 requires
  // `contracts` only non-empty; ES-19 only well-formed UTF-8), so a long
  // payload value must still parse. Previously, String.fromCodePoint(...cps)
  // threw once the decoded string exceeded ~130k code points, and
  // parseEventLine's catch-all swallowed that RangeError as if the line were
  // INVALID. This does not assert a full-chain VALID verdict (that needs a
  // real signature and would be inventing an oracle beyond the fixtures) —
  // only that the single-line parse itself succeeds rather than throwing or
  // being mis-reported as unparseable.
  const hugeValue = "a".repeat(200_000);
  const line = Buffer.from(
    "{" +
      `"seq":1,` +
      `"type":"genesis",` +
      `"version":1,` +
      `"payload":{"contracts":"${hugeValue}"},` +
      `"ts":"2024-01-01T00:00:00.000Z",` +
      `"prev_hash":"${"0".repeat(64)}",` +
      `"hash":"${"1".repeat(64)}"` +
      "}",
    "utf8",
  );
  const parsed = parseEventLine(line);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.payload[0]?.val.value, hugeValue);
});
