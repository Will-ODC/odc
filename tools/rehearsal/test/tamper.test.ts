// Two things are load-bearing. (1) Determinism by seed is T6c's acceptance
// criterion — but determinism ALONE is satisfied by a tool that ignores its
// seed, so "the seed selects the target" is asserted separately. (2) Nothing is
// pinned to a chosen seed: T6b shipped five pinned seeds that stopped testing
// anything the moment an upstream RNG draw count shifted, suite still green.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Event } from "@odc/fixtures-gen/encode";
import { serializeEvent } from "@odc/fixtures-gen/serialize";

import { buildChain, type RehearsalChain } from "../src/build.js";
import {
  applyTamper,
  ENVELOPE_KEYS,
  exportLines,
  isTamperCase,
  swapEnvelopeKeys,
  TAMPER_CASES,
  type TamperCase,
  type TamperResult,
} from "../src/tamper.js";

const CHAINS: RehearsalChain[] = [
  buildChain(11, { participants: 3, issues: 2, votes: 4 }),
  buildChain(77, { participants: 5, issues: 3, votes: 9 }),
];
const CHAIN = CHAINS[0] as RehearsalChain;

// Ranges, not a hand-picked handful: a property holding for 80 consecutive
// seeds on two shapes is no accident of one draw sequence. The last two values
// reach the top of `Rng`'s accepted range.
const SEEDS: number[] = [
  ...Array.from({ length: 80 }, (_, i) => i),
  99991,
  0xffff_ffff,
];

const obj = (l: string): Record<string, unknown> =>
  JSON.parse(l) as Record<string, unknown>;
const field = (l: string, k: string): string => String(obj(l)[k]);
const without = (l: string, k: string): Record<string, unknown> => {
  const o = obj(l);
  delete o[k];
  return o;
};
const at = (ls: readonly string[], n: number): string => ls[n - 1] as string;
const drop = (ls: readonly string[], n: number): string[] =>
  ls.filter((_, i) => i !== n - 1);
const storedHead = (ls: readonly string[]): string =>
  field(at(ls, ls.length), "hash");

/** 1-based line numbers where the two files differ, length change included. */
function diffLines(a: readonly string[], b: readonly string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) out.push(i + 1);
  }
  return out;
}

describe("the case list", () => {
  it("is the odc-contracts matrix, over EX-7's fields in EX-7's order", () => {
    assert.equal(
      TAMPER_CASES.join(" "),
      "byte-flip line-deletion line-reordering truncation duplicated-seq" +
        " wrong-prev-hash reserialized-line wrong-head",
    );
    const ex7 = "seq type version payload ts prev_hash hash";
    assert.equal(ENVELOPE_KEYS.join(" "), ex7);
  });

  it("recognises every case flag and nothing else", () => {
    for (const kase of TAMPER_CASES) assert.ok(isTamperCase(kase));
    for (const s of ["", "byte flip", "byteflip", "BYTE-FLIP", "line-swap"]) {
      assert.ok(!isTamperCase(s), `${s} accepted`);
    }
  });
});

describe("determinism by seed (T6c acceptance)", () => {
  for (const kase of TAMPER_CASES) {
    it(`${kase} is byte-identical for the same seed`, () => {
      for (const chain of CHAINS) {
        for (const seed of SEEDS) {
          const a = applyTamper(chain, kase, seed);
          const b = applyTamper(chain, kase, seed);
          assert.deepEqual(a.ndjson, b.ndjson);
          assert.equal(a.head, b.head);
          assert.equal(a.line, b.line);
          assert.equal(a.case, kase);
          assert.equal(a.seed, seed);
        }
      }
    });
  }

  // Without this, deleting the seed argument passes every test above.
  it("varies line and bytes with the seed, bar the case that draws none", () => {
    for (const kase of TAMPER_CASES) {
      const lines = new Set<number>();
      const bytes = new Set<string>();
      for (const seed of SEEDS) {
        const r = applyTamper(CHAIN, kase, seed);
        lines.add(r.line);
        bytes.add(`${r.ndjson.toString("hex")}:${r.head}`);
      }
      if (kase === "wrong-head") {
        // No draw: the export is untouched, EX-19 fixes the line at the last.
        assert.equal(lines.size, 1, "wrong-head is not seed-independent");
        assert.equal(bytes.size, 1);
      } else {
        assert.ok(lines.size > 1, `${kase} ignores its seed (line)`);
        assert.ok(bytes.size > 1, `${kase} ignores its seed (bytes)`);
      }
    }
  });
});

