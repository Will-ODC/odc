// Byte-exact preimage construction, implementing contracts/hashing.md.
//
// Every function below cites the normative sentence it implements. This file is
// the TypeScript half of the cross-language gate (odc-contracts): the Go
// verifier built in T7 must reach identical bytes from the spec text alone. If
// the two ever disagree, one of them is wrong — never "fix" a golden value to
// paper over it (odc-testing).

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

/** A payload value is an integer or a string, and nothing else (ES-16/ES-17). */
export type PayloadValue = number | string;
export type Payload = Record<string, PayloadValue>;

/** The six content fields the preimage covers (HA-11); `hash` is excluded. */
export interface EventContent {
  seq: number;
  type: string;
  version: number;
  payload: Payload;
  ts: string;
  prev_hash: string;
}

/** A complete seven-field event (ES-1). */
export interface Event extends EventContent {
  hash: string;
}

// --- §1 Primitive encoders -------------------------------------------------

/** HA-1: exactly 8 octets, big-endian, unsigned. */
export function U64(n: number): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `U64 requires an integer in 0 … 2^53-1 (ES-5), got ${n}`,
    );
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/**
 * HA-2: UTF-8 of the *decoded* string value. No BOM, and no Unicode
 * normalization of any form — the decoded scalar values are encoded exactly as
 * decoded. Node strings are already decoded scalar values, so this is a plain
 * UTF-8 encode; the rule matters for whoever parses the stored line.
 */
export function UTF8(s: string): Buffer {
  assertWellFormed(s, "HA-2");
  return Buffer.from(s, "utf8");
}

/**
 * The reject-don't-repair gate, shared by every path that turns a JS string into
 * octets: the hash preimage (HA-2) and the canonical line (EX-9/EX-10).
 *
 * `Buffer.from(s, "utf8")` does the opposite of what both rules require — it
 * replaces an unpaired surrogate with U+FFFD and returns successfully. That
 * collides distinct values onto identical octets: `"A\ud800B"`, `"A\udfffB"` and
 * the literal `"A�B"` all encode to `41 efbfbd 42`, which defeats HA-9's
 * guarantee on the preimage side and EX-10's "a mismatch is rejected, never
 * repaired" on the serialization side. It also puts this implementation at odds
 * with a Go verifier, which will reject rather than repair.
 *
 * A well-formed astral character (U+10000 and above) is a surrogate PAIR and
 * passes; only an unpaired half is rejected.
 */
export function assertWellFormed(s: string, rule: string): void {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        throw new RangeError(
          `ill-formed UTF-8: unpaired high surrogate at ${String(i)} (${rule})`,
        );
      }
      i += 1;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new RangeError(
        `ill-formed UTF-8: unpaired low surrogate at ${String(i)} (${rule})`,
      );
    }
  }
}

/** HA-3: length-prefixed octets, `U64(len) || x`. Never a delimiter. */
export function LP(x: Buffer): Buffer {
  return Buffer.concat([U64(x.length), x]);
}

/** HA-4: an integer field value. */
export const ENC_INT = (n: number): Buffer => U64(n);

/** HA-5: a string field value. */
export const ENC_STR = (s: string): Buffer => LP(UTF8(s));

/** HA-10: domain separation, ASCII `ODC1`. */
export const DOMAIN = Buffer.from([0x4f, 0x44, 0x43, 0x31]);

/** HA-7 type tags: `i` for integer values, `s` for string values (HA-9). */
const TAG_INT = 0x69;
const TAG_STR = 0x73;

// --- §2 Payload encoding (generic, per-type-agnostic) ----------------------

/**
 * HA-8: ascending lexicographic order of the keys' UTF-8 octet sequences,
 * compared as unsigned bytes. A shorter key that is a prefix of a longer one
 * sorts first — which is exactly what Buffer.compare does.
 */
export function sortPayloadKeys(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => Buffer.compare(UTF8(a), UTF8(b)));
}

