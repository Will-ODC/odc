// ET-23 (quantized ballot `ts`) and ET-24 (minimum batch size and its blamed
// line), event-types.md "Ballot publication discipline".
//
// WHAT THIS FILE IS, AND WHAT IT IS NOT. When this file was written no vector in
// `contracts/fixtures/` cited ET-23, and no vector had an issue whose ballots
// span more than one batch — so the conformance suite cannot tell whether either
// rule is implemented at all. Every chain here is SYNTHETIC AND SELF-CONSISTENT:
// hashed by `hashing.ts` and signed over a preimage that same module produces,
// i.e. by the functions under test (see `genesis-builder.ts`). These chains are
// a harness, not an oracle; the verdicts asserted below are this verifier's
// reading of the contract text, and a fixture for these rules supersedes them
// the day one lands.
//
// What they CAN detect is the decision logic itself, which is independent of
// the hashing path: whether a `ts` is quantized against the interval the issue
// declared, which ballots form a batch, which batch is last, and which line is
// blamed. Each rule is exercised in BOTH directions — chains that must be
// rejected and legal chains that must be accepted — because a check written
// over-broadly passes every rejection test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExport } from "../src/verify.js";
import { BallotBatches, epochMs, isQuantized } from "../src/batching.js";
import {
  ZERO64,
  distinctKeypair,
  keypair,
  signedEventLine,
  tokenAndLine,
  type KeyPair,
} from "./genesis-builder.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../src/cli.js"); // dist/test -> dist/src/cli.js

// Batch instants used throughout: whole minutes of one day, so each is a
// multiple of the 60000 ms floor interval.
const T0 = "2026-07-21T00:00:00.000Z";
const T1 = "2026-07-21T00:01:00.000Z";
const T2 = "2026-07-21T00:02:00.000Z";
const T3 = "2026-07-21T00:03:00.000Z";
const T4 = "2026-07-21T00:04:00.000Z";

/**
 * Builds a v1 chain line by line. `lines.length` after an append is that
 * event's 1-based LINE number, which is what every assertion below names.
 */
class Chain {
  readonly op: KeyPair = keypair();
  readonly reg: KeyPair = distinctKeypair(this.op.hex);
  private readonly lines: string[] = [];
  private prev = ZERO64;

  constructor() {
    this.push("genesis", {
      strings: {
        chain_id: createHash("sha256").update(this.op.rawPub).digest("hex"),
        contracts: "contracts-v1",
        operator_pk: this.op.hex,
        registrar_pk: this.reg.hex,
      },
      ints: {},
      ts: T0,
      signer: this.op,
    });
  }

  private push(
    type: string,
    e: {
      strings: Record<string, string>;
      ints: Record<string, number>;
      ts: string;
      signer: KeyPair | null;
      version?: number;
    },
  ): { line: number; hash: string } {
    const built = signedEventLine({
      seq: this.lines.length + 1,
      type,
      prevHash: this.prev,
      ...e,
    });
    this.lines.push(built.line);
    this.prev = built.hash;
    return { line: this.lines.length, hash: built.hash };
  }

  /** Append an issue_created; returns its issue_id (its hash, ID-7). */
  issue(opts: { intervalMs?: number; min?: number } = {}): string {
    return this.push("issue_created", {
      strings: { title: "Issue" },
      ints: {
        ballot_batch_interval_ms: opts.intervalMs ?? 60000,
        ballot_batch_min: opts.min ?? 3,
        choice_count: 2,
      },
      ts: T0,
      signer: this.op,
    }).hash;
  }

  /** Append one registrar-signed ballot; returns its line number. */
  vote(issueId: string, ts: string, version = 1, signer?: KeyPair): number {
    return this.push("vote_cast", {
      version,
      strings: { issue_id: issueId },
      ints: { choice: 0 },
      ts,
      // An unregistered version never reaches Stage B, so it needs no signature.
      signer: signer ?? (version === 1 ? this.reg : null),
    }).line;
  }

