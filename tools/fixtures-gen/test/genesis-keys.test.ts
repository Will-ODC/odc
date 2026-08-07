// ET-9b isolation: 076/077 must fail for the genesis key FORMAT and nothing else.
//
// The acceptance criterion of T5j is that each vector fails for the format rule
// ALONE — hash, signature and chain_id all valid on the same line, so the only
// thing a verifier can trip on is the uppercase case. If any of those three broke
// too, the vector could no longer separate ET-9b from ET-7/ET-8, and a verifier
// that omits the format check would still fail it (for the wrong reason), leaving
// the gap ET-9b exists to close undetectable.
//
// Asserted over the COMMITTED bytes, because that is what an independent verifier
// (T7) actually reads — not the builder's in-memory event.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { chainId, eventHash, verifyEvent, type Event } from "../src/encode.js";
import { vectors } from "../src/vectors/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "../../../..", "contracts", "fixtures");
const read = (rel: string): Buffer => readFileSync(join(fixturesDir, rel));

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const ANY_HEX_64 = /^[0-9a-fA-F]{64}$/;

/** The single genesis line of a one-event vector, parsed from its committed bytes. */
function genesisOf(id: string): Event {
  const line = read(`vectors/${id}.ndjson`).toString("utf8").trimEnd();
  assert.ok(!line.includes("\n"), `${id}: expected a single genesis line`);
  return JSON.parse(line) as Event;
}

/** A required string payload field, or a failed assertion naming it. */
function field(g: Event, id: string, key: string): string {
  const value = (g.payload as Record<string, unknown>)[key];
  assert.equal(typeof value, "string", `${id}: payload.${key} is not a string`);
  return value as string;
}

for (const { id, badKey } of [
  { id: "076-genesis-operator-pk-uppercase", badKey: "operator_pk" },
  { id: "077-genesis-registrar-pk-uppercase", badKey: "registrar_pk" },
] as const) {
  test(`${id}: only the key case is wrong — hash, signature and chain_id all verify`, () => {
    const g = genesisOf(id);
    const operatorLower = field(g, id, "operator_pk").toLowerCase();

    // hash recomputes over the uppercase payload (HA-13) — no digest mismatch.
    assert.equal(eventHash(g), g.hash, `${id}: hash does not recompute`);

    // chain_id is the correct sha256 of the decoded operator key (ET-7).
    assert.equal(
      field(g, id, "chain_id"),
      chainId(operatorLower),
      `${id}: chain_id is not the ET-7 derivation`,
    );

    // The genesis self-signature verifies under the decoded operator key (ET-8):
    // an uppercase key decodes to the same 32 bytes, so ET-8 cannot catch it.
    assert.ok(
      verifyEvent(g, operatorLower, field(g, id, "sig")),
      `${id}: signature does not verify under operator_pk`,
    );

    // The one and only defect: the named key is uppercase hex, the other is not.
    const badValue = field(g, id, badKey);
    assert.match(badValue, ANY_HEX_64, `${id}: ${badKey} is not hex`);
    assert.doesNotMatch(
      badValue,
      LOWER_HEX_64,
      `${id}: ${badKey} is already lowercase, so nothing violates ET-9b`,
    );
    const otherKey = badKey === "operator_pk" ? "registrar_pk" : "operator_pk";
    assert.match(
      field(g, id, otherKey),
      LOWER_HEX_64,
      `${id}: ${otherKey} must be valid lowercase, so exactly one key is malformed`,
    );
  });

  test(`${id}: declares INVALID at line 1`, () => {
    const vec = vectors.find((v) => v.id === id);
    assert.ok(vec !== undefined, `${id} is not in the vector table`);
    assert.deepEqual(vec.expect, { verdict: "INVALID", line: 1 });
  });
}
