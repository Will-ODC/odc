// EV-23 / EV-24 (evolution.md v8, §7): the two minimums every verifier
// accepts, and what this verifier does past its own limits.
//
// What is asserted, and on what authority:
//   - Within the minimums (lines up to 65536 bytes, depth up to 64) the
//     verifier reaches a verdict. The verdict VALUES used are ones the rules
//     fix without any fixture: an `x_` event (EV-18) with a correct hash and
//     link is PARTIAL at its line (EV-7, EV-8); a line that is not a canonical
//     event is INVALID at its line (EX-10, ES-17, EV-16). Both chains start at
//     fixture 001's genesis, which the corpus declares VALID.
//   - Past them: either a verdict established before any limit, or a
//     tool-level failure (exit 3, no verdict line, no EX-24 report) — never a
//     throw, a crash or a stack overflow, and never a verdict after a limit.
//   - No fixed limit on the number of lines or on the input's size: the file
//     is read in chunks, and a PARTIAL line is rendered in pieces.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExport, type Verdict } from "../src/verify.js";
import { parseEventLine, type ParsedEvent } from "../src/parse.js";
import { computeHash } from "../src/hashing.js";
import {
  FileRecords,
  LINE_MINIMUM,
  LimitReached,
  MAX_LINE_BYTES,
  recordsOf,
  type InputRecord,
} from "../src/input.js";
import {
  CLAIM_MAX_DEPTH,
  nestingDepthExceeds,
  storedClaims,
  storedHashClaim,
  verdictLine,
  verdictPieces,
} from "../src/report.js";
import { tokenAndLine } from "./genesis-builder.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../src/cli.js"); // dist/test -> dist/src/cli.js
const vectors = resolve(here, "../../../../contracts/fixtures/vectors");
const scratch = mkdtempSync(join(tmpdir(), "verifier-ts-limits-"));
// Several files here are over 64 MiB; never leave them behind.
after(() => rmSync(scratch, { recursive: true, force: true }));

// Fixture 001: a one-line chain the corpus declares VALID.
const GENESIS = readFileSync(resolve(vectors, "001-genesis-only.ndjson"));
const GENESIS_HASH = (
  JSON.parse(GENESIS.toString("utf8")) as {
    hash: string;
  }
).hash;

/**
 * An `x_pad` event (EV-18's reserved prefix, so never registered) at `seq`,
 * linked to `prev`, whose line is EXACTLY `length` bytes: a `pad` string fills
 * the difference. Hash computed over the parsed line, as HA-13 defines it.
 */
function xLine(
  seq: number,
  prev: string,
  length: number,
): { line: string; hash: string } {
  const build = (pad: string, hash: string): string =>
    `{"seq":${seq},"type":"x_pad","version":1,"payload":{"pad":"${pad}"},` +
    `"ts":"2026-01-01T00:00:00.000Z","prev_hash":"${prev}","hash":"${hash}"}`;
  const overhead = build("", "0".repeat(64)).length;
  assert.ok(length >= overhead, `cannot build a ${length}-byte line`);
  const pad = "a".repeat(length - overhead);
  const parsed = parseEventLine(Buffer.from(build(pad, "0".repeat(64))));
  assert.notEqual(parsed, null, "harness built an unparseable line");
  const hash = computeHash(parsed as ParsedEvent);
  const line = build(pad, hash);
  assert.equal(Buffer.byteLength(line), length);
  return { line, hash };
}

// An array, never `...lines`: a spread of 300,000 arguments overflows the stack.
function exportOf(lines: string[]): Buffer {
  return Buffer.concat([GENESIS, Buffer.from(lines.join("\n") + "\n")]);
}

function writeScratch(name: string, content: Buffer): string {
  const p = join(scratch, name);
  writeFileSync(p, content);
  return p;
}

