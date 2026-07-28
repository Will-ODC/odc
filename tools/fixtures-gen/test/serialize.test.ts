// Unit tests for the canonical line form (contracts/export-format.md §1–2).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  jsonInteger,
  jsonString,
  serializeEvent,
  serializeExport,
} from "../src/serialize.js";
import type { Event } from "../src/encode.js";

const sample: Event = {
  seq: 2,
  type: "issue_created",
  version: 1,
  // Insertion order is deliberately wrong: EX-8 requires ascending byte order.
  payload: { title: "Adopt the charter", choice_count: 3 },
  ts: "2026-07-21T00:02:00.000Z",
  prev_hash: "a".repeat(64),
  hash: "b".repeat(64),
};

test("emits the seven envelope fields in the required order (EX-7)", () => {
  const line = serializeEvent(sample);
  const order = [
    "seq",
    "type",
    "version",
    "payload",
    "ts",
    "prev_hash",
    "hash",
  ].map((k) => line.indexOf(`"${k}":`));
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
});

test("emits compact JSON with no insignificant whitespace (EX-7)", () => {
  const line = serializeEvent(sample);
  assert.ok(
    !/[ \t]/.test(line.replace(/"[^"]*"/g, "")),
    "no whitespace outside string literals",
  );
});

test("sorts payload keys by UTF-8 bytes regardless of insertion order (EX-8)", () => {
  const line = serializeEvent(sample);
  assert.ok(line.indexOf('"choice_count"') < line.indexOf('"title"'));
});

test("serializes integers in canonical form (EX-8, ES-5)", () => {
  assert.equal(jsonInteger(0), "0");
  assert.equal(jsonInteger(64), "64");
  assert.equal(jsonInteger(Number.MAX_SAFE_INTEGER), "9007199254740991");
  assert.throws(() => jsonInteger(-1), RangeError);
  assert.throws(() => jsonInteger(1.5), RangeError);
});

test("escapes only what EX-9 requires", () => {
  assert.equal(jsonString('a"b'), '"a\\"b"');
  assert.equal(jsonString("a\\b"), '"a\\\\b"');
  assert.equal(jsonString("a\tb"), '"a\\tb"');
  assert.equal(jsonString("a\nb"), '"a\\nb"');
  assert.equal(jsonString("a\u0008b"), '"a\\bb"');
  assert.equal(jsonString("a\u000cb"), '"a\\fb"');
  assert.equal(jsonString("a\rb"), '"a\\rb"');
});

test("escapes other control characters as lowercase \\u00xx (EX-9)", () => {
  assert.equal(jsonString("\u0001"), '"\\u0001"');
  assert.equal(jsonString("\u001f"), '"\\u001f"', "lowercase hex digit");
  assert.notEqual(jsonString("\u001f"), '"\\u001F"');
});

test("leaves solidus and non-ASCII literal (EX-9)", () => {
  assert.equal(jsonString("a/b"), '"a/b"', "solidus is never escaped");
  assert.equal(jsonString("règlement"), '"règlement"');
  assert.equal(jsonString("日本語"), '"日本語"');
  assert.equal(jsonString("✅"), '"✅"');
});

test("leaves an astral-plane character literal as its four UTF-8 octets (EX-9)", () => {
  // Above U+FFFF, so it is a surrogate PAIR in the source string — the branch
  // that must NOT be confused with the unpaired case below.
  assert.equal(jsonString("clef 𝄞"), '"clef 𝄞"');
  assert.equal(jsonString("𝄞"), '"\u{1d11e}"');
  assert.deepEqual(
    Buffer.from(jsonString("\u{1d11e}"), "utf8"),
    Buffer.from([0x22, 0xf0, 0x9d, 0x84, 0x9e, 0x22]),
    "one character, four octets, no escape",
  );
  assert.equal(jsonString("𝄞\t🎼"), '"𝄞\\t🎼"');
});

test("a whole line keeps an astral title literal, escape-free, and round-tripping (EX-7, EX-9)", () => {
  // The jsonString-level assertions above pin the function; this pins the LINE,
  // which is the artifact a verifier actually reads and the level at which a
  // surrogate-escaping writer would still look correct: it parses back to the
  // same event and hashes to the same preimage, so only the bytes betray it.
  const line = serializeEvent({
    ...sample,
    payload: { title: `anthem \u{1d11e}`, choice_count: 3 },
  });
  assert.ok(!line.includes("\\u"), "no \\u escape anywhere in the line");
  assert.ok(
    Buffer.from(line, "utf8").includes(Buffer.from([0xf0, 0x9d, 0x84, 0x9e])),
    "the four literal UTF-8 octets of U+1D11E",
  );
  const parsed = JSON.parse(line) as Event;
  assert.equal(parsed.payload["title"], "anthem \u{1d11e}");
  // The escaped form is valid JSON parsing to the same value — which is exactly
  // why the assertions above are on bytes and not on the parsed object.
  assert.equal(
    JSON.parse('"anthem \\ud834\\udd1e"'),
    parsed.payload["title"],
    "the surrogate-escaped form is indistinguishable after parsing",
  );
});

test("rejects ill-formed UTF-16 instead of repairing it (EX-10, ES-19, HA-2)", () => {
  // EX-10: "a mismatch is rejected, never repaired". Encoding to UTF-8 replaces
  // an unpaired surrogate with U+FFFD, which collapses three DISTINCT string
  // values onto one canonical line — so the repair must not be reachable.
  assert.throws(() => jsonString("A\ud800B"), RangeError, "unpaired high");
  assert.throws(() => jsonString("A\udfffB"), RangeError, "unpaired low");
  assert.throws(() => jsonString("\ud83d"), RangeError, "lone lead at the end");
  assert.throws(() => jsonString("\udc00\ud800"), RangeError, "reversed pair");
  // U+FFFD is itself a perfectly good character and stays literal, which is why
  // the repair is undetectable downstream: the collision is silent.
  assert.equal(jsonString("A�B"), '"A�B"');
});

test("the ill-formed rejection reaches whole lines, not just jsonString", () => {
  assert.throws(
    () => serializeEvent({ ...sample, type: "issue\ud800" }),
    RangeError,
  );
  assert.throws(
    () =>
      serializeExport([
        { ...sample, payload: { title: "a\udfffb", choice_count: 3 } },
      ]),
    RangeError,
  );
  // A payload KEY is serialized by the same function and gets the same gate.
  assert.throws(
    () => serializeEvent({ ...sample, payload: { "k\ud800": 1 } }),
    RangeError,
  );
});

test("agrees with JSON.parse on every escaping branch", () => {
  // Round-tripping proves the escaping is *correct* JSON; the assertions above
  // prove it is the *canonical* choice among several correct ones.
  for (const s of [
    'a"b',
    "a\\b",
    "a\tb",
    "\u0001\u001f",
    "a/b",
    "règlement 日本語 ✅",
    "𝄞 🎼 above U+FFFF",
    "",
  ]) {
    assert.equal(JSON.parse(jsonString(s)), s);
  }
});

test("frames lines with LF and a required final newline (EX-3, EX-4)", () => {
  const bytes = serializeExport([sample, { ...sample, seq: 3 }]);
  const text = bytes.toString("utf8");
  assert.ok(text.endsWith("\n"));
  assert.equal(text.split("\n").length - 1, 2, "two terminators for two lines");
  assert.ok(!text.includes("\r"), "no carriage returns");
});

test("serializes an empty chain as the zero-length file (EX-6)", () => {
  assert.equal(serializeExport([]).length, 0);
});
