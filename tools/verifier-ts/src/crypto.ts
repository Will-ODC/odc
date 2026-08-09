// Ed25519 canonical-encoding, prime-order, and verification primitives.
//
// event-types.md ET-4a/ET-4b/ET-4c and ET-5. The canonical-encoding checks run
// on the RAW decoded bytes BEFORE the verification primitive is ever called, so
// the RFC-8032 underdetermination of non-canonical inputs is unreachable (the
// point of ET-4a/ET-4b). ET-4c (prime-order subgroup) needs curve scalar
// multiplication that node:crypto lacks, so it — and ONLY it — uses the one
// audited third-party curve library, @noble/curves. Everything else, including
// the ET-5 verify primitive, is node:crypto.

import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";

const P = (1n << 255n) - 19n; // field prime 2^255 - 19
// order of the Ed25519 prime-order subgroup
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

// Interpret octets as an unsigned little-endian integer.
function leToBigInt(bytes: Buffer): bigint {
  let acc = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    acc = (acc << 8n) | BigInt(bytes[i] as number);
  }
  return acc;
}

/**
 * ET-4b: canonical verification-key encoding. The 32 decoded octets of A, with
 * bit 255 (top bit of octet 31) cleared, interpreted little-endian, MUST be < p.
 * Runs on the raw key octets before any verification.
 */
export function isCanonicalKeyEncoding(raw32: Buffer): boolean {
  if (raw32.length !== 32) return false;
  const masked = Buffer.from(raw32);
  masked[31] = (masked[31] as number) & 0x7f;
  return leToBigInt(masked) < P;
}

/**
 * ET-4a: canonical signature encoding. Given the 64 octets R||S:
 *   (i)  S (little-endian) strictly < L
 *   (ii) R with bit 255 cleared (little-endian) strictly < p
 * Both must hold on the raw decoded bytes.
 */
export function isCanonicalSigEncoding(raw64: Buffer): boolean {
  if (raw64.length !== 64) return false;
  const R = raw64.subarray(0, 32);
  const S = raw64.subarray(32, 64);
  const sOk = leToBigInt(S) < L;
  const maskedR = Buffer.from(R);
  maskedR[31] = (maskedR[31] as number) & 0x7f;
  const rOk = leToBigInt(maskedR) < P;
  return sOk && rOk;
}

/**
 * ET-4c: prime-order verification key. On the ALREADY-canonical key (ET-4b has
 * passed), the decoded point A MUST satisfy [L]A == 𝒪 AND A != 𝒪 — i.e. it lies
 * in the prime-order subgroup and is not the identity. The `A != 𝒪` clause is
 * load-bearing: @noble's isTorsionFree() returns true for the identity, which
 * ET-4c must reject (fixture 081). Rejects all small-order AND mixed-order keys.
 */
export function isPrimeOrderKey(raw32: Buffer): boolean {
  try {
    const point = ed25519.Point.fromBytes(Uint8Array.from(raw32));
    return point.isTorsionFree() && !point.is0();
  } catch {
    // A non-decodable point cannot be in the subgroup.
    return false;
  }
}

// SPKI DER prefix for a raw 32-byte Ed25519 public key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * ET-5: Ed25519 verification of `sig` over `message` under raw 32-byte key `key`.
 * The message is the raw signing preimage (HA-16), not pre-hashed.
 */
export function ed25519Verify(
  message: Buffer,
  sig64: Buffer,
  rawKey32: Buffer,
): boolean {
  try {
    const keyObj = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, rawKey32]),
      format: "der",
      type: "spki",
    });
    return nodeVerify(null, message, keyObj, sig64);
  } catch {
    return false;
  }
}
