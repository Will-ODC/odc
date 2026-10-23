// THE conformance test: every golden vector, fed line by line through
// checkLine, and whole through verifyExport.
//
// What "accepted" means: checkLine accepts a line exactly when the export
// ending with it verifies VALID with no --head/--chain (EV-26). So:
// - VALID: every line is accepted.
// - INVALID at N: lines before N are accepted, and the checker refuses at N,
//   or earlier at the first unregistered (type, version) line, because an
//   export ending there is PARTIAL, not VALID (EV-7, EV-26). Every line before
//   that one passed Stage A and no registered check failed (N is the first
//   fatal line), and no ET-24b check can be unresolved before the first
//   unregistered line, so the prefix before it is VALID.
// - PARTIAL with lines [a, ...]: the first refused line is a. EV-17 lists
//   every unregistered line, and an unresolved registered ballot (ET-18b,
//   ET-24b) always follows the unregistered line that makes it unresolved, so
//   a is the first unregistered line. The test checks that independently.
// - A vector with `head` or `chain` is run without them only when its flagless
//   verdict follows soundly: those flags can only add a failure (EX-15,
//   EX-22), so bytes VALID in any vector are VALID without flags.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkLine,
  initialState,
  splitExport,
  verifyExport,
} from "../../src/chain/checker.js";
import { loadVectors, vectorBytes, type Vector } from "./support/fixtures.js";

// The v1 registry as event-types.md ET-1/ET-2 state it; deliberately not
// imported from the code under test.
const V1_REGISTRY = new Set([
  "genesis/1",
  "participant_registered/1",
  "issue_created/1",
  "vote_cast/1",
]);

type Expectation =
  | { kind: "accept-all" }
  | { kind: "refuse"; line: number; early?: boolean }
  | { kind: "skip"; reason: string };

function firstUnregisteredLine(records: Uint8Array[]): number | undefined {
  for (let i = 0; i < records.length; i++) {
    try {
      const e = JSON.parse(Buffer.from(records[i] ?? []).toString("utf8")) as {
        type?: unknown;
        version?: unknown;
      };
      if (!V1_REGISTRY.has(`${String(e.type)}/${String(e.version)}`))
        return i + 1;
    } catch {
      // Not JSON: the line is INVALID anyway, which is N's business.
    }
  }
  return undefined;
}

function expectationFor(v: Vector, all: Vector[]): Expectation {
  const bytes = vectorBytes(v);
  if (v.head !== undefined || v.chain !== undefined) {
    const validTwin = all.find(
      (o) => o.expect.verdict === "VALID" && vectorBytes(o).equals(bytes),
    );
    if (validTwin === undefined) {
      return {
        kind: "skip",
        reason:
          "flagless verdict not derivable: no VALID vector shares its bytes",
      };
    }
    return { kind: "accept-all" };
  }
  const { records } = splitExport(bytes);
  const unregistered = firstUnregisteredLine(records);
  if (v.expect.verdict === "VALID") return { kind: "accept-all" };
  if (v.expect.verdict === "INVALID") {
    const n = v.expect.line;
    if (unregistered !== undefined && unregistered < n) {
      return { kind: "refuse", line: unregistered, early: true };
    }
    return { kind: "refuse", line: n };
  }
  assert.equal(
    unregistered,
    v.expect.lines[0],
    `${v.id}: first PARTIAL line is unregistered`,
  );
  return { kind: "refuse", line: v.expect.lines[0] ?? 0 };
}

/** Feed lines one at a time; return the first refused line and its kind. */
function feed(bytes: Uint8Array): { line: number; kind: string } | undefined {
  const { records, unterminated } = splitExport(bytes);
  let state = initialState();
  for (let i = 0; i < records.length; i++) {
    // A missing final LF is a framing fault no single line shows (EX-4, EX-20).
    if (unterminated && i === records.length - 1)
      return { line: i + 1, kind: "invalid" };
    const r = checkLine(state, records[i] ?? new Uint8Array());
    if (!r.ok) return { line: i + 1, kind: r.refusal.kind };
    state = r.state;
  }
  return undefined;
}

describe("golden vectors (contracts/fixtures/index.json)", () => {
  it("every vector is exercised or skipped with a reason, and the checker agrees", (t) => {
    const all = loadVectors();
    assert.equal(all.length, 150);
    const tally: Record<string, number> = {};
    const skipped: string[] = [];
    const early: string[] = [];
    const disagreements: string[] = [];
    let exercised = 0;
    for (const v of all) {
      const exp = expectationFor(v, all);
      const bytes = vectorBytes(v);
      if (exp.kind === "skip") {
        skipped.push(`${v.id}: ${exp.reason}`);
        continue;
      }
      if (exp.kind === "refuse" && exp.early === true)
        early.push(`${v.id}@${exp.line}`);
      const whole = verifyExport(bytes);
      const wholeLine = whole.ok ? undefined : whole.line;
      const want = exp.kind === "accept-all" ? undefined : exp.line;
      if (wholeLine !== want) {
        disagreements.push(
          `${v.id}: verifyExport ${wholeLine ?? "VALID"}, want ${want ?? "VALID"}`,
        );
      }
      if (bytes.length === 0) {
        // 047: no line to feed; EX-18 is verifyExport's (checked above).
        skipped.push(
          `${v.id}: checkLine has no line to check (EX-18 covered by verifyExport)`,
        );
        continue;
      }
      exercised++;
      const key = `${v.expect.verdict}${v.head !== undefined || v.chain !== undefined ? " (flags dropped)" : ""}`;
      tally[key] = (tally[key] ?? 0) + 1;
      const refused = feed(bytes);
      // EV-7/EV-17: an unregistered line past line 1 makes the export PARTIAL
      // ("unregistered"); every other refusal is INVALID ("invalid").
      const wantKind =
        exp.kind === "refuse" &&
        (exp.early === true || v.expect.verdict === "PARTIAL") &&
        exp.line > 1
          ? "unregistered"
          : "invalid";
      if (refused?.line !== want) {
        disagreements.push(
          `${v.id}: checkLine refused ${refused?.line ?? "none"}, want ${want ?? "none"}`,
        );
      } else if (refused !== undefined && refused.kind !== wantKind) {
        disagreements.push(
          `${v.id}: refusal kind ${refused.kind}, want ${wantKind}`,
        );
      }
    }
    const summary = [
      `vectors: ${all.length}; exercised through checkLine: ${exercised}; skipped: ${skipped.length}`,
      `by expected verdict: ${JSON.stringify(tally)}`,
      `INVALID vectors refused earlier, at an unregistered line: ${early.join(", ")}`,
      ...skipped.map((s) => `skipped ${s}`),
    ];
    for (const line of summary) t.diagnostic(line);
    console.log(summary.join("\n"));
    assert.equal(exercised + skipped.length, all.length);
    assert.equal(skipped.length, 1);
    assert.deepEqual(tally, {
      VALID: 19,
      "VALID (flags dropped)": 4,
      PARTIAL: 15,
      INVALID: 105,
      "INVALID (flags dropped)": 6,
    });
    assert.equal(early.length, 7);
    assert.deepEqual(disagreements, []);
  });
});
