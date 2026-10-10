// Issue #193: `--chain <genesis-hash>` (export-format.md EX-22/EX-23) and the
// EX-24 report of the genesis hash and head on every non-empty run.
//
// Inputs are golden fixture exports (and byte-level edits of them); the
// expected verdicts follow from EX-22/EX-23 and the precedence documented in
// verifyExport. The EX-24 lines are tool output, not conformance surface
// (EV-17), so they are asserted here and never in fixtures.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../src/cli.js"); // dist/test -> dist/src/cli.js
const vectors = resolve(here, "../../../../contracts/fixtures/vectors");
const scratch = mkdtempSync(join(tmpdir(), "verifier-ts-chain-"));

const VALID4 = resolve(vectors, "002-four-types.ndjson"); // VALID, 4 lines
const PARTIAL5 = resolve(vectors, "008-unregistered-type.ndjson"); // PARTIAL [5]
const WRONG = "f".repeat(64);

function storedHashes(path: string): { genesis: string; head: string } {
  const lines = readFileSync(path, "utf8").split("\n").slice(0, -1);
  const hashOf = (l: string) => (JSON.parse(l) as { hash: string }).hash;
  return {
    genesis: hashOf(lines[0] as string),
    head: hashOf(lines[lines.length - 1] as string),
  };
}

function writeScratch(name: string, content: string | Buffer): string {
  const p = join(scratch, name);
  writeFileSync(p, content);
  return p;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function verify(...args: string[]): Run {
  const r = spawnSync(process.execPath, [cliPath, "verify", ...args], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** stdout is exactly the one verdict line, whatever else happened. */
function assertOneStdoutLine(r: Run): void {
  assert.match(
    r.stdout,
    /^[^\n]+\n$/,
    `stdout was ${JSON.stringify(r.stdout)}`,
  );
}

function identity(genesis: string, head: string): string {
  return `genesis: ${genesis}\nhead: ${head}\n`;
}

const valid = storedHashes(VALID4);
const partial = storedHashes(PARTIAL5);

// --- --chain verdicts (EX-22 / EX-23) ---------------------------------------

test("--chain equal to line 1's hash leaves a valid export VALID", () => {
  const r = verify(VALID4, "--chain", valid.genesis);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "VALID\n");
});

test("--chain mismatch on an otherwise valid export is INVALID at line 1", () => {
  const r = verify(VALID4, "--chain", WRONG);
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.match(r.stdout, /^INVALID at line 1(:|\n)/);
});

test("--chain mismatch overrides PARTIAL, attributed to line 1", () => {
  const r = verify(PARTIAL5, "--chain", WRONG);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 1(:|\n)/);
});

test("--chain match on a PARTIAL export stays PARTIAL", () => {
  const r = verify(PARTIAL5, "--chain", partial.genesis);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "PARTIAL at line 5\n");
});

test("--chain and --head both correct is VALID", () => {
  const r = verify(VALID4, "--chain", valid.genesis, "--head", valid.head);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "VALID\n");
});

test("--chain correct and --head wrong blames the last line (EX-19)", () => {
  const r = verify(VALID4, "--chain", valid.genesis, "--head", WRONG);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 4(:|\n)/);
});

test("precedence: --chain and --head both wrong blames line 1, not the last line", () => {
  for (const order of [
    ["--chain", WRONG, "--head", WRONG],
    ["--head", WRONG, "--chain", WRONG],
  ]) {
    const r = verify(VALID4, ...order);
    assert.equal(r.status, 1);
    assertOneStdoutLine(r);
    assert.match(r.stdout, /^INVALID at line 1(:|\n)/);
  }
});

test("--chain, like --head, does not move an INVALID the file already earned", () => {
  // Line 3 tampered (one hex digit of its hash flipped): INVALID at line 3 on
  // its own. The anchors are checked only after every link check passes, so a
  // wrong --chain does not re-attribute it to line 1.
  const lines = readFileSync(VALID4, "utf8").split("\n");
  const l3 = JSON.parse(lines[2] as string) as { hash: string };
  const flipped = (l3.hash[0] === "0" ? "1" : "0") + l3.hash.slice(1);
  lines[2] = (lines[2] as string).replace(l3.hash, flipped);
  const p = writeScratch("tampered-line3.ndjson", lines.join("\n"));
  const r = verify(p, "--chain", WRONG);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 3(:|\n)/);
});