type Check = (
  r: TamperResult,
  out: readonly string[],
  base: readonly string[],
  trueHead: string,
) => void;

// Each case asserts its defect POSITIVELY — the exact line, changed in the
// exact way — not "something differs". T5g's review found three mutants
// surviving a suite that only checked the latter, one of which emitted
// perfectly canonical bytes under an INVALID declaration.
// The two single-field flips. `without` is what separates them: byte-flip moves
// `hash` and nothing else (the line stops hashing to what it claims), while
// wrong-prev-hash moves `prev_hash` and nothing else (a broken LINK). Each check
// fails if the tool produced the other one.
const flipsOnly =
  (key: string): Check =>
  (r, out, base) => {
    assert.equal(out.length, base.length);
    assert.deepEqual(diffLines(base, out), [r.line]);
    const b = at(base, r.line);
    const a = at(out, r.line);
    assert.notEqual(field(a, key), field(b, key));
    assert.match(field(a, key), /^[0-9a-f]{64}$/);
    assert.deepEqual(without(a, key), without(b, key));
    assert.equal(r.head, storedHead(out));
  };

const CHECKS: Record<TamperCase, Check> = {
  "byte-flip": flipsOnly("hash"),
  "line-deletion": (r, out, base, trueHead) => {
    assert.ok(r.line >= 1 && r.line < base.length, "last line is truncation");
    assert.deepEqual(out, drop(base, r.line));
    assert.equal(r.head, trueHead);
  },
  "line-reordering": (r, out, base) => {
    assert.equal(out.length, base.length);
    const changed = diffLines(base, out);
    assert.equal(changed.length, 2);
    assert.equal(changed[0], r.line, "not the earlier of the two lines");
    const [a, b] = changed as [number, number];
    assert.equal(at(out, a), at(base, b));
    assert.equal(at(out, b), at(base, a));
    // A permutation: no line's bytes were edited, only their order.
    assert.deepEqual([...out].sort(), [...base].sort());
  },
  truncation: (r, out, base, trueHead) => {
    assert.ok(r.line >= 1 && r.line < base.length, "nothing was dropped");
    assert.deepEqual(out, base.slice(0, r.line));
    assert.equal(r.head, trueHead, "the true head is the only evidence");
    assert.notEqual(r.head, storedHead(out));
  },
  "duplicated-seq": (r, out, base, trueHead) => {
    const copy = at(out, r.line);
    const orig = at(out, r.line - 1);
    assert.equal(out.length, base.length + 1);
    assert.equal(copy, orig, "the copy is no copy");
    assert.equal(field(copy, "seq"), field(orig, "seq"));
    assert.deepEqual(drop(out, r.line), base);
    assert.equal(r.head, trueHead);
  },
  "wrong-prev-hash": flipsOnly("prev_hash"),
  "reserialized-line": (r, out, base, trueHead) => {
    assert.equal(out.length, base.length);
    assert.deepEqual(diffLines(base, out), [r.line]);
    const b = at(base, r.line);
    const a = at(out, r.line);
    assert.deepEqual(obj(a), obj(b), "the values must survive");
    assert.notEqual(a, b, "the bytes must not");
    assert.equal(
      b,
      serializeEvent(JSON.parse(b) as Event),
      "base not canonical",
    );
    assert.notEqual(
      a,
      serializeEvent(JSON.parse(a) as Event),
      "still canonical",
    );
    assert.equal(r.head, trueHead);
  },
  "wrong-head": (r, out, base, trueHead) => {
    assert.deepEqual(out, base, "the export bytes were touched");
    assert.notEqual(r.head, trueHead);
    assert.match(r.head, /^[0-9a-f]{64}$/);
    assert.equal(r.line, base.length, "EX-19 attributes this to the last line");
  },
};

