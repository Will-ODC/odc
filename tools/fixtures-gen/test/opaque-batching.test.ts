import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { vectors } from "../src/vectors/index.js";

// ADR-0034's vectors. The verdicts are declared from ET-18b/ET-24b and checked
// for agreement with the exact rule by docs/security/attacks/
// check-adr-0034-agreement.py. The first test below is only a change detector
// (it restates the declarations, so it proves nothing about their truth); the
// shape tests after it are the substance: they pin what makes each vector test
// what its note says, so an edit to the builder cannot quietly turn one into a
// different test.
const expected = [
  ["116-opaque-member", "PARTIAL", [6, 7]],
  ["117-opaque-payload-names-other-issue", "PARTIAL", [6, 7]],
  ["118-opaque-insufficient-even-optimistically", "INVALID", 6],
  ["119-opaque-closure", "PARTIAL", [7, 8]],
  ["120-definite-resumed-instant", "INVALID", 11],
  ["121-opaque-after-full-batch", "PARTIAL", [7]],
  ["122-known-only-control", "INVALID", 6],
  ["123-opaque-cannot-excuse-off-interval", "INVALID", 5],
  ["124-ballot-of-unreadable-issue", "PARTIAL", [3, 4]],
  ["125-two-opaque-ballots-fill-a-batch", "PARTIAL", [5, 6, 7]],
  ["126-opaque-before-first-ballot", "PARTIAL", [4, 7]],
  ["127-issues-share-an-instant", "PARTIAL", [6, 7, 10, 11]],
  ["128-opaque-off-one-issues-interval", "INVALID", 7],
  ["129-opaque-before-the-issue", "INVALID", 7],
  ["130-opaque-ballot-malformed-payload", "INVALID", 6],
  ["131-opaque-in-an-earlier-run", "PARTIAL", [7, 8]],
  ["132-unregistered-non-ballot-is-no-candidate", "INVALID", 7],
  ["133-candidate-before-the-runs-window", "INVALID", 10],
  ["134-candidate-at-a-run-starts-instant", "PARTIAL", [4, 5, 8]],
] as const;

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "contracts/fixtures/vectors",
);

type EventLine = {
  type: string;
  version: number;
  ts: string;
  hash: string;
  payload: Record<string, unknown>;
};

function events(id: string): EventLine[] {
  return readFileSync(resolve(fixtures, `${id}.ndjson`), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as EventLine);
}

const isOpaqueBallot = (e: EventLine) =>
  e.type === "vote_cast" && e.version === 1000000;

test("each ADR-0034 vector declares the verdict and lines its note argues for", () => {
  for (const [id, verdict, where] of expected) {
    const v = vectors.find((x) => x.id === id);
    assert.ok(v, `${id} is missing`);
    assert.equal(v.expect.verdict, verdict, id);
    if (verdict === "INVALID")
      assert.deepEqual(v.expect, { verdict, line: where });
    else assert.deepEqual(v.expect, { verdict, lines: where });
  }
});

test("every opaque ballot is vote_cast at the EV-19 reserved version", () => {
  for (const [id] of expected) {
    for (const e of events(id)) {
      if (e.type === "vote_cast") {
        assert.ok(
          e.version === 1 || e.version === 1000000,
          `${id}: vote_cast at version ${String(e.version)}`,
        );
      }
    }
  }
  // Each PARTIAL vector except 124 (ET-18b, an opaque issue) holds an opaque ballot.
  for (const [id, verdict] of expected) {
    if (verdict !== "PARTIAL" || id.startsWith("124")) continue;
    assert.ok(events(id).some(isOpaqueBallot), `${id} has no opaque ballot`);
  }
});

test("117 differs from 116 only in which issue the opaque payload names", () => {
  const a = events("116-opaque-member");
  const b = events("117-opaque-payload-names-other-issue");
  assert.equal(a.length, b.length);
  const [issueA, issueB] = [a[1]?.hash, a[2]?.hash];
  assert.equal(a[5]?.payload["issue_id"], issueA);
  assert.equal(b[5]?.payload["issue_id"], issueB);
  for (let i = 0; i < 5; i++)
    assert.deepEqual(a[i], b[i], `line ${String(i + 1)}`);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i]?.ts, b[i]?.ts, `line ${String(i + 1)} ts`);
    assert.equal(a[i]?.type, b[i]?.type);
  }
});

test("128's opaque ballot is on A's interval but off B's", () => {
  const e = events("128-opaque-off-one-issues-interval");
  const u = e.find(isOpaqueBallot);
  assert.ok(u);
  const ms = Date.parse(u.ts);
  assert.equal(e[1]?.payload["ballot_batch_interval_ms"], 60_000);
  assert.equal(e[2]?.payload["ballot_batch_interval_ms"], 120_000);
  assert.equal(ms % 60_000, 0);
  assert.notEqual(ms % 120_000, 0);
});

test("129's opaque ballot comes before issue B, so it is no candidate of B", () => {
  const e = events("129-opaque-before-the-issue");
  const u = e.findIndex(isOpaqueBallot);
  const b = e.findIndex((x, i) => x.type === "issue_created" && i > 1);
  assert.ok(u > 0 && b > u, "the opaque ballot must precede issue B");
});

test("124's ballot names an issue_created at an unregistered version", () => {
  const e = events("124-ballot-of-unreadable-issue");
  assert.equal(e[2]?.type, "issue_created");
  assert.equal(e[2]?.version, 1000000);
  assert.equal(e[3]?.type, "vote_cast");
  assert.equal(e[3]?.version, 1);
  assert.equal(e[3]?.payload["issue_id"], e[2]?.hash);
});

test("130's opaque ballot carries a float, so it has no preimage (EV-16)", () => {
  const raw = readFileSync(
    resolve(fixtures, "130-opaque-ballot-malformed-payload.ndjson"),
    "utf8",
  ).split("\n")[5];
  assert.match(raw ?? "", /"n":3\.5/);
  assert.match(raw ?? "", /"version":1000000/);
});
