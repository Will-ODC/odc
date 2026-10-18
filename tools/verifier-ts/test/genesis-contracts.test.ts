// ET-9 (event-types.md v14): `genesis.contracts` is a non-empty string of at
// most 64 BYTES, counted as the UTF-8 encoding of the DECODED value — never
// the escaped bytes on the line. And EV-21 (evolution.md v8): the advisory
// reason for a `genesis` at a version other than 1.
//
// Same terms as genesis-ancestry.test.ts: these chains are SYNTHETIC AND
// SELF-CONSISTENT (hashed and signed by the functions under test), so they
// say nothing about the preimage; they exist because no committed vector
// reaches the 64-byte boundary (the longest committed `contracts` is 12
// bytes). A fixture for this rule supersedes them the day one lands.
//
// Each boundary is pinned on both sides, and in units where the byte count,
// the UTF-16 length (`.length`) and the escaped line length all differ — a
// check written in the wrong unit passes one side and fails the other.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport } from "../src/verify.js";
import { genesisExport, tokenAndLine } from "./genesis-builder.js";

/** Verdict of a one-line chain whose `contracts` is the RAW JSON text given. */
function withContracts(rawJsonText: string): string {
  return tokenAndLine(verifyExport(genesisExport({ contracts: rawJsonText })));
}

const FOUR = "\u{1F600}"; // 4 UTF-8 bytes, 2 UTF-16 units
const THREE = "€"; // € — 3 UTF-8 bytes, 1 UTF-16 unit
const TWO = "é"; // é — 2 UTF-8 bytes, 1 UTF-16 unit

test("calibration: the usual contracts value verifies", () => {
  assert.equal(withContracts("contracts-v1"), "VALID");
});

test("ASCII: 64 bytes VALID, 65 INVALID at line 1", () => {
  assert.equal(withContracts("a".repeat(64)), "VALID");
  assert.equal(withContracts("a".repeat(65)), "INVALID at line 1");
});

test("empty contracts is INVALID at line 1", () => {
  assert.equal(withContracts(""), "INVALID at line 1");
});

test("an integer contracts is INVALID at line 1", () => {
  const out = verifyExport(genesisExport({}, { rawExtra: { contracts: "1" } }));
  // `rawExtra` overrides the string value with a raw JSON integer.
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("four-byte characters: 16 (64 bytes) VALID, 17 (68 bytes) INVALID", () => {
  assert.equal(withContracts(FOUR.repeat(16)), "VALID");
  assert.equal(withContracts(FOUR.repeat(17)), "INVALID at line 1");
});

test("four-byte characters: 32 of them are 64 UTF-16 units but 128 bytes — INVALID", () => {
  // The `.length` trap: 32 astral characters have .length 64.
  assert.equal(FOUR.repeat(32).length, 64);
  assert.equal(withContracts(FOUR.repeat(32)), "INVALID at line 1");
});

test("three-byte characters: 21 plus one ASCII (64 bytes) VALID, 22 (66 bytes) INVALID", () => {
  assert.equal(withContracts(THREE.repeat(21) + "a"), "VALID");
  // .length is 22 here, far under 64: only a byte count rejects it.
  assert.equal(withContracts(THREE.repeat(22)), "INVALID at line 1");
});

test("two-byte characters: 32 (64 bytes) VALID, 33 (66 bytes) INVALID", () => {
  assert.equal(withContracts(TWO.repeat(32)), "VALID");
  assert.equal(withContracts(TWO.repeat(33)), "INVALID at line 1");
});

test("escaped control characters count once: 64 \\u0001 (384 line bytes) VALID, 65 INVALID", () => {
  // The escaped form is six bytes on the line; the decoded value is one byte.
  assert.equal(withContracts("\\u0001".repeat(64)), "VALID");
  assert.equal(withContracts("\\u0001".repeat(65)), "INVALID at line 1");
});

test("short escapes count once: 64 \\n (128 line bytes) VALID, 65 INVALID", () => {
  assert.equal(withContracts("\\n".repeat(64)), "VALID");
  assert.equal(withContracts("\\n".repeat(65)), "INVALID at line 1");
  assert.equal(withContracts("\\\\".repeat(64)), "VALID");
  assert.equal(withContracts("\\\\".repeat(65)), "INVALID at line 1");
});

test("surrogate-pair escapes are INVALID at line 1 at any length (EX-9 forbids the escape)", () => {
  // A `\u` escape is canonical only for C0 controls without a short escape
  // (EX-9), so a surrogate-pair escape cannot probe the 64-byte boundary:
  // both sides of it are already non-canonical. Pinned so a parser that
  // started decoding pairs would at least have to face this test. The
  // harness cannot sign such a line (its own parser refuses it), so the
  // escape is spliced into a signed genesis; the parser rejects the line
  // before its hash or signature is ever looked at.
  const pair = "\\ud83d\\ude00"; // decodes to one four-byte character
  for (const n of [1, 16, 17]) {
    const signed = genesisExport({ contracts: "X" }).toString("utf8");
    const spliced = signed.replace(
      '"contracts":"X"',
      `"contracts":"${pair.repeat(n)}"`,
    );
    assert.notEqual(spliced, signed);
    assert.equal(
      tokenAndLine(verifyExport(Buffer.from(spliced, "utf8"))),
      "INVALID at line 1",
    );
  }
});

// --- EV-21: the advisory reason for a genesis at version other than 1 ---------

for (const version of [2, 1000000]) {
  test(`EV-21 reason for genesis version ${version}: names it, says corrupt/hostile/not ODC, no upgrade advice`, () => {
    // Tool output, not conformance: EV-17 checks only token and line, and
    // the token and line here are asserted in genesis-ancestry.test.ts.
    const out = verifyExport(genesisExport({}, { version, sign: false }));
    assert.equal(out.verdict, "INVALID");
    const reason = out.verdict === "INVALID" ? (out.reason ?? "") : "";
    assert.match(reason, new RegExp(`\\bversion ${version}\\b`));
    assert.match(reason, /corrupt/);
    assert.match(reason, /hostile/);
    assert.match(reason, /not an ODC chain/);
    assert.match(reason, /ET-6/);
    assert.doesNotMatch(reason, /newer|fetch|upgrade|update|out of date/i);
  });
}
