import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { vectors } from "../src/vectors/index.js";

// These are contract verdicts, declared independently of the generator's bytes.
const expected = [
  ["099-batch-resumed", "INVALID", 9],
  ["100-batch-interleaved-issues", "VALID"],
  ["101-under-size-not-last", "INVALID", 6],
  ["102-under-size-last-interleaved", "VALID"],
  ["103-off-interval-ballot", "INVALID", 4],
  ["104-interval-below-floor", "INVALID", 2],
  ["105-minimum-below-floor", "INVALID", 2],
  ["106-run-two-then-three-return", "INVALID", 5],
  ["107-run-one-then-three-return", "INVALID", 4],
  ["108-two-full-batches", "VALID"],
] as const;

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "contracts/fixtures/vectors",
);
type EventLine = {
  type: string;
  ts: string;
  hash: string;
  payload: Record<string, string | number>;
};
const events = (id: string): EventLine[] =>
  readFileSync(join(fixtures, `${id}.ndjson`), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as EventLine);
const ballotMinutes = (id: string): number[] => {
  const rows = events(id);
  const issue = rows.find((e) => e.type === "issue_created");
  assert.ok(issue);
  return rows
    .filter((e) => e.type === "vote_cast" && e.payload.issue_id === issue.hash)
    .map((e) => Date.parse(e.ts) / 60_000);
};

test("phase-3 vectors pin ET-14b, ET-23, ET-24 and ET-24a verdicts", () => {
  for (const [id, verdict, line] of expected) {
    const vector = vectors.find((v) => v.id === id);
    assert.ok(vector, `${id} is missing`);
    assert.deepEqual(
      vector.expect,
      line === undefined ? { verdict } : { verdict, line },
      `${id} must declare the contract's verdict and first fatal line`,
    );
  }
});

test("committed batch bytes preserve the run and line-attribution counterexamples", () => {
  const base = Date.parse("2026-07-21T00:00:00.000Z") / 60_000;
  for (const [id, offsets] of [
    ["099-batch-resumed", [10, 10, 10, 11, 11, 11, 10]],
    ["106-run-two-then-three-return", [10, 10, 11, 11, 11, 10]],
    ["107-run-one-then-three-return", [10, 11, 11, 11, 10, 10]],
    ["108-two-full-batches", [10, 10, 10, 11, 11, 11]],
  ] as [string, number[]][]) {
    assert.deepEqual(
      ballotMinutes(id),
      offsets.map((n) => base + n),
      id,
    );
  }
  const interleaved = events("100-batch-interleaved-issues");
  assert.equal(
    interleaved[3]?.payload.issue_id,
    interleaved[5]?.payload.issue_id,
  );
  assert.notEqual(
    interleaved[3]?.payload.issue_id,
    interleaved[4]?.payload.issue_id,
  );
  assert.equal(interleaved[3]?.ts, interleaved[5]?.ts);
  const offInterval = events("103-off-interval-ballot");
  assert.equal(offInterval[2]?.payload.ballot_batch_interval_ms, 120_000);
  assert.equal(offInterval[3]?.ts, "2026-07-21T00:05:00.000Z");
});
