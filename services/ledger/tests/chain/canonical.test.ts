import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  epochMsToTs,
  isValidTs,
  lineDepth,
  parseLine,
  serializeLine,
  tsToEpochMs,
  type Event,
} from "../../src/chain/canonical.js";
import { TestChain } from "./support/builders.js";
import { loadVectors, vectorLines } from "./support/fixtures.js";

const enc = (s: string): Buffer => Buffer.from(s, "utf8");

function sample(): Event {
  const chain = new TestChain();
  return chain.genesis();
}

function text(e: Event): string {
  return Buffer.from(serializeLine(e)).toString("utf8");
}

function rejects(line: string | Uint8Array, rule?: string): void {
  const r = parseLine(typeof line === "string" ? enc(line) : line);
  assert.equal(r.ok, false, `expected refusal of ${String(line).slice(0, 80)}`);
  if (!r.ok && rule !== undefined) assert.equal(r.refusal.rule, rule);
}

describe("canonical line: round trip", () => {
  it("parses and re-serializes every line of every VALID vector to identical bytes", () => {
    let lines = 0;
    for (const v of loadVectors().filter((x) => x.expect.verdict === "VALID")) {
      for (const line of vectorLines(v)) {
        const r = parseLine(line);
        assert.ok(r.ok, `${v.id}: ${r.ok ? "" : r.refusal.reason}`);
        assert.ok(Buffer.from(serializeLine(r.event)).equals(line), v.id);
        lines++;
      }
    }
    assert.ok(lines > 50);
  });

  it("serializes strings with EX-9 minimal escaping", () => {
    const e = {
      ...sample(),
      type: "x_t",
      payload: { a: '"\\/\b\t\n\f\r\u0001\u007f\u0080é\u{1F600}' },
    };
    const expected =
      '"a":"\\"\\\\/\\b\\t\\n\\f\\r\\u0001\u007f\u0080é\u{1F600}"';
    assert.ok(text(e).includes(expected), text(e));
  });

  it("refuses to serialize what has no canonical form", () => {
    const e = sample();
    assert.throws(() => serializeLine({ ...e, seq: -1 }));
    assert.throws(() => serializeLine({ ...e, seq: 1.5 }));
    assert.throws(() => serializeLine({ ...e, payload: { a: "\ud800" } }));
  });
});

describe("canonical line: strict rejection (EX-10, never repaired)", () => {
  const good = (): string => text(sample());

  it("accepts the canonical line", () => {
    assert.ok(parseLine(enc(good())).ok);
  });
  it("rejects insignificant whitespace", () => {
    rejects(good().replace('"seq":1', '"seq": 1'));
    rejects(good() + " ");
  });
  it("rejects reordered envelope fields", () => {
    rejects(
      good().replace('{"seq":1,"type":"genesis"', '{"type":"genesis","seq":1'),
      "EX-10",
    );
  });
  it("rejects unsorted payload keys", () => {
    const e = sample();
    const line = text(e).replace(
      `"chain_id":"${e.payload.chain_id}","contracts":"contracts-v1"`,
      `"contracts":"contracts-v1","chain_id":"${e.payload.chain_id}"`,
    );
    rejects(line, "EX-10");
  });
  it("rejects non-minimal escapes: solidus, \\u for a literal, uppercase hex", () => {
    const e = { ...sample(), payload: { a: "/", b: "A", c: "\u001f" } };
    const t = text(e);
    rejects(t.replace('"a":"/"', '"a":"\\/"'), "EX-10");
    rejects(t.replace('"b":"A"', '"b":"\\u0041"'), "EX-10");
    rejects(t.replace('"c":"\\u001f"', '"c":"\\u001F"'), "EX-10");
  });
  it("rejects ill-formed UTF-8, raw and escaped (HA-2)", () => {
    const t = text({ ...sample(), payload: { a: "X" } });
    const [pre, post] = t.split("X") as [string, string];
    for (const bad of [
      [0xed, 0xa0, 0x80],
      [0xc0, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0xe2, 0x82],
    ]) {
      rejects(Buffer.concat([enc(pre), Buffer.from(bad), enc(post)]));
    }
    rejects(t.replace("X", "\\ud800"), "HA-2");
  });
  it("rejects non-canonical and out-of-range integers (ES-5)", () => {
    for (const n of ["1.0", "1e0", "01", "-1", "+1", "9007199254740992"]) {
      rejects(good().replace('"seq":1', `"seq":${n}`));
    }
    const max = { ...sample(), seq: Number.MAX_SAFE_INTEGER };
    assert.ok(parseLine(serializeLine(max)).ok);
  });
  it("rejects null, booleans, arrays and nesting (ES-3, ES-16, ES-17)", () => {
    rejects(
      good().replace('"contracts":"contracts-v1"', '"contracts":null'),
      "ES-3",
    );
    rejects(
      good().replace('"contracts":"contracts-v1"', '"contracts":true'),
      "ES-16",
    );
    rejects(
      good().replace('"contracts":"contracts-v1"', '"contracts":[]'),
      "ES-16",
    );
    rejects(
      good().replace('"contracts":"contracts-v1"', '"contracts":{}'),
      "ES-17",
    );
    rejects(good().replace('"ts":', '"ts":{},"x":'));
  });
  it("rejects duplicate payload keys (HA-6) and envelope keys", () => {
    rejects(
      good().replace(
        '"contracts":"contracts-v1"',
        '"contracts":"a","contracts":"b"',
      ),
      "HA-6",
    );
    rejects(good().replace('{"seq":1,', '{"seq":1,"seq":1,'));
  });
  it("rejects extra, missing and wrongly typed envelope fields (ES-1, ES-2)", () => {
    rejects(good().replace(',"hash":', ',"extra":1,"hash":'), "ES-2");
    rejects(good().replace(/,"hash":"[0-9a-f]+"/, ""), "ES-1");
    rejects(good().replace('"version":1', '"version":0'), "ES-12");
    rejects(good().replace('"type":"genesis"', '"type":"Genesis"'), "ES-10");
    rejects(good().replace('"type":"genesis"', '"type":1'), "ES-10");
    rejects(
      good().replace(/"prev_hash":"0+"/, `"prev_hash":"${"A".repeat(64)}"`),
      "ES-23",
    );
  });
  it("rejects a BOM, a CR, an empty line and leading garbage", () => {
    rejects(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), enc(good())]));
    rejects(good() + "\r");
    rejects("");
    rejects(" " + good());
  });
});