/**
 * HA-6 note: a duplicate payload key is structurally unrepresentable in
 * `Record<string, PayloadValue>`, so HA-6's "MUST be rejected" cannot be
 * enforced here. It lands on the line parser / verifier — T7 must not assume
 * this module covers it.
 *
 * HA-7: `U64(k)` then, per key in HA-8 order, `tag || ENC_STR(key) || value`.
 * Never consults the event's `type` (ADR-0006) — the same code encodes the
 * payload of an event of any future type. An empty payload encodes as `U64(0)`
 * and nothing more (HA-8).
 */
export function ENC_PAYLOAD(p: Payload): Buffer {
  const keys = sortPayloadKeys(Object.keys(p));
  const parts: Buffer[] = [U64(keys.length)];
  for (const key of keys) {
    const value = p[key] as PayloadValue;
    if (typeof value === "number") {
      parts.push(Buffer.from([TAG_INT]), ENC_STR(key), ENC_INT(value));
    } else if (typeof value === "string") {
      parts.push(Buffer.from([TAG_STR]), ENC_STR(key), ENC_STR(value));
    } else {
      // ES-16: only integers and strings may appear in a v1 payload. Without
      // this the string branch is a catch-all, and Buffer.from accepts a byte
      // array — so {k: [104,105]} would encode identically to {k: "hi"}.
      throw new TypeError(
        `payload value for ${key} is neither integer nor string (ES-16)`,
      );
    }
  }
  return Buffer.concat(parts);
}

// --- §3 The preimage -------------------------------------------------------

/**
 * HA-11: DOMAIN then the six content fields in exactly this order. HA-12:
 * `prev_hash` (and every hex-string payload field) is encoded as its lowercase
 * hex *text* via ENC_STR, never as decoded bytes.
 */
export function preimage(e: EventContent): Buffer {
  return Buffer.concat([
    DOMAIN,
    ENC_INT(e.seq),
    ENC_STR(e.type),
    ENC_INT(e.version),
    ENC_PAYLOAD(e.payload),
    ENC_STR(e.ts),
    ENC_STR(e.prev_hash),
  ]);
}

/** HA-13: SHA-256 of the preimage as 64 lowercase hex characters. */
export function eventHash(e: EventContent): string {
  return createHash("sha256").update(preimage(e)).digest("hex");
}

// --- §5 The signing preimage ----------------------------------------------

/**
 * HA-15: PRE(E) computed over the event with the single payload key `sig`
 * removed — the count `k` is one lower and the `sig` entry absent; every other
 * field is byte-identical. HA-17: removing `sig` shifts no other key.
 */
export function signingPreimage(e: EventContent): Buffer {
  const payload: Payload = { ...e.payload };
  delete payload["sig"];
  return preimage({ ...e, payload });
}

// --- Ed25519 (D2) ----------------------------------------------------------

const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

export interface Keypair {
  /** 32-byte raw public key as 64 lowercase hex (ID-3). */
  publicKeyHex: string;
  privateKey: ReturnType<typeof createPrivateKey>;
}

/**
 * Deterministic keypair from a 32-octet RFC 8032 seed, so every fixture is
 * reproducible from the seed alone. Node has no raw-seed import, so the seed is
 * wrapped in the fixed Ed25519 PKCS#8 prefix.
 */
export function keypairFromSeed(seed: Buffer): Keypair {
  if (seed.length !== 32)
    throw new RangeError("Ed25519 seed must be 32 octets");
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(privateKey).export({ format: "jwk" });
  const publicKeyHex = Buffer.from(String(jwk.x), "base64url").toString("hex");
  if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) {
    // A missing jwk.x stringifies to "undefined" and base64url-decodes to
    // garbage rather than throwing. ID-3 requires the 32 raw bytes.
    throw new Error("Ed25519 public key export did not yield 32 bytes (ID-3)");
  }
  return { publicKeyHex, privateKey };
}

