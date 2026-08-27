// Conformance test: every vector in contracts/fixtures/ must produce the
// DECLARED verdict token and line number(s). Per EV-17 / the fixtures README we
// assert ONLY the verdict and line(s) — never reason text, never exit code.
//
// The fixtures are the ONLY test oracle (no hand-invented chains): a divergence
// here is exactly the signal a second independent verifier exists to surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyExport, type Verdict } from "../src/verify.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/test/ -> repo root is four levels up (test, dist, verifier-ts, tools).
const fixturesDir = resolve(here, "../../../../contracts/fixtures");

interface Vector {
  id: string;
  export: string;
  head?: string;
  expect:
    | { verdict: "VALID" }
    | { verdict: "INVALID"; line: number }
    | { verdict: "PARTIAL"; lines: number[] };
}

const index = JSON.parse(
  readFileSync(resolve(fixturesDir, "index.json"), "utf8"),
) as { vectors: Vector[] };

function actualToExpectShape(v: Verdict): unknown {
  switch (v.verdict) {
    case "VALID":
      return { verdict: "VALID" };
    case "INVALID":
      return { verdict: "INVALID", line: v.line };
    case "PARTIAL":
      return { verdict: "PARTIAL", lines: v.lines };
  }
}

test(`fixtures index has all vectors`, () => {
  assert.equal(index.vectors.length, 94);
});

for (const vec of index.vectors) {
  test(vec.id, () => {
    const bytes = readFileSync(resolve(fixturesDir, vec.export));
    const result = verifyExport(bytes, vec.head);
    assert.deepEqual(
      actualToExpectShape(result),
      vec.expect,
      `vector ${vec.id}: expected ${JSON.stringify(vec.expect)}, got ${JSON.stringify(result)}`,
    );
  });
}
