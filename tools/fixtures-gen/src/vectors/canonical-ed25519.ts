// INVALID vectors for the Ed25519 canonical-encoding predicate (event-types.md
// ET-4a / ET-4b), decided in ADR-0009.
//
// RFC 8032 leaves the verification predicate underdetermined for non-canonically
// encoded inputs. Rather than adjudicate a predicate, v1 makes the divergence
// UNREACHABLE by rejecting non-canonical encodings BEFORE the Ed25519 verify
// primitive is called (the same move ET-14a makes by capping choice_count):
//   ET-4a  canonical S (< L) and canonical R (masked, < p) of `sig`;
//   ET-4b  canonical verification key A (masked, < p).
//
// Three vectors, each isolating ONE rule (T5j-style). Only 078 is DISCRIMINATING
// on today's libraries: it is the case where Go crypto/ed25519 (1.24.7) and Node
// node:crypto (v22 / OpenSSL 3) both PROCEED to verify a non-canonical key and
// both ACCEPT a degenerate self-signature, so a verifier lacking ET-4b wrongly
// reports VALID. 079/080 are NON-DISCRIMINATING: both libraries already reject a
// non-canonical S (S >= L) and a non-canonical R at the primitive, so a verifier
// lacking the explicit ET-4a check still returns INVALID — those vectors PIN the
// agreed verdict and guard against future library drift. All three verdicts were
// confirmed empirically against both libraries (ADR-0009); the T10 re-audit
// re-measures, since the result is version-bound.

import { bad, chain, lines, type Vector } from "./shared.js";
import { keypairFromSeed, seedOf, type Keypair } from "../encode.js";

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
];
