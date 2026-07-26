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

test("every vector in this slice ends in exactly one LF and contains no CR (EX-3, EX-4)", () => {
  // Every vector here is well-framed. The deliberately malformed framing vectors
  // arrive in a later slice and will need explicit exclusions from this check.
  for (const vec of vectors) {
    const bytes = read(`vectors/${vec.id}.ndjson`);
    assert.ok(bytes.length > 0, `${vec.id} is empty`);
    assert.equal(bytes[bytes.length - 1], 0x0a, `${vec.id} lacks a final LF`);
    assert.ok(!bytes.includes(0x0d), `${vec.id} contains a CR`);
  }
});
