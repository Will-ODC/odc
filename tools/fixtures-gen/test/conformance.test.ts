// The rules about what a fixture may ASSERT, and which types it may use.
//
// These are enforced as tests rather than left to convention because both are
// frozen-fixture time bombs. A vector that asserts reason text pins a diagnostic
// vocabulary EV-17 deliberately leaves revisable; a PARTIAL vector on a
// non-x_ type could be contradicted by a later verifier once that type is
// registered for real, against a fixture contracts-guard has made uneditable.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { vectors, type Expect } from "../src/vectors/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "../../../..", "contracts", "fixtures");
const read = (rel: string): Buffer => readFileSync(join(fixturesDir, rel));
const index = JSON.parse(read("index.json").toString("utf8")) as {
  vectors: { id: string; expect: Expect }[];
};

/** The v1 registry (ET-1). Anything else is unregistered by definition. */
const V1_TYPES = new Set([
  "genesis",
  "participant_registered",
  "issue_created",
  "vote_cast",
]);

/**
 * Extracts (type, version) per line by regex rather than JSON.parse: many
 * vectors are deliberately non-parseable JSON, and these checks must still see
 * inside them.
 */
function typesIn(bytes: Buffer): { type: string; version: number }[] {
  const out: { type: string; version: number }[] = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    if (line.length === 0) continue;
    const type = /"type":"([^"]*)"/.exec(line);
    const version = /"version":(\d+)/.exec(line);
    if (type === null || version === null) continue;
    out.push({ type: type[1] as string, version: Number(version[1]) });
  }
  return out;
}

test("no vector asserts anything beyond the verdict token and line numbers (EV-17)", () => {
  for (const entry of index.vectors) {
    const keys = Object.keys(entry.expect).sort();
    const allowed =
      entry.expect.verdict === "VALID"
        ? ["verdict"]
        : entry.expect.verdict === "INVALID"
          ? ["line", "verdict"]
          : ["lines", "verdict"];
    assert.deepEqual(keys, allowed, `${entry.id} asserts unexpected keys`);
  }
});

test("no vector asserts a reason or an exit code anywhere in index.json (EV-17)", () => {
  const raw = read("index.json").toString("utf8");
  for (const forbidden of [
    '"reason"',
    '"exit_code"',
    '"exitCode"',
    '"message"',
  ]) {
    assert.ok(
      !raw.includes(forbidden),
      `index.json must not carry ${forbidden}`,
    );
  }
});

test("PARTIAL vectors enumerate affected lines in ascending order (EV-7, EV-17)", () => {
  for (const vec of vectors) {
    if (vec.expect.verdict !== "PARTIAL") continue;
    assert.ok(
      vec.expect.lines.length > 0,
      `${vec.id} must name at least one line`,
    );
    assert.deepEqual(
      vec.expect.lines,
      [...vec.expect.lines].sort((a, b) => a - b),
    );
  }
});

test("PARTIAL vectors use only x_-prefixed unregistered types (EV-18)", () => {
  for (const vec of vectors) {
    if (vec.expect.verdict !== "PARTIAL") continue;
    for (const { type } of typesIn(vec.bytes)) {
      if (!V1_TYPES.has(type)) {
        assert.ok(
          type.startsWith("x_"),
          `${vec.id} uses unregistered type ${type} without the x_ prefix`,
        );
      }
    }
  }
});

test("no vector freezes a verdict for an unregistered genesis version", () => {
  // An unregistered genesis version leaves a verifier unable to extract
  // operator_pk/registrar_pk, so Stage B on later events is undefined. That is
  // an open question; freezing any verdict for it here would foreclose it.
  for (const vec of vectors) {
    for (const { type, version } of typesIn(vec.bytes)) {
      if (type === "genesis") {
        assert.equal(
          version,
          1,
          `${vec.id} carries a genesis at version ${String(version)}`,
        );
      }
    }
  }
});
