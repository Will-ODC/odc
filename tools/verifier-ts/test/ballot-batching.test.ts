// ET-23 (quantized ballot `ts`), ET-24 (minimum batch size and its blamed line)
// and ET-24a (a batch, once left, is closed), event-types.md "Ballot
// publication discipline" (written at v11; the unregistered-version section is
// re-read under v12's ET-24b, whose own suite is opaque-ballots.test.ts).
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
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExport } from "../src/verify.js";
import { BallotBatches, epochMs, isQuantized } from "../src/batching.js";
import { tokenAndLine } from "./genesis-builder.js";
import { Chain, T1, T2, T3, T4, UNREG } from "./chain-builder.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../src/cli.js"); // dist/test -> dist/src/cli.js

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

test("ET-24: with violations on two issues, the first in file order is named", () => {
  // a's under-size batch is opened first but closed later than b's.
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

test("ET-24 with --head: the ET-24 line is named, not the last line", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const blamed = c.vote(a, T2);
  c.votes(a, T2, 4);
  assert.equal(c.verdict(c.head()), `INVALID at line ${blamed}`);
});

// --- ET-24a: what MUST be rejected, and WHERE ---------------------------------

test("ET-24a: a ballot returning to a left instant is INVALID at the returning line", () => {
  // Both batches are full, so ET-24 is satisfied; only the return is wrong.
  const c = new Chain();
  const a = c.issue();
  const first = c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  const back = c.vote(a, T1);
  c.votes(a, T3, 3);
  assert.equal(c.verdict(), `INVALID at line ${back}`);
  assert.notEqual(back, first[0]); // never the resumed batch's first member
});

test("ET-24a: a return at the very end of the chain is INVALID at that last line", () => {
  // The returning ballot is the issue's highest-seq one; being last does not
  // excuse it (ET-24a has no last-batch exemption).
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  const back = c.vote(a, T1);
  assert.equal(c.verdict(), `INVALID at line ${back}`);
});

test("ET-24a: a return to ANY earlier instant counts, not only the batch just left", () => {
  // 00:01, 00:02, 00:03, then back to 00:01 — two batches back.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  c.votes(a, T3, 3);
  const back = c.vote(a, T1);
  assert.equal(c.verdict(), `INVALID at line ${back}`);
});

test("ET-24a: a return that follows an under-size batch is INVALID at the returning line", () => {
  // 00:01 x3, 00:02 x1 (under-size), back to 00:01. The returning ballot is
  // both the first ballot after the under-size batch (ET-24) and a return
  // (ET-24a); either way it is the fatal line.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.vote(a, T2);
  const back = c.vote(a, T1);
  assert.equal(c.verdict(), `INVALID at line ${back}`);
});

test("ET-24a: an under-size batch returned to — the old 'set' reading's VALID case — is INVALID", () => {
  // 00:01 x1, 00:02 x3, 00:01 x1. Under v9 this was one 00:01 batch of 2 that
  // held the issue's highest-seq ballot. v11: leaving 00:01 at size 1 already
  // breaks ET-24, at the first 00:02 ballot.
  const c = new Chain();
  const a = c.issue();
  c.vote(a, T1);
  const [closes] = c.votes(a, T2, 3);
  c.vote(a, T1);
  assert.equal(c.verdict(), `INVALID at line ${closes}`);
});

test("ET-24a: returning to the same instant of ANOTHER issue's batch is not a return", () => {
  // a leaves 00:01 for 00:02; b, a different issue, then publishes at 00:01.
  // ET-24a binds each issue separately, so b's 00:01 batch is legal.
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  c.votes(b, T1, 3);
  c.votes(b, T2, 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24a: an issue moving to an instant ANOTHER issue has left is not a return", () => {
  // a leaves 00:01; b, starting at 00:03, then moves to 00:01. Left instants
  // are per issue, so b never left 00:01 and its move is legal.
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  c.votes(b, T3, 3);
  c.votes(b, T1, 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24 over ET-24a: T1, T1, T2, T2, T2, T1 (min 3) is INVALID at the first T2", () => {
  // The contract's own example (ET-24 "Line attribution"): the run of two T1
  // ballots ends at the first T2, which is the fatal line. The returning T1 is
  // a later ET-24a violation and is never reached.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const [firstT2] = c.votes(a, T2, 3);
  const back = c.vote(a, T1);
  assert.ok(firstT2 !== undefined && firstT2 < back);
  assert.equal(c.verdict(), `INVALID at line ${firstT2}`);
});

// --- ET-24a: what MUST be accepted --------------------------------------------

test("ET-24a: other issues' ballots and other events between one batch's members are VALID", () => {
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  c.vote(a, T1);
  c.votes(b, T1, 3); // another issue's whole batch
  c.vote(a, T1);
  c.participant(); // a non-ballot event
  c.issue(); // and another issue opening
  c.vote(a, T1);
  c.votes(b, T2, 2); // b's last batch, under-size: legal
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24a: interleaving two issues at DIFFERENT instants is VALID", () => {
  // a at 00:01 and b at 00:02 alternate line by line: each issue's own run
  // never changes instant, though the file's ts alternates every line.
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  for (let i = 0; i < 3; i++) {
    c.vote(a, T1);
    c.vote(b, T2);
  }
  c.votes(a, T3, 3);
  c.votes(b, T4, 3);
  assert.equal(c.verdict(), "VALID");
});

// --- ET-24: the per-batch counter and the EX-16 truncation residual ------------

test("ET-24: three batches each exactly at the minimum, then a short fourth, is VALID", () => {
  // Pins the counter reset directly: each batch must be counted from 1. A
  // counter reset to 0 would make each exact-minimum batch look one short.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  c.votes(a, T3, 3);
  c.votes(a, T4, 1);
  assert.equal(c.verdict(), "VALID");
});

test("ET-24: after three batches at the minimum, an under-size fourth that is ended is INVALID", () => {
  // A counter that kept accumulating across batches would see the fourth batch
  // as holding 11 and miss it.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  c.votes(a, T3, 3);
  c.votes(a, T4, 2);
  const ends = c.vote(a, "2026-07-21T00:05:00.000Z");
  assert.equal(c.verdict(), `INVALID at line ${ends}`);
});

test("ET-24 / EX-16: truncation that makes a mid-chain under-size batch last hides it without --head", () => {
  // Full chain: T1 x3, T2 x2 (under-size), T3 x3. INVALID at the first T3.
  // Truncated just after T2, the under-size batch becomes the issue's last:
  // VALID on its own (EX-16), and INVALID at its last line under the original
  // head (EX-15, EX-19). ET-24 names this residual and this remedy.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  const t2 = c.votes(a, T2, 2);
  const [firstT3] = c.votes(a, T3, 3);
  const cut = t2[t2.length - 1] as number;
  assert.equal(c.verdict(), `INVALID at line ${firstT3}`);
  const truncated = c.prefixBytes(cut);
  assert.equal(tokenAndLine(verifyExport(truncated)), "VALID");
  assert.equal(
    tokenAndLine(verifyExport(truncated, c.head())),
    `INVALID at line ${cut}`,
  );
});

// --- ET-24 / ET-24a beside unregistered vote_cast versions (v12, ET-24b) ------
//
// Up to v11 these chains asserted that an unregistered ballot "joins no batch,
// ends none, and proves none not-last". v12 (ADR-0034) reverses that: such a
// ballot is opaque, may be a member of a batch this verifier checks, and ET-24b
// decides which registered checks it leaves unresolved. The full ET-24b suite
// is test/opaque-ballots.test.ts; these are the v11 chains re-read under v12.

test("ET-24b: an opaque ballot at another instant inside a run leaves the next ballot unresolved", () => {
  // 00:01 x3, an opaque ballot at 00:02, then 00:01 again. The opaque ballot
  // may have been a's, closing 00:01, so the returning 00:01 is unresolved.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  const unreg = c.vote(a, T2, UNREG);
  const back = c.vote(a, T1);
  assert.equal(c.verdict(), `PARTIAL at lines ${unreg},${back}`);
});

test("ET-24b: an opaque ballot at a left instant, then the current run continues: unresolved", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  const unreg = c.vote(a, T1, UNREG);
  const next = c.vote(a, T2);
  assert.equal(c.verdict(), `PARTIAL at lines ${unreg},${next}`);
});

test("ET-24b: an opaque ballot between one run's members leaves both affected ballots unresolved", () => {
  // 00:01, opaque@00:02, 00:01, 00:01, then 00:02 x3. The second 00:01 may
  // follow a closed batch; the first 00:02 may return to the opaque instant.
  const c = new Chain();
  const a = c.issue();
  c.vote(a, T1);
  const unreg = c.vote(a, T2, UNREG);
  const [second] = c.votes(a, T1, 2);
  const [firstT2] = c.votes(a, T2, 3);
  assert.equal(c.verdict(), `PARTIAL at lines ${unreg},${second},${firstT2}`);
});

test("ET-24b: an opaque ballot that could complete an under-size run makes its end unresolved", () => {
  // Two v1 ballots at 00:01, one opaque at 00:01, then a v1 batch at 00:02:
  // |R| + F = 2 + 1 = 3, not < 3, so the known ET-24 failure is not definite.
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 2);
  const unreg = c.vote(a, T1, UNREG);
  const [firstT2] = c.votes(a, T2, 3);
  assert.equal(c.verdict(), `PARTIAL at lines ${unreg},${firstT2}`);
});

test("ET-24b: an opaque ballot after an under-size batch proves nothing: PARTIAL on its own line", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 1);
  const unreg = c.vote(a, T3, UNREG);
  assert.equal(c.verdict(), `PARTIAL at lines ${unreg}`);
});

