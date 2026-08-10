// Byte-exact preimage construction and SHA-256, per hashing.md (HA-1..HA-16).
//
// This is an explicit byte-string construction (never "canonicalize the JSON
// and hash it") and is generic over any flat integer/string payload: it never
// consults the event type (HA-7 / ADR-0006), so it hashes an unregistered type
// exactly as it hashes a v1 one.

import { createHash } from "node:crypto";
import type { ParsedEvent, PayloadEntry } from "./parse.js";

const DOMAIN = Buffer.from([0x4f, 0x44, 0x43, 0x31]); // "ODC1" (HA-10)

// HA-1: U64(n) — 8 octets, big-endian, unsigned. Every event integer is bounded
// to [0, 2^53-1] (ES-5), so BigInt conversion is exact.
function u64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

// HA-5: ENC_STR(s) = LP(UTF8(s)) = U64(len) || utf8-bytes. The string is the
// DECODED scalar value (HA-2); its UTF-8 octets are already computed by the
// parser. For envelope fields (type/ts/prev_hash) we UTF-8-encode here.
function encStrBytes(utf8: Buffer): Buffer {
  return Buffer.concat([u64(utf8.length), utf8]);
}

function encStr(s: string): Buffer {
  return encStrBytes(Buffer.from(s, "utf8"));
}

// HA-4: ENC_INT(n) = U64(n).
function encInt(n: number): Buffer {
  return u64(n);
}

// HA-7: ENC_PAYLOAD(P). Keys are taken in ascending UTF-8-byte order (HA-8).
// The stored line is already required to be in that order (EX-8, enforced by the
// parser), but we sort defensively so the preimage is correct regardless.
function encPayload(entries: PayloadEntry[], omitSig: boolean): Buffer {
  const kept = omitSig ? entries.filter((e) => e.key !== "sig") : entries;
  const sorted = [...kept].sort((a, b) =>
    Buffer.compare(a.keyBytes, b.keyBytes),
  );
  const parts: Buffer[] = [u64(sorted.length)];
  for (const e of sorted) {
    // 1-octet type tag: 0x69 'i' for integer, 0x73 's' for string (HA-7/HA-9).
    const tag = e.val.kind === "int" ? 0x69 : 0x73;
    parts.push(Buffer.from([tag]));
    parts.push(encStrBytes(e.keyBytes)); // ENC_STR(key)
    parts.push(
      e.val.kind === "int" ? encInt(e.val.value) : encStr(e.val.value),
    );
  }
  return Buffer.concat(parts);
}

// HA-11: the preimage. HA-12: prev_hash is ENC_STR of its 64 hex-ASCII chars.
function preimage(ev: ParsedEvent, omitSig: boolean): Buffer {
  return Buffer.concat([
    DOMAIN,
    encInt(ev.seq),
    encStr(ev.type),
    encInt(ev.version),
    encPayload(ev.payload, omitSig),
    encStr(ev.ts),
    encStr(ev.prevHash),
  ]);
}

// HA-13: hash = lowercase-hex SHA-256 of the hash preimage (sig included).
export function computeHash(ev: ParsedEvent): string {
  return createHash("sha256").update(preimage(ev, false)).digest("hex");
}

// HA-15/HA-16: the signing preimage is the hash preimage with the "sig" key
// removed from the payload. Ed25519 consumes these raw octets (not pre-hashed).
export function signingPreimage(ev: ParsedEvent): Buffer {
  return preimage(ev, true);
}
