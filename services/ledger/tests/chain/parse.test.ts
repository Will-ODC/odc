import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseLine,
  serializeLine,
  type ParseResult,
} from "../../src/chain/canonical.js";
import { computeHash } from "../../src/chain/hashing.js";
import { GENESIS_TS } from "./support/builders.js";
import { loadVectors, vectorLines } from "./support/fixtures.js";

// INVALID vectors whose expected line parseLine itself must refuse: envelope
// shape and Stage A (ES-1..ES-26, HA-6), canonical form (EX-9, EX-10), a
// payload with no HA-7 preimage on any type (EV-16: 042, 070, 130, 144), and
// ill-formed UTF-8 (HA-2: 146-150). 043 (CR) and 046 (BOM) are framing faults
// that also leave the LF-split record non-canonical, so parseLine refuses it.
// Excluded: 044 and 047 are framing only (no final LF; no lines at all), and
// every other INVALID vector fails a chain, hash, signature or type rule over
// lines that parse; the sweep asserts their expected line DOES parse.
const PARSE_LEVEL = new Set(
  `012 013 014 018 019 020 021 022 023 024 025 026 027 028 029 030 031 032 033
   036 042 043 045 046 048 049 050 051 052 070 130 144
   146 147 148 149 150`.split(/\s+/),
);
const FRAMING_ONLY = new Set(["044", "047"]);
// The byte comparison would also refuse 146-150; the rule shows the earlier gate.
const why = (r: ParseResult) =>
  r.ok ? "ok" : `${r.refusal.kind} ${r.refusal.rule}`;

describe("parseLine over contracts/fixtures", () => {
  for (const v of loadVectors()) {
    const id = v.id.slice(0, 3);
    const lines = vectorLines(v);
    const e = v.expect;
    const good = e.verdict === "INVALID" ? e.line - 1 : lines.length;
    it(`${v.id}: ${e.verdict} lines parse where they must`, () => {
      for (let n = 1; n <= good; n++) {
        const r = parseLine(lines[n - 1] ?? new Uint8Array());
        assert.ok(r.ok, `line ${n}: ${r.ok ? "" : r.refusal.reason}`);
        const { hash, ...unhashed } = r.event;
        assert.equal(computeHash(unhashed), hash, `line ${n} hash`);
      }
      if (e.verdict !== "INVALID" || FRAMING_ONLY.has(id)) return;
      const r = parseLine(lines[e.line - 1] ?? new Uint8Array());
      assert.equal(r.ok, !PARSE_LEVEL.has(id), `line ${e.line}`);
      if (!r.ok) assert.equal(r.refusal.kind, "invalid");
      if (id >= "146" && id <= "150") {
        assert.equal(why(r), id === "147" ? "invalid HA-2" : "invalid EX-2");
      }
    });
  }
});

/** An x_ event line with `pad` in its payload; `arrays` deep brackets after. */
function line(pad: string, arrays = 0): Uint8Array {
  const text = Buffer.from(
    serializeLine({
      seq: 2,
      type: "x_t",
      version: 1,
      payload: { a: pad },
      ts: GENESIS_TS,
      prev_hash: "0".repeat(64),
      hash: "1".repeat(64),
    }),
  ).toString("utf8");
  const deep = "[".repeat(arrays) + "]".repeat(arrays);
  return Buffer.from(arrays ? text.replace(`"${pad}"`, deep) : text);
}

describe("parseLine limits (EV-25)", () => {
  const base = line("").length;
  it("accepts a 65536-byte line and refuses a 65537-byte one as cap", () => {
    assert.ok(parseLine(line("a".repeat(65536 - base))).ok);
    assert.equal(why(parseLine(line("a".repeat(65537 - base)))), "cap EV-25");
  });
  it("refuses depth 65 as cap, and depth 64 (within the cap) as invalid", () => {
    assert.equal(why(parseLine(line("p", 63))), "cap EV-25");
    assert.match(why(parseLine(line("p", 62))), /^invalid /);
  });
  it("refuses ill-formed UTF-8 under EX-2 before any other check", () => {
    const bad = Buffer.from([...line("ab").subarray(0, -2), 0xff]);
    assert.equal(why(parseLine(bad)), "invalid EX-2");
  });
});
