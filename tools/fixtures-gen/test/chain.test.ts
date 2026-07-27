// Tests for the event builders (contracts/event-types.md).
//
// The assertions that matter here are the signature ones: every signed type must
// verify under the key ITS OWN type names (ET-8/ET-10/ET-13/ET-17), and getting
// that wrong is invisible in the output — a chain signed entirely by the operator
// key looks perfectly well-formed until a verifier checks it.

import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { test } from "node:test";

import {
  ChainBuilder,
  GENESIS_PREV_HASH,
  GENESIS_TS,
  newChain,
  OPERATOR,
  REGISTRAR,
  tsAt,
} from "../src/chain.js";
import {
  eventHash,
  keypairFromSeed,
  participantId,
  seedOf,
  signingPreimage,
} from "../src/encode.js";
import type { Event } from "../src/encode.js";

/** Ed25519 SPKI prefix, so a raw 32-byte hex key can be used to verify. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const publicKeyOf = (hex: string): ReturnType<typeof createPublicKey> =>
  createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });

/** ET-4: sig verifies over the signing preimage under the named key. */
function sigVerifies(e: Event, pubkeyHex: string): boolean {
  return verify(
    null,
    signingPreimage(e),
    publicKeyOf(pubkeyHex),
    Buffer.from(String(e.payload["sig"]), "hex"),
  );
}

test("genesis is byte-identical to the hashing.md 6 worked example", () => {
  const g = newChain().all[0] as Event;
  assert.equal(
    g.hash,
    "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a",
  );
  assert.equal(g.seq, 1);
  assert.equal(g.prev_hash, GENESIS_PREV_HASH);
  assert.equal(g.ts, GENESIS_TS);
});

test("genesis self-signs under the operator_pk it declares (ET-8)", () => {
  const g = newChain().all[0] as Event;
  assert.equal(g.payload["operator_pk"], OPERATOR.publicKeyHex);
  assert.ok(sigVerifies(g, String(g.payload["operator_pk"])));
});

test("chain_id is derived from operator_pk, not registrar_pk (ET-7)", () => {
  const g = newChain().all[0] as Event;
  assert.notEqual(g.payload["chain_id"], g.payload["registrar_pk"]);
  assert.match(String(g.payload["chain_id"]), /^[0-9a-f]{64}$/);
});

test("participant_registered self-signs under its own pubkey (ET-10)", () => {
  const c = newChain();
  const p = c.participant(0x03);
  assert.ok(sigVerifies(p, String(p.payload["pubkey"])));
  assert.equal(p.payload["pubkey"], keypairFromSeed(seedOf(0x03)).publicKeyHex);
});

test("issue_created is signed by the operator, not the registrar (ET-13)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  assert.ok(sigVerifies(i, OPERATOR.publicKeyHex));
  assert.ok(!sigVerifies(i, REGISTRAR.publicKeyHex));
});

test("vote_cast is signed by the registrar, not the operator (ET-17)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.ok(sigVerifies(v, REGISTRAR.publicKeyHex));
  assert.ok(!sigVerifies(v, OPERATOR.publicKeyHex));
});

test("a ballot carries no voter field at all (ET-21)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.deepEqual(Object.keys(v.payload).sort(), [
    "choice",
    "issue_id",
    "sig",
  ]);
});

test("issue_id is the issue_created event's own hash (ID-7, ET-15)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.equal(v.payload["issue_id"], i.hash);
  assert.equal(c.issues.get(i.hash), 3, "choice_count is tracked for ET-18a");
});

test("seq increments by one and prev_hash links to the predecessor (ES-7, ES-25)", () => {
  const c = newChain();
  c.participant(0x03);
  const i = c.issue("Adopt the charter", 3);
  c.vote(i.hash, 1);
  const all = c.all;
  assert.equal(all.length, 4);
  for (let n = 0; n < all.length; n += 1) {
    const e = all[n] as Event;
    assert.equal(e.seq, n + 1);
    assert.equal(
      e.prev_hash,
      n === 0 ? GENESIS_PREV_HASH : (all[n - 1] as Event).hash,
    );
  }
});

test("hash covers the payload INCLUDING sig, sig covers it excluding sig (ES-29, ES-32)", () => {
  const p = newChain().participant(0x03);
  // Recomputing the hash over the stored six content fields reproduces it, and
  // those fields include sig — so tampering with a signature breaks the chain,
  // not merely the signature check.
  assert.equal(eventHash(p), p.hash);
  assert.ok("sig" in p.payload);
});

