import assert from "node:assert/strict";
import { createHash, verify } from "node:crypto";
import { test } from "node:test";

import {
  eventHash,
  publicKeyFromHex,
  signingPreimage,
  type Event,
} from "../src/encode.js";
import {
  registrationPreimage,
  registrationV2Vectors,
} from "../src/vectors/registration-v2.js";

function events(id: string): Event[] {
  const vector = registrationV2Vectors.find((v) => v.id.startsWith(id));
  assert.ok(vector, `registration vector ${id} is missing`);
  return vector.bytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Event);
}

function verifiesSignature(event: Event, message: Buffer): boolean {
  const { pubkey, sig } = event.payload;
  assert.ok(typeof pubkey === "string");
  assert.ok(typeof sig === "string");
  return verify(
    null,
    message,
    publicKeyFromHex(pubkey),
    Buffer.from(sig, "hex"),
  );
}

test("registration v2 fixture 151 reproduces the HA-15a worked example", () => {
  const [genesis, registration] = events("151");
  assert.ok(genesis && registration);
  const { sig, ...payload } = registration.payload;
  assert.ok(typeof sig === "string");
  const message = registrationPreimage(genesis.hash, payload);
  assert.equal(message.length, 213);
  assert.equal(
    createHash("sha256").update(message).digest("hex"),
    "3f06485f5e3e50cdf369a343e7a2df2bdbaef7c791b27b7aab951dffcd2e2751",
  );
  assert.ok(verifiesSignature(registration, message));
  assert.equal(
    verifiesSignature(registration, signingPreimage(registration)),
    false,
  );
});

test("registration vectors isolate position, chain identity and exact keys", () => {
  const [genesis, immediate] = events("151");
  const [, , delayed] = events("152");
  const [, first, duplicate] = events("153");
  const [otherGenesis, replay] = events("156");
  const [, extra] = events("157");
  assert.ok(
    genesis &&
      immediate &&
      delayed &&
      first &&
      duplicate &&
      otherGenesis &&
      replay &&
      extra,
  );

  for (const reuse of [delayed, duplicate, replay]) {
    assert.deepEqual(reuse.payload, immediate.payload);
    assert.notEqual(reuse.hash, immediate.hash);
    assert.equal(reuse.hash, eventHash(reuse));
  }
  assert.deepEqual(first, immediate);
  for (const key of ["seq", "ts", "prev_hash"] as const) {
    assert.notEqual(delayed[key], immediate[key]);
    assert.notEqual(duplicate[key], immediate[key]);
  }

  const { pubkey } = immediate.payload;
  assert.ok(typeof pubkey === "string");
  assert.deepEqual(
    otherGenesis.payload.operator_pk,
    genesis.payload.operator_pk,
  );
  assert.deepEqual(otherGenesis.payload.chain_id, genesis.payload.chain_id);
  assert.notEqual(otherGenesis.hash, genesis.hash);
  assert.equal(replay.prev_hash, otherGenesis.hash);
  assert.equal(
    verifiesSignature(
      replay,
      registrationPreimage(otherGenesis.hash, { pubkey: pubkey }),
    ),
    false,
  );

  assert.ok(
    verifiesSignature(
      extra,
      registrationPreimage(genesis.hash, { pubkey: pubkey, extra: 1 }),
    ),
  );
  assert.equal(extra.hash, eventHash(extra));
});
