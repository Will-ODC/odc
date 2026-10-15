// The uncapped collections (src/collections.ts) and their use by the verifier.
//
// EV-24 forbids a fixed limit on the number of lines, and V8 caps a Map or Set
// at 2^23 entries and a pushed array at 2^26 elements, so every collection
// that grows with the line count is sharded or chunked. These tests check the
// wrappers behave as the built-ins do across shard and chunk boundaries, that
// one real ShardedMap passes 2^23 entries (without asserting where a plain
// Map stops, which differs between engine versions), and that the verifier actually uses
// the wrappers with the caps it is given: with tiny caps every growing
// collection must span several shards and every verdict must be unchanged.
//
// Verdict VALUES here are never asserted on their own: each capped run is
// compared with the same input under the default caps.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_SHIFT,
  ChunkedList,
  SHARD_CAP,
  ShardedMap,
  ShardedSet,
} from "../src/collections.js";
import { ExportVerifier, verifyExport } from "../src/verify.js";
import { recordsOf } from "../src/input.js";
import { BallotBatches } from "../src/batching.js";
import { tokenAndLine } from "./genesis-builder.js";
import { Chain, UNREG } from "./chain-builder.js";

test("ShardedMap: get, has, set and update across shards, insertion order", () => {
  const m = new ShardedMap<number, string>(4);
  for (let i = 0; i < 100; i++) m.set(i, `v${i}`);
  assert.equal(m.size, 100);
  assert.equal(m.shardCount, 25);
  for (let i = 0; i < 100; i++) {
    assert.equal(m.has(i), true);
    assert.equal(m.get(i), `v${i}`);
  }
  assert.equal(m.has(100), false);
  assert.equal(m.get(100), undefined);
  // Updating a key in an old shard updates it there: no duplicate, no growth.
  m.set(1, "updated");
  assert.equal(m.get(1), "updated");
  assert.equal(m.size, 100);
  assert.equal(m.shardCount, 25);
  const values = [...m.values()];
  assert.equal(values.length, 100);
  assert.equal(values[1], "updated");
  assert.equal(values[99], "v99");
});

test("ShardedSet: add, has, duplicates across shards", () => {
  const s = new ShardedSet<string>(3);
  for (let i = 0; i < 10; i++) s.add(`k${i}`);
  for (let i = 0; i < 10; i++) s.add(`k${i}`); // all duplicates
  assert.equal(s.size, 10);
  assert.equal(s.shardCount, 4);
  for (let i = 0; i < 10; i++) assert.equal(s.has(`k${i}`), true);
  assert.equal(s.has("k10"), false);
});

test("ChunkedList: push, at, slice, iteration and join across chunks", () => {
  const l = new ChunkedList(2); // chunks of 4
  const want: number[] = [];
  for (let i = 0; i < 37; i++) {
    l.push(i * 3);
    want.push(i * 3);
  }
  assert.equal(l.length, 37);
  assert.equal(l.chunkCount, 10);
  for (let i = 0; i < 37; i++) assert.equal(l.at(i), want[i]);
  assert.equal(l.at(-1), undefined);
  assert.equal(l.at(37), undefined);
  assert.deepEqual([...l], want);
  assert.deepEqual(l.slice(3, 9), want.slice(3, 9));
  assert.deepEqual(l.slice(30, 100), want.slice(30, 100));
  assert.equal(l.join(", "), want.join(", "));
  assert.equal(ChunkedList.of([1, 2]).join(","), "1,2");
  assert.equal(new ChunkedList(2).join(","), "");
});

test("a ShardedMap filled past 2^23 keys stays correct at every boundary", () => {
  // V8's Map/Set cap differs by version (Node 24 throws at 2^23 entries,
  // Node 20 does not), so this never asserts where a plain Map stops. What
  // it pins is engine-independent: the shard size is at most 2^22, below
  // every cap we know of (2^23 on Node 24, larger on Node 20), and a
  // ShardedMap of the default size holds more keys than the lowest of those
  // caps, with each shard a real Map filled to SHARD_CAP — so SHARD_CAP
  // entries fit in one built-in Map on the engine running the test.
  assert.ok(SHARD_CAP <= 2 ** 22, `SHARD_CAP ${SHARD_CAP}`);
  const n = 2 ** 23 + 1000;
  const m = new ShardedMap<number, number>();
  for (let i = 0; i < n; i++) m.set(i, i);
  assert.equal(m.size, n);
  assert.equal(m.shardCount, Math.ceil(n / SHARD_CAP));
  for (const k of [0, SHARD_CAP - 1, SHARD_CAP, 2 ** 23 - 1, 2 ** 23, n - 1])
    assert.equal(m.get(k), k);
  assert.equal(m.has(n), false);
  m.set(SHARD_CAP - 1, -1); // an update in the first, full shard
  assert.equal(m.get(SHARD_CAP - 1), -1);
  assert.equal(m.size, n);
});