test("timestamps satisfy the ts format gate (ES-20)", () => {
  const c = newChain();
  c.participant(0x03);
  for (const e of c.all) {
    assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  assert.equal(tsAt(0), GENESIS_TS);
  assert.equal(tsAt(2), "2026-07-21T00:02:00.000Z");
});

test("a headless builder starts at seq 1 with the genesis anchor", () => {
  // This is what the "first event is not a genesis" vector needs: a well-formed
  // event in position 1 that is not a genesis.
  const c = new ChainBuilder();
  const kp = keypairFromSeed(seedOf(0x03));
  const e = c.custom(
    "participant_registered",
    1,
    { pubkey: kp.publicKeyHex },
    { signer: kp },
  );
  assert.equal(e.seq, 1);
  assert.equal(e.prev_hash, GENESIS_PREV_HASH);
  assert.notEqual(e.type, "genesis");
});

test("custom() builds unregistered types, with or without a signature", () => {
  const c = newChain();
  const unsigned = c.custom("x_experimental", 1, { n: 7 });
  assert.ok(!("sig" in unsigned.payload), "no signer means no sig key");
  assert.equal(
    eventHash(unsigned),
    unsigned.hash,
    "still hashed by the generic rule (HA-7)",
  );
  const v2 = c.custom("participant_registered", 2, {
    pubkey: OPERATOR.publicKeyHex,
  });
  assert.equal(v2.version, 2, "a registered type at an unregistered version");
});

test("custom() actually signs with the signer it is given", () => {
  // Without this, replacing `opts.signer` with `undefined` leaves the whole
  // suite green — and custom() is the ONLY path to the wrong-key signature
  // vectors, where an absent sig is an ES-18 missing-key failure rather than
  // the ET-5 signature failure the vector claims.
  const c = newChain();
  const kp = keypairFromSeed(seedOf(0x03));
  const e = c.custom("x_signed", 1, { n: 7 }, { signer: kp });
  assert.ok("sig" in e.payload, "a signer must produce a sig key");
  assert.ok(sigVerifies(e, kp.publicKeyHex), "sig verifies under the signer");
  assert.ok(
    !sigVerifies(e, OPERATOR.publicKeyHex),
    "and under nothing else — this is what pins the wrong-key vectors",
  );
});

test("custom() signs with a wrong key on demand, which is the ET-5 vector shape", () => {
  const c = newChain();
  const kp = keypairFromSeed(seedOf(0x03));
  const impostor = keypairFromSeed(seedOf(0xee));
  const e = c.custom(
    "participant_registered",
    1,
    { pubkey: kp.publicKeyHex },
    { signer: impostor },
  );
  assert.ok("sig" in e.payload, "the key is present, so ES-18 is satisfied");
  assert.ok(
    !sigVerifies(e, String(e.payload["pubkey"])),
    "and fails at the signature check (ET-5), not at the key-set check",
  );
  assert.ok(sigVerifies(e, impostor.publicKeyHex));
});

test("genesis() honours every declared option (ET-6, ET-7, ET-8)", () => {
  const impostorOp = keypairFromSeed(seedOf(0xee));
  const altReg = keypairFromSeed(seedOf(0xef));
  const c = new ChainBuilder();
  const g = c.genesis({
    operator: impostorOp,
    registrar: altReg,
    contracts: "contracts-v2",
  });
  assert.equal(g.payload["operator_pk"], impostorOp.publicKeyHex);
  assert.equal(g.payload["registrar_pk"], altReg.publicKeyHex);
  assert.equal(g.payload["contracts"], "contracts-v2");
  assert.equal(g.payload["chain_id"], participantId(impostorOp.publicKeyHex));
  assert.ok(sigVerifies(g, impostorOp.publicKeyHex), "self-signed (ET-8)");
});

test("issue_created verifies under the genesis-DECLARED operator_pk (ET-13)", () => {
  // Signing from a module constant instead of the declared key yields a chain
  // that is well-formed and self-consistently hashed but does not verify under
  // its own operator_pk — a wrong-but-plausible vector, which reads at T7 as a
  // mysterious verifier bug rather than a fixture bug.
  const impostorOp = keypairFromSeed(seedOf(0xee));
  const c = new ChainBuilder();
  const g = c.genesis({ operator: impostorOp });
  const i = c.issue("Adopt the charter", 2);
  assert.notEqual(impostorOp.publicKeyHex, OPERATOR.publicKeyHex);
  assert.ok(sigVerifies(i, String(g.payload["operator_pk"])));
  assert.ok(!sigVerifies(i, OPERATOR.publicKeyHex));
});

test("vote_cast verifies under the genesis-DECLARED registrar_pk (ET-17)", () => {
  const altReg = keypairFromSeed(seedOf(0xef));
  const c = new ChainBuilder();
  const g = c.genesis({ registrar: altReg });
  const i = c.issue("Adopt the charter", 2);
  const vote = c.vote(i.hash, 1);
  assert.notEqual(altReg.publicKeyHex, REGISTRAR.publicKeyHex);
  assert.ok(sigVerifies(vote, String(g.payload["registrar_pk"])));
  assert.ok(!sigVerifies(vote, REGISTRAR.publicKeyHex));
});

test("a headless chain still signs from the module defaults", () => {
  // No genesis has declared anything, so the §6 keys remain the fallback —
  // otherwise the headless vectors would lose their signers entirely.
  const c = new ChainBuilder();
  const i = c.issue("Adopt the charter", 2);
  assert.ok(sigVerifies(i, OPERATOR.publicKeyHex));
  assert.ok(sigVerifies(c.vote(i.hash, 1), REGISTRAR.publicKeyHex));
});

test("an empty payload is buildable and hashes (HA-8)", () => {
  const e = newChain().custom("x_empty", 1, {});
  assert.deepEqual(Object.keys(e.payload), []);
  assert.equal(eventHash(e), e.hash);
});
