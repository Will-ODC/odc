// Issue #193: `--chain <genesis-hash>` (export-format.md EX-22/EX-23) and the
// EX-24 report of the stored genesis-hash and head claims on every non-empty
// run; brought to export-format.md v5 (anchor precedence, stored claims).
//
// Inputs are golden fixture exports (and byte-level edits of them); the
// expected verdicts follow from EX-15/EX-22/EX-23. The EX-24 lines are tool
// output, not conformance surface (EV-17), so they are asserted here and never
// in fixtures.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENESIS_CLAIM_LABEL,
  HEAD_CLAIM_LABEL,
  storedClaims,
} from "../src/report.js";
import { run, type CliDeps } from "../src/run.js";

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

/** The exact EX-24 stderr report: one line per endpoint, stored claims. */
function identity(genesis: string, head: string): string {
  return `${GENESIS_CLAIM_LABEL}: ${genesis}\n${HEAD_CLAIM_LABEL}: ${head}\n`;
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

// --- v5: anchor precedence (EX-15 / EX-22 / EX-23) ---------------------------

test("v5 EX-23: both anchors wrong on a PARTIAL (eligible) file blames line 1", () => {
  const r = verify(PARTIAL5, "--head", WRONG, "--chain", WRONG);
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.match(r.stdout, /^INVALID at line 1(:|\n)/);
});

test("v5 EX-15: PARTIAL does not block the --head comparison (last line blamed)", () => {
  const r = verify(PARTIAL5, "--head", WRONG);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 5(:|\n)/);
});

test("v5 EX-15/EX-22: both anchors wrong never displace an earlier file-check INVALID", () => {
  // Line 3's stored hash flipped: INVALID at line 3 on its own (HA-14).
  const lines = readFileSync(VALID4, "utf8").split("\n");
  const l3 = JSON.parse(lines[2] as string) as { hash: string };
  const flipped = (l3.hash[0] === "0" ? "1" : "0") + l3.hash.slice(1);
  lines[2] = (lines[2] as string).replace(l3.hash, flipped);
  const p = writeScratch("tampered-line3-both.ndjson", lines.join("\n"));
  for (const args of [
    ["--head", WRONG],
    ["--chain", WRONG, "--head", WRONG],
  ]) {
    const r = verify(p, ...args);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^INVALID at line 3(:|\n)/);
  }
});

test("v5 EX-15/EX-22: a framing INVALID keeps its line under wrong anchors", () => {
  // A trailing blank record (EX-5) is INVALID at that line, line 5; neither a
  // wrong --chain (line 1) nor a wrong --head may replace it.
  const p = writeScratch(
    "trailing-blank.ndjson",
    readFileSync(VALID4, "utf8") + "\n",
  );
  const r = verify(p, "--chain", WRONG, "--head", WRONG);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 5(:|\n)/);
});

// --- v5 EX-24: candidate extraction -----------------------------------------

const A = "a".repeat(64);
const B = "b".repeat(64);
const enc = (s: string) => Buffer.from(s, "utf8");

test("EX-24 extraction: one terminal LF ends the last record, adds no candidate", () => {
  assert.deepEqual(storedClaims(enc(`{"hash":"${A}"}\n{"hash":"${B}"}\n`)), {
    genesis: A,
    head: B,
  });
});

test("EX-24 extraction: an additional trailing blank record IS the last candidate", () => {
  assert.deepEqual(storedClaims(enc(`{"hash":"${A}"}\n{"hash":"${B}"}\n\n`)), {
    genesis: A,
    head: "unavailable",
  });
});

test("EX-24 extraction: without a final LF the final fragment is the last candidate", () => {
  assert.deepEqual(storedClaims(enc(`{"hash":"${A}"}\n{"hash":"${B}"}`)), {
    genesis: A,
    head: B,
  });
  // One record, no LF at all: it is both the first and the last candidate.
  assert.deepEqual(storedClaims(enc(`{"hash":"${A}"}`)), {
    genesis: A,
    head: A,
  });
});

test("EX-24 extraction: a leading blank record is the first candidate", () => {
  assert.deepEqual(storedClaims(enc(`\n{"hash":"${B}"}\n`)), {
    genesis: "unavailable",
    head: B,
  });
});

test("EX-24 extraction: a lone LF is one blank candidate, both claims unavailable", () => {
  for (const s of ["\n", "\n\n"]) {
    assert.deepEqual(storedClaims(enc(s)), {
      genesis: "unavailable",
      head: "unavailable",
    });
  }
});

test("EX-24 extraction: an empty input has no endpoints", () => {
  assert.equal(storedClaims(enc("")), null);
});

test("EX-24 extraction applies when framing fails: CRLF records still yield claims", () => {
  // Every line carries a CR (EX-3, INVALID), but each candidate is still a
  // JSON object — a trailing CR is JSON whitespace — so both stored claims
  // are recovered.
  const crlf = readFileSync(VALID4, "utf8").replace(/\n/g, "\r\n");
  const r = verify(writeScratch("crlf.ndjson", crlf));
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.equal(r.stderr, identity(valid.genesis, valid.head));
});

test("EX-24 extraction applies when framing fails: a trailing blank record makes head unavailable", () => {
  const p = writeScratch(
    "trailing-blank-report.ndjson",
    readFileSync(VALID4, "utf8") + "\n",
  );
  const r = verify(p);
  assert.equal(r.status, 1);
  assertOneStdoutLine(r);
  assert.equal(r.stderr, identity(valid.genesis, "unavailable"));
});

