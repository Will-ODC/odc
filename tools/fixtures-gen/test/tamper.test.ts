// Tests for the adversarial mutations.
//
// The load-bearing test here is that editLine THROWS when its target is absent.
// A mutation that silently no-ops would produce a vector whose bytes are still
// perfectly valid while its declared verdict says INVALID — and every conforming
// verifier would then fail that vector, for the right reason, on the wrong file.
// That is the worst failure this tool could have, because it looks like a
// verifier bug rather than a fixture bug.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deleteLine,
  duplicateLine,
  editLine,
  flipHashChar,
  frame,
  insertBlankLine,
  swapLines,
  truncate,
} from "../src/tamper.js";

const LINES = ["one", "two", "three", "four"];
const withHash = (n: number, h: string): string =>
  `{"seq":${String(n)},"hash":"${h}"}`;
const HASH_A = "a".repeat(64);

// --- framing (EX-2, EX-3, EX-4, EX-6) -------------------------------------

test("frames with LF and a required final newline by default", () => {
  assert.equal(frame(["a", "b"]).toString("utf8"), "a\nb\n");
});

test("emits CRLF only when asked (EX-3)", () => {
  assert.equal(
    frame(["a", "b"], { crlf: true }).toString("utf8"),
    "a\r\nb\r\n",
  );
  assert.ok(!frame(["a", "b"]).includes(0x0d));
});

test("omits the final newline only when asked (EX-4)", () => {
  assert.equal(
    frame(["a", "b"], { noFinalNewline: true }).toString("utf8"),
    "a\nb",
  );
});

test("prepends a byte-order mark only when asked (EX-2)", () => {
  const bytes = frame(["a"], { bom: true });
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
  assert.deepEqual(frame(["a"]).subarray(0, 1), Buffer.from("a"));
});

test("an empty export is zero bytes, not a lone newline (EX-6)", () => {
  assert.equal(frame([]).length, 0);
  assert.equal(frame([], { noFinalNewline: true }).length, 0);
});

// --- the safety net -------------------------------------------------------

test("editLine throws rather than silently failing to mutate", () => {
  assert.throws(
    () => editLine(LINES, 2, "absent-substring", "x"),
    /does not contain/,
    "a no-op mutation would yield a valid file claiming to be INVALID",
  );
  assert.throws(() => editLine(LINES, 99, "two", "x"), /no line 99/);
});

test("editLine replaces only the first occurrence, on the named line", () => {
  const out = editLine(["aa", "aa"], 1, "a", "b");
  assert.deepEqual(out, ["ba", "aa"]);
});

// --- the mutations --------------------------------------------------------

test("flipHashChar changes the stored hash and nothing else", () => {
  const lines = [withHash(1, HASH_A)];
  const out = flipHashChar(lines, 1);
  assert.notEqual(out[0], lines[0]);
  assert.equal((out[0] as string).length, (lines[0] as string).length);
  assert.ok(
    (out[0] as string).includes('"seq":1'),
    "the rest of the line is untouched",
  );
  assert.match(
    /"hash":"([0-9a-f]{64})"/.exec(out[0] as string)?.[1] ?? "",
    /^[0-9a-f]{64}$/,
  );
});

test("flipHashChar refuses a line with no trailing hash", () => {
  assert.throws(() => flipHashChar(['{"seq":1}'], 1), /no trailing hash/);
});

test("deleteLine removes exactly one line (tamper matrix)", () => {
  assert.deepEqual(deleteLine(LINES, 3), ["one", "two", "four"]);
});

test("swapLines exchanges two lines and keeps the length (tamper matrix)", () => {
  assert.deepEqual(swapLines(LINES, 2, 3), ["one", "three", "two", "four"]);
  assert.throws(() => swapLines(LINES, 1, 99), RangeError);
});

test("duplicateLine repeats a line immediately after itself (tamper matrix)", () => {
  assert.deepEqual(duplicateLine(LINES, 2), [
    "one",
    "two",
    "two",
    "three",
    "four",
  ]);
});

test("truncate keeps a prefix (tamper matrix: end-truncation, EX-16)", () => {
  assert.deepEqual(truncate(LINES, 2), ["one", "two"]);
  assert.deepEqual(truncate(LINES, 0), []);
});

test("insertBlankLine puts the blank at the expected position (EX-5)", () => {
  assert.deepEqual(insertBlankLine(LINES, 2), [
    "one",
    "two",
    "",
    "three",
    "four",
  ]);
  // The blank becomes line 3, which is the line a verifier must name.
  assert.equal(
    frame(insertBlankLine(LINES, 2)).toString("utf8").split("\n")[2],
    "",
  );
});

test("every mutation leaves the input array untouched", () => {
  const original = [...LINES];
  deleteLine(LINES, 1);
  swapLines(LINES, 1, 2);
  duplicateLine(LINES, 1);
  truncate(LINES, 1);
  insertBlankLine(LINES, 1);
  editLine(LINES, 1, "one", "x");
  assert.deepEqual(LINES, original, "mutations must not alias the base chain");
});
