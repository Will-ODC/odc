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
import { CLEF } from "../src/vectors/unicode.js";

/** The vectors whose bytes must contain a code point above U+FFFF. */
const ASTRAL_VECTORS = [
  "071-title-astral",
  "072-title-200-astral",
  "073-title-201-astral",
];

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

/**
 * The integer half of the payload encoding, which 001 cannot show: its payload is
 * four strings, so every tag in it is 0x73 and ENC_INT appears only in the
 * envelope. The expected fragment is spelled out as raw octets rather than built
 * from `encode.ts`, so this asserts what the committed file says instead of
 * re-deriving it from the code that wrote it.
 */
test("preimage 002-four-types-seq3 carries the 0x69 integer tag and an ENC_INT value (HA-4, HA-7, HA-9)", () => {
  const pre = Buffer.from(
    read("preimages/002-four-types-seq3.hex").toString("utf8").trim(),
    "hex",
  );
  const line3 = read("vectors/002-four-types.ndjson")
    .toString("utf8")
    .trimEnd()
    .split("\n")[2] as string;
  const event = JSON.parse(line3) as Event;
  assert.equal(event.type, "issue_created");
  assert.equal(createHash("sha256").update(pre).digest("hex"), event.hash);

  // HA-8 sorts the keys ballot_batch_interval_ms < ballot_batch_min <
  // choice_count < sig < title, so choice_count is the LAST integer entry and is
  // immediately followed by a string entry — the 0x69/0x73 adjacency a swapped
  // tag constant would invert. (Before ET-14b it was also the first entry;
  // adjacency, not position, is what this asserts and what matters.)
  const intEntry = Buffer.concat([
    Buffer.from([0x69]), // HA-9: `i`
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 12]), // U64 length of "choice_count"
    Buffer.from("choice_count", "ascii"),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 3]), // ENC_INT(3), 8 octets big-endian
  ]);
  const at = pre.indexOf(intEntry);
  assert.notEqual(at, -1, "no 0x69 entry for choice_count in the preimage");
  const sigTag = pre.indexOf(
    Buffer.concat([
      Buffer.from([0x73]),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 3]),
      Buffer.from("sig", "ascii"),
    ]),
  );
  assert.equal(
    sigTag,
    at + intEntry.length,
    "the string entry for sig must abut the integer entry for choice_count",
  );
});

/**
 * ET-14b makes both batching parameters REQUIRED on every `issue_created`, so an
 * issue line missing one is not a vector with an extra fault — it is a vector
 * that has stopped testing what its note claims, because every conforming
 * verifier now rejects it on ET-14b first. The scan is by regex over the
 * committed bytes, not JSON.parse: several vectors are deliberately
 * non-parseable, and a check that skipped them would fail open on exactly the
 * hand-built payloads (057) most likely to forget a key.
 *
 * NOTE FOR THE NEXT AUTHOR: this asserts presence AND floor compliance, so it
 * will reject the below-floor vectors ADR-0014 owes — a vector whose whole point
 * is an interval under 60000 or a minimum under 3. That is correct today (no such
 * vector exists) and wrong the moment one is written. When adding them, exempt
 * vectors whose declared fault IS the floor; do not relax the check for
 * everything else, because its value is catching a payload that quietly stopped
 * testing what its note claims.
 */