describe("ts (ES-20)", () => {
  it("applies both gates", () => {
    assert.ok(isValidTs("2024-02-29T23:59:59.999Z"));
    assert.ok(!isValidTs("2026-02-29T00:00:00.000Z"));
    assert.ok(!isValidTs("1900-02-29T00:00:00.000Z"));
    assert.ok(isValidTs("2000-02-29T00:00:00.000Z"));
    assert.ok(!isValidTs("2026-07-21T00:00:60.000Z"));
    assert.ok(!isValidTs("2026-13-40T25:61:61.999Z"));
    assert.ok(!isValidTs("2026-07-21T00:00:00Z"));
    assert.ok(!isValidTs("2026-07-21T00:00:00.000+00:00"));
  });
  it("converts to and from epoch milliseconds on the proleptic calendar", () => {
    assert.equal(tsToEpochMs("1970-01-01T00:00:00.000Z"), 0);
    assert.equal(tsToEpochMs("1969-12-31T23:59:00.000Z"), -60000);
    assert.equal(
      tsToEpochMs("2026-07-21T00:00:00.000Z"),
      Date.UTC(2026, 6, 21),
    );
    assert.equal(tsToEpochMs("0000-01-01T00:00:00.000Z"), -62167219200000);
    for (const ts of [
      "0000-03-01T12:34:56.789Z",
      "9999-12-31T23:59:59.999Z",
      "2024-02-29T00:00:00.001Z",
    ]) {
      assert.equal(epochMsToTs(tsToEpochMs(ts)), ts);
    }
  });
});

describe("EV-25 cap", () => {
  it("measures depth with EV-23's scan", () => {
    assert.equal(lineDepth(enc(text(sample()))), 2);
    assert.equal(lineDepth(enc('{"a":"{{[[","b":{"c":{}}}')), 3);
    assert.equal(lineDepth(enc('{"a":"\\"{"}')), 1);
  });
  it("refuses a line longer than 65536 bytes or deeper than 64", () => {
    const r = parseLine(new Uint8Array(65537).fill(0x7b));
    assert.ok(!r.ok && r.refusal.kind === "cap");
    const deep = parseLine(enc("[".repeat(65)));
    assert.ok(!deep.ok && deep.refusal.kind === "cap");
  });
  it("parses a 65536-byte line", () => {
    const base = { ...sample(), type: "x_long", payload: { a: "" } };
    const pad = 65536 - serializeLine(base).length;
    const long = serializeLine({ ...base, payload: { a: "z".repeat(pad) } });
    assert.equal(long.length, 65536);
    assert.ok(parseLine(long).ok);
  });
});