  /** `n` ballots of one issue at one instant; returns their line numbers. */
  votes(issueId: string, ts: string, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.vote(issueId, ts));
    return out;
  }

  /** A non-ballot line between ballots (a self-signed participant). */
  participant(): number {
    const p = keypair();
    return this.push("participant_registered", {
      strings: { pubkey: p.hex },
      ints: {},
      ts: T0,
      signer: p,
    }).line;
  }

  /** A line that fails Stage A: its stored hash is wrong (HA-14). */
  corruptLine(): number {
    const { line } = this.push("participant_registered", {
      strings: { pubkey: keypair().hex },
      ints: {},
      ts: T0,
      signer: null,
    });
    // Rewrite the stored hash; prev stays the real one, so only this line fails.
    const idx = line - 1;
    this.lines[idx] = (this.lines[idx] as string).replace(
      /"hash":"[0-9a-f]{64}"/,
      `"hash":"${"e".repeat(64)}"`,
    );
    return line;
  }

  head(): string {
    return this.prev;
  }

  bytes(): Buffer {
    return Buffer.from(this.lines.map((l) => l + "\n").join(""), "utf8");
  }

  verdict(head?: string): string {
    return tokenAndLine(verifyExport(this.bytes(), head));
  }
}

/** Independent oracle for `epochMs`: `Date` with `setUTCFullYear`, which (unlike
 * `Date.UTC`) does not remap years 0–99. Exact over the ES-20 range. */
function dateOracle(ts: string): number {
  const d = new Date(0);
  d.setUTCFullYear(
    Number(ts.slice(0, 4)),
    Number(ts.slice(5, 7)) - 1,
    Number(ts.slice(8, 10)),
  );
  d.setUTCHours(
    Number(ts.slice(11, 13)),
    Number(ts.slice(14, 16)),
    Number(ts.slice(17, 19)),
    Number(ts.slice(20, 23)),
  );
  return d.getTime();
}

function isoFromMs(ms: number): string {
  // toISOString renders years 0000–9999 as four digits, matching ES-20.
  return new Date(ms).toISOString();
}

// --- the harness itself ------------------------------------------------------

test("harness: one issue, one full batch verifies (calibration only)", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  assert.equal(c.verdict(), "VALID");
});

// --- epochMs: the ts -> milliseconds conversion ET-23 rests on ----------------

test("epochMs: the anchors and both ends of the ES-20 range are exact", () => {
  assert.equal(epochMs("1970-01-01T00:00:00.000Z"), 0);
  assert.equal(epochMs("1969-12-31T23:59:59.999Z"), -1);
  assert.equal(epochMs("0000-01-01T00:00:00.000Z"), -62167219200000);
  assert.equal(epochMs("9999-12-31T23:59:59.999Z"), 253402300799999);
  assert.equal(epochMs("2000-02-29T12:34:56.789Z"), 951827696789);
  // Both ends are safe integers: no rounding anywhere in the range.
  assert.ok(Number.isSafeInteger(epochMs("0000-01-01T00:00:00.000Z")));
  assert.ok(Number.isSafeInteger(epochMs("9999-12-31T23:59:59.999Z")));
});

test("epochMs matches the Date oracle on every year 0000-9999 at month and leap boundaries", () => {
  const dates = ["01-01", "02-28", "03-01", "12-31"];
  for (let y = 0; y <= 9999; y++) {
    const yyyy = String(y).padStart(4, "0");
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const days = leap ? [...dates, "02-29"] : dates;
    for (const md of days) {
      const ts = `${yyyy}-${md}T23:59:59.999Z`;
      assert.equal(epochMs(ts), dateOracle(ts), ts);
    }
  }
});

test("isQuantized: negative multiples (pre-1970) count, off-by-one does not", () => {
  assert.ok(isQuantized(-60000, 60000));
  assert.ok(isQuantized(0, 60000));
  assert.ok(!isQuantized(-1, 60000));
  assert.ok(!isQuantized(60001, 60000));
  assert.ok(isQuantized(0, Number.MAX_SAFE_INTEGER));
  assert.ok(!isQuantized(60000, Number.MAX_SAFE_INTEGER));
});

// --- ET-23: what MUST be rejected ---------------------------------------------

