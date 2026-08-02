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
  flipPrevHashChar,
  frame,
  insertBlankLine,
  swapLines,
  truncate,
} from "../src/tamper.js";

const LINES = ["one", "two", "three", "four"];
const withHash = (n: number, h: string): string =>
  `{"seq":${String(n)},"hash":"${h}"}`;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
// Uppercase hex is not a hash (ID-2), so the mutators must not recognise it.
const HASH_UPPER = "A".repeat(64);

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

test("editLine throws on an identity replacement", () => {
  // `find` is present, so the absent-`find` guard stays quiet — yet the line
  // does not move, so the vector would ship canonical bytes while declaring
  // INVALID. This is the failure class PR #31 recorded against vector 048.
  assert.throws(
    () => editLine(LINES, 2, "two", "two"),
    /identity replacement/,
    "find === replace finds its target and changes nothing",
  );
  assert.throws(
    () => editLine(LINES, 2, "", ""),
    /identity replacement/,
    "the empty-string pair is an identity replacement too",
  );
});

test("editLine throws when a $-substitution reproduces the match", () => {
  // The other half of the no-op space, and the reason the guard asserts on the
  // RESULT rather than on `find === replace`. `replace` is a plain string, so
  // String.prototype.replace expands `$&` to the matched text: find and replace
  // differ, the substitution puts the match straight back, and the line is
  // unchanged. Enumerating input shapes would have missed this entirely.
  assert.throws(
    () => editLine(LINES, 2, "two", "$&"),
    /changed nothing/,
    "$& expands to the match, so the line is rebuilt identically",
  );
  assert.throws(
    () => editLine(LINES, 2, "wo", "$&"),
    /changed nothing/,
    "a partial match reproduced by $& is the same no-op",
  );
  // $$ is an escaped literal dollar, so this one genuinely mutates.
  assert.deepEqual(editLine(LINES, 2, "two", "$$"), [
    "one",
    "$",
    "three",
    "four",
  ]);
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

test("flipPrevHashChar breaks the link and leaves the payload alone", () => {
  // The payload carries the SAME 64 hex digits as prev_hash — the real shape of a
  // ballot cast directly after its own issue. A hash-only search would hit this
  // first (payload precedes prev_hash in EX-7's order) and mutate an `issue_id`
  // while the file still linked correctly, i.e. tamper the wrong field silently.
  const line = `{"seq":2,"payload":{"issue_id":"${HASH_A}"},"prev_hash":"${HASH_A}","hash":"${HASH_B}"}`;
  const out = flipPrevHashChar([line], 1) as string[];
  const got = out[0] as string;
  assert.equal(got.length, line.length);
  assert.ok(got.includes(`"issue_id":"${HASH_A}"`), "payload was mutated");
  assert.ok(got.includes(`"hash":"${HASH_B}"}`), "own hash was mutated");
  const prev = /"prev_hash":"([0-9a-f]{64})"/.exec(got)?.[1] ?? "";
  assert.match(prev, /^[0-9a-f]{64}$/);
  assert.notEqual(prev, HASH_A);
});

test("flipPrevHashChar flips genesis's 64-zero anchor to a real hex string", () => {
  const zeros = "0".repeat(64);
  const out = flipPrevHashChar([`{"prev_hash":"${zeros}"}`], 1) as string[];
  assert.equal(out[0], `{"prev_hash":"1${"0".repeat(63)}"}`);
});

test("flipPrevHashChar refuses a line with no prev_hash", () => {
  assert.throws(() => flipPrevHashChar(['{"seq":1}'], 1), /no prev_hash/);
  assert.throws(
    () => flipPrevHashChar([`{"prev_hash":"${HASH_UPPER}"}`], 1),
    /no prev_hash/,
  );
  assert.throws(() => flipPrevHashChar(["x"], 2), RangeError);
});

test("deleteLine removes exactly one line (tamper matrix)", () => {
  assert.deepEqual(deleteLine(LINES, 3), ["one", "two", "four"]);
});

test("deleteLine refuses a line number outside the file", () => {
  // Unguarded, splice(98, 1) is a NO-OP: the vector's bytes stay perfectly
  // valid while its declared verdict says INVALID.
  assert.throws(() => deleteLine(LINES, 99), RangeError);
  assert.throws(() => deleteLine(LINES, LINES.length + 1), RangeError);
  // And splice(-1, 1) END-TRUNCATES: the vector would exercise EX-16
  // truncation while claiming mid-chain deletion (EX-13).
  assert.throws(() => deleteLine(LINES, 0), RangeError);
  assert.throws(() => deleteLine(LINES, -1), RangeError);
  assert.throws(() => deleteLine([], 1), RangeError);
  assert.throws(() => deleteLine(LINES, 1.5), RangeError);
});

test("swapLines exchanges two lines and keeps the length (tamper matrix)", () => {
  assert.deepEqual(swapLines(LINES, 2, 3), ["one", "three", "two", "four"]);
  assert.throws(() => swapLines(LINES, 1, 99), RangeError);
});

test("swapLines refuses the no-ops that would emit canonical bytes", () => {
  // Both of these returned the input unchanged before this guard existed. Every
  // swapLines caller declares INVALID, so an unchanged return ships a valid
  // export under an INVALID declaration — the failure 048 actually shipped.
  assert.throws(
    () => swapLines(LINES, 2, 2),
    /cannot be swapped with itself/,
    "swapping a line with itself is a no-op, not a mutation",
  );
  assert.throws(
    () => swapLines(["same", "same"], 1, 2),
    /byte-identical/,
    "swapping equal lines changes no bytes",
  );
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

test("truncate refuses a count that removes nothing, or removes from the end", () => {
  // slice(0, 4) and slice(0, 99) both return the WHOLE file — a vector claiming
  // truncation whose bytes are the untruncated chain. This is load-bearing:
  // 004-truncated-without-head is built by this function.
  assert.throws(() => truncate(LINES, LINES.length), RangeError);
  assert.throws(() => truncate(LINES, 99), RangeError);
  // slice(0, -1) silently drops the LAST line, so the count means the opposite
  // of what it says.
  assert.throws(() => truncate(LINES, -1), RangeError);
  assert.throws(() => truncate([], 0), RangeError);
  assert.throws(() => truncate(LINES, 1.5), RangeError);
  // A clamping implementation, slice(0, Math.min(count, lines.length)), is
  // observable ONLY here.
  assert.equal(truncate(LINES, LINES.length - 1).length, LINES.length - 1);
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
