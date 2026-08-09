// Strict canonical NDJSON-line parser for ODC events.
//
// Built from contracts/ alone: event-schema.md (ES-*), export-format.md (EX-*),
// hashing.md (HA-2, HA-6), event-types.md (ET-14 uses the decoded scalars this
// produces). This parser enforces the *single valid byte representation* an
// event line MUST have (EX-7..EX-10) directly on the raw bytes — it does NOT
// delegate to JSON.parse, which silently accepts duplicate keys, non-canonical
// numbers (1e2, 1.0), and loses key order, all of which the spec rejects (D5).
//
// A successful parse means every single-line Stage A check has passed:
//   - compact object, exactly the 7 envelope fields in fixed order (EX-7, ES-1/2)
//   - no null / absent field (ES-3)
//   - seq/version canonical integers in [0, 2^53-1] (ES-5, ES-12)
//   - type matches ^[a-z][a-z0-9_]*$ (ES-10)
//   - payload flat, values integer-or-string only (ES-15/16/17, EV-16),
//     keys strictly ascending by UTF-8 bytes, no duplicates (EX-8, HA-6)
//   - every string minimally + canonically escaped, valid UTF-8 (EX-9, HA-2)
//   - ts syntactically + calendrically valid (ES-20)
//   - prev_hash / hash are 64 lowercase hex (ES-23, ES-26)
//
// Any violation throws ParseFail; parseEventLine catches it and returns null,
// which the verifier renders as INVALID at that line. Cross-line checks
// (seq contiguity, prev_hash linkage, genesis position, hash recomputation) and
// all type semantics live in verify.ts.

export type PayloadValue =
  { kind: "int"; value: number } | { kind: "str"; value: string };

export interface PayloadEntry {
  key: string; // decoded scalar value of the key
  keyBytes: Buffer; // UTF-8 octets of the decoded key (HA-8 ordering)
  val: PayloadValue;
}

export interface ParsedEvent {
  seq: number;
  type: string;
  version: number;
  payload: PayloadEntry[]; // in stored (ascending) order
  ts: string;
  prevHash: string;
  hash: string;
}

const MAX_INT = 9007199254740991; // 2^53 - 1 (ES-5)

class ParseFail extends Error {}

// Reader over the raw line bytes. Never skips whitespace: the canonical form is
// compact (EX-7), so any space/tab/newline between tokens is a violation.
class Reader {
  constructor(
    private readonly b: Buffer,
    public pos = 0,
  ) {}

  atEnd(): boolean {
    return this.pos >= this.b.length;
  }

  peek(): number {
    if (this.pos >= this.b.length) throw new ParseFail("eof");
    // Buffer indexing is a number here; noUncheckedIndexedAccess widens it.
    return this.b[this.pos] as number;
  }

  next(): number {
    const c = this.peek();
    this.pos++;
    return c;
  }

  expect(byte: number): void {
    if (this.next() !== byte) throw new ParseFail("expected byte");
  }

  // The number token is pure ASCII (digits/sign/exponent), so latin1 is exact.
  slice(from: number, to: number): string {
    return this.b.subarray(from, to).toString("latin1");
  }
}

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isLowerHex = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66);

const HEX64 = /^[0-9a-f]{64}$/;
const TYPE_RE = /^[a-z][a-z0-9_]*$/;

// --- string parsing (EX-9 canonical escaping, HA-2 UTF-8) --------------------

