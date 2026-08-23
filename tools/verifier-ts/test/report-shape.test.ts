// The CLI output contract: ONE verdict line, reason after a colon on that same
// line.
//
// WHY THIS FILE EXISTS. A downstream consumer parses stdout with a single-line
// regex. A reason printed on a SECOND line makes that consumer THROW rather
// than mismatch — a worse failure than a wrong verdict, and one no current
// input triggers, so no other test in this suite would catch it. Adding
// advisory reason text (EV-17/EV-21) is exactly the change that could
// introduce it, so the shape is pinned here directly rather than inferred.
//
// Nothing here asserts a verdict VALUE for any input — that is
// `contracts/fixtures/`'s job (see `fixtures.test.ts`). These assertions are
// about the rendering of a Verdict, over Verdict values constructed in the
// test, and about the shape of the process's stdout.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { oneLine, verdictLine } from "../src/report.js";
import type { Verdict } from "../src/verify.js";
import { parseEventLine, type ParsedEvent } from "../src/parse.js";
import { computeHash } from "../src/hashing.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/test/ -> dist/src/cli.js
const cliPath = resolve(here, "../src/cli.js");

/** Every verdict shape the renderer can be handed, including hostile reasons. */
const CASES: Verdict[] = [
  { verdict: "VALID" },
  { verdict: "INVALID", line: 1 },
  { verdict: "INVALID", line: 42, reason: "HA-14: hash mismatch" },
  { verdict: "PARTIAL", lines: [3] },
  { verdict: "PARTIAL", lines: [3, 4, 9] },
  // Reasons that would split the line if appended naively. These are not
  // reachable from today's code paths — every reason the verifier builds
  // interpolates numbers only — which is precisely why the renderer, not the
  // call sites, has to be the thing that guarantees the shape.
  { verdict: "INVALID", line: 7, reason: "first line\nsecond line" },
  { verdict: "INVALID", line: 7, reason: "carriage\r\nreturn" },
  { verdict: "INVALID", line: 7, reason: "trailing newline\n" },
  { verdict: "INVALID", line: 7, reason: " unicode line separator" },
  { verdict: "INVALID", line: 7, reason: "\n" },
];

// A consumer's single-line regex over the whole of stdout. `^`/`$` without the
// `m` flag means a second line cannot satisfy it.
const VERDICT_RE =
  /^(VALID|INVALID at line \d+(: .*)?|PARTIAL at lines? \d+(, \d+)*)$/;

test("verdictLine renders every verdict shape as exactly one line", () => {
  for (const v of CASES) {
    const rendered = verdictLine(v);
    assert.equal(
      rendered.includes("\n"),
      false,
      `verdictLine produced a newline for ${JSON.stringify(v)}: ${JSON.stringify(rendered)}`,
    );
    assert.equal(rendered.includes("\r"), false, JSON.stringify(rendered));
    assert.match(rendered, VERDICT_RE, JSON.stringify(rendered));
  }
});

test("verdictLine puts the reason after a colon on the verdict line itself", () => {
  const rendered = verdictLine({
    verdict: "INVALID",
    line: 12,
    reason: "ES-25: prev_hash does not match",
  });
  assert.equal(rendered, "INVALID at line 12: ES-25: prev_hash does not match");
});

test("a verdict with no reason renders without a trailing colon", () => {
  assert.equal(
    verdictLine({ verdict: "INVALID", line: 5 }),
    "INVALID at line 5",
  );
  assert.equal(
    verdictLine({ verdict: "INVALID", line: 5, reason: "   " }),
    "INVALID at line 5",
  );
});

test("oneLine collapses every line terminator a reason could carry", () => {
  assert.equal(oneLine("a\nb"), "a b");
  assert.equal(oneLine("a\r\nb"), "a b");
  assert.equal(oneLine("a b"), "a b");
  assert.equal(oneLine("a b"), "a b");
  assert.equal(oneLine("a\n\n\nb"), "a b");
  assert.equal(oneLine("\nleading and trailing\n"), "leading and trailing");
});

// --- end to end, through the real process ------------------------------------

function runCli(bytes: Buffer): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "odc-verify-"));
  const file = join(dir, "export.ndjson");
  writeFileSync(file, bytes);
  try {
    const stdout = execFileSync(process.execPath, [cliPath, "verify", file], {
      encoding: "utf8",
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

test("the CLI writes exactly one stdout line, terminated by a single LF", () => {
  // An unregistered genesis version, with a CORRECT hash so that the EV-20
  // registration check is what reports — that path carries the longest reason
  // text this verifier produces (EV-21 asks it to name the version encountered
  // and the versions registered), so it is the one most likely to wrap. The
  // verdict VALUE for this input is asserted in genesis-ancestry.test.ts; here
  // only the output SHAPE is.
  const withoutHash = (hash: string): string =>
    `{"seq":1,"type":"genesis","version":1000000,` +
    `"payload":{"chain_id":"${"1".repeat(64)}","contracts":"contracts-v1",` +
    `"operator_pk":"${"1".repeat(64)}","registrar_pk":"${"2".repeat(64)}",` +
    `"sig":"${"3".repeat(128)}"},` +
    `"ts":"2026-01-01T00:00:00.000Z","prev_hash":"${"0".repeat(64)}",` +
    `"hash":"${hash}"}`;
  const draft = parseEventLine(
    Buffer.from(withoutHash("0".repeat(64)), "utf8"),
  );
  assert.notEqual(draft, null);
  const line = withoutHash(computeHash(draft as ParsedEvent));
  const { stdout } = runCli(Buffer.from(line + "\n", "utf8"));
  assert.match(stdout, /EV-20/, "expected the EV-20 reason path");

  assert.equal(stdout.endsWith("\n"), true, JSON.stringify(stdout));
  assert.equal(
    stdout.split("\n").length,
    2, // the verdict line, then the empty tail after the single LF
    `stdout must be one LF-terminated line, got ${JSON.stringify(stdout)}`,
  );
  assert.match(stdout.trimEnd(), VERDICT_RE, JSON.stringify(stdout));
});

test("the CLI writes exactly one stdout line for a VALID-shaped run too", () => {
  // Any input at all: the invariant is about stdout, not about the verdict.
  const { stdout } = runCli(Buffer.from("", "utf8"));
  assert.equal(stdout.split("\n").length, 2, JSON.stringify(stdout));
  assert.match(stdout.trimEnd(), VERDICT_RE, JSON.stringify(stdout));
});
