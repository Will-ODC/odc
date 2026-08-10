// INVALID vectors for the Ed25519 canonical-encoding predicate (event-types.md
// ET-4a / ET-4b, ADR-0009) and the prime-order subgroup requirement (ET-4c,
// ADR-0010).
//
// RFC 8032 leaves the verification predicate underdetermined for non-canonically
// encoded inputs. Rather than adjudicate a predicate, v1 makes the divergence
// UNREACHABLE by rejecting non-canonical encodings BEFORE the Ed25519 verify
// primitive is called (the same move ET-14a makes by capping choice_count):
//   ET-4a  canonical S (< L) and canonical R (masked, < p) of `sig`;
//   ET-4b  canonical verification key A (masked, < p);
//   ET-4c  A lies in the prime-order subgroup: [L]A == 𝒪 AND A != 𝒪.
//
// ET-4a/ET-4b (078-080): three vectors, each isolating ONE rule (T5j-style).
// Only 078 is DISCRIMINATING on today's libraries: it is the case where Go
// crypto/ed25519 (1.24.7) and Node node:crypto (v22 / OpenSSL 3) both PROCEED to
// verify a non-canonical key and both ACCEPT a degenerate self-signature, so a
// verifier lacking ET-4b wrongly reports VALID. 079/080 are NON-DISCRIMINATING:
// both libraries already reject a non-canonical S (S >= L) and a non-canonical R
// at the primitive, so a verifier lacking the explicit ET-4a check still returns
// INVALID — those vectors PIN the agreed verdict and guard against future drift.
//
// ET-4c (081-082): both DISCRIMINATING — the key is canonically encoded (ET-4a/
// ET-4b pass) and the self-signature VERIFIES in both libraries (ET-10 passes),
// so ONLY the new subgroup check rejects. 081 is a small-order key (the identity),
// 082 a mixed-order key A = P + T (T order-8 torsion); 082 additionally
// distinguishes a full prime-order check from a small-order-blocklist-only one,
// which a small-order key cannot. All verdicts confirmed empirically against both
// libraries (ADR-0009, ADR-0010); the T10 re-audit re-measures, since the result
// is version-bound.
//
// ET-9c (083): reuses 081's small-order key but on registrar_pk at GENESIS, to
// pin WHEN ET-4b/ET-4c apply to registrar_pk — at declaration, not deferred to
// first use at vote_cast (ADR-0011). See the block comment above that vector.

import { createHash } from "node:crypto";
import { ed25519, ED25519_TORSION_SUBGROUP } from "@noble/curves/ed25519.js";

import { bad, chain, headless, lines, type Vector } from "./shared.js";
import {
  chainId,
  keypairFromSeed,
  seedOf,
  signingPreimage,
  type EventContent,
  type Keypair,
} from "../encode.js";
import { OPERATOR } from "../chain.js";

// --- the two canonical bounds (event-types.md ET-4a/ET-4b) -----------------

/** L = 2^252 + 27742317777372353535851937790883648493 — the subgroup order. */
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

const leToBig = (b: Buffer): bigint => {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i -= 1)
    n = (n << 8n) | BigInt(b[i] as number);
  return n;
};

const bigToLe32 = (n: bigint): Buffer => {
  const b = Buffer.alloc(32);
  let x = n;
  for (let i = 0; i < 32; i += 1) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
};

// --- the non-canonical encodings -------------------------------------------

/**
 * The non-canonical encoding of the Edwards identity point (0, 1): y = 1 + p =
 * 2^255 - 18, little-endian, sign bit clear — `ee` `ff`x30 `7f`. It is 64
 * lowercase hex (so ES-31/ID-3/ET-9b hex-format passes) but decodes to a
 * y-coordinate >= p, so ET-4a(ii)/ET-4b reject it. Reused as both the bad key A
 * (078) and the bad R (080).
 */
const NONCANONICAL_POINT = `ee${"ff".repeat(30)}7f`;

/**
 * A degenerate Ed25519 signature: R = the CANONICAL identity encoding
 * (`01` `00`x31, value 1 < p) and S = 0 (< L). Both halves are canonically
 * encoded, so ET-4a passes; and under the identity key the cofactorless
 * predicate [S]B = R + [k]A collapses to identity == identity for ANY message,
 * so it VERIFIES (measured true in both libraries). ET-10's self-signature check
 * therefore PASSES — leaving ET-4b as the sole fault in 078.
 */
const DEGENERATE_SIG = `01${"00".repeat(31)}${"00".repeat(32)}`;

