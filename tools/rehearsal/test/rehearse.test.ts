import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  conformanceVerdict,
  main,
  runRehearsal,
  type Judge,
} from "../src/rehearse.js";
import { selfVerify } from "../src/verify.js";
import { TAMPER_CASES } from "../src/tamper.js";

function selfJudge(name: string): Judge {
  return {
    name,
    invoke(file, head) {
      const result = selfVerify({ ndjson: readFileSync(file), head });
      return result.ok
        ? { status: 0, stdout: "VALID\n", stderr: "" }
        : {
            status: 1,
            stdout: `INVALID at line ${String(result.line)}: advisory\n`,
            stderr: "",
          };
    },
  };
}

describe("conformanceVerdict", () => {
  it("keeps only EV-17's verdict token and line attribution", () => {
    assert.equal(conformanceVerdict("VALID\n"), "VALID");
    assert.equal(
      conformanceVerdict("INVALID at line 7: advisory reason\n"),
      "INVALID at line 7",
    );
    assert.equal(
      conformanceVerdict("PARTIAL at lines 2, 9\n"),
      "PARTIAL at lines 2, 9",
    );
  });

  it("normalizes a single-line PARTIAL written either way", () => {
    // The two independent verifiers disagree on pluralization here: one
    // always writes "lines", the other writes "line" for a single line.
    // Both must reduce to the same conformance surface, or the judge reports
    // a divergence that does not exist.
    assert.equal(
      conformanceVerdict("PARTIAL at line 5\n"),
      "PARTIAL at lines 5",
    );
    assert.equal(
      conformanceVerdict("PARTIAL at lines 5\n"),
      "PARTIAL at lines 5",
    );
    assert.equal(
      conformanceVerdict("PARTIAL at line 5\n"),
      conformanceVerdict("PARTIAL at lines 5\n"),
    );
  });

  it("drops an advisory reason from PARTIAL, as it already does from INVALID", () => {
    // EV-17's "token and line number(s) alone" is not scoped to INVALID, and
    // it keeps the CLI surface revisable — so a verifier MAY start attaching
    // a reason to PARTIAL. Unmatched output aborts the judge, so tolerating
    // the suffix here is what stops that from becoming the next abort.
    assert.equal(
      conformanceVerdict("PARTIAL at lines 5: unregistered type x_foo\n"),
      "PARTIAL at lines 5",
    );
    assert.equal(
      conformanceVerdict("PARTIAL at line 5: unregistered type x_foo\n"),
      "PARTIAL at lines 5",
    );
  });

  it("throws rather than guessing at output that is not a verdict", () => {
    // The throw is correct for genuine non-verdicts; the bug it masked was
    // reaching it for a well-formed one. Each case pins one property of the
    // match, so loosening any of them fails here rather than silently
    // widening what the judge will accept as agreement.
    assert.throws(() => conformanceVerdict("PARTIAL at lines\n"), /EV-17/);
    assert.throws(() => conformanceVerdict("PARTIAL at lines 0\n"), /EV-17/);
    // Leading zeros in a LATER number, not just the first.
    assert.throws(() => conformanceVerdict("PARTIAL at lines 5, 0\n"), /EV-17/);
    // Multi-line output on the PARTIAL branch specifically — the branch this
    // change touched. Without the anchors, this would silently reduce to a
    // clean verdict and the judge would report agreement that never happened.
    assert.throws(
      () => conformanceVerdict("PARTIAL at lines 5\nreason\n"),
      /EV-17/,
    );
    assert.throws(
      () => conformanceVerdict("INVALID at line 3\nreason\n"),
      /EV-17/,
    );
  });

  it("rejects malformed or multi-line output", () => {
    assert.throws(() => conformanceVerdict("INVALID\n"), /EV-17/);
    assert.throws(() => conformanceVerdict("VALID\nVALID\n"), /EV-17/);
  });
});

describe("runRehearsal", () => {
  it("runs the clean chain and every tamper case through two judges", () => {
    const results = runRehearsal(17, {
      judges: [selfJudge("first"), selfJudge("second")],
    });
    assert.deepEqual(
      results.map((result) => result.name),
      ["clean", ...TAMPER_CASES],
    );
    assert.equal(results[0]?.expected, "VALID");
    for (const result of results.slice(1)) {
      assert.match(result.expected, /^INVALID at line [1-9][0-9]*$/);
      assert.deepEqual(result.verdicts, {
        first: result.expected,
        second: result.expected,
      });
    }
  });

  it("fails closed when either verifier disagrees", () => {
    const alwaysValid: Judge = {
      name: "wrong",
      invoke: () => ({ status: 0, stdout: "VALID\n", stderr: "" }),
    };
    assert.throws(
      () =>
        runRehearsal(1, {
          judges: [selfJudge("right"), alwaysValid],
        }),
      /wanted INVALID at line [1-9][0-9]*, got VALID/,
    );
  });

  it("surfaces a verifier tool failure before parsing its stdout", () => {
    const crashed: Judge = {
      name: "crashed",
      invoke: () => ({
        status: 3,
        stdout: "",
        stderr: "could not load verifier",
      }),
    };
    assert.throws(
      () =>
        runRehearsal(1, {
          judges: [selfJudge("right"), crashed],
        }),
      /crashed tool failure \(exit 3\): could not load verifier/,
    );
  });

  it("requires two uniquely named judges", () => {
    assert.throws(
      () => runRehearsal(1, { judges: [selfJudge("only")] }),
      /requires two independent/,
    );
    assert.throws(
      () =>
        runRehearsal(1, {
          judges: [selfJudge("same"), selfJudge("same")],
        }),
      /duplicate verifier name/,
    );
  });
});

describe("main", () => {
  it("rejects a non-integer seed as usage", () => {
    assert.equal(main(["--seed", "not-a-number"]), 2);
  });
});