function parseString(r: Reader): { value: string; bytes: Buffer } {
  r.expect(0x22); // opening quote
  const cps: number[] = [];
  for (;;) {
    const c = r.next();
    if (c === 0x22) break; // closing quote
    if (c === 0x5c) {
      // backslash escape
      const e = r.next();
      switch (e) {
        case 0x22: // \"
          cps.push(0x22);
          break;
        case 0x5c: // \\
          cps.push(0x5c);
          break;
        case 0x62: // \b
          cps.push(0x08);
          break;
        case 0x74: // \t
          cps.push(0x09);
          break;
        case 0x6e: // \n
          cps.push(0x0a);
          break;
        case 0x66: // \f
          cps.push(0x0c);
          break;
        case 0x72: // \r
          cps.push(0x0d);
          break;
        case 0x75: {
          // \u00xx — ONLY the C0 controls that lack a short escape, lowercase hex
          const h0 = r.next();
          const h1 = r.next();
          const h2 = r.next();
          const h3 = r.next();
          if (
            !isLowerHex(h0) ||
            !isLowerHex(h1) ||
            !isLowerHex(h2) ||
            !isLowerHex(h3)
          ) {
            throw new ParseFail("non-lowercase-hex \\u escape");
          }
          const v = parseInt(String.fromCharCode(h0, h1, h2, h3), 16);
          // Minimal escaping: \u is legal ONLY for U+0000..U+001F excluding the
          // five that MUST use a short escape (\b \t \n \f \r). Everything else
          // — including non-controls and U+007F+ — is literal, never \u (EX-9).
          const shortEscaped =
            v === 0x08 || v === 0x09 || v === 0x0a || v === 0x0c || v === 0x0d;
          if (v > 0x1f || shortEscaped) {
            throw new ParseFail("non-minimal \\u escape");
          }
          cps.push(v);
          break;
        }
        default:
          // Any other escape (\/ among them) is non-canonical (EX-9).
          throw new ParseFail("illegal escape");
      }
      continue;
    }
    if (c < 0x20) {
      // A raw control byte MUST have been escaped (EX-9).
      throw new ParseFail("raw control byte in string");
    }
    if (c < 0x80) {
      cps.push(c); // ASCII, incl. 0x7f which EX-9 leaves literal
      continue;
    }
    // Multi-byte UTF-8, decoded and validated (HA-2 rejects ill-formed UTF-8).
    let need: number;
    let cp: number;
    let min: number;
    if (c >= 0xc2 && c <= 0xdf) {
      need = 1;
      cp = c & 0x1f;
      min = 0x80;
    } else if (c >= 0xe0 && c <= 0xef) {
      need = 2;
      cp = c & 0x0f;
      min = 0x800;
    } else if (c >= 0xf0 && c <= 0xf4) {
      need = 3;
      cp = c & 0x07;
      min = 0x10000;
    } else {
      // 0x80..0xC1 (continuation or overlong lead) and 0xF5..0xFF are invalid.
      throw new ParseFail("invalid UTF-8 lead byte");
    }
    for (let i = 0; i < need; i++) {
      const cont = r.next();
      if (cont < 0x80 || cont > 0xbf) throw new ParseFail("bad continuation");
      cp = (cp << 6) | (cont & 0x3f);
    }
    if (cp < min) throw new ParseFail("overlong UTF-8");
    if (cp >= 0xd800 && cp <= 0xdfff) throw new ParseFail("surrogate in UTF-8");
    if (cp > 0x10ffff) throw new ParseFail("UTF-8 out of range");
    cps.push(cp);
  }
  const value = String.fromCodePoint(...cps);
  return { value, bytes: Buffer.from(value, "utf8") };
}

// --- number parsing (ES-5 canonical integer) ---------------------------------

const CANON_INT = /^(0|[1-9][0-9]*)$/;

function parseCanonicalInteger(r: Reader): number {
  const start = r.pos;
  // Collect the full JSON number token so a float/exponent/sign is recognised
  // and then rejected, rather than silently truncated at the '.'.
  while (!r.atEnd()) {
    const c = r.peek();
    if (
      isDigit(c) ||
      c === 0x2d || // -
      c === 0x2b || // +
      c === 0x2e || // .
      c === 0x65 || // e
      c === 0x45 // E
    ) {
      r.pos++;
    } else {
      break;
    }
  }
  const raw = r.slice(start, r.pos);
  if (!CANON_INT.test(raw)) throw new ParseFail("non-canonical integer");
  const big = BigInt(raw);
  if (big > BigInt(MAX_INT)) throw new ParseFail("integer out of range");
  return Number(big);
}