/** The self-signing participant key for the S/R vectors (deterministic seed). */
const SR_SIGNER: Keypair = keypairFromSeed(seedOf(0x07));

/** ET-4a(i): replace S with S + L (still 32 bytes, sign bit clear), keep R. */
const bumpSByL = (sigHex: string): string => {
  const sig = Buffer.from(sigHex, "hex");
  const sPlus = leToBig(sig.subarray(32, 64)) + L;
  if (sPlus >= 1n << 255n) throw new Error("S+L set bit 255; pick another S");
  return Buffer.concat([sig.subarray(0, 32), bigToLe32(sPlus)]).toString("hex");
};

/** ET-4a(ii): replace R with a non-canonical encoding (y >= p), keep S. */
const badR = (sigHex: string): string =>
  NONCANONICAL_POINT +
  Buffer.from(sigHex, "hex").subarray(32, 64).toString("hex");

const participant078 = lines(
  chain((c) =>
    c.custom(
      "participant_registered",
      1,
      { pubkey: NONCANONICAL_POINT, sig: DEGENERATE_SIG },
      {},
    ),
  ),
);

const participant079 = lines(
  chain((c) =>
    c.custom(
      "participant_registered",
      1,
      { pubkey: SR_SIGNER.publicKeyHex },
      { signer: SR_SIGNER, sigTransform: bumpSByL },
    ),
  ),
);

const participant080 = lines(
  chain((c) =>
    c.custom(
      "participant_registered",
      1,
      { pubkey: SR_SIGNER.publicKeyHex },
      { signer: SR_SIGNER, sigTransform: badR },
    ),
  ),
);

// --- ET-4c: small-order and mixed-order keys (ADR-0010) --------------------

/**
 * The CANONICAL identity-point encoding (0, 1): y = 1, little-endian, sign bit
 * clear — `01` `00`x31. Unlike 078's NONCANONICAL_POINT (y = 1 + p), this decodes
 * to y = 1 < p, so it PASSES ET-4a(ii)/ET-4b and ID-3. It is the order-1 point,
 * so ET-4c rejects it: [L]A == 𝒪 holds, but the non-identity clause A != 𝒪 fails
 * (this is exactly the identity case where noble's isTorsionFree() returns true).
 * Reused with the same DEGENERATE_SIG as 078 — measured to verify in both
 * libraries under the identity key, so ET-10 passes and ET-4c is the sole fault.
 */
const CANONICAL_IDENTITY = `01${"00".repeat(31)}`;

const Point = ed25519.Point;
/** L = the order of the prime-order subgroup (same value as the constant above). */
const CURVE_ORDER = Point.CURVE().n;

const sha512 = (...parts: Buffer[]): Buffer =>
  createHash("sha512").update(Buffer.concat(parts)).digest();

/**
 * A fixed non-zero secret scalar mod L, from a published seed. Deterministic so a
 * regenerate is byte-identical (odc-testing: the tree MUST regenerate diff-free).
 * TEST MATERIAL — the seed is in this file, so anyone can reproduce it.
 */
const MIXED_SCALAR =
  (leToBig(
    createHash("sha512")
      .update(Buffer.from("odc-082-s"))
      .digest()
      .subarray(0, 32),
  ) %
    (CURVE_ORDER - 1n)) +
  1n;

/**
 * A = [s]B + T, with T = ED25519_TORSION_SUBGROUP[1] (verified order 8). A is
 * canonically encoded (ET-4a/ET-4b and ID-3 all pass) but MIXED-order (order 8L):
 * [L]A = [L]T = [5]T != 𝒪 (because L ≡ 5 (mod 8)) and [8]A = [8]P != 𝒪, so ET-4c
 * rejects it — and does so for a key that is neither prime-order NOR one of the
 * eight small-order points, which is what makes it discriminate a full prime-order
 * check from a small-order blocklist.
 */
const MIXED_POINT = Point.BASE.multiply(MIXED_SCALAR).add(
  Point.fromHex(ED25519_TORSION_SUBGROUP[1] as string),
);
const MIXED_KEY = Buffer.from(MIXED_POINT.toBytes());
const MIXED_KEY_HEX = MIXED_KEY.toString("hex");

/**
 * Self-signs the mixed-order-key event honestly under its prime-order part
 * P = [s]B, grinding a DETERMINISTIC nonce until the challenge k ≡ 0 (mod 8).
 * Then [k]T = 𝒪 (T has order 8), so the honest-under-P verification equation
 * [S]B = R + [k]P equals R + [k]A and the signature VERIFIES under A. Measured
 * true in both Go crypto/ed25519 and Node node:crypto, so ET-10 passes and ET-4c
 * is the sole fault. The nonce comes from a fixed seed + counter, so the grind is
 * reproducible and the golden bytes are stable across regenerates.
 */
