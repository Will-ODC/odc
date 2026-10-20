// ET-24b (batch checks beside ballots the verifier cannot read) and ET-18b (a
// ballot of an issue the verifier cannot read), event-types.md v12 /
// evolution.md v7 EV-7, EV-8, EV-17 (ADR-0034).
//
// Same terms as ballot-batching.test.ts: every chain is SYNTHETIC AND
// SELF-CONSISTENT (built by chain-builder.ts over the functions under test), a
// harness, not an oracle. The verdicts asserted are this verifier's reading of
// contracts/; a golden vector for these rules supersedes them the day one lands.
//
// Unless a test says otherwise a chain is: line 1 genesis, line 2 issue A,
// line 3 issue B, both at interval 60000 and minimum 3, ballots from line 4.
// "U" is a vote_cast at EV-19's reserved version 1000000: an opaque ballot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExport } from "../src/verify.js";
import { keypair, tokenAndLine } from "./genesis-builder.js";
import { Chain, T1, T2, T3, T4, UNREG } from "./chain-builder.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../src/cli.js");

const T1_PLUS_1MS = "2026-07-21T00:01:00.001Z";

function twoIssues(): { c: Chain; a: string; b: string } {
  const c = new Chain();
  const a = c.issue();
  const b = c.issue();
  return { c, a, b };
}

// --- ADR-0034's table: the eight cases, verbatim -------------------------------

test("ADR-0034 opaque member: A@T1, A@T1, U@T1, A@T2x3 -> PARTIAL 6, 7", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 2);
  c.vote(a, T1, UNREG);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "PARTIAL at lines 6,7");
});

test("ADR-0034 payload must stay opaque: U names issue B, same verdict PARTIAL 6, 7", () => {
  const { c, a, b } = twoIssues();
  c.votes(a, T1, 2);
  c.vote(b, T1, UNREG); // its issue_id says B; the verifier MUST NOT read it
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "PARTIAL at lines 6,7");
});

test("ADR-0034 insufficient even optimistically: A@T1, U@T1, A@T2x3 -> INVALID 6", () => {
  const { c, a } = twoIssues();
  c.vote(a, T1);
  c.vote(a, T1, UNREG);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "INVALID at line 6");
});

test("ADR-0034 opaque closure: A@T1x3, U@T2, A@T1 -> PARTIAL 7, 8", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  c.vote(a, T2, UNREG);
  c.vote(a, T1);
  assert.equal(c.verdict(), "PARTIAL at lines 7,8");
});

test("ADR-0034 definite resumed instant: A@T1x3, A@T2x3, U@T1, A@T1 -> INVALID 11", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  c.vote(a, T1, UNREG);
  c.vote(a, T1);
  assert.equal(c.verdict(), "INVALID at line 11");
});

test("ADR-0034 already full batch: A@T1x3, U@T1, A@T2x3 -> PARTIAL 7", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  c.vote(a, T1, UNREG);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "PARTIAL at lines 7");
});

test("ADR-0034 known-only control: A@T1x2, A@T2x3 -> INVALID 6", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 2);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "INVALID at line 6");
});

test("ADR-0034 definite quantization error: U@T1, A at T1 + 1 ms -> INVALID 5", () => {
  const { c, a } = twoIssues();
  c.vote(a, T1, UNREG);
  c.vote(a, T1_PLUS_1MS);
  assert.equal(c.verdict(), "INVALID at line 5");
});

// --- ET-18b: a registered ballot of an unregistered issue_created --------------

test("ET-18b: a v1 ballot naming an unregistered issue_created is PARTIAL naming both lines", () => {
  const c = new Chain();
  const x = c.issue({ version: UNREG }); // line 2
  const ballot = c.vote(x, T1); // line 3
  assert.equal(c.verdict(), `PARTIAL at lines 2,${ballot}`);
});

test("ET-18b: its ET-23 check is unresolved, not failed (an unquantized ts is still PARTIAL)", () => {
  const c = new Chain();
  const x = c.issue({ version: UNREG });
  c.vote(x, T1_PLUS_1MS);
  assert.equal(c.verdict(), "PARTIAL at lines 2,3");
});

