// Tests over the COMMITTED artifacts in contracts/fixtures/.
//
// This is the acceptance criterion of the T5 ticket: recompute every vector and
// match what is on disk. A failure here means either the generator changed or a
// committed file was corrupted — and the fix is never to regenerate the goldens
// so the test passes (odc-testing).
//
// The rules about what a fixture may ASSERT (EV-17) and which types it may use
// (EV-18) live in conformance.test.ts; this file is about the bytes.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { serializeEvent } from "../src/serialize.js";
import { type Event } from "../src/encode.js";
import { vectors, type Expect } from "../src/vectors/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "../../../..", "contracts", "fixtures");
const read = (rel: string): Buffer => readFileSync(join(fixturesDir, rel));

interface IndexEntry {
  id: string;
  export: string;
  head?: string;
  expect: Expect;
  cites: string[];
  note: string;
}
const index = JSON.parse(read("index.json").toString("utf8")) as {
  vectors: IndexEntry[];
};

const manifestLines = (): string[] =>
  read("MANIFEST.sha256").toString("utf8").trimEnd().split("\n");

test("every vector on disk is byte-identical to the regenerated vector", () => {
  for (const vec of vectors) {
    assert.deepEqual(
      read(`vectors/${vec.id}.ndjson`),
      vec.bytes,
      `${vec.id} on disk differs from the generator's output`,
    );
  }
});

test("index.json lists exactly the vector table, in order, with unique ids", () => {
  assert.deepEqual(
    index.vectors.map((e) => e.id),
    vectors.map((v) => v.id),
  );
  assert.equal(new Set(vectors.map((v) => v.id)).size, vectors.length);
});

test("MANIFEST.sha256 matches every file it lists, and lists every artifact", () => {
  const lines = manifestLines();
  assert.ok(lines.length > 0);
  const listed = new Set<string>();
  for (const line of lines) {
    const [digest, rel] = line.split("  ") as [string, string];
    listed.add(rel);
    assert.equal(
      createHash("sha256").update(read(rel)).digest("hex"),
      digest,
      `${rel} changed`,
    );
  }
  for (const vec of vectors) {
    assert.ok(listed.has(`vectors/${vec.id}.ndjson`), `${vec.id} unlisted`);
  }
  assert.ok(listed.has("index.json"));
  assert.ok(listed.has("derivations.json"));
});

// --- the calibration point ------------------------------------------------

test("vector 001 is the hashing.md 6 worked example, and its preimage is pinned", () => {
  const line = read("vectors/001-genesis-only.ndjson")
    .toString("utf8")
    .trimEnd();
  const event = JSON.parse(line) as {
    hash: string;
    payload: Record<string, string>;
  };
  assert.equal(
    event.hash,
    "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a",
  );
  assert.equal(
    event.payload["chain_id"],
    "34750f98bd59fcfc946da45aaabe933be154a4b5094e1c4abf42866505f3c97e",
  );

  const pre = Buffer.from(
    read("preimages/001-genesis-only.hex").toString("utf8").trim(),
    "hex",
  );
  assert.equal(pre.length, 607, "hashing.md 6.2 states 607 octets");
  assert.equal(pre.subarray(0, 4).toString("ascii"), "ODC1");
  assert.equal(createHash("sha256").update(pre).digest("hex"), event.hash);
});

test("derivations.json pins the ids.md worked shape (ID-4)", () => {
  const doc = JSON.parse(read("derivations.json").toString("utf8")) as {
    participant_id: { pubkey: string; participant_id: string }[];
  };
  const entry = doc.participant_id[0];
  assert.ok(entry !== undefined);
  assert.equal(
    entry.participant_id,
    createHash("sha256").update(Buffer.from(entry.pubkey, "hex")).digest("hex"),
  );
});

// --- framing of the committed bytes themselves ---------------------------

/**
 * The framing anomaly each vector's committed bytes MUST exhibit. Absent from
 * this table means well-framed: non-empty, no CR, no BOM, exactly one final LF.
 *
 * This is deliberately NOT an exclusion list. A vector whose declared verdict is
 * INVALID *because of its framing* is worthless if the generator quietly stops
 * producing the malformation — the file would be valid bytes claiming INVALID,
 * which surfaces at T7 as a verifier bug rather than a fixture bug. So the
 * anomaly is asserted in both directions: each listed vector MUST carry its own,
 * and every unlisted vector MUST carry none.
 *
 * 045-blank-line and 048-052 are absent because their malformation is not one of
 * these four properties. That makes them UNCOVERED here, not covered-by-default:
 * the checks below say only that their framing is correct, which it is, and say
 * nothing about the defect each one exists to carry. NON_CANONICAL and the blank
 * -line assertion further down are what pin those six — see the comments there
 * for the three mutations that survived when this table was the only check.
 */
