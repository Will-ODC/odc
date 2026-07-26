// Unit tests for the preimage construction (contracts/hashing.md).
//
// The §6 assertions are the load-bearing ones: they check this implementation
// against values a human derived by hand in T4, independently of this code. If
// they fail, this code is wrong — never adjust the expected value to match
// (odc-testing).

import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { test } from "node:test";

import {
  chainId,
  ENC_PAYLOAD,
  eventHash,
  keypairFromSeed,
  participantId,
  preimage,
  seedOf,
  signEvent,
  signingPreimage,
  U64,
  UTF8,
  type EventContent,
} from "../src/encode.js";

const sha256 = (b: Buffer): string =>
  createHash("sha256").update(b).digest("hex");

// --- the hand-derived anchors of hashing.md §6 -----------------------------

/**
 * The keys and timestamp of hashing.md §6, derived here rather than imported so
 * this file tests the encoder against the spec and nothing else.
 */
const OPERATOR = keypairFromSeed(seedOf(0x01));
const REGISTRAR = keypairFromSeed(seedOf(0x02));
const GENESIS_TS = "2026-07-21T00:00:00.000Z";

const SPEC_OPERATOR_PK =
  "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";
const SPEC_REGISTRAR_PK =
  "8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394";
const SPEC_CHAIN_ID =
  "34750f98bd59fcfc946da45aaabe933be154a4b5094e1c4abf42866505f3c97e";
const SPEC_SIG =
  "631d1b8001d674f4f9c2d04a9e7ff83b246a2d9ac10077b2095298777ed3c9055d7e5512c52604cb27b77076257a0ff8ced9fb156708d14f6b16b7769f305900";
const SPEC_HASH =
  "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a";
const SPEC_SIGNING_PREIMAGE_SHA256 =
  "31a2a0dcf12cd82f1defb04362528e6bf0663058329a01323b87909b6fd47710";

const genesisContent: EventContent = {
  seq: 1,
  type: "genesis",
  version: 1,
  payload: {
    chain_id: SPEC_CHAIN_ID,
    contracts: "contracts-v1",
    operator_pk: SPEC_OPERATOR_PK,
    registrar_pk: SPEC_REGISTRAR_PK,
  },
  ts: GENESIS_TS,
  prev_hash: "0".repeat(64),
};
const genesisSigned: EventContent = {
  ...genesisContent,
  payload: { ...genesisContent.payload, sig: SPEC_SIG },
};

test("derives the worked example keypairs from their seeds", () => {
  assert.equal(keypairFromSeed(seedOf(0x01)).publicKeyHex, SPEC_OPERATOR_PK);
  assert.equal(keypairFromSeed(seedOf(0x02)).publicKeyHex, SPEC_REGISTRAR_PK);
});

test("derives chain_id from operator_pk bytes (ET-7)", () => {
  assert.equal(chainId(SPEC_OPERATOR_PK), SPEC_CHAIN_ID);
});

test("reproduces the signing preimage of hashing.md 6.1", () => {
  const pre = signingPreimage(genesisSigned);
  assert.equal(pre.length, 459, "the spec states 459 octets");
  assert.equal(sha256(pre), SPEC_SIGNING_PREIMAGE_SHA256);
});

test("reproduces the hash preimage and digest of hashing.md 6.2", () => {
  const pre = preimage(genesisSigned);
  assert.equal(pre.length, 607, "the spec states 607 octets");
  assert.equal(sha256(pre), SPEC_HASH);
  assert.equal(eventHash(genesisSigned), SPEC_HASH);
});

test("reproduces the worked example signature bit for bit (HA-16)", () => {
  assert.equal(signEvent(genesisContent, OPERATOR), SPEC_SIG);
});

// --- the construction's own properties ------------------------------------

test("prefixes every preimage with the ODC1 domain (HA-10)", () => {
  assert.equal(
    preimage(genesisSigned).subarray(0, 4).toString("ascii"),
    "ODC1",
  );
});