test("ET-18b: its ET-18a check is unresolved (a choice of 40 against an unreadable choice_count)", () => {
  const c = new Chain();
  const x = c.issue({ version: UNREG });
  c.voteRaw({
    version: 1,
    strings: { issue_id: x },
    ints: { choice: 40 },
    ts: T1,
  });
  assert.equal(c.verdict(), "PARTIAL at lines 2,3");
});

test("ET-18b: its batch checks are unresolved (an under-size run of the unreadable issue, then a new instant)", () => {
  const c = new Chain();
  const x = c.issue({ version: UNREG });
  c.vote(x, T1);
  c.vote(x, T2);
  c.vote(x, T1);
  assert.equal(c.verdict(), "PARTIAL at lines 2,3,4,5");
});

test("ET-18b: ET-17 still applies — a bad signature is INVALID at the ballot", () => {
  const c = new Chain();
  const x = c.issue({ version: UNREG });
  const bad = c.vote(x, T1, 1, keypair()); // signed by a key that is not registrar_pk
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-18b: ES-18 still applies — an extra payload key is INVALID at the ballot", () => {
  const c = new Chain();
  const x = c.issue({ version: UNREG });
  const bad = c.voteRaw({
    version: 1,
    strings: { issue_id: x },
    ints: { choice: 0, extra: 1 },
    ts: T1,
  });
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-18b: a v1 ballot naming an unregistered vote_cast (not an issue_created) is still INVALID under ET-18", () => {
  const c = new Chain();
  c.issue();
  c.vote("ab".repeat(32), T1, UNREG); // line 3, opaque
  // Name line 3's hash: build a fresh chain identically is not possible
  // (fresh keys), so read the hash back from the bytes.
  const lines = c.bytes().toString("utf8").trimEnd().split("\n");
  const m = /"hash":"([0-9a-f]{64})"/.exec(lines[2] as string);
  assert.ok(m);
  const bad = c.vote(m[1] as string, T1);
  assert.equal(c.verdict(), `INVALID at line ${bad}`);
});

test("ET-18b: such a ballot is neither a registered ballot of any issue nor an ET-24b candidate", () => {
  // genesis, A (2), X unregistered (3), A@T1 x2 (4, 5), a v1 ballot of X at
  // T1 (6), A@T2 (7). Line 6 is not opaque, so F = 0 and line 7's known
  // ET-24 failure is definite.
  const c = new Chain();
  const a = c.issue();
  const x = c.issue({ version: UNREG });
  c.votes(a, T1, 2);
  c.vote(x, T1);
  const blamed = c.vote(a, T2);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-18b contrast: the same chain with an OPAQUE ballot in that position is PARTIAL", () => {
  const c = new Chain();
  const a = c.issue();
  c.issue({ version: UNREG });
  c.votes(a, T1, 2);
  const u = c.vote(a, T1, UNREG);
  const firstT2 = c.vote(a, T2);
  assert.equal(c.verdict(), `PARTIAL at lines 3,${u},${firstT2}`);
});

// --- ET-24b: more shapes --------------------------------------------------------

test("ET-24b: several opaque ballots add up in F (A@T1, U@T1, U@T1, A@T2x3 -> PARTIAL 5, 6, 7)", () => {
  const { c, a } = twoIssues();
  c.vote(a, T1);
  c.votes(a, T1, 2, UNREG);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "PARTIAL at lines 5,6,7");
});

test("ET-24b: F counts only candidates after w (opaque ballots at t from an earlier run do not fill this one)", () => {
  // U@T2 x2 (4, 5), A@T1 x3 (6-8), A@T2 (9), A@T3 (10). At 10 the run {9} at
  // T2 has w = 8, so the two T2 candidates before it do not count: definite.
  const { c, a } = twoIssues();
  c.votes(a, T2, 2, UNREG);
  c.votes(a, T1, 3);
  c.vote(a, T2);
  c.vote(a, T3);
  assert.equal(c.verdict(), "INVALID at line 10");
});