// --- ts calendar validation (ES-20) ------------------------------------------

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function validTimestamp(s: string): boolean {
  const m = TS_RE.exec(s);
  if (!m) return false; // syntactic gate
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const min = Number(m[5]);
  const sec = Number(m[6]);
  // Calendar gate: real UTC instant; leap seconds (60) rejected (ES-20).
  if (month < 1 || month > 12) return false;
  const dim = [
    31,
    isLeap(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  const maxDay = dim[month - 1] as number;
  if (day < 1 || day > maxDay) return false;
  if (hour > 23) return false;
  if (min > 59) return false;
  if (sec > 59) return false;
  return true;
}

// --- payload parsing (EX-8 ordering, HA-6 duplicates, ES-16/17 value types) ---

function parsePayload(r: Reader): PayloadEntry[] {
  r.expect(0x7b); // {
  const entries: PayloadEntry[] = [];
  if (r.peek() === 0x7d) {
    r.pos++; // empty payload {}
    return entries;
  }
  let prevKeyBytes: Buffer | null = null;
  for (;;) {
    const key = parseString(r);
    r.expect(0x3a); // :
    // Ordering + duplicate check on the raw decoded key bytes (HA-8 / EX-8).
    if (prevKeyBytes !== null) {
      const cmp = Buffer.compare(prevKeyBytes, key.bytes);
      if (cmp === 0) throw new ParseFail("duplicate payload key"); // HA-6
      if (cmp > 0) throw new ParseFail("payload keys not ascending"); // EX-8
    }
    prevKeyBytes = key.bytes;

    const c = r.peek();
    let val: PayloadValue;
    if (c === 0x22) {
      val = { kind: "str", value: parseString(r).value };
    } else if (isDigit(c) || c === 0x2d) {
      // A leading '-' is captured so negative / non-canonical forms are rejected
      // by parseCanonicalInteger rather than mis-parsed.
      val = { kind: "int", value: parseCanonicalInteger(r) };
    } else {
      // { [ t f n  → nested object/array, boolean, or null: all illegal in a
      // v1 payload (ES-16/ES-17). EV-16 makes this INVALID even on an
      // unregistered type, because such a value has no HA-7 encoding.
      throw new ParseFail("illegal payload value type");
    }
    entries.push({ key: key.value, keyBytes: key.bytes, val });

    const sep = r.next();
    if (sep === 0x7d) break; // }
    if (sep !== 0x2c) throw new ParseFail("expected , or }"); // ,
  }
  return entries;
}

// --- top-level event line ----------------------------------------------------

const ENVELOPE_ORDER = [
  "seq",
  "type",
  "version",
  "payload",
  "ts",
  "prev_hash",
  "hash",
] as const;

function parseEnvelopeKey(r: Reader, expected: string): void {
  const k = parseString(r);
  if (k.value !== expected) throw new ParseFail("wrong envelope key/order");
  r.expect(0x3a); // :
}

function parseEvent(r: Reader): ParsedEvent {
  r.expect(0x7b); // {

  // seq
  parseEnvelopeKey(r, ENVELOPE_ORDER[0]);
  const seq = parseCanonicalInteger(r);
  r.expect(0x2c);

  // type
  parseEnvelopeKey(r, ENVELOPE_ORDER[1]);
  const type = parseString(r).value;
  if (!TYPE_RE.test(type)) throw new ParseFail("malformed type (ES-10)");
  r.expect(0x2c);

  // version
  parseEnvelopeKey(r, ENVELOPE_ORDER[2]);
  const version = parseCanonicalInteger(r);
  if (version < 1) throw new ParseFail("version < 1 (ES-12)");
  r.expect(0x2c);

  // payload
  parseEnvelopeKey(r, ENVELOPE_ORDER[3]);
  const payload = parsePayload(r);
  r.expect(0x2c);

  // ts
  parseEnvelopeKey(r, ENVELOPE_ORDER[4]);
  const ts = parseString(r).value;
  if (!validTimestamp(ts)) throw new ParseFail("bad ts (ES-20)");
  r.expect(0x2c);

  // prev_hash
  parseEnvelopeKey(r, ENVELOPE_ORDER[5]);
  const prevHash = parseString(r).value;
  if (!HEX64.test(prevHash)) throw new ParseFail("bad prev_hash (ES-23)");
  r.expect(0x2c);

  // hash
  parseEnvelopeKey(r, ENVELOPE_ORDER[6]);
  const hash = parseString(r).value;
  if (!HEX64.test(hash)) throw new ParseFail("bad hash (ES-26)");

  r.expect(0x7d); // }
  if (!r.atEnd()) throw new ParseFail("trailing bytes after object");

  return { seq, type, version, payload, ts, prevHash, hash };
}

/**
 * Parse one raw NDJSON line (without its terminating LF) into a ParsedEvent, or
 * null if it violates any single-line Stage A / canonical-form rule. Returning
 * null (not throwing) lets the caller attribute INVALID to this line number.
 */
export function parseEventLine(lineBytes: Buffer): ParsedEvent | null {
  try {
    return parseEvent(new Reader(lineBytes));
  } catch (e) {
    if (e instanceof ParseFail) return null;
    // A non-ParseFail (e.g. String.fromCodePoint range) still means the line is
    // not a conforming event; treat as INVALID rather than crashing the tool.
    return null;
  }
}