test("ET-23: a ballot ts one millisecond after the batch instant is INVALID at that ballot", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  const bad = c.vote(a, "2026-07-21T00:02:00.001Z");
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-23: a ballot ts one millisecond before the batch instant is INVALID at that ballot", () => {
  const c = new Chain();
  const a = c.issue();
  const bad = c.vote(a, "2026-07-21T00:00:59.999Z");
  c.votes(a, T1, 3);
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-23: the interval is the issue's DECLARED one, not the 60000 floor", () => {
  // 00:01:00 is a multiple of 60000 but not of the declared 90000.
  const c = new Chain();
  const a = c.issue({ intervalMs: 90000 });
  const bad = c.vote(a, T1);
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-23: each ballot is checked against its OWN issue's interval", () => {
  const c = new Chain();
  const a = c.issue({ intervalMs: 60000 });
  const b = c.issue({ intervalMs: 120000 });
  c.votes(a, T1, 3); // fine for a
  const bad = c.vote(b, T1); // 60000 is not a multiple of 120000
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-23: a ballot one millisecond into year 0000 is INVALID", () => {
  const c = new Chain();
  const a = c.issue();
  const bad = c.vote(a, "0000-01-01T00:00:00.001Z");
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-23: under the largest legal interval only the epoch itself is quantized", () => {
  const c = new Chain();
  const a = c.issue({ intervalMs: Number.MAX_SAFE_INTEGER });
  c.votes(a, "1970-01-01T00:00:00.000Z", 3);
  const bad = c.vote(a, "1970-01-01T00:01:00.000Z");
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

// --- ET-23: what MUST be accepted ---------------------------------------------

test("ET-23: a declared 90000 ms interval accepts its own multiples", () => {
  const c = new Chain();
  const a = c.issue({ intervalMs: 90000 });
  c.votes(a, "2026-07-21T00:01:30.000Z", 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-23: pre-1970 instants and year 0000 are quantized like any other", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, "0000-01-01T00:00:00.000Z", 3);
  c.votes(a, "1969-12-31T23:59:00.000Z", 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-23: a weekly interval accepts a first-century instant (Date.UTC would misplace it)", () => {
  // Date.UTC maps years 0-99 to 1900-1999; a week-aligned instant in year 0050
  // is only week-aligned if the year is placed correctly.
  const week = 7 * 86400000;
  const target = dateOracle("0050-06-15T00:00:00.000Z");
  const aligned = Math.floor(target / week) * week;
  const ts = isoFromMs(aligned);
  assert.ok(ts.startsWith("0050-"), ts);
  const c = new Chain();
  const a = c.issue({ intervalMs: week });
  c.votes(a, ts, 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-23: under the largest legal interval the epoch instant verifies", () => {
  const c = new Chain();
  const a = c.issue({ intervalMs: Number.MAX_SAFE_INTEGER });
  c.votes(a, "1970-01-01T00:00:00.000Z", 3);
  assert.equal(c.verdict(), "VALID");
});

// --- ET-24: what MUST be accepted ---------------------------------------------

test("ET-24: a batch of exactly ballot_batch_min followed by another batch is VALID", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: the issue's last batch may be under-size (the one legal under-size batch)", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 1);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: a lone under-size batch is the issue's last, so it is legal", () => {
  const c = new Chain();
  const a = c.issue({ min: 5 });
  c.votes(a, T1, 2);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: the declared minimum is read from the issue (5 ballots meet min 5)", () => {
  const c = new Chain();
  const a = c.issue({ min: 5 });
  c.votes(a, T1, 5);
  c.votes(a, T2, 1);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: interleaved issues each meeting their minimum are VALID", () => {
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  for (let i = 0; i < 3; i++) {
    c.vote(a, T1);
    c.vote(b, T1);
  }
  for (let i = 0; i < 3; i++) {
    c.vote(b, T2);
    c.vote(a, T2);
  }
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: an under-size batch followed only by ANOTHER issue's ballots is still its issue's last", () => {
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  c.votes(a, T1, 1);
  c.votes(b, T1, 3);
  c.votes(b, T2, 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: lastness is by seq — a later-seq batch with an EARLIER ts is the last", () => {
  // 3 ballots at 00:02, then 1 at 00:01. By seq the 00:01 batch holds the
  // highest-seq ballot, so it is last and may be under-size. Deciding lastness
  // by the greatest ts would wrongly reject this.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T2, 3);
  c.votes(a, T1, 1);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: a batch is ALL ballots sharing issue and ts, even when not contiguous", () => {
  // 00:01 x2, 00:02 x3, 00:01 x1: the 00:01 batch has 3 members in total and
  // holds the highest-seq ballot; the 00:02 batch has 3. Every batch is full.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  c.votes(a, T2, 3);
  c.votes(a, T1, 1);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: an under-size batch that is RETURNED to and holds the highest-seq ballot is last", () => {
  // 00:01 x1, 00:02 x3, 00:01 x1: the 00:01 batch has 2 members (under-size)
  // but holds the issue's highest-seq ballot, so it is the exempt last batch.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 1);
  c.votes(a, T2, 3);
  c.votes(a, T1, 1);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: a full batch plus a partial final one verifies under a matching --head", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 2);
  assert.equal(c.verdict(c.head()), "VALID");
});

// --- ET-24: what MUST be rejected, and WHERE ----------------------------------

test("ET-24: an under-size batch followed by a later ballot of its issue is INVALID at that later ballot", () => {
  const c = new Chain();
  const a = c.issue();
  const under = c.votes(a, T1, 2);
  const [blamed] = c.votes(a, T2, 3);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
  // Never at the under-size batch itself.
  assert.notEqual(blamed, under[1]);
});

test("ET-24: one ballot short of the DECLARED minimum (4 of 5) is rejected", () => {
  const c = new Chain();
  const a = c.issue({ min: 5 });
  c.votes(a, T1, 4);
  const blamed = c.vote(a, T2);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24: the blamed line skips other issues' ballots and non-ballot lines", () => {
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  c.votes(a, T1, 2);
  c.votes(b, T1, 3); // other issue: not "of that issue"
  c.participant(); // not a vote_cast at all
  c.issue(); // nor this
  const blamed = c.vote(a, T2);
  c.votes(a, T2, 2);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24: lastness is by seq — an under-size batch with the GREATEST ts is not last if a ballot follows it", () => {
  // 1 ballot at 00:02, then 3 at 00:01. The 00:02 batch is under-size and the
  // 00:01 ballots follow it in seq. Deciding lastness by greatest ts would
  // wrongly accept this.
  const c = new Chain();
  const a = c.issue();
  c.vote(a, T2);
  const [blamed] = c.votes(a, T1, 3);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24: a non-contiguous under-size batch is blamed at the first same-issue ballot after its LAST member", () => {
  // 00:01 x2, 00:02 x1 (line u), 00:01 x1 (line u+1), 00:03 x3.
  // Final batches: 00:01 = 3 (full), 00:02 = 1 (under-size, not last),
  // 00:03 = 3 (last). The 00:02 batch's last member is line u, so the blamed
  // line is u+1 — a ballot of the 00:01 batch, which itself is legal.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const u = c.vote(a, T2);
  const blamed = c.vote(a, T1);
  c.votes(a, T3, 3);
  assert.equal(blamed, u + 1);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24: with several violations, the LOWEST blamed line wins (not the first batch created)", () => {
  // a's under-size batch is created first but blamed later than b's.
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  c.vote(a, T1); // a@00:01 — under-size
  c.vote(b, T1); // b@00:01 — under-size
  const bBlamed = c.vote(b, T2);
  c.votes(b, T2, 2);
  const aBlamed = c.vote(a, T2);
  c.votes(a, T2, 2);
  assert.ok(bBlamed < aBlamed);
  assert.equal(c.verdict(), `INVALID at line ${bBlamed}`);
});

test("ET-24: a second batch that is ALSO under-size and not last is caught too", () => {
  // First batch full; second under-size, then a third.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 2);
  const blamed = c.vote(a, T3);
  c.votes(a, T4, 3);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24 vs a later Stage A fault: the earlier ET-24 line wins", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const blamed = c.vote(a, T2);
  c.corruptLine();
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24 vs an earlier Stage A fault: the earlier fault wins", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const bad = c.corruptLine();
  c.vote(a, T2);
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-24: a ballot that fails its own checks joins no batch", () => {
  // 00:01 x2, 00:02 x1 (blamed), then a 00:01 ballot signed by the OPERATOR
  // key (fails ET-17). Were the failing ballot admitted, the 00:01 batch would
  // reach 3 and become last again, hiding the ET-24 violation behind the
  // later ET-17 line.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const blamed = c.vote(a, T2);
  const badSig = c.vote(a, T1, 1, c.op);
  assert.ok(blamed < badSig);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24 with --head: the ET-24 line is named, not the last line", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const blamed = c.vote(a, T2);
  c.votes(a, T2, 4);
  assert.equal(c.verdict(c.head()), `INVALID at line ${blamed}`);
});

// --- ET-24 and unregistered vote_cast versions (EV-8) --------------------------

test("ET-24: an unregistered vote_cast version joins no batch (its payload is never read)", () => {
  // Two v1 ballots at 00:01, one vote_cast v1000000 naming the same issue and
  // instant, then a v1 batch at 00:02. Counted, the 00:01 batch would reach 3;
  // it is not counted, so the v1 batch is under-size and not last.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  c.vote(a, T1, 1000000);
  const [blamed] = c.votes(a, T2, 3);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24: an unregistered vote_cast after an under-size batch does not prove it was not last", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 1);
  const unreg = c.vote(a, T3, 1000000);
  assert.equal(c.verdict(), `PARTIAL at lines ${unreg}`);
});

// --- cost: linear in the export ------------------------------------------------

test("BallotBatches stays linear under a hostile pattern (200k batches, one issue)", () => {
  // Every ballot opens a new under-size batch of the same issue: the worst case
  // for any implementation that rescans earlier batches per ballot (O(n^2) —
  // ~2e10 steps here) instead of touching one batch per ballot.
  const t = new BallotBatches();
  t.openIssue("a", 3);
  const n = 200000;
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++) t.admit("a", i * 60000, i + 3);
  const first = t.firstViolation();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(first, 4); // batch @0 under-size, next ballot on line 4
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test("BallotBatches: blamed line is the successor of the batch's last member", () => {
  const t = new BallotBatches();
  t.openIssue("a", 3);
  t.openIssue("b", 3);
  t.admit("a", 0, 10);
  t.admit("b", 0, 11);
  t.admit("a", 0, 12); // a@0 now has 2
  t.admit("a", 60000, 13); // successor of a@0
  t.admit("a", 60000, 14);
  t.admit("a", 60000, 15);
  assert.equal(t.firstViolation(), 13);
});

// --- the CLI: one verdict line and the exit status ----------------------------

function runCli(bytes: Buffer): { status: number | null; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "odc-batching-"));
  const file = join(dir, "export.ndjson");
  writeFileSync(file, bytes);
  const r = spawnSync(process.execPath, [cliPath, "verify", file], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout };
}

test("CLI: an ET-24 violation prints one INVALID line naming the blamed line and exits 1", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const blamed = c.vote(a, T2);
  const { status, stdout } = runCli(c.bytes());
  assert.equal(status, 1);
  assert.match(
    stdout,
    new RegExp(`^INVALID at line ${blamed}(: [^\\n]*)?\\n$`),
  );
});

test("CLI: an ET-23 violation prints one INVALID line naming the ballot and exits 1", () => {
  const c = new Chain();
  const a = c.issue();
  const bad = c.vote(a, "2026-07-21T00:01:00.001Z");
  const { status, stdout } = runCli(c.bytes());
  assert.equal(status, 1);
  assert.match(stdout, new RegExp(`^INVALID at line ${bad}(: [^\\n]*)?\\n$`));
});

test("CLI: a legal multi-batch chain with an under-size final batch prints VALID and exits 0", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 1);
  const { status, stdout } = runCli(c.bytes());
  assert.equal(status, 0);
  assert.equal(stdout, "VALID\n");
});