test("ET-24b: a candidate at another instant still counts when a later candidate sits at ts(L)", () => {
  // A@T1 (4), U@T2 (5), U@T1 (6), A@T1 (7). The latest candidate before 7 is
  // at T1 = ts(L), but U@T2 also falls after P(L) = 4, so 7 is unresolved.
  const { c, a } = twoIssues();
  c.vote(a, T1);
  c.vote(a, T2, UNREG);
  c.vote(a, T1, UNREG);
  c.vote(a, T1);
  assert.equal(c.verdict(), "PARTIAL at lines 5,6,7");
});

test("ET-24b: F counts a candidate between w and f (just before the run begins)", () => {
  // A@T1 x3 (4-6), U@T2 (7), A@T2 x2 (8, 9), A@T3 (10). The run {8, 9} has
  // w = 6, and U at 7 is at its instant t = T2: |R| + F = 3, not definite.
  // Line 8 is also unresolved (a candidate at its own instant precedes it).
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  c.vote(a, T2, UNREG);
  c.votes(a, T2, 2);
  c.vote(a, T3);
  assert.equal(c.verdict(), "PARTIAL at lines 7,8,10");
});

test("ET-24b: an opaque ballot before an issue's first registered ballot, at another instant: unresolved", () => {
  const { c, a } = twoIssues();
  const u = c.vote(a, T2, UNREG);
  const first = c.vote(a, T1);
  c.votes(a, T1, 2);
  assert.equal(c.verdict(), `PARTIAL at lines ${u},${first}`);
});

test("ET-24b: an opaque ballot before an issue's first registered ballot, at the same instant: resolved", () => {
  const { c, a } = twoIssues();
  const u = c.vote(a, T1, UNREG);
  c.votes(a, T1, 3);
  assert.equal(c.verdict(), `PARTIAL at lines ${u}`);
});

test("ET-24b: a run start at an instant some earlier candidate used is unresolved (a possible ET-24a return)", () => {
  // U@T2 (4), A@T1 x3 (5-7), A@T2 (8): line 5 is unresolved (the opaque
  // ballot may have been a's at another instant) and line 8 too (the
  // opaque ballot may have been a's batch at T2, which a has left).
  const { c, a } = twoIssues();
  c.vote(a, T2, UNREG);
  c.votes(a, T1, 3);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "PARTIAL at lines 4,5,8");
});

test("ET-24b: one opaque ballot counts in every issue it is a candidate of", () => {
  // A@T1 x2 (4, 5), B@T1 x2 (6, 7), U@T1 (8), A@T2 (9), B@T2 (10). U may
  // belong to A or to B, but not both; the rule is conservative and leaves
  // both run starts unresolved rather than search the assignments.
  const { c, a, b } = twoIssues();
  c.votes(a, T1, 2);
  c.votes(b, T1, 2);
  c.vote(a, T1, UNREG);
  c.vote(a, T2);
  c.vote(b, T2);
  assert.equal(c.verdict(), "PARTIAL at lines 8,9,10");
});

test("ET-24b: issues sharing instants, interleaved and full, are untouched by an opaque ballot at a full instant", () => {
  const { c, a, b } = twoIssues();
  for (let i = 0; i < 3; i++) {
    c.vote(a, T1);
    c.vote(b, T1);
  }
  const u = c.vote(b, T1, UNREG);
  for (let i = 0; i < 3; i++) {
    c.vote(a, T2);
    c.vote(b, T2);
  }
  assert.equal(c.verdict(), `PARTIAL at lines ${u}`);
});

test("ET-24b: an opaque ts that is a multiple of one issue's interval and not another's", () => {
  // A at 60000, B at 120000. 00:01 is a multiple of 60000 but not of 120000,
  // so U@00:01 is a candidate of A only. Lines: genesis 1, A 2, B 3,
  // B@T2 (4), A@T2 (5), U@T1 (6), B@T2 (7), A@T2 (8).
  const c = new Chain();
  const a = c.issue({ intervalMs: 60000 });
  const b = c.issue({ intervalMs: 120000 });
  c.vote(b, T2);
  c.vote(a, T2);
  const u = c.vote(a, T1, UNREG);
  c.vote(b, T2); // resolved: U is not a candidate of B
  const aNext = c.vote(a, T2); // unresolved: U is a candidate of A at another instant
  assert.equal(c.verdict(), `PARTIAL at lines ${u},${aNext}`);
});

