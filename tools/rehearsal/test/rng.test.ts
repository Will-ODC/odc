import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Rng } from "../src/rng.js";

describe("Rng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const left = Array.from({ length: 64 }, () => a.nextUint32());
    const right = Array.from({ length: 64 }, () => b.nextUint32());
    assert.deepEqual(left, right);
  });

  it("produces a different sequence for a different seed", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const left = Array.from({ length: 16 }, () => a.nextUint32());
    const right = Array.from({ length: 16 }, () => b.nextUint32());
    assert.notDeepEqual(left, right);
  });

  // Pinned literals, not a self-consistency check. Without these, swapping the
  // generator for any other deterministic one keeps every other test in this
  // file green while silently changing every chain the rehearsal has ever built
  // — and a seed printed in a T8 bug report would no longer rebuild its chain.
  it("pins the first draws of seed 1 so the generator cannot be swapped silently", () => {
    const rng = new Rng(1);
    assert.deepEqual(
      [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()],
      [1580013426, 350525680, 3524174333],
    );
  });

  it("treats the seed as 32 bits unsigned", () => {
    const negative = new Rng(-1);
    const wrapped = new Rng(0xffff_ffff);
    assert.equal(negative.nextUint32(), wrapped.nextUint32());
  });

  it("rejects a non-integer seed", () => {
    assert.throws(() => new Rng(1.5), TypeError);
  });

  it("draws only within 0 … 2^32-1", () => {
    const rng = new Rng(99);
    for (let i = 0; i < 10_000; i += 1) {
      const n = rng.nextUint32();
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff, String(n));
    }
  });

  describe("int", () => {
    it("stays inside [0, maxExclusive)", () => {
      const rng = new Rng(7);
      for (let i = 0; i < 5_000; i += 1) {
        const n = rng.int(64);
        assert.ok(n >= 0 && n < 64, String(n));
      }
    });

    it("reaches every value of a small range", () => {
      const rng = new Rng(4);
      const seen = new Set<number>();
      for (let i = 0; i < 200; i += 1) seen.add(rng.int(3));
      assert.deepEqual([...seen].sort(), [0, 1, 2]);
    });

    it("int(1) is always 0", () => {
      const rng = new Rng(5);
      for (let i = 0; i < 50; i += 1) assert.equal(rng.int(1), 0);
    });

    it("rejects a non-positive or non-integer bound", () => {
      const rng = new Rng(1);
      assert.throws(() => rng.int(0), RangeError);
      assert.throws(() => rng.int(-3), RangeError);
      assert.throws(() => rng.int(2.5), RangeError);
    });
  });

  describe("intBetween", () => {
    it("is inclusive at both ends", () => {
      const rng = new Rng(11);
      const seen = new Set<number>();
      for (let i = 0; i < 500; i += 1) seen.add(rng.intBetween(2, 5));
      assert.deepEqual([...seen].sort(), [2, 3, 4, 5]);
    });

    it("allows min === max", () => {
      const rng = new Rng(3);
      assert.equal(rng.intBetween(9, 9), 9);
    });

    it("rejects max < min", () => {
      const rng = new Rng(1);
      assert.throws(() => rng.intBetween(5, 4), RangeError);
    });
  });

  describe("pick", () => {
    it("returns only elements of the array", () => {
      const rng = new Rng(21);
      const items = ["a", "b", "c"] as const;
      for (let i = 0; i < 200; i += 1) {
        assert.ok(items.includes(rng.pick(items)));
      }
    });

    it("throws on an empty array rather than returning undefined", () => {
      const rng = new Rng(1);
      assert.throws(() => rng.pick([]), RangeError);
    });
  });
});
