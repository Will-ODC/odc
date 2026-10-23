import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  L,
  P,
  decodeVerificationKey,
  leInt,
  verifySignature,
  type VerificationKey,
} from "../../src/chain/ed25519.js";
import { parseLine, type Event } from "../../src/chain/canonical.js";
import { signingPreimage } from "../../src/chain/hashing.js";
import { sign, testKey } from "./support/builders.js";
import { loadVectors, vectorLines } from "./support/fixtures.js";

const msg = Buffer.from("ODC test message");
const alice = testKey(0x11);

function key(hex: string): VerificationKey {
  const r = decodeVerificationKey(hex);
  assert.ok(r.ok, r.ok ? "" : r.refusal.reason);
  return r.key;
}

function le32(n: bigint): Buffer {
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return out;
}

function ruleOf(r: {
  ok: boolean;
  refusal?: { rule: string };
}): string | undefined {
  return r.ok ? undefined : r.refusal?.rule;
}

// An order-8 torsion point (a published small-order encoding).
const T8 = "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a";

describe("Ed25519 verification (ET-4..ET-5)", () => {
  it("accepts a deterministic RFC 8032 signature", () => {
    const sig = sign(alice.seed, msg);
    assert.ok(verifySignature(key(alice.pk), msg, sig).ok);
    assert.equal(sign(alice.seed, msg), sig, "deterministic");
  });

  it("rejects a wrong key, a wrong message and a flipped bit (ET-5)", () => {
    const sig = sign(alice.seed, msg);
    assert.equal(
      ruleOf(verifySignature(key(testKey(0x12).pk), msg, sig)),
      "ET-5",
    );
    assert.equal(
      ruleOf(verifySignature(key(alice.pk), Buffer.from("other"), sig)),
      "ET-5",
    );
    const flipped =
      (parseInt(sig[0] ?? "0", 16) ^ 1).toString(16) + sig.slice(1);
    assert.equal(ruleOf(verifySignature(key(alice.pk), msg, flipped)), "ET-5");
  });

  it("rejects non-hex or uppercase sig (ES-31)", () => {
    const sig = sign(alice.seed, msg);
    assert.equal(
      ruleOf(verifySignature(key(alice.pk), msg, sig.toUpperCase())),
      "ES-31",
    );
    assert.equal(
      ruleOf(verifySignature(key(alice.pk), msg, sig.slice(2))),
      "ES-31",
    );
  });

  it("rejects S >= L before verifying, never reducing it (ET-4a i)", () => {
    const sig = Buffer.from(sign(alice.seed, msg), "hex");
    const s = leInt(sig.subarray(32));
    for (const bad of [s + L, L]) {
      const mutated = Buffer.concat([sig.subarray(0, 32), le32(bad)]).toString(
        "hex",
      );
      assert.equal(
        ruleOf(verifySignature(key(alice.pk), msg, mutated)),
        "ET-4a",
      );
    }
  });

  it("rejects a non-canonical R encoding (ET-4a ii)", () => {
    const sig = Buffer.from(sign(alice.seed, msg), "hex");
    const rNonCanonical = le32(P); // y = p, sign bit clear
    const mutated = Buffer.concat([rNonCanonical, sig.subarray(32)]).toString(
      "hex",
    );
    assert.equal(ruleOf(verifySignature(key(alice.pk), msg, mutated)), "ET-4a");
    // y = p + 1 with the sign bit set: bit 255 is cleared before the y < p
    // test, not ignored, so this is still non-canonical.
    const signedR = le32(P + 1n);
    signedR[31] = (signedR[31] ?? 0) | 0x80;
    const withSign = Buffer.concat([signedR, sig.subarray(32)]).toString("hex");
    assert.equal(
      ruleOf(verifySignature(key(alice.pk), msg, withSign)),
      "ET-4a",
    );
  });

  it("refuses an R with x = 0 and the sign bit set, even where S would fit", () => {
    // R = identity (y = 1) with octet 31 |= 0x80, and S = k·a, so [S]B equals
    // O + [k]A: it would verify if the encoding were decoded leniently.
    const ext = ed25519.utils.getExtendedPublicKey(alice.seed);
    const rBytes = Buffer.from("01" + "00".repeat(31), "hex");
    rBytes[31] = 0x80;
    const k =
      leInt(
        createHash("sha512")
          .update(rBytes)
          .update(ext.pointBytes)
          .update(msg)
          .digest(),
      ) % L;
    const sig = Buffer.concat([rBytes, le32((k * ext.scalar) % L)]);
    const r = verifySignature(key(alice.pk), msg, sig.toString("hex"));
    assert.equal(ruleOf(r), "ET-5");
    assert.match(r.ok ? "" : r.refusal.reason, /R does not decode/);
    // The order-2 point (y = p - 1, x = 0), also with the sign bit set.
    const order2 = le32(P - 1n);
    order2[31] = (order2[31] ?? 0) | 0x80;
    const r2 = verifySignature(
      key(alice.pk),
      msg,
      Buffer.concat([order2, sig.subarray(32)]).toString("hex"),
    );
    assert.match(r2.ok ? "" : r2.refusal.reason, /R does not decode/);
  });

  it("checks the cofactorless equation: R with a torsion component fails", () => {
    // Re-sign honestly but with R' = R + T8, so the cofactored equation holds
    // and the cofactorless one does not (the ET-4b note's v1 predicate).
    const ext = ed25519.utils.getExtendedPublicKey(alice.seed);
    const r = 12345678901234567890n;
    const rPoint = ed25519.Point.BASE.multiply(r).add(
      ed25519.Point.fromHex(T8),
    );
    const rBytes = rPoint.toBytes();
    const k =
      leInt(
        createHash("sha512")
          .update(rBytes)
          .update(ext.pointBytes)
          .update(msg)
          .digest(),
      ) % L;
    const s = (r + k * ext.scalar) % L;
    const sig = Buffer.concat([Buffer.from(rBytes), le32(s)]);
    assert.ok(
      ed25519.verify(sig, msg, ext.pointBytes),
      "noble's cofactored verify accepts",
    );
    assert.equal(
      ruleOf(verifySignature(key(alice.pk), msg, sig.toString("hex"))),
      "ET-5",
    );
  });
});