test("ET-24b: an opaque ballot not quantized to the issue's interval is not a candidate", () => {
  // U at T1 + 1 ms is no issue's candidate, so A's under-size run is definite.
  const { c, a } = twoIssues();
  c.votes(a, T1, 2);
  c.vote(a, T1_PLUS_1MS, UNREG);
  c.votes(a, T2, 3);
  assert.equal(c.verdict(), "INVALID at line 7");
});

test("ET-24b: an opaque ballot created before an issue (seq <= c) is not its candidate", () => {
  // genesis 1, U@T1 (2), A (3), A@T1 x2 (4, 5), A@T2 (6): F = 0, definite.
  const c = new Chain();
  c.vote("cd".repeat(32), T1, UNREG);
  const a = c.issue();
  c.votes(a, T1, 2);
  const blamed = c.vote(a, T2);
  assert.equal(c.verdict(), `INVALID at line ${blamed}`);
});

test("ET-24b: an opaque ballot before an issue at another instant leaves its first ballot resolved", () => {
  const c = new Chain();
  const u = c.vote("cd".repeat(32), T2, UNREG); // line 2
  const a = c.issue(); // line 3
  c.votes(a, T1, 3);
  assert.equal(c.verdict(), `PARTIAL at lines ${u}`);
});

test("ET-24b / EV-16: a malformed opaque payload (a float) is INVALID at its line", () => {
  // HA-7 gives a float no encoding, so the harness cannot hash one: build a
  // well-formed opaque ballot with a distinctive choice and rewrite that value
  // into a float in the bytes. EV-16: INVALID whatever the version.
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  const bad = c.voteRaw({
    version: UNREG,
    strings: { issue_id: a },
    ints: { choice: 424242 },
    ts: T1,
  });
  c.votes(a, T1, 1);
  const text = c.bytes().toString("utf8");
  assert.equal(text.split('"choice":424242').length, 2);
  const mutated = Buffer.from(
    text.replace('"choice":424242', '"choice":4242.5'),
    "utf8",
  );
  assert.equal(tokenAndLine(verifyExport(mutated)), `INVALID at line ${bad}`);
});

test("ET-24b: a definite failure after an unresolved line is INVALID at the definite line", () => {
  // An unresolved line earlier on the chain does not stop the scan.
  const { c, a, b } = twoIssues();
  c.votes(a, T1, 3);
  c.vote(a, T2, UNREG); // 7
  c.vote(a, T1); // 8: unresolved
  c.votes(b, T3, 2); // 9, 10
  c.vote(b, T4); // 11: B's under-size run, no candidate at T3: definite
  assert.equal(c.verdict(), "INVALID at line 11");
});

test("ET-24b: a non-definite known failure does not stop the known state (a later return is still caught)", () => {
  // A@T1 x2, U@T1 (6), A@T2 (7, unresolved), A@T2 x2, A@T1 (10): T1 was left,
  // so line 10 is a definite ET-24a failure.
  const { c, a } = twoIssues();
  c.votes(a, T1, 2);
  c.vote(a, T1, UNREG);
  c.votes(a, T2, 3);
  c.vote(a, T1);
  assert.equal(c.verdict(), "INVALID at line 10");
});

// --- the per-interval summary and the first run's w --------------------------------

test("ET-24b: two candidates at one instant do not count as a candidate at another instant", () => {
  // U@T3 (4), A@T1 x3 (5-7), U@T1 x2 (8, 9), A@T2 (10). At the run start 10,
  // item 4(b) asks for a candidate after f = 5 at an instant other than
  // t = T1. U@T3 is the only candidate at another instant, and it precedes f,
  // so line 10 is resolved; the two T1 candidates must not stand in for it.
  // (Line 5 is unresolved: U@T3 falls after c at another instant.)
  const { c, a } = twoIssues();
  c.vote(a, T3, UNREG);
  c.votes(a, T1, 3);
  c.votes(a, T1, 2, UNREG);
  c.vote(a, T2);
  assert.equal(c.verdict(), "PARTIAL at lines 4,5,8,9");
});

