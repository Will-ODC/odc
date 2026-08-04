// The CLI's own contract: flags parse as documented, unknown input is refused
// rather than ignored, and `run` cross-checks itself against `selfVerify`.
//
// The cross-check is the part worth testing hardest. `run` throws when the
// tamper tool's declared line and self-verify's reported line disagree — that
// is the guarantee letting a rehearsal export be handed to T7 with a defect
// line attached, so a test that only ever sees them agree proves nothing. The
// disagreement path is therefore forced explicitly, not waited for.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { buildChain } from "../src/build.js";
import {
  main,
  parseArgs,
  run,
  summary,
  UsageError,
  USAGE,
} from "../src/cli.js";
import { TAMPER_CASES } from "../src/tamper.js";
import { selfVerify } from "../src/verify.js";

const CLI = new URL("../src/cli.js", import.meta.url).pathname;

describe("parseArgs", () => {
  it("defaults to seed 1 and the default shape, with no tamper", () => {
    const o = parseArgs([]);
    assert.equal(o.seed, 1);
    assert.equal(o.case, null);
    assert.equal(o.tamperSeed, null);
    assert.equal(o.out, null);
    assert.ok(o.shape.participants > 0);
  });

  it("reads every documented flag", () => {
    const o = parseArgs([
      "--seed",
      "7",
      "--participants",
      "3",
      "--issues",
      "2",
      "--votes",
      "4",
      "--case",
      "byte-flip",
      "--tamper-seed",
      "9",
      "--out",
      "x.ndjson",
    ]);
    assert.deepEqual(o, {
      seed: 7,
      shape: { participants: 3, issues: 2, votes: 4 },
      case: "byte-flip",
      tamperSeed: 9,
      out: "x.ndjson",
    });
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    // A dropped --case would print a clean chain the caller believes is tampered.
    assert.throws(() => parseArgs(["--tamper"]), UsageError);
    assert.throws(() => parseArgs(["--case", "byteflip"]), UsageError);
    assert.throws(() => parseArgs(["extra"]), UsageError);
  });

  it("refuses a flag with a missing or non-integer value", () => {
    for (const argv of [["--seed"], ["--seed", "x"], ["--out"], ["--case"]]) {
      assert.throws(() => parseArgs(argv), UsageError, argv.join(" "));
    }
  });

  it("documents every tamper case in --help", () => {
    for (const kase of TAMPER_CASES) assert.ok(USAGE.includes(kase), kase);
  });
});

describe("run", () => {
  const shape = { participants: 3, issues: 2, votes: 4 };

  it("returns a self-verifying export with no --case", () => {
    const r = run({ seed: 4, shape, case: null, tamperSeed: null, out: null });
    assert.equal(r.tamper, undefined);
    assert.equal(r.lines, 10);
    assert.equal(selfVerify({ ndjson: r.ndjson, head: r.head }).ok, true);
    assert.deepEqual(r.ndjson, buildChain(4, shape).ndjson);
  });

  it("reports the defect line for every tamper case", () => {
    for (const kase of TAMPER_CASES) {
      const r = run({
        seed: 4,
        shape,
        case: kase,
        tamperSeed: 11,
        out: null,
      });
      assert.equal(r.tamper?.case, kase);
      assert.equal(r.tamper?.seed, 11);
      const v = selfVerify({ ndjson: r.ndjson, head: r.head });
      assert.equal(v.ok, false, kase);
      assert.equal(v.ok === false ? v.line : -1, r.tamper?.line, kase);
    }
  });

  it("defaults --tamper-seed to the chain seed", () => {
    const o = { seed: 6, shape, case: "byte-flip", out: null };
    const a = run({ ...o, tamperSeed: null });
    const b = run({ ...o, tamperSeed: 6 });
    assert.equal(a.tamper?.seed, 6);
    assert.deepEqual(a.ndjson, b.ndjson);
  });

  it("rejects an out-of-range shape as a usage error, not an internal one", () => {
    assert.throws(
      () =>
        run({
          seed: 1,
          shape: { participants: 0, issues: 1, votes: 0 },
          case: null,
          tamperSeed: null,
          out: null,
        }),
      UsageError,
    );
  });

  // The three safety-net throws, forced through the injected checker. All
  // eight real cases agree with self-verify, so waiting for a natural
  // disagreement would leave every one of these paths unexecuted.
  const opts = (kase: string | null) => ({
    seed: 4,
    shape,
    case: kase,
    tamperSeed: 11,
    out: null,
  });

  it("throws when the chain it just built does not self-verify", () => {
    assert.throws(
      () =>
        run(opts(null), {
          verify: () => ({ ok: false, line: 2, rule: "HA-13", detail: "x" }),
        }),
      /does not self-verify: line 2 HA-13/,
    );
  });

  it("throws when a tampered export still verifies", () => {
    // Always-ok: the clean chain passes, then the tampered bytes wrongly do too.
    assert.throws(
      () => run(opts("byte-flip"), { verify: () => ({ ok: true }) }),
      /produced an export that verifies/,
    );
  });

  it("throws when the failure lands on a line other than the declared one", () => {
    assert.throws(
      () =>
        run(opts("byte-flip"), {
          verify: (t) =>
            t.head === undefined || selfVerify(t).ok
              ? { ok: true }
              : { ok: false, line: 999, rule: "HA-13", detail: "x" },
        }),
      /declared line \d+, self-verify reports 999/,
    );
  });
});