describe("verification keys (ID-3, ET-4b, ET-4c)", () => {
  it("accepts an ordinary key", () => {
    assert.ok(decodeVerificationKey(alice.pk).ok);
  });

  it("rejects uppercase or short hex", () => {
    assert.equal(ruleOf(decodeVerificationKey(alice.pk.toUpperCase())), "ID-3");
    assert.equal(ruleOf(decodeVerificationKey(alice.pk.slice(2))), "ID-3");
  });

  it("rejects y >= p even with the sign bit set (ET-4b)", () => {
    assert.equal(
      ruleOf(decodeVerificationKey(le32(P).toString("hex"))),
      "ET-4b",
    );
    // y = 1 + p: the non-canonical identity of fixture 078.
    assert.equal(
      ruleOf(decodeVerificationKey(le32(P + 1n).toString("hex"))),
      "ET-4b",
    );
    const signed = le32(P + 1n);
    signed[31] = (signed[31] ?? 0) | 0x80;
    assert.equal(
      ruleOf(decodeVerificationKey(signed.toString("hex"))),
      "ET-4b",
    );
  });

  it("rejects the identity key, which isTorsionFree alone accepts (ET-4c)", () => {
    const identity = "01" + "00".repeat(31);
    assert.ok(ed25519.Point.fromHex(identity).isTorsionFree());
    assert.equal(ruleOf(decodeVerificationKey(identity)), "ET-4c");
  });

  it("rejects small-order and mixed-order keys (ET-4c)", () => {
    assert.equal(ruleOf(decodeVerificationKey(T8)), "ET-4c");
    const mixed = ed25519.Point.fromHex(alice.pk).add(
      ed25519.Point.fromHex(T8),
    );
    assert.equal(
      ruleOf(
        decodeVerificationKey(Buffer.from(mixed.toBytes()).toString("hex")),
      ),
      "ET-4c",
    );
  });

  it("rejects an encoding that is no curve point", () => {
    // y = 2 has no x on edwards25519.
    assert.equal(ruleOf(decodeVerificationKey("02" + "00".repeat(31))), "ET-5");
  });
});

describe("the golden vectors' keys and signatures", () => {
  const vectors = loadVectors();
  const line2Key = (id: string): string => {
    const v = vectors.find((x) => x.id.startsWith(id));
    assert.ok(v, id);
    const parsed = parseLine(vectorLines(v)[1] as Buffer);
    assert.ok(parsed.ok);
    return String(parsed.event.payload.pubkey);
  };

  it("refuses the registration keys of 078 (ET-4b), 081 and 082 (ET-4c)", () => {
    assert.equal(ruleOf(decodeVerificationKey(line2Key("078"))), "ET-4b");
    assert.equal(ruleOf(decodeVerificationKey(line2Key("081"))), "ET-4c");
    assert.equal(ruleOf(decodeVerificationKey(line2Key("082"))), "ET-4c");
  });

  it("verifies every signed event of every VALID vector over SIGN_PRE", () => {
    let checked = 0;
    for (const v of vectors.filter((x) => x.expect.verdict === "VALID")) {
      let genesis: Event | null = null;
      for (const line of vectorLines(v)) {
        const parsed = parseLine(line);
        assert.ok(parsed.ok, v.id);
        const e = parsed.event;
        if (e.type === "genesis") genesis = e;
        const signer =
          e.type === "participant_registered"
            ? e.payload.pubkey
            : e.type === "vote_cast"
              ? genesis?.payload.registrar_pk
              : genesis?.payload.operator_pk;
        const r = verifySignature(
          key(String(signer)),
          signingPreimage(e),
          String(e.payload.sig),
        );
        assert.ok(r.ok, `${v.id} seq ${e.seq}`);
        checked++;
      }
    }
    assert.ok(checked > 50, `checked ${checked}`);
  });
});