// `exportLines` on the RESULT is itself an assertion: it throws on a missing
// final LF, a CR or a blank line, so every run below also proves the tampered
// export stays canonically framed and the mutation is the only defect.
describe("structural properties, quantified over seeds", () => {
  for (const kase of TAMPER_CASES) {
    it(`${kase} produces its declared defect at its declared line`, () => {
      for (const chain of CHAINS) {
        const base = exportLines(chain.ndjson);
        for (const seed of SEEDS) {
          const r = applyTamper(chain, kase, seed);
          const untouched = r.ndjson.equals(chain.ndjson);
          assert.equal(untouched, kase === "wrong-head", "wrong byte effect");
          CHECKS[kase](r, exportLines(r.ndjson), base, chain.head);
        }
      }
    });
  }
});

describe("refusing to fail open", () => {
  const target = (ls: readonly string[]): { ndjson: Buffer; head: string } => ({
    ndjson: Buffer.from(`${ls.join("\n")}\n`, "utf8"),
    head: storedHead(ls),
  });
  const base = exportLines(CHAIN.ndjson);

  // Pins the two-line minimum by behaviour, not by restating the constant.
  it("refuses a one-line export, whatever the case", () => {
    const one = target(base.slice(0, 1));
    for (const kase of TAMPER_CASES) {
      assert.throws(() => applyTamper(one, kase, 1), RangeError, kase);
    }
  });

  it("tampers a two-line export, whatever the case", () => {
    const two = target(base.slice(0, 2));
    for (const kase of TAMPER_CASES) {
      const r = applyTamper(two, kase, 5);
      assert.ok(r.line >= 1 && r.line <= 3, `${kase} line ${String(r.line)}`);
    }
  });

  it("refuses a head that is not the last line's stored hash", () => {
    const bad = { ndjson: CHAIN.ndjson, head: "0".repeat(64) };
    assert.throws(() => applyTamper(bad, "byte-flip", 1), /EX-14/);
  });

  it("refuses an export that is not already canonically framed", () => {
    const two = base.slice(0, 2).join("\n");
    const blank = `${at(base, 1)}\n\n${at(base, 2)}\n`;
    assert.throws(() => exportLines(Buffer.alloc(0)), /EX-6/);
    assert.throws(() => exportLines(Buffer.from(two, "utf8")), /EX-4/);
    assert.throws(() => exportLines(Buffer.from(`${two}\r\n`, "utf8")), /EX-3/);
    assert.throws(() => exportLines(Buffer.from(blank, "utf8")), /EX-5/);
    assert.doesNotThrow(() => exportLines(CHAIN.ndjson));
  });

  it("refuses a key index outside the six adjacent envelope pairs", () => {
    for (const k of [-1, 6, 7, 1.5]) {
      assert.throws(() => swapEnvelopeKeys(base, 1, k), RangeError, String(k));
    }
    assert.throws(() => swapEnvelopeKeys(base, base.length + 1, 0), RangeError);
  });

  it("refuses to reserialize a line that was not canonical to begin with", () => {
    const spaced = at(base, 1).replace('"seq":', '"seq": ');
    assert.throws(() => swapEnvelopeKeys([spaced], 1, 0), /canonical/);
  });

  // Every k must move bytes, including k=5, which takes `hash` off the end.
  it("swaps each of the six adjacent envelope pairs, all six visibly", () => {
    const seen = new Set<string>();
    for (let k = 0; k <= 5; k += 1) {
      const line = at(swapEnvelopeKeys(base, 1, k), 1);
      assert.notEqual(line, at(base, 1));
      assert.deepEqual(obj(line), obj(at(base, 1)));
      seen.add(line);
    }
    assert.equal(seen.size, 6, "two key indices produced the same bytes");
  });
});