// --- v5 EX-24: claim availability -------------------------------------------

/** The claim of a one-candidate input (first and last coincide). */
function claimOf(record: string | Buffer): string {
  const c = storedClaims(typeof record === "string" ? enc(record) : record);
  assert.ok(c !== null);
  assert.equal(c.genesis, c.head, "a one-candidate input has one claim");
  return c.genesis;
}

test("EX-24 claim: a repeated top-level `hash` key uses its LAST occurrence", () => {
  assert.equal(claimOf(`{"hash":"${A}","hash":"${B}"}`), B);
  // The last occurrence decides even when it is the unusable one: there is
  // no fallback to an earlier well-formed value.
  assert.equal(
    claimOf(`{"hash":"${A}","hash":"${A.toUpperCase()}"}`),
    "unavailable",
  );
  assert.equal(claimOf(`{"hash":"${A.toUpperCase()}","hash":"${A}"}`), A);
});

test("EX-24 claim: no normalisation — case, padding and length are not repaired", () => {
  for (const bad of [
    A.toUpperCase(),
    "A" + A.slice(1),
    ` ${A}`,
    `${A} `,
    A.slice(1), // 63 hex
    A + "a", // 65 hex
    "g".repeat(64),
  ]) {
    assert.equal(
      claimOf(`{"hash":${JSON.stringify(bad)}}`),
      "unavailable",
      bad,
    );
  }
});

test("EX-24 claim: `hash` must be a top-level string member of an object", () => {
  for (const rec of [
    `{"hash":42}`,
    `{"hash":null}`,
    `{"hash":["${A}"]}`,
    `{"payload":{"hash":"${A}"}}`, // nested only
    `["${A}"]`,
    `[{"hash":"${A}"}]`,
    `"${A}"`,
    `{"Hash":"${A}"}`,
    `{}`,
    `{"hash":"${A}"`, // truncated JSON
    `not json`,
  ]) {
    assert.equal(claimOf(rec), "unavailable", rec);
  }
});

test("EX-24 claim: recovery is not a canonical-form check", () => {
  // Whitespace, a different key order and extra keys are all non-canonical
  // (EX-7/EX-10), but the candidate still decodes as a JSON object.
  assert.equal(claimOf(`  { "seq" : 9 , "hash" : "${A}" , "x" : 1 }  `), A);
});

test("EX-24 claim: bytes that are not UTF-8, or a leading BOM, make the claim unavailable", () => {
  const ok = enc(`{"hash":"${A}","t":"x"}`);
  assert.equal(claimOf(ok), A); // control: the unedited candidate is available
  const badUtf8 = Buffer.from(ok);
  badUtf8[badUtf8.length - 3] = 0xff; // the "x" in "t"'s value
  assert.equal(claimOf(badUtf8), "unavailable");
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), ok]);
  assert.equal(claimOf(bom), "unavailable");
});

test("EX-24 claim: an inherited property is never read as `hash`", () => {
  assert.equal(claimOf(`{"__proto__":{"hash":"${A}"}}`), "unavailable");
});

test("EX-24: one unavailable endpoint never suppresses the other", () => {
  assert.deepEqual(storedClaims(enc(`not json\n{"hash":"${B}"}\n`)), {
    genesis: "unavailable",
    head: B,
  });
  assert.deepEqual(storedClaims(enc(`{"hash":"${A}"}\nnot json\n`)), {
    genesis: A,
    head: "unavailable",
  });
});

// --- v5 EX-24: when the report is (and is not) written ----------------------

function inProcess(verifyFn: CliDeps["verify"], file: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(["node", "cli.js", "verify", file], {
    verify: verifyFn,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

test("EX-24: the report labels describe stored claims, one line per endpoint", () => {
  const r = verify(VALID4);
  assert.equal(r.stdout, "VALID\n");
  const lines = r.stderr.split("\n").slice(0, -1);
  assert.equal(lines.length, 2, "exactly one line per endpoint");
  // Exact bytes, shared with the Go verifier so the two can be diffed.
  assert.equal(GENESIS_CLAIM_LABEL, "genesis hash (stored claim)");
  assert.equal(HEAD_CLAIM_LABEL, "head hash (stored claim)");
  assert.equal(lines[0], `genesis hash (stored claim): ${valid.genesis}`);
  assert.equal(lines[1], `head hash (stored claim): ${valid.head}`);
  for (const l of lines) {
    assert.match(l, /\(stored claim\): [0-9a-f]{64}$/);
    // Never presented as a successful verification or recomputation.
    assert.doesNotMatch(l, /verif|recomput|comput/i);
  }
});

test("EX-24: every chain verdict (here an injected INVALID) gets the report", () => {
  const r = inProcess(() => ({ verdict: "INVALID", line: 2 }), VALID4);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "INVALID at line 2\n");
  assert.equal(r.stderr, identity(valid.genesis, valid.head));
});

test("EX-24: an internal error (#194) has no report — exit 3, one stderr line, empty stdout", () => {
  const r = inProcess(() => {
    throw new Error("boom");
  }, VALID4);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^[^\n]*internal error[^\n]*\n$/);
});

test("EX-24: a malformed --head is a tool error with no report", () => {
  const r = verify(VALID4, "--head", "abc");
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^[^\n]*--head[^\n]*\n$/);
});
