// The bounds ADR-0038 added: ET-9's 64-byte cap on `genesis.contracts`
// (event-types.md v14) and the two verifier minimums of evolution.md EV-23 —
// line length 65536 bytes, nesting depth 64.
//
// Every vector here stays WITHIN the minimums, and that is a rule, not a
// choice: EV-24 says no verifier is required to reach a verdict past them, so a
// vector beyond a minimum would freeze a verdict the spec does not require.
// The two limits vectors sit exactly ON a minimum, which is the only place a
// verifier whose own limit is one short (or that counts the LF) can be caught.
//
// The ET-9 vectors are bare genesis lines, like the other genesis-value
// vectors (076, 077, 084-091). ET-9 is a check on one value of line 1 that no
// later line consults, so there is no later line a verifier could plausibly
// blame instead. The two limits vectors are three lines on purpose: the line
// under test is line 2, between a valid genesis and a valid event that links to
// it, so a verifier that drops, truncates or skips the long or deep line, or
// that blames the line after it, names the wrong line or the wrong verdict.

import {
  bad,
  chain,
  forked,
  lines,
  ok,
  partial,
  type Vector,
} from "./shared.js";
import { CLEF } from "./unicode.js";
import type { Event } from "../encode.js";
import { serializeEvent } from "../serialize.js";
import { editLine } from "../tamper.js";

/**
 * An ASCII `contracts` value of exactly `bytes` bytes that still reads as a
 * version label, so a reviewer sees what it is and not just its length.
 */
const label = (bytes: number): string => {
  const base = "contracts-v1-";
  if (bytes < base.length) throw new RangeError(`label(${String(bytes)})`);
  return base + "x".repeat(bytes - base.length);
};

/** U+0001: a C0 control character EX-9 writes as the six bytes `\u0001`. */
const SOH = "\u0001";

// --- EV-23 line length -----------------------------------------------------

/** EV-23's line-length minimum, in bytes, not counting the LF. */
const LINE_BYTES = 65536;

/**
 * Genesis, then an `x_` event whose one string value is padded so its
 * canonical line is exactly LINE_BYTES long, then a registered event linked to
 * it. The padding is found by measuring, not by arithmetic on field widths:
 * the line's length is a fixed overhead plus the string's length, and the
 * overhead is whatever the serializer emits.
 */
function longLineChain(): Event[] {
  const build = (pad: number): Event[] =>
    chain((c) => {
      c.custom("x_long", 1, { s: "a".repeat(pad) });
      c.participant(0x03);
    });
  const overhead = Buffer.byteLength(
    serializeEvent(build(0)[1] as Event),
    "utf8",
  );
  const events = build(LINE_BYTES - overhead);
  const long = serializeEvent(events[1] as Event);
  if (Buffer.byteLength(long, "utf8") !== LINE_BYTES) {
    throw new Error(
      `line 2 is ${String(Buffer.byteLength(long, "utf8"))} bytes, not ${String(LINE_BYTES)}`,
    );
  }
  return events;
}

// --- EV-23 nesting depth ---------------------------------------------------

/**
 * Brackets nested inside `payload` to reach depth 64: the envelope object is
 * depth 1 and `payload` depth 2 (EV-23), so 62 more levels.
 */
const INNER_LEVELS = 62;

/**
 * Genesis, an `x_` event made 64 deep by replacing one integer value with 62
 * nested arrays, then a registered event linked to the stored hash. The edit
 * is made on the line, after sealing: a nested payload has no HA-7 preimage,
 * so there is no hash to recompute, and the stored hash is the pre-edit one
 * (the 027/028/130 shape). The `a` value holds four `[` inside a string, which
 * EV-23's scan does not count: a scanner that ignores strings measures 68.
 */
function deepLines(): string[] {
  const ls = lines(
    chain((c) => {
      c.custom("x_deep", 1, { a: "[[[[", n: 0 });
      c.participant(0x03);
    }),
  );
  return editLine(
    ls,
    2,
    '"n":0',
    `"n":${"[".repeat(INNER_LEVELS)}${"]".repeat(INNER_LEVELS)}`,
  );
}

