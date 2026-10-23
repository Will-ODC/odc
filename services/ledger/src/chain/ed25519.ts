// Ed25519 verification exactly as event-types.md ET-4..ET-5 states it.
//
// The canonical-encoding checks (ET-4a, ET-4b) run on raw bytes before any
// curve code; the prime-order check (ET-4c) and the verification equation use
// @noble/curves point arithmetic only. The library's own `verify` is not used:
// it checks the cofactored equation, while v1 assumes the cofactorless one
// (ET-4b note, RFC 8032 §5.1.7), which is also the stricter of the two.

import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { HEX128, HEX64, type Refusal } from "./canonical.js";

/** Order of the prime-order subgroup (ET-4a). */
export const L = 2n ** 252n + 27742317777372353535851937790883648493n;
/** The field prime (ET-4a). */
export const P = 2n ** 255n - 19n;

type Point = ReturnType<typeof ed25519.Point.fromBytes>;

/** A verification key that has passed ET-4b and ET-4c. */
export interface VerificationKey {
  readonly hex: string;
  readonly bytes: Uint8Array;
  readonly point: Point;
}

export type KeyResult =
  | { readonly ok: true; readonly key: VerificationKey }
  | { readonly ok: false; readonly refusal: Refusal };

export type SigResult =
  { readonly ok: true } | { readonly ok: false; readonly refusal: Refusal };

function invalid(
  rule: string,
  reason: string,
): { ok: false; refusal: Refusal } {
  return { ok: false, refusal: { kind: "invalid", rule, reason } };
}

/** Unsigned little-endian integer of the octets. */
export function leInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--)
    n = (n << 8n) | BigInt(bytes[i] ?? 0);
  return n;
}

/** The point encoding with bit 255 cleared, as a little-endian integer < p? */
export function isCanonicalPointEncoding(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  const y = Uint8Array.from(bytes);
  y[31] = (y[31] ?? 0) & 0x7f;
  return leInt(y) < P;
}

/** ET-4c: [L]A == O and A != O. `isTorsionFree` alone accepts O (fixture 081). */
export function isPrimeOrder(point: Point): boolean {
  return point.isTorsionFree() && !point.is0();
}

/**
 * Decode a verification key: 64 lowercase hex (ID-3, ET-9b), then ET-4b on
 * the raw octets, then decoding to a curve point, then ET-4c.
 */
export function decodeVerificationKey(hex: string): KeyResult {
  if (!HEX64.test(hex)) return invalid("ID-3", "key is not 64 lowercase hex");
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  if (!isCanonicalPointEncoding(bytes)) {
    return invalid("ET-4b", "key is not a canonical point encoding");
  }
  let point: Point;
  try {
    point = ed25519.Point.fromBytes(bytes, false);
  } catch {
    // ET-4b/ET-4c define the decoding; an encoding that is canonical but no
    // curve point is labelled ET-5 here. The verdict and line are the same
    // either way: the event's signature cannot verify.
    return invalid("ET-5", "key does not decode to a curve point");
  }
  if (!isPrimeOrder(point)) {
    return invalid("ET-4c", "key is not in the prime-order subgroup");
  }
  return { ok: true, key: { hex, bytes, point } };
}

/**
 * ET-4 with ET-4a and ET-5: `sig` (128 lowercase hex, ES-31) must have a
 * canonical S and R, and must satisfy [S]B == R + [k]A with
 * k = SHA-512(R || A || M) mod L over the raw message (HA-16).
 */
export function verifySignature(
  key: VerificationKey,
  message: Uint8Array,
  sigHex: string,
): SigResult {
  if (!HEX128.test(sigHex))
    return invalid("ES-31", "sig is not 128 lowercase hex");
  const sig = Uint8Array.from(Buffer.from(sigHex, "hex"));
  const rBytes = sig.subarray(0, 32);
  const s = leInt(sig.subarray(32, 64));
  if (s >= L) return invalid("ET-4a", "sig S is not canonical (S >= L)");
  if (!isCanonicalPointEncoding(rBytes)) {
    return invalid("ET-4a", "sig R is not a canonical encoding");
  }
  let r: Point;
  try {
    r = ed25519.Point.fromBytes(rBytes, false);
  } catch {
    // Includes x = 0 with the sign bit set (RFC 8032 §5.1.3 rejects it; ET-4a
    // pins only y < p). Labelled ET-5, as for keys above: the verdict is the
    // same, since no such R can satisfy the equation.
    return invalid("ET-5", "sig R does not decode to a curve point");
  }
  const digest = createHash("sha512")
    .update(rBytes)
    .update(key.bytes)
    .update(message)
    .digest();
  const k = leInt(digest) % L;
  const lhs = ed25519.Point.BASE.multiplyUnsafe(s);
  const rhs = r.add(key.point.multiplyUnsafe(k));
  return lhs.equals(rhs)
    ? { ok: true }
    : invalid("ET-5", "sig does not verify");
}