test("every issue_created in the corpus declares both batch parameters at or above their floors (ET-14b)", () => {
  const INTERVAL_FLOOR = 60000;
  const MIN_FLOOR = 3;
  let seen = 0;
  for (const vec of vectors) {
    for (const line of read(`vectors/${vec.id}.ndjson`)
      .toString("utf8")
      .split("\n")) {
      if (!/"type"\s*:\s*"issue_created"/.test(line)) continue;
      seen += 1;
      const interval = /"ballot_batch_interval_ms"\s*:\s*(\d+)/.exec(line);
      const min = /"ballot_batch_min"\s*:\s*(\d+)/.exec(line);
      assert.ok(interval !== null, `${vec.id}: no ballot_batch_interval_ms`);
      assert.ok(min !== null, `${vec.id}: no ballot_batch_min`);
      assert.ok(
        Number(interval[1]) >= INTERVAL_FLOOR,
        `${vec.id}: ballot_batch_interval_ms below the ET-14b floor`,
      );
      assert.ok(
        Number(min[1]) >= MIN_FLOOR,
        `${vec.id}: ballot_batch_min below the ET-14b floor`,
      );
    }
  }
  assert.ok(seen > 0, "no issue_created line found in any vector");
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

/**
 * The two sets of vectors that are byte-identical ON PURPOSE, each run under a
 * different `--head`. Their whole value is that the bytes do not distinguish
 * them: EX-16 makes end-truncation undetectable from the export alone, so
 * 004/053 is the only thing pinning that rule.
 *
 * Asserted here because both directions can break silently. If a generator
 * change made the bytes differ, the pair would stop testing `--head` and start
 * testing two unrelated exports, with every other test still green. And a
 * conformance runner that keys on content hash would collapse each set to one
 * entry and report success having never exercised the `--head` paths.
 */
const SAME_BYTES: string[][] = [
  ["002-four-types", "003-head-match", "054-head-mismatch-substituted"],
  ["004-truncated-without-head", "053-head-mismatch-truncated"],
];

test("the deliberately byte-identical vectors are identical, and differ only in head (EX-15, EX-16)", () => {
  for (const group of SAME_BYTES) {
    const [first, ...rest] = group as [string, ...string[]];
    const want = read(`vectors/${first}.ndjson`);
    for (const id of rest) {
      assert.deepEqual(
        read(`vectors/${id}.ndjson`),
        want,
        `${id} is no longer byte-identical to ${first}, so the group stops testing --head`,
      );
    }

    // The head values must all differ, or two members are the same test.
    const heads = group.map(
      (id) => index.vectors.find((e) => e.id === id)?.head ?? "<absent>",
    );
    assert.equal(
      new Set(heads).size,
      group.length,
      `${group.join("/")} share a head value, so they are the same test twice`,
    );
  }
});

// --- above the BMP --------------------------------------------------------

/** The title of the `issue_created` on line 2 of one of the 07x vectors. */
function titleOnLine2(id: string): string {
  const line = read(`vectors/${id}.ndjson`).toString("utf8").split("\n")[1];
  assert.ok(line !== undefined, `${id}: no line 2`);
  const parsed = JSON.parse(line) as Event;
  const title = parsed.payload["title"];
  assert.equal(typeof title, "string", `${id}: line 2 has no string title`);
  return title as string;
}

test("the astral vectors carry literal 4-octet UTF-8, never a surrogate escape (EX-9)", () => {
  // The regression this exists to catch: emitting U+1D11E as the escape pair
  // \\ud834\\udd1e. It parses back to the same string and hashes to the same
  // preimage, so the manifest and framing checks stay green — and a Go verifier,
  // which emits the literal octets, would disagree with these bytes on the
  // canonical form of a legal title.
  //
  // This is NOT the only test that fails on that mutation: serialize.test.ts has
  // caught it at the jsonString level since PR #26, and the byte-identity check
  // above catches it until the goldens are regenerated. What was missing is a
  // check over the COMMITTED bytes that survives regeneration — before these
  // vectors, no fixture byte under contracts/ was above U+FFFF, so the golden
  // artifacts were blind to it even though jsonString was not.
  const CLEF_UTF8 = Buffer.from([0xf0, 0x9d, 0x84, 0x9e]);
  for (const id of ASTRAL_VECTORS) {
    const bytes = read(`vectors/${id}.ndjson`);
    assert.ok(bytes.includes(CLEF_UTF8), `${id}: no literal U+1D11E octets`);
    assert.ok(
      !bytes.toString("utf8").includes("\\u"),
      `${id}: contains a \\u escape, so a scalar value above U+FFFF was escaped`,
    );
    assert.ok(titleOnLine2(id).includes(CLEF), `${id}: title lost its clef`);
  }
});

test("072/073 straddle ET-14's ceiling in SCALAR VALUES, not code units or bytes", () => {
  // The three readings of "1-200 Unicode scalar values" that 061's 201 ASCII `t`
  // cannot tell apart. Asserted here so the vectors' declared verdicts stay
  // attached to the property that makes them decidable: if a future edit made
  // these titles ASCII, both vectors would keep their verdicts and quietly stop
  // discriminating.
  //
  // The counts are literals, NOT the generator's TITLE_MAX_SCALARS. 200 is
  // ET-14's number, not this tool's: importing the constant that built the
  // titles would let a change to it move both vectors together — leaving a file
  // named 072-title-200-astral, whose note reads "exactly 200 scalar values",
  // carrying some other number with the whole suite green.
  for (const [id, scalars] of [
    ["072-title-200-astral", 200],
    ["073-title-201-astral", 201],
  ] as [string, number][]) {
    const title = titleOnLine2(id);
    assert.equal([...title].length, scalars, `${id}: scalar values`);
    assert.equal(title.length, scalars * 2, `${id}: UTF-16 code units`);
    assert.equal(
      Buffer.byteLength(title, "utf8"),
      scalars * 4,
      `${id}: UTF-8 octets`,
    );
  }

  // Both halves of the boundary, or the vector that argues the over-limit branch
  // is the point would not be asserting it.
  assert.deepEqual(
    vectors.find((v) => v.id === "072-title-200-astral")?.expect,
    { verdict: "VALID" },
    "200 scalar values is inside ET-14's range however many octets it takes",
  );
  assert.deepEqual(
    vectors.find((v) => v.id === "073-title-201-astral")?.expect,
    { verdict: "INVALID", line: 2 },
    "201 scalar values is outside it however few code units a reader counts",
  );
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

test("074/075 pin ET-14's control-character clause at the BYTE level", () => {
  // ET-14 forbids the C0 block AND U+007F, and stops there. Both edges are
  // invisible to every earlier vector: 060 is the only other control-character
  // vector and it carries U+0001.
  //
  // These assertions are over the COMMITTED bytes, not the builder's opinion,
  // because that is what an independent verifier actually reads. The literal
  // encodings are the point: EX-9 escapes only U+0000-U+001F, so a generator
  // that started escaping U+007F or U+0085 as \\u007f / \\u0085 would still
  // parse back to the same string and hash to the same preimage — invisible
  // everywhere except here.
  const del = read("vectors/074-title-del.ndjson");
  assert.ok(
    del.includes(Buffer.from([0x7f])),
    "074: no literal U+007F octet — it must not be escaped",
  );
  assert.ok(
    titleOnLine2("074-title-del").includes("\u007f"),
    "074: title lost its U+007F, so it no longer violates ET-14",
  );

  const c1 = read("vectors/075-title-c1.ndjson");
  assert.ok(
    c1.includes(Buffer.from([0xc2, 0x85])),
    "075: no literal U+0085 octets — it must not be escaped",
  );
  assert.ok(
    titleOnLine2("075-title-c1").includes("\u0085"),
    "075: title lost its C1 character, so it no longer tests over-rejection",
  );
  // 075 is VALID: if it ever carried a C0 character or U+007F as well, it would
  // be an illegal title wearing a VALID declaration.
  for (const ch of titleOnLine2("075-title-c1")) {
    const c = ch.codePointAt(0) as number;
    assert.ok(
      c > 0x1f && c !== 0x7f,
      `075: title contains U+${c.toString(16).padStart(4, "0")}, which ET-14 forbids`,
    );
  }
});
