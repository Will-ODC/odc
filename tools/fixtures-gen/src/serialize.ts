// Canonical NDJSON serialization, implementing contracts/export-format.md §1–2.
//
// Deliberately hand-written rather than delegating to JSON.stringify: these
// bytes become frozen golden artifacts, so the escaping rule must be traceable
// to EX-9 sentence by sentence, not inherited from a runtime's incidental
// behavior. A test pins the two against each other so any divergence surfaces.

import type { Event, Payload, PayloadValue } from "./encode.js";
import { sortPayloadKeys } from "./encode.js";

/**
 * EX-9: minimal escaping. `\"` and `\\`; the short escapes for U+0008, U+0009,
 * U+000A, U+000C, U+000D; any other C0 control as `\u00xx` with LOWERCASE hex;
 * every other character — including every non-ASCII character and `/` — as its
 * literal UTF-8 bytes, never a `\u` escape.
 */
export function jsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    switch (ch) {
      case '"':
        out += '\\"';
        continue;
      case "\\":
        out += "\\\\";
        continue;
      case "\b":
        out += "\\b";
        continue;
      case "\t":
        out += "\\t";
        continue;
      case "\n":
        out += "\\n";
        continue;
      case "\f":
        out += "\\f";
        continue;
      case "\r":
        out += "\\r";
        continue;
      default:
        break;
    }
    if (c <= 0x1f) {
      out += `\\u${c.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out + '"';
}

/**
 * EX-8: canonical integer form — no leading zeros, no sign, no exponent, no
 * fractional part (ES-5). Within 0 … 2^53-1, `String` never produces exponent
 * notation, but the bounds are asserted rather than assumed.
 */
export function jsonInteger(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`integer out of ES-5 range: ${n}`);
  }
  return String(n);
}

function jsonValue(v: PayloadValue): string {
  return typeof v === "number" ? jsonInteger(v) : jsonString(v);
}

/** EX-8: payload keys in ascending UTF-8-byte order — the same order as HA-8. */
export function serializePayload(p: Payload): string {
  const keys = sortPayloadKeys(Object.keys(p));
  const entries = keys.map(
    (k) => `${jsonString(k)}:${jsonValue(p[k] as PayloadValue)}`,
  );
  return `{${entries.join(",")}}`;
}

/**
 * EX-7: one compact JSON object — no whitespace between tokens — with the seven
 * envelope fields in exactly this order.
 */
export function serializeEvent(e: Event): string {
  return (
    `{${jsonString("seq")}:${jsonInteger(e.seq)}` +
    `,${jsonString("type")}:${jsonString(e.type)}` +
    `,${jsonString("version")}:${jsonInteger(e.version)}` +
    `,${jsonString("payload")}:${serializePayload(e.payload)}` +
    `,${jsonString("ts")}:${jsonString(e.ts)}` +
    `,${jsonString("prev_hash")}:${jsonString(e.prev_hash)}` +
    `,${jsonString("hash")}:${jsonString(e.hash)}}`
  );
}

/**
 * EX-1/EX-3/EX-4: LF-separated and LF-terminated, so every line including the
 * last is followed by exactly one LF. EX-6: an empty chain is the zero-length
 * file, not a single LF.
 */
export function serializeExport(events: readonly Event[]): Buffer {
  if (events.length === 0) return Buffer.alloc(0);
  return Buffer.from(
    events.map((e) => `${serializeEvent(e)}\n`).join(""),
    "utf8",
  );
}

/** EX-14: the head is the last line's `hash`, or the 64-zero anchor if empty. */
export function head(events: readonly Event[]): string {
  const last = events[events.length - 1];
  return last ? last.hash : "0".repeat(64);
}