/** A seed of one repeated octet — how the spec's worked example names keys. */
export const seedOf = (octet: number): Buffer => Buffer.alloc(32, octet);

/**
 * HA-16: Ed25519 over the raw signing preimage, encoded as 128 lowercase hex.
 * The preimage is passed to Ed25519 as the message and is NOT pre-hashed with
 * SHA-256 — Ed25519 hashes its own input internally.
 */
export function signEvent(content: EventContent, key: Keypair): string {
  return sign(null, signingPreimage(content), key.privateKey).toString("hex");
}

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * A public KeyObject from 64 lowercase hex (ID-3), for verification. Node has no
 * raw-key import, so the 32 bytes are wrapped in the fixed Ed25519 SPKI prefix —
 * the mirror of `keypairFromSeed`'s PKCS#8 wrapping, placed beside it.
 *
 * This is the first copy of the SPKI prefix in `src/`, not the only one in the
 * package: `test/chain.test.ts` and `test/encode.test.ts` each hand-roll the
 * same DER wrapping. Those are DELIBERATELY left alone — both verify signatures
 * along a path independent of this file, and rewriting them to call this
 * function would make them agree with it by construction rather than confirm
 * it. Do not "deduplicate" them into this helper.
 *
 * Case is rejected, not repaired: ID-3 requires lowercase, and Node's hex
 * decoder would accept uppercase silently (D5).
 */
export function publicKeyFromHex(
  pubkeyHex: string,
): ReturnType<typeof createPublicKey> {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) {
    throw new RangeError(
      `not 64 lowercase hex characters (ID-3): ${pubkeyHex}`,
    );
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(pubkeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
}

/**
 * The inverse of `signEvent`: true when `sig` is a valid Ed25519 signature by
 * `pubkeyHex` over this event's signing preimage (HA-15/HA-16). `content` is
 * passed WITH its `sig` payload key present — `signingPreimage` removes it, so
 * caller and signer see the same bytes.
 *
 * Returns false for a malformed `sig`; throws for a malformed key, since a bad
 * key is a caller error while a bad signature is the thing being tested.
 *
 * The order is part of the contract, not an accident: the `sig` format is
 * checked FIRST, so a call with both malformed returns false rather than
 * throwing. Swapping the two checks changes that, which is why a test pins it.
 *
 * Note what this does NOT decide: whether a non-canonical `S`, a small-order
 * key, or the cofactored-vs-strict equation should verify. Node's Ed25519 makes
 * that choice for us, and whether it matches Go's is an open contracts question
 * (see `OPEN-QUESTIONS.md`) — do not read agreement here as the answer.
 */
export function verifyEvent(
  content: EventContent,
  pubkeyHex: string,
  sigHex: string,
): boolean {
  if (!/^[0-9a-f]{128}$/.test(sigHex)) return false;
  return verify(
    null,
    signingPreimage(content),
    publicKeyFromHex(pubkeyHex),
    Buffer.from(sigHex, "hex"),
  );
}

/**
 * ID-4/ID-5: sha256 of the 32 *decoded* key bytes, not of the hex text.
 *
 * The input is validated because Node's hex decoder truncates at the first
 * invalid character instead of erroring: participantId("zz") would otherwise
 * return sha256 of the empty string, and a malformed operator_pk would mint a
 * bogus but authentic-looking chain_id. Lowercase only — ID-2 says an uppercase
 * identifier "MUST be rejected; it is never lowercased to conform".
 */
export function participantId(pubkeyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) {
    throw new RangeError(
      `not 64 lowercase hex characters (ID-1, ID-2): ${pubkeyHex}`,
    );
  }
  const bytes = Buffer.from(pubkeyHex, "hex");
  if (bytes.length !== 32)
    throw new RangeError("hex did not decode to 32 bytes (ID-5)");
  return createHash("sha256").update(bytes).digest("hex");
}

/** ET-7: chain_id is the same derivation applied to `operator_pk`. */
export const chainId = participantId;