test("ET-24b: the first run's F counts a candidate between c and f", () => {
  // U@T1 (4), A@T1 x2 (5, 6), A@T2 (7). The first run has no P(f), so w = c =
  // 2 and U at 4 counts: |R| + F = 3, not definite, so line 7 is unresolved.
  const { c, a } = twoIssues();
  c.vote(a, T1, UNREG);
  c.votes(a, T1, 2);
  c.vote(a, T2);
  assert.equal(c.verdict(), "PARTIAL at lines 4,7");
});

// --- ET-22a: only vote_cast carries ballots --------------------------------------

for (const [type, version] of [
  ["x_ballot_like", 1],
  ["participant_registered", UNREG],
] as const) {
  test(`ET-22a / ET-24b: an unregistered ${type} v${version} at a quantized ts is not a candidate`, () => {
    // A@T1 x2 (4, 5), the unregistered event @T1 naming A (6), A@T2 x3 (7-9).
    // Not a vote_cast, so not an opaque ballot (ET-24b) and never a ballot
    // (ET-22a): F = 0 and line 7's known ET-24 failure is definite.
    const { c, a } = twoIssues();
    c.votes(a, T1, 2);
    c.unregistered(type, version, T1, a);
    c.votes(a, T2, 3);
    assert.equal(c.verdict(), "INVALID at line 7");
  });

  test(`ET-22a / ET-24b: an unregistered ${type} v${version} at another instant inside a run leaves nothing unresolved`, () => {
    const { c, a } = twoIssues();
    c.votes(a, T1, 3);
    const x = c.unregistered(type, version, T2, a);
    c.vote(a, T1);
    assert.equal(c.verdict(), `PARTIAL at lines ${x}`);
  });
}

// --- run-start state is per run ---------------------------------------------------

test("ET-24b: a candidate from an earlier run does not leave a later run start unresolved", () => {
  // A@T1 x3 (4-6), U@T3 (7), A@T2 x3 (8-10), A@T4 (11). Line 8 is unresolved
  // (U falls after f = 4 at an instant other than T1). Line 11 is not: its
  // run began at 8, after U, and no candidate sits at T4.
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  c.vote(a, T3, UNREG);
  c.votes(a, T2, 3);
  c.vote(a, T4);
  assert.equal(c.verdict(), "PARTIAL at lines 7,8");
});

// --- EX-15 / EX-22: an unresolved check counts as not failed --------------------

test("EX-15: a PARTIAL chain with unresolved lines is still compared against --head", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 3);
  c.vote(a, T2, UNREG);
  c.vote(a, T1);
  assert.equal(c.verdict(c.head()), "PARTIAL at lines 7,8");
  assert.equal(c.verdict("f".repeat(64)), "INVALID at line 8");
});

test("EX-16: every prefix of an ET-24b chain gets the verdict its own lines decide", () => {
  // The prefix property: the outcome at each line is fixed when the scan
  // reaches it, so a prefix's PARTIAL set is the full chain's set cut short.
  const { c, a } = twoIssues();
  c.votes(a, T1, 2); // 4, 5
  c.vote(a, T1, UNREG); // 6
  c.votes(a, T2, 3); // 7-9
  c.vote(a, T3, UNREG); // 10
  c.vote(a, T2); // 11: unresolved
  const expected: Record<number, string> = {
    5: "VALID",
    6: "PARTIAL at lines 6",
    7: "PARTIAL at lines 6,7",
    9: "PARTIAL at lines 6,7",
    10: "PARTIAL at lines 6,7,10",
    11: "PARTIAL at lines 6,7,10,11",
  };
  for (const [n, v] of Object.entries(expected)) {
    const got = tokenAndLine(verifyExport(c.prefixBytes(Number(n))));
    assert.equal(got, v, `prefix of ${n} lines`);
  }
});

// --- the CLI --------------------------------------------------------------------

test("CLI: unresolved lines print as one PARTIAL line, ascending, and exit 2", () => {
  const { c, a } = twoIssues();
  c.votes(a, T1, 2);
  c.vote(a, T1, UNREG);
  c.votes(a, T2, 3);
  const dir = mkdtempSync(join(tmpdir(), "odc-opaque-"));
  const file = join(dir, "export.ndjson");
  writeFileSync(file, c.bytes());
  const r = spawnSync(process.execPath, [cliPath, "verify", file], {
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "PARTIAL at lines 6, 7\n");
});