// --- cost: linear in the export ------------------------------------------------

test("BallotBatches stays linear under a hostile pattern (200k instants, one issue)", () => {
  // Every ballot opens a new instant, so the set of left instants grows to
  // 200k and every ballot must be checked against all of them (ET-24a). An
  // implementation that rescans the earlier ballots or instants per ballot is
  // O(n^2) — ~2e10 steps here; this one does one Set lookup per ballot.
  const t = new BallotBatches();
  t.openIssue("a", 1, 60000, 1); // below the ET-14b floor on purpose: no ET-24 stop
  const n = 200000;
  const start = process.hrtime.bigint();
  for (let i = 0; i < n; i++)
    assert.equal(t.admit("a", i + 2, i * 60000), "resolved");
  const back = t.admit("a", n + 2, 0); // return to the very first instant
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(back, "ET-24a");
  assert.ok(ms < 2000, `took ${ms} ms`);
});

test("BallotBatches: opaque-ballot cost grows linearly in opaque ballots (the current O(opaque x distinct intervals) bound)", () => {
  // An opaque ballot is tested against every DISTINCT interval among the
  // registered issues (ET-24b item 1). Machine speed varies ~10x between a
  // laptop and a loaded CI runner (a 2 s absolute limit flaked at 2.09 s), so
  // this compares two runs on the same machine instead: 1k intervals with 60k
  // opaque ballots against 1k intervals with 6k. At the current bound the
  // ratio is ~10 (measured 9.0-14.0 idle and with two full suites running
  // alongside). A cost that grows with the number of earlier opaque ballots
  // breaks it: a mutant rescanning every recorded opaque ballot measured 44.
  // The band, ratio < 25, sits between the two. (With 10k intervals the
  // interval term hides that mutant: 11.9.) Each side is the minimum of three
  // runs, after a warm-up, to shed GC and JIT noise; a 30 s absolute backstop
  // catches only a gross regression. Sub-quadratic candidacy is an open
  // follow-up.
  const intervals = 1000;
  const run = (opaque: number): number => {
    const t = new BallotBatches();
    for (let i = 0; i < intervals; i++)
      t.openIssue(`i${i}`, i + 2, 60000 * (i + 1), 3);
    const start = process.hrtime.bigint();
    for (let j = 0; j < opaque; j++)
      t.opaque(intervals + 2 + j, 60000 * (j % 7));
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // The summaries are live: issue i0 (interval 60000) sees a candidate.
    assert.equal(
      t.admit("i0", intervals + opaque + 3, 60000 * 100),
      "unresolved",
    );
    return ms;
  };
  run(6000); // warm-up
  const best = (opaque: number): number =>
    Math.min(run(opaque), run(opaque), run(opaque));
  const small = best(6000);
  const large = best(60000);
  const ratio = large / small;
  assert.ok(
    ratio < 25,
    `60k/6k opaque ratio ${ratio.toFixed(1)} (${large.toFixed(0)} ms / ${small.toFixed(0)} ms)`,
  );
  assert.ok(large < 30000, `took ${large} ms`);
});