test("encodes integers as 8 big-endian octets (HA-1)", () => {
  assert.equal(U64(1).toString("hex"), "0000000000000001");
  assert.equal(U64(0).toString("hex"), "0000000000000000");
  assert.throws(() => U64(-1), RangeError);
  assert.throws(() => U64(1.5), RangeError);
  assert.throws(() => U64(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test('distinguishes the integer 1 from the string "1" (HA-9)', () => {
  assert.notEqual(
    ENC_PAYLOAD({ k: 1 }).toString("hex"),
    ENC_PAYLOAD({ k: "1" }).toString("hex"),
    "the 1-octet type tag is what prevents this collision",
  );
});

test("orders payload keys by UTF-8 octets, shorter prefix first (HA-8)", () => {
  // Object insertion order is deliberately the reverse of the required order.
  const encoded = ENC_PAYLOAD({ ab: "y", a: "x" });
  assert.equal(
    encoded.toString("hex"),
    ENC_PAYLOAD({ a: "x", ab: "y" }).toString("hex"),
  );
  const hex = encoded.toString("hex");
  assert.ok(
    hex.indexOf(Buffer.from("a").toString("hex")) <
      hex.indexOf(Buffer.from("ab").toString("hex")),
  );
});

test("orders keys by UTF-8 bytes, NOT by UTF-16 code units (HA-8)", () => {
  // ASCII keys cannot tell the two orders apart — they coincide. These cannot:
  // U+FFFD is ef bf bd and U+10000 is f0 90 80 80, so UTF-8 puts U+FFFD first,
  // while UTF-16 puts the surrogate pair d800 dc00 first. A plain keys.sort(),
  // localeCompare, or `<` comparison sorts by code unit and produces different
  // bytes here — each of which survives an ASCII-only test.
  const astral = "\u{10000}";
  const bmp = "\uFFFD";
  const encoded = ENC_PAYLOAD({ [astral]: "a", [bmp]: "b" });
  const bmpAt = encoded.indexOf(Buffer.from(bmp, "utf8"));
  const astralAt = encoded.indexOf(Buffer.from(astral, "utf8"));
  assert.ok(bmpAt !== -1 && astralAt !== -1);
  assert.ok(
    bmpAt < astralAt,
    "UTF-8 byte order must put U+FFFD before U+10000",
  );
});

test("applies no Unicode normalization of any form (HA-2)", () => {
  // HA-2's most emphatic prohibition, and the one with the highest chance of
  // being violated accidentally: macOS input methods routinely produce NFD, so
  // real French/Vietnamese/Korean titles exercise this path. Inserting a
  // .normalize() call anywhere in UTF8 must break this.
  const composed = "\u00e9"; // é
  const decomposed = "e\u0301"; // e + combining acute
  assert.equal(composed.normalize("NFC"), decomposed.normalize("NFC"));
  assert.notEqual(
    UTF8(composed).toString("hex"),
    UTF8(decomposed).toString("hex"),
    "visually equal but differently encoded titles are different events (ET-16)",
  );
  assert.notEqual(
    ENC_PAYLOAD({ t: composed }).toString("hex"),
    ENC_PAYLOAD({ t: decomposed }).toString("hex"),
  );
});

test("rejects ill-formed UTF-8 rather than repairing it (HA-2)", () => {
  // Buffer.from replaces an unpaired surrogate with U+FFFD and succeeds, which
  // would collide two distinct payloads on one preimage and defeat HA-9.
  assert.throws(() => UTF8("\uD800"), /unpaired high surrogate/);
  assert.throws(() => UTF8("\uDC00"), /unpaired low surrogate/);
  assert.throws(() => UTF8("a\uD800b"), /unpaired high surrogate/);
  assert.doesNotThrow(() => UTF8("\u{10000}"), "a valid pair is fine");
  assert.throws(() => ENC_PAYLOAD({ t: "\uD800" }), /unpaired/);
});

test("the integer tag is exactly 0x69 and the string tag 0x73 (HA-7)", () => {
  // notEqual alone lets the tags be any two distinct bytes; HA-7 names them.
  assert.ok(ENC_PAYLOAD({ k: 1 }).includes(Buffer.from([0x69])));
  assert.ok(ENC_PAYLOAD({ k: "1" }).includes(Buffer.from([0x73])));
});

test("rejects a payload value that is neither integer nor string (ES-16)", () => {
  const bad = [104, 105] as unknown as string;
  assert.throws(() => ENC_PAYLOAD({ k: bad }), /neither integer nor string/);
});

test("encodes an empty payload as U64(0) and nothing more (HA-8)", () => {
  assert.equal(ENC_PAYLOAD({}).toString("hex"), "0000000000000000");
});

test("hashes prev_hash as its 64 hex characters, not 32 decoded bytes (HA-12)", () => {
  const pre = preimage(genesisSigned);
  const zeros = Buffer.alloc(64, 0x30); // 64 ASCII '0'
  assert.ok(
    pre.includes(zeros),
    "the genesis anchor appears as 64 ASCII zero characters",
  );
  assert.ok(
    !pre.includes(Buffer.alloc(32, 0x00)),
    "and never as 32 zero bytes",
  );
});

test("signing preimage differs from the hash preimage only by the sig entry (HA-15, HA-17)", () => {
  const signing = signingPreimage(genesisSigned);
  const hashing = preimage(genesisSigned);
  // 1 tag octet + LP("sig") = 8+3 + LP(128 hex chars) = 8+128 → 148 octets.
  assert.equal(hashing.length - signing.length, 148);
  // Every field before the payload count is byte-identical.
  assert.equal(
    signing.subarray(0, 35).toString("hex"),
    hashing.subarray(0, 35).toString("hex"),
  );
});

test("signEvent ignores an existing sig key in the payload (HA-15)", () => {
  assert.equal(signEvent(genesisSigned, OPERATOR), SPEC_SIG);
});

test("the signature actually verifies under operator_pk (ET-4, ET-8)", () => {
  // Nothing in this suite previously exercised an Ed25519 verify path at all —
  // every assertion only re-derived the signature with the same code that made
  // it, which cannot catch a signing-preimage error that is self-consistent.
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(SPEC_OPERATOR_PK, "hex"),
  ]);
  const pub = createPublicKey({ key: spki, format: "der", type: "spki" });
  assert.ok(
    verify(
      null,
      signingPreimage(genesisSigned),
      pub,
      Buffer.from(SPEC_SIG, "hex"),
    ),
  );
  // And it must NOT verify over the hash preimage, which includes sig (ES-32).
  assert.ok(
    !verify(null, preimage(genesisSigned), pub, Buffer.from(SPEC_SIG, "hex")),
  );
});

test("derives participant_id from decoded key bytes, not the hex text (ID-4, ID-5)", () => {
  const pubkey =
    "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
  assert.equal(participantId(pubkey), sha256(Buffer.from(pubkey, "hex")));
  assert.notEqual(participantId(pubkey), sha256(Buffer.from(pubkey, "utf8")));
});

test("participantId rejects malformed and uppercase hex (ID-1, ID-2, ID-5)", () => {
  // Node's hex decoder truncates at the first invalid character, so without
  // validation participantId("zz") returns sha256 of the empty string — a
  // well-formed-looking id derived from garbage.
  assert.throws(() => participantId("zz"), RangeError);
  assert.throws(() => participantId("abc"), RangeError);
  assert.throws(() => participantId("aabbzzccdd"), RangeError);
  assert.throws(() => participantId("A".repeat(64)), RangeError);
  assert.throws(() => participantId("a".repeat(63)), RangeError);
});

test("the registrar key is not the operator key (ET-9a)", () => {
  assert.notEqual(OPERATOR.publicKeyHex, REGISTRAR.publicKeyHex);
});