const mixedOrderSelfSig = (content: EventContent): string => {
  const m = signingPreimage(content);
  const nonceSeed = Buffer.from("odc-082-nonce");
  for (let counter = 0; counter < 1_000_000; counter += 1) {
    const r =
      (leToBig(sha512(nonceSeed, bigToLe32(BigInt(counter)))) %
        (CURVE_ORDER - 1n)) +
      1n;
    const rEnc = Buffer.from(Point.BASE.multiply(r).toBytes());
    const k = leToBig(sha512(rEnc, MIXED_KEY, m)) % CURVE_ORDER;
    if (k % 8n === 0n && k !== 0n) {
      const s = (r + k * MIXED_SCALAR) % CURVE_ORDER;
      return Buffer.concat([rEnc, bigToLe32(s)]).toString("hex");
    }
  }
  throw new Error("082: no nonce with k ≡ 0 (mod 8) found within bound");
};

const participant081 = lines(
  chain((c) =>
    c.custom(
      "participant_registered",
      1,
      { pubkey: CANONICAL_IDENTITY, sig: DEGENERATE_SIG },
      {},
    ),
  ),
);

const participant082 = lines(
  chain((c) =>
    c.custom(
      "participant_registered",
      1,
      { pubkey: MIXED_KEY_HEX },
      { signRaw: mixedOrderSelfSig },
    ),
  ),
);

// --- ET-4c/ET-9c: registrar_pk validation TIMING at genesis (ADR-0011) -------
//
// 078-082 all place the bad key on participant_registered.pubkey at line 2 —
// where the key is DECLARED and USED to verify on the same line, because that
// event is self-signed (ET-10). So they cannot distinguish "check the key at
// declaration" from "check it at first use". registrar_pk is the one key where
// the two differ: it is declared at genesis (ET-9a) but not used to verify until
// the first vote_cast (ET-17), and genesis is operator-self-signed (ET-8), so a
// chain with no vote_cast never exercises registrar_pk. 083 is that chain — a
// well-formed genesis whose registrar_pk is the canonical identity encoding
// (small-order). ET-9c pins the checks to the declaration line, so the verdict
// is INVALID at line 1; a verifier that deferred ET-4b/ET-4c on registrar_pk to
// first use would report VALID. This is the sole divergence the T7 review found.
const genesis083 = lines(
  headless((c) =>
    c.custom(
      "genesis",
      1,
      {
        chain_id: chainId(OPERATOR.publicKeyHex),
        contracts: "contracts-v1",
        operator_pk: OPERATOR.publicKeyHex,
        registrar_pk: CANONICAL_IDENTITY,
      },
      { signer: OPERATOR },
    ),
  ),
);

