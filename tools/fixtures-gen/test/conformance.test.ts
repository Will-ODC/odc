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
import { UNREGISTERED_GENESIS_VECTORS } from "../src/vectors/genesis-registration.js";

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

/**
 * EV-19. The reservation against future registration is open-ended (`>=` this),
 * but the obligation on a FIXTURE is this exact value — so a vector can never
 * carry a `version` near ES-5's `2^53-1` ceiling and strain a `version` parser.
 * The check below asserts the exact value, which is the stricter of the two.
 */
const RESERVED_VERSION = 1000000;

interface TypeRef {
  /** 1-based, matching how every `expect` field numbers lines. */
  line: number;
  type: string;
  version: number;
}

/** Is this key outside the v1 registry, and so a candidate for PARTIAL? */
const isUnregistered = ({ type, version }: TypeRef): boolean =>
  !V1_REGISTRY.has(`${type}@${String(version)}`);

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
 *
 * Each line is searched only up to its `payload`, so a payload string value
 * containing the text `"type":"…"` cannot be mistaken for the envelope field.
 * ES-1/EX-8 fix `seq, type, version` ahead of `payload`, so nothing legitimate
 * is lost; a line with no `payload` at all is searched whole.
 */
function typesIn(bytes: Buffer): { refs: TypeRef[]; unparsed: number } {
  const refs: TypeRef[] = [];
  let unparsed = 0;
  let lineNumber = 0;
  for (const line of bytes.toString("utf8").split("\n")) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    const payloadAt = line.indexOf('"payload"');
    const envelope = payloadAt === -1 ? line : line.slice(0, payloadAt);
    const type = /"type"\s*:\s*"([^"]*)"/.exec(envelope);
    const version = /"version"\s*:\s*(\d+)/.exec(envelope);
    if (type === null || version === null) {
      unparsed += 1;
      continue;
    }
    refs.push({
      line: lineNumber,
      type: type[1] as string,
      version: Number(version[1]),
    });
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
    for (const ref of refsOf(vec.id, vec.bytes)) {
      if (!isUnregistered(ref)) continue;
      assert.ok(
        ref.type.startsWith("x_") || ref.version === RESERVED_VERSION,
        `${vec.id} freezes a PARTIAL verdict on unregistered (${ref.type}, ${String(ref.version)}), which is neither an x_ type (EV-18) nor the reserved version ${String(RESERVED_VERSION)} (EV-19), and so could be registered later`,
      );
    }
  }
});

test("a PARTIAL vector names exactly the lines that are unregistered (EV-7, EV-17)", () => {
  // The other half of what EV-17 makes conformance-checkable. A verdict token
  // with the wrong line numbers is still a wrong fixture: every CORRECT verifier
  // would fail against it, and after the freeze contracts-guard makes it
  // uneditable. Nothing else in this file or the suite reads expect.lines, so
  // without this a typo in the declared list ships silently.
  for (const vec of vectors) {
    if (vec.expect.verdict !== "PARTIAL") continue;
    const unregistered = refsOf(vec.id, vec.bytes)
      .filter(isUnregistered)
      .map((ref) => ref.line);
    assert.deepEqual(
      vec.expect.lines,
      unregistered,
      `${vec.id} declares PARTIAL on lines [${vec.expect.lines.join(", ")}] but the unregistered (type, version) lines are [${unregistered.join(", ")}]`,
    );
  }
});

test("only the named vectors carry an unregistered genesis version (EV-20)", () => {
  // INVERTED, not deleted. This check used to admit version 1 alone, because an
  // unregistered genesis version was an OPEN question — EV-9's PARTIAL sentence
  // and EV-20 gave different verdicts for it — and any fixture would have frozen
  // one of the two readings before it was chosen. That is closed: ADR-0015
  // decided INVALID at line 1, EV-20 specified it, and evolution.md v5 conformed
  // EV-9's sentence to it.
  //
  // What stays is the reason the guard existed. EV-20 is the SOLE exception to
  // EV-8, so exactly one vector may exercise it and every other vector must
  // still carry a version-1 genesis. Deleting the check would let a future
  // PARTIAL vector freeze a verdict EV-20 forbids; relaxing it to "any version
  // in the EV-19 reserved range" would allow the same thing while looking
  // principled. Scoping it to one id is what keeps it a guard.
  const carriers = vectors
    .filter((vec) =>
      refsOf(vec.id, vec.bytes).some(
        ({ type, version }) => type === "genesis" && version !== 1,
      ),
    )
    .map((vec) => vec.id);

  // A literal list, deliberately, rather than a predicate over ids or a count.
  // A predicate is what lets the exception widen by accident; adding an id here
  // is a decision someone has to write down.
  assert.deepEqual(
    carriers,
    [...UNREGISTERED_GENESIS_VECTORS],
    `only [${UNREGISTERED_GENESIS_VECTORS.join(", ")}] may carry a genesis at a version other than 1 (EV-20); found [${carriers.join(", ")}]`,
  );
});

test("every permitted unregistered-genesis vector declares INVALID at line 1 (EV-20)", () => {
  // The other half of the pair above. Without this, the scoped exception admits
  // vectors by id while saying nothing about what they assert — so a later edit
  // could turn a permitted unregistered-genesis vector into a PARTIAL and the
  // guard would still pass, which is the exact outcome it exists to stop.
  for (const id of UNREGISTERED_GENESIS_VECTORS) {
    const vec = vectors.find((v) => v.id === id);
    assert.ok(vec, `${id} is missing from the table`);
    assert.deepEqual(vec.expect, { verdict: "INVALID", line: 1 }, id);
  }
});

test("an unregistered genesis is fixtured both alone and with a line after it", () => {
  // ADR-0015 asks for a chain whose genesis is unregistered AND is "followed by
  // at least one later event at a registered version", because the defect it
  // records is a LINE ATTRIBUTION one: both verifiers once reported INVALID at
  // line 2, blaming the first signature they could not check rather than the
  // genesis that made it uncheckable. A one-line export has no line 2 to blame,
  // so it cannot tell the two behaviours apart. Pinned here so the multi-line
  // vector cannot be dropped as a duplicate of the single-line one.
  const lineCounts = UNREGISTERED_GENESIS_VECTORS.map(
    (id) =>
      refsOf(id, vectors.find((v) => v.id === id)?.bytes ?? Buffer.alloc(0))
        .length,
  );
  assert.ok(
    lineCounts.includes(1) && lineCounts.some((n) => n > 1),
    `the unregistered-genesis vectors must cover both a bare genesis and a genesis with a later event (ADR-0015); line counts are [${lineCounts.join(", ")}]`,
  );
});