describe("summary", () => {
  it("names the case and the defect line when tampered", () => {
    const r = run({
      seed: 2,
      shape: { participants: 2, issues: 1, votes: 1 },
      case: "truncation",
      tamperSeed: 3,
      out: null,
    });
    const s = summary(r);
    assert.match(s, /truncation/);
    assert.match(s, new RegExp(`defect line ${String(r.tamper?.line)}`));
    assert.match(s, new RegExp(r.head));
  });
});

describe("main", () => {
  it("writes the export to --out and exits 0", () => {
    const out = join(mkdtempSync(join(tmpdir(), "odc-")), "chain.ndjson");
    assert.equal(
      main([
        "--seed",
        "3",
        "--participants",
        "2",
        "--issues",
        "1",
        "--votes",
        "1",
        "--out",
        out,
      ]),
      0,
    );
    const bytes = readFileSync(out);
    assert.deepEqual(
      bytes,
      buildChain(3, { participants: 2, issues: 1, votes: 1 }).ndjson,
    );
  });

  it("exits 2 on a usage error", () => {
    assert.equal(main(["--nope"]), 2);
  });

  it("prints usage and exits 0 for --help", () => {
    assert.equal(main(["--help"]), 0);
  });

  it("exits 3 — not 2 — when the failure is not a usage error", () => {
    // The two codes mean different things to `just` and to T8's loop: 2 is the
    // caller's mistake, 3 is this tool contradicting itself.
    assert.equal(
      main(
        ["--seed", "3", "--participants", "2", "--issues", "1", "--votes", "1"],
        {
          verify: () => ({ ok: false, line: 1, rule: "HA-13", detail: "x" }),
        },
      ),
      3,
    );
  });

  it("does not run when merely imported", () => {
    // The entry guard compares resolved paths. An `endsWith("cli.js")` version
    // is true on import too, so importing would build and print a whole chain.
    // Imported from a real FILE, not `node -e`: with `-e` there is no
    // `process.argv[1]`, so the guard's first condition short-circuits and the
    // test passes against a broken guard.
    const importer = join(mkdtempSync(join(tmpdir(), "odc-")), "importer.mjs");
    writeFileSync(importer, `await import(${JSON.stringify(CLI)});\n`);
    const stdout = execFileSync(process.execPath, [importer], {
      encoding: "utf8",
    });
    assert.equal(stdout, "");
  });

  it("runs as a program and writes the export to stdout", () => {
    // The module-level entry guard only fires when this file IS the entry
    // point — an `endsWith("cli.js")` version would also fire on import here.
    const stdout = execFileSync(
      process.execPath,
      [
        CLI,
        "--seed",
        "5",
        "--participants",
        "2",
        "--issues",
        "1",
        "--votes",
        "1",
      ],
      { encoding: "buffer" },
    );
    assert.deepEqual(
      stdout,
      buildChain(5, { participants: 2, issues: 1, votes: 1 }).ndjson,
    );
  });
});