test("BallotBatches: the leaving ballot reports ET-24 when the batch it leaves is under-size", () => {
  const t = new BallotBatches();
  t.openIssue("a", 1, 60000, 3);
  t.openIssue("b", 2, 60000, 3);
  assert.equal(t.admit("a", 3, 0), "resolved");
  assert.equal(t.admit("b", 4, 60000), "resolved"); // other issue: no effect on a
  assert.equal(t.admit("a", 5, 0), "resolved");
  assert.equal(t.admit("a", 6, 60000), "ET-24"); // a@0 holds 2 < 3
});

test("BallotBatches: a batch left at the minimum is closed; returning to it is ET-24a", () => {
  const t = new BallotBatches();
  t.openIssue("a", 1, 60000, 3);
  for (let i = 0; i < 3; i++) assert.equal(t.admit("a", i + 2, 0), "resolved");
  assert.equal(t.admit("a", 5, 60000), "resolved");
  assert.equal(t.admit("a", 6, 0), "ET-24a");
});

// --- the CLI: one verdict line and the exit status ----------------------------

function runCli(bytes: Buffer): { status: number | null; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "odc-batching-"));
  const file = join(dir, "export.ndjson");
  try {
    writeFileSync(file, bytes);
    const r = spawnSync(process.execPath, [cliPath, "verify", file], {
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("CLI: an ET-24a return prints one INVALID line naming the returning ballot and exits 1", () => {
  const c = new Chain();
  const a = c.issue();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  const back = c.vote(a, T1);
  const { status, stdout } = runCli(c.bytes());
  assert.equal(status, 1);
  assert.match(stdout, new RegExp(`^INVALID at line ${back}(: [^\\n]*)?\\n$`));
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
