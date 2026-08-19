// Tests for the three rules added by T9: evolution.md EV-20, event-types.md
// ET-9d, and event-types.md ET-9e together with event-schema.md ES-34.
//
// NO FIXTURE PINS THESE THREE RULES YET — the conformance vectors are being
// written separately. These tests are therefore NOT a conformance oracle:
// `test/fixtures.test.ts` remains the sole oracle for what verifies VALID, and
// nothing here asserts a chain-level VALID verdict or signs anything (the same
// line `test/robustness.test.ts` holds). What they do is record this
// implementation's reading of three brand-new spec sentences so a divergence
// from the second implementation surfaces here rather than in production.
//
// Where a test is *non-discriminating* — it would pass with the new check
// removed, because the mutation also breaks the genesis self-signature — it is
// labelled as such. That is the same status `contracts/fixtures/README.md`
// gives vectors 079/080, and the same reason for keeping them: they pin the
// agreed verdict and guard against drift, they just catch nothing today.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { verifyExport, payloadKeysConform } from "../src/verify.js";
import { parseEventLine } from "../src/parse.js";
import { computeHash } from "../src/hashing.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/test/ -> repo root is four levels up (test, dist, verifier-ts, tools).
const fixturesDir = resolve(here, "../../../../contracts/fixtures");

// The single-line genesis-only chain of vector 001 — the calibration point of
// the whole corpus — used here only as a *starting shape* to mutate. Every
// mutation below re-derives `hash` so the line stays Stage A-clean and the new
// check is what the verdict turns on, never a stale hash (HA-14).
const GENESIS_ONLY = readFileSync(
  resolve(fixturesDir, "vectors/001-genesis-only.ndjson"),
  "utf8",
);

/** Re-derive the `hash` field of a one-line export after mutating its content. */
function withRecomputedHash(exportText: string): Buffer {
  const line = exportText.endsWith("\n") ? exportText.slice(0, -1) : exportText;
  const parsed = parseEventLine(Buffer.from(line, "utf8"));
  if (parsed === null) {
    throw new Error("test setup: mutated line is not canonically parseable");
  }
  const rehashed = line.replace(
    /"hash":"[0-9a-f]{64}"\}$/,
    `"hash":"${computeHash(parsed)}"}`,
  );
  assert.notEqual(
    rehashed,
    line,
    "test setup: hash substitution did not apply",
  );
  return Buffer.from(rehashed + "\n", "utf8");
}

// --- EV-20: the genesis (type, version) MUST be registered -------------------

test("EV-20: a genesis at an unregistered version is INVALID at line 1", () => {
  // DISCRIMINATING. Before EV-20 this chain reported PARTIAL [1]: Stage A
  // passes on every line (the hash is re-derived over the mutated version), the
  // pair (genesis, 2) is outside the registry, so Stage B — and with it the
  // self-signature check — is skipped and the chain walks to PARTIAL. EV-20
  // makes that the one case where an unregistered well-formed pair is INVALID
  // rather than PARTIAL: "A chain whose first line does not [carry a registered
  // (type, version)] is INVALID at line 1, and the verifier MUST NOT proceed to
  // a chain-level VALID or PARTIAL verdict."
  const bytes = withRecomputedHash(
    GENESIS_ONLY.replace(',"version":1,', ',"version":2,'),
  );
  const result = verifyExport(bytes);
  assert.equal(result.verdict, "INVALID");
  assert.equal(result.verdict === "INVALID" ? result.line : null, 1);
});

test("EV-21: the EV-20 rejection carries an advisory reason naming both readings", () => {
  // EV-21 is SHOULD-level and its text is never conformance-checked (EV-17), so
  // this asserts only that the honest both-possibilities message is present —
  // never that any fixture or caller depends on its wording.
  const bytes = withRecomputedHash(
    GENESIS_ONLY.replace(',"version":1,', ',"version":2,'),
  );
  const result = verifyExport(bytes);
  assert.equal(result.verdict, "INVALID");
  const reason = result.verdict === "INVALID" ? (result.reason ?? "") : "";
  assert.match(reason, /out of date/);
  assert.match(reason, /corrupt or hostile/);
  assert.match(reason, /version 2/);
});

test("EV-20 does not fire on a registered genesis (fixture 001 is untouched)", () => {
  assert.deepEqual(verifyExport(Buffer.from(GENESIS_ONLY, "utf8")), {
    verdict: "VALID",
  });
});

// --- ET-9d: the two genesis keys MUST be distinct ----------------------------