const FRAMING_ANOMALY: Record<string, "empty" | "cr" | "no-final-lf" | "bom"> =
  {
    "043-crlf": "cr",
    "044-no-final-newline": "no-final-lf",
    "046-byte-order-mark": "bom",
    "047-empty-export": "empty",
  };

test("each vector's bytes carry exactly the framing anomaly it declares (EX-2, EX-3, EX-4, EX-6)", () => {
  for (const vec of vectors) {
    const bytes = read(`vectors/${vec.id}.ndjson`);
    const want = FRAMING_ANOMALY[vec.id];

    const isEmpty = bytes.length === 0;
    const hasCR = bytes.includes(0x0d);
    const hasBOM =
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf;

    assert.equal(isEmpty, want === "empty", `${vec.id}: emptiness`);
    assert.equal(hasCR, want === "cr", `${vec.id}: CR presence`);
    assert.equal(hasBOM, want === "bom", `${vec.id}: BOM presence`);
    if (!isEmpty) {
      assert.equal(
        bytes[bytes.length - 1] === 0x0a,
        want !== "no-final-lf",
        `${vec.id}: final LF presence`,
      );
    }
  }
});

test("the framing anomaly table names only ids that are real vectors", () => {
  // A typo'd or stale id would exempt nothing, and would let the vector it was
  // meant to describe drift to well-framed unnoticed.
  const ids = new Set(vectors.map((v) => v.id));
  for (const id of Object.keys(FRAMING_ANOMALY)) {
    assert.ok(ids.has(id), `${id} is in FRAMING_ANOMALY but is not a vector`);
  }
});

/**
 * The vectors whose defect is that a line PARSES fine but is not the canonical
 * serialization of what it parses to (EX-7 through EX-10). Each is INVALID for
 * bytes alone: insignificant whitespace, envelope key order, payload key order,
 * an escape where a literal is required, an uppercase hex escape.
 *
 * This is the check the FRAMING_ANOMALY table cannot make. With that table as
 * the only guard, these mutations all shipped GREEN:
 *
 *   - 048's editLine find/replace made an identity ('"seq":2,' → '"seq":2,'),
 *     so the vector shipped perfectly canonical bytes under a declared verdict
 *     of INVALID. editLine only throws when `find` is ABSENT, so a replacement
 *     equal to the original is silent.
 *   - 045's blank line moved from line 3 to line 4, and to the end of the file,
 *     while the vector kept declaring line 3.
 *
 * Re-serializing the parsed object and requiring it to DIFFER is what catches
 * all of them, and it needs no verifier — `serializeEvent` is the canonical form
 * these vectors are defined against.
 */
const NON_CANONICAL = new Set([
  "048-insignificant-whitespace",
  "049-envelope-keys-reordered",
  "050-payload-keys-unsorted",
  "051-escape-where-literal-required",
  "052-uppercase-hex-escape",
]);

test("each non-canonical vector's declared line parses but is NOT canonical (EX-7…EX-10)", () => {
  for (const id of NON_CANONICAL) {
    const vec = vectors.find((v) => v.id === id);
    assert.ok(vec !== undefined, `${id} is not a vector`);
    assert.equal(vec.expect.verdict, "INVALID");
    assert.ok("line" in vec.expect);

    const fileLines = read(`vectors/${id}.ndjson`)
      .toString("utf8")
      .replace(/\n$/, "")
      .split("\n");
    const offending = fileLines[vec.expect.line - 1];
    assert.ok(offending !== undefined, `${id}: no line ${vec.expect.line}`);

    // It must still parse — the whole point is that the object is fine and only
    // the bytes are wrong. A parse failure here means the vector drifted into
    // testing something else.
    const parsed = JSON.parse(offending) as Event;
    assert.notEqual(
      offending,
      serializeEvent(parsed),
      `${id}: line ${vec.expect.line} IS canonical, so the vector declares INVALID over valid bytes`,
    );
  }
});

test("045-blank-line has an empty line at exactly the line it declares (EX-5)", () => {
  const vec = vectors.find((v) => v.id === "045-blank-line");
  assert.ok(vec !== undefined);
  assert.ok("line" in vec.expect);

  const fileLines = read("vectors/045-blank-line.ndjson")
    .toString("utf8")
    .replace(/\n$/, "")
    .split("\n");
  assert.equal(
    fileLines[vec.expect.line - 1],
    "",
    `the blank is not at line ${vec.expect.line}`,
  );
  assert.equal(
    fileLines.filter((l) => l === "").length,
    1,
    "exactly one blank line, or the declared line is ambiguous",
  );
});
