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