export const canonicalEd25519Vectors: Vector[] = [
  bad(
    "078-noncanonical-a",
    participant078,
    2,
    ["ET-4b"],
    "DISCRIMINATING. A participant_registered whose pubkey is the non-canonical identity-point encoding y = 1 + p (ee ff*30 7f) — 64 lowercase hex, so ES-31/ID-3 hex-format passes — self-signed with the degenerate sig R = canonical identity (0100..00), S = 0. Measured in BOTH Go 1.24.7 and Node 22/OpenSSL 3: the non-canonical key is accepted by the decoder and the degenerate signature VERIFIES under it (identity math makes [S]B = R + [k]A collapse to identity == identity for any message), so ET-10 (self-sig verifies) PASSES, participant_id still derives, and the line hashes and links. The ONLY failing rule is the new canonical-A check ET-4b. A verifier lacking ET-4b proceeds to verify, the degenerate sig passes, and it wrongly reports VALID.",
  ),
  bad(
    "079-noncanonical-s",
    participant079,
    2,
    ["ET-4a"],
    "NON-DISCRIMINATING (pins the verdict). A valid self-signed participant_registered whose sig S has been replaced by S + L — still 64 bytes, sign bit clear, and ES-31 128-hex — with the hash RECOMPUTED over the mutated sig so the vector fails for the encoding alone and not for a stale digest (HA-14) or a bad chain link. S >= L violates the canonical-S check ET-4a(i). On current libraries this is non-discriminating: both Go and Node already reject S >= L inside the verify primitive, so a verifier lacking the explicit ET-4a check still returns INVALID via ET-10. The vector pins the agreed verdict and guards against future drift; R and the key A are both canonical, so ET-4a(i) is the sole fault.",
  ),
  bad(
    "080-noncanonical-r",
    participant080,
    2,
    ["ET-4a"],
    "NON-DISCRIMINATING (pins the verdict). A valid self-signed participant_registered whose sig R has been replaced by a non-canonical point encoding (y = 1 + p >= p, ee ff*30 7f), S left canonical, with the hash RECOMPUTED over the mutated sig to isolate the fault (not a stale digest, not a broken link). The masked R value >= p violates the canonical-R check ET-4a(ii). Non-discriminating on current libraries: both Go and Node reject a non-canonical R at point decode inside the primitive, so a verifier lacking the explicit ET-4a check still returns INVALID via ET-10. The key A and S are both canonical, so ET-4a(ii) is the sole fault.",
  ),
  bad(
    "081-smallorder-key",
    participant081,
    2,
    ["ET-4c"],
    "DISCRIMINATING. A participant_registered whose pubkey is the CANONICAL identity-point encoding (0100..00, y = 1 < p — so ET-4a(ii)/ET-4b and ID-3 all PASS, unlike 078's non-canonical y = 1 + p) — a small-order key (order 1). Self-signed with the degenerate identity sig R = 0100..00, S = 0, whose S and R are both canonical (ET-4a passes) and which VERIFIES under the identity key in BOTH Go 1.24.7 and Node 22/OpenSSL 3 (identity math collapses [S]B = R + [k]A to identity == identity for any message), so ET-10 passes, participant_id derives, and the line hashes and links. The ONLY failing rule is the new prime-order check ET-4c: [L]A == 𝒪 holds but the non-identity clause A != 𝒪 fails. This is precisely the case where noble's isTorsionFree() returns TRUE, so a subgroup check written as isTorsionFree() alone wrongly ACCEPTS it — the A != 𝒪 clause is load-bearing.",
  ),
  bad(
    "082-mixedorder-key",
    participant082,
    2,
    ["ET-4c"],
    "DISCRIMINATING, and sharper than 081. A participant_registered whose pubkey is a canonically-encoded MIXED-order key A = P + T, where P = [s]B is prime-order and T is an order-8 torsion point (ED25519_TORSION_SUBGROUP[1]); A has order 8L, is not small-order, and is not one of the eight small-order points. It is self-signed honestly under P with the nonce ground so the challenge k ≡ 0 (mod 8): then [k]T = 𝒪, so [S]B = R + [k]P = R + [k]A and the signature VERIFIES under A — measured true in BOTH Go crypto/ed25519 and Node node:crypto, so ET-10 passes; the key is canonical (ET-4a/ET-4b pass), 64 lowercase hex (ID-3 passes), and the line hashes and links. ET-4c is the sole fault: [L]A = [5]T != 𝒪 (L ≡ 5 mod 8) and [8]A = [8]P != 𝒪. Because A is neither prime-order nor small-order, this vector distinguishes a FULL prime-order check from a small-order-blocklist-only verifier, which 081 cannot.",
  ),
  bad(
    "083-genesis-registrar-pk-smallorder",
    genesis083,
    1,
    ["ET-4c", "ET-9c"],
    "DISCRIMINATING on the registrar_pk validation TIMING (ET-9c, ADR-0011). A genesis whose registrar_pk is the CANONICAL identity-point encoding (0100..00, y = 1 < p) — the same small-order key 081 puts on a participant pubkey, so ET-9b hex-format, ET-4a(ii)/ET-4b and ID-3 all PASS. Genesis is operator-self-signed under the real operator_pk (ET-8), so chain_id derives (ET-7), the self-signature verifies, and the hash covers the small-order registrar_pk and matches: the genesis is well-formed in every respect EXCEPT that registrar_pk is not prime-order (ET-4c). registrar_pk is DECLARED here (ET-9a) but not USED to verify until the first vote_cast (ET-17), and this chain has none — so a verifier that defers ET-4b/ET-4c on registrar_pk to first use reports VALID, while ET-9c requires the checks at the genesis line where the key is declared, giving INVALID at line 1. This is the single point where two otherwise-conforming verifiers diverged (found by the fresh-context T7 review; ADR-0011): 078-082 are all on participant_registered.pubkey at line 2, where declaration and use coincide because that event is self-signed, so none of them pins this timing. As in 081, the ET-4c fault is the non-identity clause A != 𝒪.",
  ),
];