for (const [name, value] of [
  ["too short", "abc"],
  ["uppercase hex", valid.genesis.toUpperCase()],
  ["65 hex digits", valid.genesis + "0"],
  ["non-hex", "g".repeat(64)],
] as const) {
  test(`a malformed --chain (${name}) is a tool error: exit 3, empty stdout, one stderr line`, () => {
    const r = verify(VALID4, "--chain", value);
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^[^\n]*--chain[^\n]*\n$/);
  });
}

test("--chain with no value prints usage and exits 3", () => {
  const r = verify(VALID4, "--chain");
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^usage: /);
});

// --- EX-24 report on stderr -------------------------------------------------

test("EX-24: a VALID run reports genesis and head on stderr only", () => {
  const r = verify(VALID4);
  assert.equal(r.stdout, "VALID\n");
  assert.equal(r.stderr, identity(valid.genesis, valid.head));
});

test("EX-24: a PARTIAL run reports genesis and head", () => {
  const r = verify(PARTIAL5);
  assert.equal(r.stdout, "PARTIAL at line 5\n");
  assert.equal(r.stderr, identity(partial.genesis, partial.head));
});

test("EX-24: an INVALID run (--chain mismatch) still reports the stored values", () => {
  const r = verify(VALID4, "--chain", WRONG, "--head", WRONG);
  assertOneStdoutLine(r);
  assert.equal(r.stderr, identity(valid.genesis, valid.head));
});

test("EX-24: an INVALID run (broken link) reports the stored, not recomputed, values", () => {
  // Drop line 2: line 3 no longer links (INVALID), but line 1 and the last
  // line still carry their stored hashes.
  const lines = readFileSync(VALID4, "utf8").split("\n");
  lines.splice(1, 1);
  const p = writeScratch("dropped-line2.ndjson", lines.join("\n"));
  const r = verify(p);
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.equal(r.stderr, identity(valid.genesis, valid.head));
});

test("EX-24: genesis is `unavailable` when line 1 is not JSON", () => {
  const rest = readFileSync(VALID4, "utf8").split("\n").slice(1).join("\n");
  const p = writeScratch("line1-not-json.ndjson", "not json\n" + rest);
  const r = verify(p);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 1(:|\n)/);
  assert.equal(r.stderr, identity("unavailable", valid.head));
});

test("EX-24: head is `unavailable` when the last line has no hash field", () => {
  const p = writeScratch(
    "last-no-hash.ndjson",
    readFileSync(VALID4, "utf8") + '{"seq":5}\n',
  );
  const r = verify(p);
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.equal(r.stderr, identity(valid.genesis, "unavailable"));
});

test("EX-24: a hash that is not 64 lowercase hex is `unavailable`", () => {
  const p = writeScratch(
    "bad-hash-field.ndjson",
    `{"hash":"${valid.genesis.toUpperCase()}"}\n{"hash":42}\n`,
  );
  const r = verify(p);
  assertOneStdoutLine(r);
  assert.equal(r.stderr, identity("unavailable", "unavailable"));
});

test("EX-24: the last line is read even without a final LF", () => {
  const p = writeScratch(
    "no-final-lf.ndjson",
    readFileSync(VALID4, "utf8").replace(/\n$/, ""),
  );
  const r = verify(p);
  assert.equal(r.status, 1); // EX-4
  assert.equal(r.stderr, identity(valid.genesis, valid.head));
});

test("EX-24: an empty export reports neither value", () => {
  const p = writeScratch("empty.ndjson", "");
  const r = verify(p);
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.match(r.stdout, /^INVALID at line 1(:|\n)/);
  assert.equal(r.stderr, "");
});

test("EX-24: an unreadable file is a tool error with no identity lines", () => {
  const r = verify(join(scratch, "does-not-exist.ndjson"));
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^[^\n]*\n$/);
});
