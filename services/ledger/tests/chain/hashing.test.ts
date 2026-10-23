import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLine } from "../../src/chain/canonical.js";
import {
  computeHash,
  encodePayload,
  preimage,
  sha256Hex,
  signingPreimage,
  u64,
} from "../../src/chain/hashing.js";
import { OPERATOR, REGISTRAR, testKey } from "./support/builders.js";
import { fixtureBytes, vectorLines, loadVectors } from "./support/fixtures.js";

function lineOf(id: string, n: number) {
  const v = loadVectors().find((x) => x.id === id);
  assert.ok(v, id);
  const parsed = parseLine(vectorLines(v)[n - 1] ?? new Uint8Array());
  assert.ok(parsed.ok, `${id} line ${n} parses`);
  return parsed.event;
}

function hexFixture(name: string): string {
  return fixtureBytes(`preimages/${name}`).toString("ascii").trim();
}

describe("hashing.md", () => {
  it("reproduces the §6 worked example: 459-octet signing preimage, 607-octet preimage, hash", () => {
    const genesis = lineOf("001-genesis-only", 1);
    const signing = signingPreimage(genesis);
    assert.equal(signing.length, 459);
    assert.equal(
      sha256Hex(signing),
      "31a2a0dcf12cd82f1defb04362528e6bf0663058329a01323b87909b6fd47710",
    );
    const pre = preimage(genesis);
    assert.equal(pre.length, 607);
    assert.equal(
      computeHash(genesis),
      "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a",
    );
    assert.equal(computeHash(genesis), genesis.hash);
  });

  it("matches preimages/001-genesis-only.hex byte for byte", () => {
    const genesis = lineOf("001-genesis-only", 1);
    assert.equal(
      preimage(genesis).toString("hex"),
      hexFixture("001-genesis-only.hex"),
    );
  });

  it("matches preimages/002-four-types-seq3.hex (integer tag and int/str adjacency)", () => {
    const issue = lineOf("002-four-types", 3);
    assert.equal(
      preimage(issue).toString("hex"),
      hexFixture("002-four-types-seq3.hex"),
    );
    assert.equal(computeHash(issue), issue.hash);
  });

  it("derives participant_id and chain_id from raw key bytes (derivations.json)", () => {
    const d = JSON.parse(fixtureBytes("derivations.json").toString("utf8")) as {
      participant_id: { pubkey: string; participant_id: string }[];
      chain_id: { operator_pk: string; chain_id: string }[];
      keys: {
        operator: { public_key: string };
        registrar: { public_key: string };
      };
    };
    for (const p of d.participant_id) {
      assert.equal(sha256Hex(Buffer.from(p.pubkey, "hex")), p.participant_id);
    }
    for (const c of d.chain_id) {
      assert.equal(sha256Hex(Buffer.from(c.operator_pk, "hex")), c.chain_id);
    }
    assert.equal(OPERATOR.pk, d.keys.operator.public_key);
    assert.equal(REGISTRAR.pk, d.keys.registrar.public_key);
    assert.equal(testKey(0x01).pk, d.keys.operator.public_key);
  });

  it("encodes U64 big-endian in 8 octets up to 2^53 - 1", () => {
    assert.equal(u64(1).toString("hex"), "0000000000000001");
    assert.equal(
      u64(Number.MAX_SAFE_INTEGER).toString("hex"),
      "001fffffffffffff",
    );
    assert.throws(() => u64(-1));
    assert.throws(() => u64(2 ** 53));
  });

  it('separates integer 0 from string "" only by the type tag (HA-9)', () => {
    const a = encodePayload({ k: 0 });
    const b = encodePayload({ k: "" });
    assert.equal(a.length, b.length);
    assert.notDeepEqual(a, b);
    assert.equal(a[8], 0x69);
    assert.equal(b[8], 0x73);
  });

  it("sorts payload keys by UTF-8 bytes, not UTF-16 units (HA-8)", () => {
    // U+FF61 (EF BD A1) sorts before U+1F600 (F0 9F 98 80) in UTF-8 bytes,
    // but after it in UTF-16 code units (0xFF61 > 0xD83D).
    const enc = encodePayload({ "\u{1F600}": 1, "｡": 2 });
    const firstKey = enc.subarray(17, 17 + 3).toString("utf8");
    assert.equal(firstKey, "｡");
  });

  it("omits exactly the sig key from the signing preimage (HA-15)", () => {
    const e = lineOf("002-four-types", 4);
    const withSig = preimage(e);
    const without = signingPreimage(e);
    const sigEntry = 1 + 8 + 3 + 8 + 128;
    assert.equal(withSig.length - without.length, sigEntry);
  });

  it("throws on a lone surrogate instead of hashing U+FFFD (HA-2)", () => {
    const e = lineOf("001-genesis-only", 1);
    assert.throws(() => computeHash({ ...e, type: "x_\ud800" }), TypeError);
    assert.throws(() => encodePayload({ k: "\udc00" }), TypeError);
    assert.throws(() => encodePayload({ "\ud800": 1 }), TypeError);
    // Directly on both preimages, through the string encoder (encStr).
    assert.throws(() => preimage({ ...e, ts: "\udfff" }), TypeError);
    assert.throws(() => signingPreimage({ ...e, ts: "\udfff" }), TypeError);
  });
});
