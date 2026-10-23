// The explicit byte-string preimage of hashing.md, generic over any flat
// integer/string payload (HA-7): it never consults the event's type.

import { createHash } from "node:crypto";
import { isWellFormed, sortedKeys } from "./canonical.js";
import type { Payload, UnhashedEvent } from "./canonical.js";

const DOMAIN = Buffer.from([0x4f, 0x44, 0x43, 0x31]); // "ODC1", HA-10
const TAG_INT = 0x69; // 'i', HA-7
const TAG_STR = 0x73; // 's', HA-7

/** HA-1: exactly 8 octets, big-endian, unsigned. */
export function u64(n: number): Buffer {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`bad U64 ${n}`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(n));
  return out;
}

/** HA-5: ENC_STR(s) = U64(len) || UTF8(s), with no normalization (HA-2).
 *  Throws on a lone surrogate, which Buffer.from would turn into U+FFFD. */
function encStr(s: string): Buffer {
  if (!isWellFormed(s)) throw new TypeError("string is not well-formed UTF-16");
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([u64(bytes.length), bytes]);
}

/** HA-7: U64(k), then each key in UTF-8 byte order as tag || key || value. */
export function encodePayload(payload: Payload, omitSig = false): Buffer {
  const keys = sortedKeys(payload).filter((k) => !(omitSig && k === "sig"));
  const parts: Buffer[] = [u64(keys.length)];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number") {
      parts.push(Buffer.from([TAG_INT]), encStr(key), u64(value));
    } else if (typeof value === "string") {
      parts.push(Buffer.from([TAG_STR]), encStr(key), encStr(value));
    } else {
      throw new TypeError(`payload value at ${key} is not an int or string`);
    }
  }
  return Buffer.concat(parts);
}

function build(e: UnhashedEvent, omitSig: boolean): Buffer {
  return Buffer.concat([
    DOMAIN,
    u64(e.seq),
    encStr(e.type),
    u64(e.version),
    encodePayload(e.payload, omitSig),
    encStr(e.ts),
    encStr(e.prev_hash), // its 64 hex characters as text, HA-12
  ]);
}

/** PRE(E), HA-11. */
export function preimage(e: UnhashedEvent): Buffer {
  return build(e, false);
}

/** SIGN_PRE(E), HA-15: PRE(E) over the payload with the `sig` key removed. */
export function signingPreimage(e: UnhashedEvent): Buffer {
  return build(e, true);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** hash(E), HA-13: lowercase-hex SHA-256 of PRE(E). */
export function computeHash(e: UnhashedEvent): string {
  return sha256Hex(preimage(e));
}