function cli(file: string): {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync(process.execPath, [cliPath, "verify", file], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/** A clean tool-level failure: exit 3, nothing on stdout, one stderr line. */
function assertToolFailure(r: ReturnType<typeof cli>): void {
  assert.equal(r.signal, null, "the process must not die on a signal");
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}: ${r.stderr}`);
  assert.equal(r.stdout, "", "a tool-level failure prints no verdict");
  assert.match(r.stderr, /^[^\n]*limit reached[^\n]*\n$/);
  assert.doesNotMatch(r.stderr, /stored claim/, "no EX-24 report (EV-24)");
}

const deep = (d: number): string => "[".repeat(d) + "]".repeat(d);

// --- the limit constants themselves ------------------------------------------

test("this verifier's line limit sits above EV-23's 65536-byte minimum", () => {
  assert.equal(LINE_MINIMUM, 65536);
  assert.ok(MAX_LINE_BYTES > LINE_MINIMUM);
  assert.ok(CLAIM_MAX_DEPTH > 64);
});

// --- EV-23 line length: within the minimum ------------------------------------

test("a line of exactly 65536 bytes reaches its verdict (PARTIAL at line 2)", () => {
  const x = xLine(2, GENESIS_HASH, 65536);
  const bytes = exportOf([x.line]);
  assert.equal(tokenAndLine(verifyExport(bytes)), "PARTIAL at lines 2");
  // At EV-23's minimum used as THE limit, too: the boundary is inclusive.
  assert.equal(
    tokenAndLine(verifyExport(bytes, undefined, undefined, 65536)),
    "PARTIAL at lines 2",
  );
  // And its EX-24 claim is recovered (EV-24: no claim limit within the
  // minimums).
  assert.deepEqual(storedClaims(bytes), {
    genesis: GENESIS_HASH,
    head: x.hash,
  });
});

test("a 65536-byte line that is not a canonical event is INVALID at its line", () => {
  const x = xLine(2, GENESIS_HASH, 65536);
  const broken = x.line.replace('"seq":2', '"seq":3');
  assert.equal(
    tokenAndLine(verifyExport(exportOf([broken]))),
    "INVALID at line 2",
  );
});

test("the CLI reaches the verdict on a 65536-byte line, with both claims", () => {
  const x = xLine(2, GENESIS_HASH, 65536);
  const r = cli(writeScratch("len-65536.ndjson", exportOf([x.line])));
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "PARTIAL at line 2\n");
  assert.equal(
    r.stderr,
    `genesis hash (stored claim): ${GENESIS_HASH}\nhead hash (stored claim): ${x.hash}\n`,
  );
});

// --- past the minimum: a verdict, or a tool-level failure ---------------------

test("a 65537-byte line under a 65536-byte limit is a tool-level failure, not a verdict", () => {
  const x = xLine(2, GENESIS_HASH, 65537);
  assert.throws(
    () => verifyExport(exportOf([x.line]), undefined, undefined, 65536),
    LimitReached,
  );
});

test("a line past the limit after an earlier fatal line keeps that verdict", () => {
  // INVALID at line 2 is established before line 3 is reached (EV-24: a
  // verdict established before any limit is reported).
  const x = xLine(3, "f".repeat(64), 70000);
  const bytes = exportOf(["not json", x.line]);
  assert.equal(
    tokenAndLine(verifyExport(bytes, undefined, undefined, 65536)),
    "INVALID at line 2",
  );
});

test("a line past the limit after a PARTIAL-only line is a tool-level failure", () => {
  // PARTIAL is not settled until the last line (a later line may be INVALID),
  // so the over-limit line is reached before the verdict is established.
  const x = xLine(2, GENESIS_HASH, 1000);
  const over = "a".repeat(70000);
  assert.equal(
    tokenAndLine(verifyExport(exportOf([x.line]), undefined, undefined, 65536)),
    "PARTIAL at lines 2",
  );
  assert.throws(
    () => verifyExport(exportOf([x.line, over]), undefined, undefined, 65536),
    LimitReached,
  );
});

test("the CLI on a line past 64 MiB after a PARTIAL-only line: exit 3, no verdict", () => {
  const x = xLine(2, GENESIS_HASH, 1000);
  const file = writeScratch(
    "len-over-after-partial.ndjson",
    Buffer.concat([
      GENESIS,
      Buffer.from(x.line + "\n"),
      Buffer.alloc(MAX_LINE_BYTES + 1, 0x61),
      Buffer.from("\n"),
    ]),
  );
  assertToolFailure(cli(file));
});

test("a 1 MiB line after a valid genesis reaches its verdict (both kinds)", () => {
  const x = xLine(2, GENESIS_HASH, 1 << 20);
  assert.equal(
    tokenAndLine(verifyExport(exportOf([x.line]))),
    "PARTIAL at lines 2",
  );
  const junk = "a".repeat(1 << 20);
  assert.equal(
    tokenAndLine(verifyExport(exportOf([junk]))),
    "INVALID at line 2",
  );
});

test("the CLI on a line past 64 MiB: exit 3, no verdict, no crash", () => {
  const big = Buffer.alloc(MAX_LINE_BYTES + 1, 0x61);
  const file = writeScratch(
    "len-over.ndjson",
    Buffer.concat([GENESIS, big, Buffer.from("\n")]),
  );
  assertToolFailure(cli(file));
});

test("the CLI on a first line past 64 MiB with no LF at all: exit 3", () => {
  const file = writeScratch(
    "len-over-first.ndjson",
    Buffer.alloc(MAX_LINE_BYTES + 10, 0x7b),
  );
  assertToolFailure(cli(file));
});

test("the CLI keeps an earlier INVALID past a 64 MiB last line; that claim is unavailable", () => {
  const big = Buffer.alloc(MAX_LINE_BYTES + 1, 0x61);
  const file = writeScratch(
    "len-over-late.ndjson",
    Buffer.concat([GENESIS, Buffer.from("not json\n"), big, Buffer.from("\n")]),
  );
  const r = cli(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 2(: [^\n]*)?\n$/);
  assert.equal(
    r.stderr,
    `genesis hash (stored claim): ${GENESIS_HASH}\nhead hash (stored claim): unavailable\n`,
  );
});

// --- EV-23 nesting depth -------------------------------------------------------

for (const d of [3, 64, 65, 100_000, 1_000_000]) {
  test(`a depth-${d} line after a valid genesis is INVALID at line 2, without a throw`, () => {
    // Every line deeper than 2 is INVALID (EV-24, ES-17, EV-16); the parser
    // establishes it at the first bracket opening a third level.
    assert.equal(
      tokenAndLine(verifyExport(exportOf([deep(d)]))),
      "INVALID at line 2",
    );
  });
}

test("depth inside a payload, at 64 and 65, is INVALID at its line (ES-17)", () => {
  for (const d of [62, 63]) {
    // envelope + payload + d levels = depth d + 2
    const line =
      `{"seq":2,"type":"x_pad","version":1,"payload":{"a":${deep(d)}},` +
      `"ts":"2026-01-01T00:00:00.000Z","prev_hash":"${GENESIS_HASH}","hash":"${"0".repeat(64)}"}`;
    assert.equal(
      tokenAndLine(verifyExport(exportOf([line]))),
      "INVALID at line 2",
    );
  }
});

test("the CLI on a depth-1,000,000 line: one verdict line, exit 1", () => {
  const r = cli(writeScratch("deep.ndjson", exportOf([deep(1_000_000)])));
  assert.equal(r.signal, null);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^INVALID at line 2(: [^\n]*)?\n$/);
  assert.equal(
    r.stderr,
    `genesis hash (stored claim): ${GENESIS_HASH}\nhead hash (stored claim): unavailable\n`,
  );
});

test("the EV-23 depth scan: brackets in strings, escapes, stray closers, open strings", () => {
  const over = (s: string, max: number) =>
    nestingDepthExceeds(Buffer.from(s, "latin1"), max);
  assert.equal(over(deep(64), 64), false);
  assert.equal(over(deep(65), 64), true);
  assert.equal(over('{"a":"[[[["}', 1), false, "brackets inside a string");
  assert.equal(
    over('{"a":"\\"[["}', 1),
    false,
    "an escaped quote stays inside",
  );
  assert.equal(over('{"a":"\\\\"[}', 1), true, "an escaped backslash ends it");
  assert.equal(over("]]]][[", 2), false, "a closer at depth 0 does nothing");
  assert.equal(over("]]]][[[", 2), true);
  assert.equal(over('["[[[[', 1), false, "an open string ends the scan");
  assert.equal(over("{{}{}{}}", 2), false);
});

test("EX-24 claims: recovered at depth 64, unavailable past the claim limit, never a throw", () => {
  const h = "c".repeat(64);
  const nest = (d: number) => `{"hash":"${h}","x":${deep(d - 1)}}`;
  assert.equal(storedHashClaim(Buffer.from(nest(64))), h);
  assert.equal(storedHashClaim(Buffer.from(nest(CLAIM_MAX_DEPTH))), h);
  assert.equal(
    storedHashClaim(Buffer.from(nest(CLAIM_MAX_DEPTH + 1))),
    "unavailable",
  );
  assert.equal(storedHashClaim(Buffer.from(nest(1_000_000))), "unavailable");
});

test("EX-24 claims: a candidate past 64 MiB is unavailable even though it parses", () => {
  const h = "d".repeat(64);
  const head = `{"hash":"${h}","x":"`;
  const tail = '"}';
  const fill = (n: number) =>
    Buffer.concat([
      Buffer.from(head),
      Buffer.alloc(n - head.length - tail.length, 0x61),
      Buffer.from(tail),
    ]);
  assert.equal(storedHashClaim(fill(MAX_LINE_BYTES)), h);
  assert.equal(storedHashClaim(fill(MAX_LINE_BYTES + 1)), "unavailable");
});

// --- EV-24: no fixed limit on line count --------------------------------------

test("300,000 lines: every one listed in PARTIAL, through the library and the CLI", () => {
  const lines: string[] = [];
  let prev = GENESIS_HASH;
  const n = 300_000;
  for (let seq = 2; seq <= n; seq++) {
    const line =
      `{"seq":${seq},"type":"x_n","version":1,"payload":{},` +
      `"ts":"2026-01-01T00:00:00.000Z","prev_hash":"${prev}","hash":"`;
    const parsed = parseEventLine(
      Buffer.from(line + "0".repeat(64) + '"}'),
    ) as ParsedEvent;
    prev = computeHash(parsed);
    lines.push(line + prev + '"}');
  }
  const bytes = exportOf(lines);
  const v = verifyExport(bytes);
  assert.equal(v.verdict, "PARTIAL");
  const listed = v.verdict === "PARTIAL" ? v.lines : [];
  assert.equal(listed.length, n - 1);
  assert.deepEqual(listed.slice(0, 1), [2]);
  assert.deepEqual(listed.slice(listed.length - 1, listed.length), [n]);

  const r = cli(writeScratch("many.ndjson", bytes));
  assert.equal(r.status, 2);
  assert.equal(r.stdout, verdictLine(v) + "\n");
  assert.equal(r.stdout.split("\n").length, 2, "one stdout line");
});

test("a PARTIAL line rendered in pieces is the same line", () => {
  const v: Verdict = { verdict: "PARTIAL", lines: [2, 3, 5, 7, 11, 13, 17] };
  for (const size of [1, 2, 3, 7, 100]) {
    const pieces = verdictPieces(v, size);
    assert.equal(pieces.join(""), "PARTIAL at lines 2, 3, 5, 7, 11, 13, 17");
    for (const p of pieces) assert.doesNotMatch(p, /\n/);
  }
  assert.equal(
    verdictPieces({ verdict: "PARTIAL", lines: [4] }, 1).join(""),
    "PARTIAL at line 4",
  );
});

// --- the chunked file reader ---------------------------------------------------

function collect(records: Iterable<InputRecord>): string[] {
  const out: string[] = [];
  for (const r of records) {
    out.push(
      r.overLimit
        ? "<over>"
        : `${r.terminated ? "T" : "U"}:${r.bytes.toString("latin1")}`,
    );
  }
  return out;
}

test("the chunked file reader splits records exactly as the in-memory split does", () => {
  const inputs = [
    "",
    "\n",
    "\n\n",
    "a",
    "a\n",
    "a\n\n",
    "ab\ncd",
    "ab\ncd\n",
    "\nab\n\ncd\n",
    "abcdefghij\nk\n\nlmnopqrstuvwxyz",
    "x".repeat(25) + "\n" + "y".repeat(3) + "\n" + "z".repeat(40),
  ];
  for (const input of inputs) {
    const bytes = Buffer.from(input, "latin1");
    const file = writeScratch("split.ndjson", bytes);
    for (const chunk of [1, 2, 3, 7, 64]) {
      for (const maxLine of [4, 10, 1000]) {
        const fd = openSync(file, "r");
        try {
          const fr = new FileRecords(fd, maxLine, chunk);
          const got = collect(fr);
          const want = collect(recordsOf(bytes, maxLine));
          const what = `${JSON.stringify(input)} chunk=${chunk} max=${maxLine}`;
          assert.deepEqual(got, want, what);
          // The EX-24 candidates: those of the in-memory split, with a line
          // over the limit never held (null).
          const c = fr.candidates();
          if (bytes.length === 0) {
            assert.equal(c, undefined, what);
            continue;
          }
          const claims = storedClaims(bytes);
          assert.notEqual(c, undefined, what);
          assert.notEqual(claims, null, what);
          const lines = input.endsWith("\n")
            ? input.slice(0, -1).split("\n")
            : input.split("\n");
          const first = lines[0] as string;
          const last = lines[lines.length - 1] as string;
          const held = (s: string) => (s.length > maxLine ? null : s);
          assert.equal(c?.first?.toString("latin1") ?? null, held(first), what);
          assert.equal(c?.last?.toString("latin1") ?? null, held(last), what);
        } finally {
          closeSync(fd);
        }
      }
    }
  }
});

test("drain() after an early stop still finds the last candidate", () => {
  const file = writeScratch("drain.ndjson", Buffer.from("a\nb\nc\nlast"));
  const fd = openSync(file, "r");
  try {
    const fr = new FileRecords(fd, 1000, 2);
    const it = fr[Symbol.iterator]();
    it.next(); // the consumer stops after one record
    fr.drain();
    const c = fr.candidates();
    assert.equal(c?.first?.toString(), "a");
    assert.equal(c?.last?.toString(), "last");
  } finally {
    closeSync(fd);
  }
});

test("the CLI reports a directory as an unreadable file: exit 3, no verdict", () => {
  const r = cli(scratch);
  assert.equal(r.status, 3);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^error: cannot read file: [^\n]*\n$/);
});
