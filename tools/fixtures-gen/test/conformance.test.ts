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

/**
 * The v1 registry (ET-1/ET-2), keyed on the FULL registry key. Keying on the
 * type name alone would wave through a registered name at an unregistered
 * version — which is the one shape EV-18's x_ prefix cannot protect, and so
 * exactly the shape this file has to police (see EV-19).
 */
const V1_REGISTRY = new Set([
  "genesis@1",
  "participant_registered@1",
  "issue_created@1",
  "vote_cast@1",
]);

/** EV-19: no contracts version may ever register a version at or above this. */
const RESERVED_VERSION = 1000000;

interface TypeRef {
  type: string;
  version: number;
}

/**
 * Extracts (type, version) per line by regex rather than JSON.parse: many
 * vectors are deliberately non-parseable JSON, and these checks must still see
 * inside them.
 *
 * `unparsed` counts non-empty lines this could not read, and every caller
 * asserts it is zero. Skipping silently would make these checks fail OPEN: one
 * EX-7 whitespace violation (`"type": "genesis"`) is enough to make a line
 * invisible, and the vector would then pass a rule it never satisfied. The
 * regexes tolerate that whitespace for the same reason, so only a line with no
 * recognisable type/version at all is counted — which is a deliberate decision
 * for whoever adds such a vector, not something to wave through.
 */
function typesIn(bytes: Buffer): { refs: TypeRef[]; unparsed: number } {
  const refs: TypeRef[] = [];
  let unparsed = 0;
  for (const line of bytes.toString("utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    const type = /"type"\s*:\s*"([^"]*)"/.exec(line);
    const version = /"version"\s*:\s*(\d+)/.exec(line);
    if (type === null || version === null) {
      unparsed += 1;
      continue;
    }
    refs.push({ type: type[1] as string, version: Number(version[1]) });
  }
  return { refs, unparsed };
}

/** Every line of every vector must be readable by the checks below. */
function refsOf(id: string, bytes: Buffer): TypeRef[] {
  const { refs, unparsed } = typesIn(bytes);
  assert.equal(
    unparsed,
    0,
    `${id} has ${String(unparsed)} line(s) with no readable type/version; these checks would silently skip them`,
  );
  return refs;
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

test("every unregistered (type, version) in a PARTIAL vector is reserved (EV-18, EV-19)", () => {
  // Checked on the full registry key, not the type name. A frozen PARTIAL
  // verdict on an unreserved key is a time bomb: the day EV-1 registers that
  // key for real, a newer verifier runs Stage B on the line and reports
  // INVALID, contradicting a fixture contracts-guard has made uneditable.
  // Only two things can never be registered — an x_ type name (EV-18) and a
  // version at or above RESERVED_VERSION (EV-19).
  for (const vec of vectors) {
    if (vec.expect.verdict !== "PARTIAL") continue;
    for (const { type, version } of refsOf(vec.id, vec.bytes)) {
      if (V1_REGISTRY.has(`${type}@${String(version)}`)) continue;
      assert.ok(
        type.startsWith("x_") || version >= RESERVED_VERSION,
        `${vec.id} freezes a PARTIAL verdict on unregistered (${type}, ${String(version)}), which is neither an x_ type (EV-18) nor a reserved version (EV-19) and so could be registered later`,
      );
    }
  }
});

test("no vector freezes a verdict for an unregistered genesis version", () => {
  // An unregistered genesis version leaves a verifier unable to extract
  // operator_pk/registrar_pk, so Stage B on later events is undefined. That is
  // an open question; freezing any verdict for it here would foreclose it —
  // including via the EV-19 reserved range, which is why this check admits
  // version 1 alone and is not relaxed by the reservation above.
  for (const vec of vectors) {
    for (const { type, version } of refsOf(vec.id, vec.bytes)) {
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