export const limitsVectors: Vector[] = [
  ok(
    "137-contracts-64-bytes",
    forked({ contracts: label(64) }),
    ["ET-9"],
    "A genesis whose contracts value is exactly 64 ASCII bytes, the most ET-9 allows. VALID. A verifier that writes the bound as fewer than 64 rejects it. Every other genesis rule holds, so the length is the only thing on the line to weigh.",
  ),
  bad(
    "138-contracts-65-bytes",
    lines(forked({ contracts: label(65), violates: ["ET-9"] })),
    1,
    ["ET-9"],
    "A genesis whose contracts value is 65 ASCII bytes, one more than ET-9 allows: INVALID at the genesis line. The self-signature verifies over this payload and the hash matches, so the length is the only fault. A verifier without ET-9's cap (event-types.md v14, ADR-0038), or one that writes the bound as 65 or more, reports VALID.",
  ),
  ok(
    "139-contracts-16-four-byte",
    forked({ contracts: CLEF.repeat(16) }),
    ["ET-9", "EX-9", "HA-2"],
    "A genesis whose contracts value is 16 copies of U+1D11E: 16 scalar values, 32 UTF-16 code units and 64 UTF-8 bytes, stored as literal UTF-8 (EX-9). VALID, because ET-9 counts the bytes of the decoded value's UTF-8 encoding and that is 64. A verifier that counts some larger encoding rejects it: one that measures each UTF-16 code unit as its own 3-byte UTF-8 sequence (CESU-8, 96 bytes), or one that measures the value re-escaped as \\ud834\\udd1e pairs (192 bytes).",
  ),
  bad(
    "140-contracts-17-four-byte",
    lines(forked({ contracts: CLEF.repeat(17), violates: ["ET-9"] })),
    1,
    ["ET-9"],
    "A genesis whose contracts value is 17 copies of U+1D11E: 68 UTF-8 bytes, so INVALID at the genesis line. It is only 17 scalar values and 34 UTF-16 code units, both well under 64. A verifier that counts contracts in scalar values (the unit ET-14 uses for title, which ET-9 deliberately does not use) or in UTF-16 code units (a JavaScript string's length) reports VALID. 138 cannot catch either: for ASCII all three counts agree.",
  ),
  ok(
    "141-contracts-escaped-control-64",
    forked({ contracts: SOH + label(63) }),
    ["ET-9", "EX-9", "HA-2"],
    "A genesis whose contracts value is U+0001 followed by 63 ASCII bytes: 64 bytes decoded, so VALID. EX-9 writes U+0001 as the six bytes \\u0001, so the value takes 69 bytes on the line. ET-9 counts the decoded value, the one HA-2 hashes, never the escaped bytes, so a verifier that measures the string as it appears on the line rejects this legal genesis. ET-9 bounds the length of contracts and nothing else, so a control character is legal here (unlike in a title, ET-14).",
  ),
  bad(
    "142-contracts-escaped-control-65",
    lines(forked({ contracts: SOH + label(64), violates: ["ET-9"] })),
    1,
    ["ET-9", "EX-9", "HA-2"],
    "141 with one more ASCII byte: 65 bytes decoded (70 on the line), so INVALID at the genesis line. The pair pins that the escaped character counts as exactly one byte: a verifier that strips or ignores control characters before counting measures 64 here and reports VALID. A verifier that counts the escaped bytes also reports INVALID here, which is why 141 is the vector that catches it.",
  ),
  partial(
    "143-line-65536-bytes",
    longLineChain(),
    [2],
    ["EV-23", "EV-24", "EV-7", "EV-18"],
    "Line 2 is exactly 65536 bytes, not counting its LF: the line-length minimum of EV-23. It is an x_ event (EV-18) whose one payload value is a long ASCII string, so it is well-formed and hash-checkable and its semantics go unchecked: PARTIAL with line 2 listed. Line 3 is a registered event whose prev_hash is line 2's hash, so a verifier that silently skips the long line fails the link at line 3, and one that truncates it no longer holds a line that parses. Every conforming registered v1 line is at most 1302 bytes (ET-9 and the other value bounds, EV-25), so only an unregistered type can reach this length without being INVALID. EV-24 requires every verifier to reach the verdict on this input. A verifier whose line limit is below 65536 bytes, or that counts the LF against it (for example a reader with a 65536-byte buffer that must also hold the LF), reports a tool-level failure or the wrong verdict here.",
  ),
  bad(
    "144-depth-64",
    deepLines(),
    2,
    ["EV-23", "EV-24", "ES-17", "EV-16"],
    'Line 2 is at nesting depth exactly 64, the EV-23 minimum: the envelope object (1), payload (2) and 62 nested arrays in one payload value. A nested payload breaks ES-17, and EV-16 makes that INVALID at its own line even on an x_ type, so the verdict is INVALID at line 2, never PARTIAL. The line has no HA-7 preimage, so its stored hash is the one sealed before the arrays were added; that mismatch is on line 2 as well. Line 3 is a valid event linked to that stored hash. EV-24 requires a verifier to reach this verdict. It catches a verifier that reports a tool-level failure, crashes, reports PARTIAL because the type is unregistered, or skips the line and blames line 3. It cannot catch a depth limit below 64 that reports INVALID at line 2 when reached: EV-24 forbids such a limit, but allows INVALID on reaching any depth limit above 2, so the verdict is the same. The payload also holds the string "[[[[": EV-23\'s scan does not count brackets inside a string, so the depth is 64, while a scan that ignores strings measures 68; a verifier that refuses the line with a tool-level failure on that count refuses an input within the minimums.',
  ),
  bad(
    "145-contracts-empty",
    lines(forked({ contracts: "", violates: ["ET-9"] })),
    1,
    ["ET-9"],
    "A genesis whose contracts value is the empty string: INVALID at the genesis line, because ET-9 requires a non-empty string and says a genesis whose contracts is empty or longer than 64 bytes MUST be rejected. The genesis is signed over this payload and hashed over that signature, so chain_id derives, the self-signature verifies and the hash matches: the empty value is the only fault. It pins ET-9's lower bound, which 137-142 do not reach. A verifier that checks only the upper bound, or only that the key is present with a string value (ES-18), reports VALID.",
  ),
];
