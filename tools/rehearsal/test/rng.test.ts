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

  it("accepts the boundary seeds", () => {
    assert.doesNotThrow(() => new Rng(-0x8000_0000));
    assert.doesNotThrow(() => new Rng(0xffff_ffff));
  });

  it("rejects a seed outside [-2^31, 2^32)", () => {
    assert.throws(() => new Rng(-0x8000_0001), RangeError);
    assert.throws(() => new Rng(0x1_0000_0000), RangeError);
    assert.throws(() => new Rng(2 ** 53), RangeError);
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

    // Pinned literals from a maxExclusive (0xC0000000, ~75% of 2^32) chosen so
    // rejection sampling actually rejects on this short run — about a quarter
    // of draws are discarded and re-drawn. A `limit = TWO_32` mutation (plain
    // biased modulo, no rejection) keeps every other test in this file green
    // but silently changes which draws get discarded, so it diverges from
    // these literals by the third value. Confirmed: with the mutation applied,
    // this sequence's third element is 302948861, not 3011703609.
    it("rejection-samples rather than using plain biased modulo", () => {
      const rng = new Rng(1);
      const maxExclusive = 0xc000_0000;
      const draws = Array.from({ length: 8 }, () => rng.int(maxExclusive));
      assert.deepEqual(
        draws,
        [
          1580013426, 350525680, 3011703609, 643872864, 2282937712, 2300340400,
          2737271936, 2551088109,
        ],
      );
    });

    it("accepts maxExclusive === 2^32", () => {
      const rng = new Rng(1);
      assert.doesNotThrow(() => rng.int(2 ** 32));
    });

    it("rejects maxExclusive > 2^32", () => {
      const rng = new Rng(1);
      assert.throws(() => rng.int(2 ** 32 + 1), RangeError);
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

    it("accepts a span of exactly 2^32", () => {
      const rng = new Rng(1);
      assert.doesNotThrow(() => rng.intBetween(0, 2 ** 32 - 1));
    });

    it("rejects a span over 2^32, inheriting int's guard", () => {
      const rng = new Rng(1);
      assert.throws(() => rng.intBetween(0, 2 ** 32), RangeError);
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

    // Mirrors int's "reaches every value of a small range": an `items.length -
    // 1` off-by-one satisfies "returns only elements of the array" above
    // (every value it returns IS in the array) while never returning the last
    // element. Only asserting every element is actually reached kills that
    // mutation.
    it("reaches every element, including the last", () => {
      const rng = new Rng(4);
      const items = ["a", "b", "c"] as const;
      const seen = new Set<string>();
      for (let i = 0; i < 200; i += 1) seen.add(rng.pick(items));
      assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
    });

    it("throws on an empty array rather than returning undefined", () => {
      const rng = new Rng(1);
      assert.throws(() => rng.pick([]), RangeError);
    });
  });
});