test("ET-9d: a genesis declaring registrar_pk == operator_pk is INVALID at line 1", () => {
  // NON-DISCRIMINATING today: rewriting registrar_pk also invalidates the
  // genesis self-signature (ET-8), which alone gives INVALID at line 1. Only a
  // vector signed under the collapsed key set can isolate ET-9d, and signing a
  // chain here would be inventing an oracle beyond the fixtures. Kept because
  // the verdict is the thing being pinned: "A `genesis` whose `registrar_pk` is
  // byte-identical to its `operator_pk` MUST be rejected — INVALID at the
  // `genesis` line."
  const op = "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";
  const collapsed = GENESIS_ONLY.replace(
    /"registrar_pk":"[0-9a-f]{64}"/,
    `"registrar_pk":"${op}"`,
  );
  assert.notEqual(collapsed, GENESIS_ONLY, "test setup: no substitution made");
  const result = verifyExport(withRecomputedHash(collapsed));
  assert.equal(result.verdict, "INVALID");
  assert.equal(result.verdict === "INVALID" ? result.line : null, 1);
});

// --- ET-9e / ES-34: ancestor_head is OPTIONAL, and the key set stays closed ---

test("ES-34/ET-9e: the genesis key set admits ancestor_head and nothing else", () => {
  // DISCRIMINATING, and the only part of the widening that can be pinned
  // without a signed chain. ES-34: "OPTIONAL means 'this defined key may be
  // absent', never 'an undefined key may appear', and a verifier still rejects
  // any key not defined for the (type, version)."
  const required = [
    "chain_id",
    "contracts",
    "operator_pk",
    "registrar_pk",
    "sig",
  ];
  const optional = ["ancestor_head"];

  // Absent optional key: legal (this is every one of the 83 current vectors).
  assert.equal(payloadKeysConform(required, required, optional), true);
  // Present optional key: legal — the widening this ticket exists for.
  assert.equal(
    payloadKeysConform(["ancestor_head", ...required], required, optional),
    true,
  );
  // A key outside required ∪ optional: still rejected. The widening must not
  // become a hole.
  assert.equal(
    payloadKeysConform(["x_extra", ...required], required, optional),
    false,
  );
  assert.equal(
    payloadKeysConform(
      ["ancestor_head", "x_extra", ...required],
      required,
      optional,
    ),
    false,
  );
  // A missing REQUIRED key is still missing — optionality attaches to the one
  // key the type's table marks OPTIONAL, not to the key set at large.
  assert.equal(
    payloadKeysConform(
      required.filter((k) => k !== "registrar_pk"),
      required,
      optional,
    ),
    false,
  );
  // The optional key cannot stand in for the required ones.
  assert.equal(
    payloadKeysConform(["ancestor_head"], required, optional),
    false,
  );
});

test("ET-9e: an ancestor_head of the 64-zero anchor is INVALID at line 1", () => {
  // NON-DISCRIMINATING (the added key breaks the self-signature). Pins ET-9e's
  // "MUST NOT be the 64-zero anchor; a chain with no ancestor omits the key
  // (ES-34), so there is exactly one way to say 'no ancestor'".
  // `ancestor_head` sorts first among the genesis keys, so it is inserted at
  // the head of the payload to keep the line's ascending key order (EX-8).
  const zeroAnchor = "0".repeat(64);
  const forged = GENESIS_ONLY.replace(
    '"payload":{',
    `"payload":{"ancestor_head":"${zeroAnchor}",`,
  );
  assert.notEqual(forged, GENESIS_ONLY, "test setup: no substitution made");
  const result = verifyExport(withRecomputedHash(forged));
  assert.equal(result.verdict, "INVALID");
  assert.equal(result.verdict === "INVALID" ? result.line : null, 1);
});

test("ES-18: an undefined genesis payload key is INVALID at line 1", () => {
  // NON-DISCRIMINATING at chain level for the same reason; the discriminating
  // form of this assertion is the payloadKeysConform test above. `x_extra`
  // sorts after `sig`, so it is appended to keep ascending key order (EX-8).
  const forged = GENESIS_ONLY.replace(
    /("sig":"[0-9a-f]{128}")\}/,
    '$1,"x_extra":"1"}',
  );
  assert.notEqual(forged, GENESIS_ONLY, "test setup: no substitution made");
  const result = verifyExport(withRecomputedHash(forged));
  assert.equal(result.verdict, "INVALID");
  assert.equal(result.verdict === "INVALID" ? result.line : null, 1);
});