test("a default ChunkedList crosses its real chunk boundary, far below any array cap", () => {
  // Arrays grown by push stop at 2^26 elements on Node 24 (more on some
  // other versions); a chunk is 2^20.
  assert.ok(CHUNK_SHIFT <= 20, `CHUNK_SHIFT ${CHUNK_SHIFT}`);
  const size = 2 ** CHUNK_SHIFT;
  const l = new ChunkedList();
  for (let i = 0; i < 2 * size + 3; i++) l.push(i);
  assert.equal(l.chunkCount, 3);
  for (const i of [0, size - 1, size, 2 * size, 2 * size + 2])
    assert.equal(l.at(i), i);
  assert.deepEqual(l.slice(size - 1, size + 1), [size - 1, size]);
});

/**
 * A chain that makes every growing collection hold several entries: three
 * registered issues at three intervals (issues, groups), one issue that
 * leaves many instants (left), opaque ballots at several instants and many at
 * one instant (opaqueAt and its lists), several unregistered issues
 * (unregisteredIssues) and many PARTIAL lines (partialLines).
 */
function busyChain(): Chain {
  const c = new Chain();
  const minute = (m: number) =>
    `2026-07-21T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00.000Z`;
  const a = c.issue({ intervalMs: 60000, min: 3 });
  const b = c.issue({ intervalMs: 120000, min: 3 });
  c.issue({ intervalMs: 180000, min: 3 });
  const unregistered = [1, 2, 3, 4, 5].map(() => c.issue({ version: UNREG }));
  for (let m = 1; m <= 8; m++) c.votes(a, minute(m), 3); // a leaves 7 instants
  for (let i = 0; i < 9; i++) c.vote(a, minute(20), UNREG); // one instant, many
  for (let m = 21; m <= 26; m++) c.vote(a, minute(m), UNREG); // many instants
  c.votes(a, minute(20), 2); // F from the opaque ballots at minute 20
  c.votes(b, minute(30), 3);
  for (const u of unregistered) c.vote(u, minute(40)); // ET-18b, unresolved
  c.votes(a, minute(41), 3);
  c.vote(a, minute(2)); // ET-24a: returns to an instant left long ago
  return c;
}

test("tiny caps: every growing collection is sharded, and no verdict changes", () => {
  const c = busyChain();
  const tiny = { shardCap: 2, chunkShift: 1 };
  let sawPartial = false;
  let sawInvalid = false;
  let sawValid = false;
  for (let n = 1; n <= c.lastLine; n++) {
    const bytes = c.prefixBytes(n);
    const want = tokenAndLine(verifyExport(bytes));
    const v = new ExportVerifier(undefined, undefined, tiny);
    for (const r of recordsOf(bytes)) {
      if (v.decided) break;
      v.push(r);
    }
    assert.equal(tokenAndLine(v.finish()), want, `prefix of ${n} lines`);
    sawPartial ||= want.startsWith("PARTIAL");
    sawInvalid ||= want.startsWith("INVALID");
    sawValid ||= want === "VALID";
    if (n === c.lastLine - 1) {
      const counts = v.shardCounts();
      assert.ok(counts.issues > 1, `issues: ${counts.issues}`);
      assert.ok(counts.unregisteredIssues > 1, "unregisteredIssues");
      assert.ok(counts.partialLines > 1, "partialLines");
      assert.ok(counts.batches.issues > 1, "batches.issues");
      assert.ok(counts.batches.groups > 1, "batches.groups");
      assert.ok(counts.batches.opaqueAt > 1, "batches.opaqueAt");
      assert.ok(counts.batches.left > 1, "batches.left");
      assert.ok(counts.batches.opaqueList > 1, "batches.opaqueList");
    }
  }
  // The comparison covered all three verdicts, so a lookup that missed an
  // older shard would have had something to change.
  assert.ok(sawValid && sawPartial && sawInvalid);
  assert.match(tokenAndLine(verifyExport(c.bytes())), /^INVALID at line /);
});

test("BallotBatches with tiny caps answers as with the defaults", () => {
  // Driven directly: ET-24a against an instant in an old `left` shard, and
  // ET-24's F counted across list chunks.
  const run = (b: BallotBatches): string[] => {
    const out: string[] = [];
    b.openIssue("a", 1, 60000, 3);
    let seq = 2;
    for (let m = 1; m <= 10; m++)
      for (let k = 0; k < 3; k++) out.push(b.admit("a", seq++, m * 60000));
    for (let k = 0; k < 7; k++) b.opaque(seq++, 20 * 60000);
    out.push(b.admit("a", seq++, 20 * 60000)); // run of 1 at minute 20
    out.push(b.admit("a", seq++, 21 * 60000)); // ends it: F = 7, unresolved
    out.push(b.admit("a", seq++, 3 * 60000)); // returns to a left instant
    return out;
  };
  const tiny = new BallotBatches(2, 1);
  const got = run(tiny);
  assert.deepEqual(got, run(new BallotBatches()));
  assert.equal(got[got.length - 1], "ET-24a");
  assert.equal(got[got.length - 2], "unresolved");
  const counts = tiny.shardCounts();
  assert.ok(counts.left > 1);
  assert.ok(counts.opaqueList > 1);
});
