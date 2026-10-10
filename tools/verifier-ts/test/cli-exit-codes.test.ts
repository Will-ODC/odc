// Issue #194: a throw anywhere inside the CLI's work must never exit 1 (the
// INVALID code). 0/1/2 are verdicts; >= 3 means "the verifier could not
// answer". The internal-error path is forced in-process through `run`'s
// injectable verify — there is no flag or input a real user could use to
// reach it on purpose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run, type CliDeps } from "../src/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, "../src/cli.js"); // dist/test -> dist/src/cli.js
// Any readable file will do: the injected verify throws before inspecting it.
const anyReadableFile = cliPath;

function captured(verify: CliDeps["verify"]): {
  deps: CliDeps;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    deps: { verify, out: (s) => out.push(s), err: (s) => err.push(s) },
    out,
    err,
  };
}

test("an internal error inside verification exits 3 with one stderr line and empty stdout", () => {
  const { deps, out, err } = captured(() => {
    throw new Error("boom\nsecond line");
  });
  const code = run(["node", "cli.js", "verify", anyReadableFile], deps);
  assert.equal(code, 3);
  assert.equal(out.join(""), "");
  const stderr = err.join("");
  assert.match(stderr, /^[^\n]*internal error[^\n]*\n$/);
});

test("a thrown non-Error value is still reported as one stderr line with exit 3", () => {
  const { deps, out, err } = captured(() => {
    throw "not an Error";
  });
  const code = run(["node", "cli.js", anyReadableFile], deps);
  assert.equal(code, 3);
  assert.equal(out.join(""), "");
  assert.match(err.join(""), /^[^\n]*internal error[^\n]*\n$/);
});

for (const [name, args] of [
  ["no file argument", ["verify"]],
  ["--head with no value", ["verify", "f.ndjson", "--head"]],
  ["an unknown flag", ["verify", "--nope", "f.ndjson"]],
  ["two file arguments", ["verify", "a.ndjson", "b.ndjson"]],
] as const) {
  test(`the CLI prints usage and exits 3 on ${name}`, () => {
    const r = spawnSync(process.execPath, [cliPath, ...args], {
      encoding: "utf8",
    });
    assert.equal(r.status, 3);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^usage: /);
  });
}
