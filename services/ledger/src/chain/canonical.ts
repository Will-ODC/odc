// Canonical export line: strict parse and byte-exact serialization.
//
// Written from contracts/ alone: event-schema.md (ES-n), export-format.md
// (EX-n), hashing.md (HA-2, HA-6) and evolution.md (EV-23, EV-25). One event
// has exactly one valid line (EX-7..EX-10, D5); `parseLine` accepts that line
// and nothing else, and `serializeLine` produces it. Nothing here consults the
// type registry: everything in this file is Stage A (evolution.md EV-15).

export type PayloadValue = string | number;
export type Payload = Readonly<Record<string, PayloadValue>>;

/** An event without its `hash`: the six content fields of ES-27. */
export interface UnhashedEvent {
  readonly seq: number;
  readonly type: string;
  readonly version: number;
  readonly payload: Payload;
  readonly ts: string;
  readonly prev_hash: string;
}

/** The seven-field envelope of event-schema.md §1. */
export interface Event extends UnhashedEvent {
  readonly hash: string;
}

/** Why a line was refused. `rule` names the contract sentence (advisory). */
export interface Refusal {
  /** `unregistered`: well-formed but outside the v1 registry (would be PARTIAL);
   *  never produced here, the checker produces it for an unregistered
   *  (type, version). `cap`: beyond the EV-25 line cap. `invalid`: the rest. */
  readonly kind: "invalid" | "unregistered" | "cap";
  readonly rule: string;
  readonly reason: string;
}

export type ParseResult =
  | { readonly ok: true; readonly event: Event }
  | { readonly ok: false; readonly refusal: Refusal };

export const MAX_LINE_BYTES = 65536; // EV-25
export const MAX_LINE_DEPTH = 64; // EV-25
export const MAX_INT = Number.MAX_SAFE_INTEGER; // 2^53 - 1, ES-5
export const ZERO_HASH = "0".repeat(64); // ES-24
export const HEX64 = /^[0-9a-f]{64}$/;
export const HEX128 = /^[0-9a-f]{128}$/;
const TYPE_PATTERN = /^[a-z][a-z0-9_]*$/; // ES-10
const TS_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const CANONICAL_INT = /^(0|[1-9][0-9]*)$/;
const ENVELOPE = [
  "seq",
  "type",
  "version",
  "payload",
  "ts",
  "prev_hash",
  "hash",
] as const;

class LineError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(rule: string, reason: string): never {
  throw new LineError(rule, reason);
}

// ---------------------------------------------------------------- limits

/** EV-23's nesting-depth scan over raw line bytes. */
export function lineDepth(line: Uint8Array): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const b = line[i];
    if (inString) {
      if (b === 0x5c) i++;
      else if (b === 0x22) inString = false;
    } else if (b === 0x22) inString = true;
    else if (b === 0x7b || b === 0x5b) max = Math.max(max, ++depth);
    else if ((b === 0x7d || b === 0x5d) && depth > 0) depth--;
  }
  return max;
}

// ---------------------------------------------------------------- strings

/** True when `s` holds no unpaired UTF-16 surrogate (HA-2 well-formedness). */
export function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

const SHORT_ESCAPES: Readonly<Record<number, string>> = {
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
  0x22: '\\"',
  0x5c: "\\\\",
};

/** A JSON string literal with EX-9's minimal escaping. */
function quote(s: string): string {
  if (!isWellFormed(s)) throw new TypeError("string is not well-formed UTF-16");
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const short = SHORT_ESCAPES[c];
    if (short !== undefined) out += short;
    else if (c < 0x20) out += "\\u00" + c.toString(16).padStart(2, "0");
    else out += s[i];
  }
  return out + '"';
}

/** Ascending unsigned-byte order of the keys' UTF-8 (HA-8, EX-8). */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function sortedKeys(payload: Payload): string[] {
  return Object.keys(payload).sort(compareUtf8);
}

function assertInt(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new TypeError(`not a canonical integer value: ${n}`);
  }
}

// ---------------------------------------------------------------- serialize

/** The canonical line of an event (EX-7..EX-9), without its terminating LF. */
export function serializeLine(event: Event): Uint8Array {
  assertInt(event.seq);
  assertInt(event.version);
  const members = sortedKeys(event.payload).map((key) => {
    const value = event.payload[key];
    if (typeof value === "number") {
      assertInt(value);
      return `${quote(key)}:${value}`;
    }
    if (typeof value !== "string") throw new TypeError(`bad value at ${key}`);
    return `${quote(key)}:${quote(value)}`;
  });
  const text =
    `{"seq":${event.seq},"type":${quote(event.type)},` +
    `"version":${event.version},"payload":{${members.join(",")}},` +
    `"ts":${quote(event.ts)},"prev_hash":${quote(event.prev_hash)},` +
    `"hash":${quote(event.hash)}}`;
  return Buffer.from(text, "utf8");
}

// ---------------------------------------------------------------- timestamps

function daysFromCivil(y: number, m: number, d: number): number {
  // Proleptic Gregorian day count relative to 1970-01-01 (H. Hinnant).
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** ES-20 both gates: the syntactic pattern and a real UTC instant. */
export function isValidTs(ts: string): boolean {
  const m = TS_PATTERN.exec(ts);
  if (m === null) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return (
    mo >= 1 &&
    mo <= 12 &&
    d >= 1 &&
    d <= daysInMonth(y, mo) &&
    h <= 23 &&
    mi <= 59 &&
    s <= 59
  );
}

/** Milliseconds since the epoch of an ES-20-valid `ts` (ET-23's offset). */
export function tsToEpochMs(ts: string): number {
  const m = TS_PATTERN.exec(ts);
  if (m === null) throw new TypeError(`not an ES-20 ts: ${ts}`);
  const [y, mo, d, h, mi, s, ms] = m.slice(1, 8).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return (
    daysFromCivil(y, mo, d) * 86400000 + ((h * 60 + mi) * 60 + s) * 1000 + ms
  );
}

/** The ES-20 `ts` of an epoch-millisecond instant (years 0000-9999). */
export function epochMsToTs(ms: number): string {
  const days = Math.floor(ms / 86400000);
  let rem = ms - days * 86400000;
  // civil_from_days (H. Hinnant)
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  const h = Math.floor(rem / 3600000);
  rem -= h * 3600000;
  const mi = Math.floor(rem / 60000);
  rem -= mi * 60000;
  const s = Math.floor(rem / 1000);
  const p = (n: number, w: number): string => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(mo, 2)}-${p(d, 2)}T${p(h, 2)}:${p(mi, 2)}:${p(s, 2)}.${p(rem - s * 1000, 3)}Z`;
}

// ---------------------------------------------------------------- parse

type Json =
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "obj"; readonly members: ReadonlyArray<[string, Json]> };

/**
 * A JSON reader for exactly the shapes a canonical line can hold: objects to
 * depth 2, strings and canonical non-negative integers. It never skips
 * whitespace, so any insignificant byte fails here or in the final byte
 * comparison (EX-10). Arrays, booleans, null, floats and depth > 2 are
 * rejected outright (ES-3, ES-5, ES-16, ES-17, EV-16).
 */
class Reader {
  private i = 0;
  constructor(private readonly s: string) {}

  parseTop(): Json {
    if (this.s[0] !== "{") fail("EX-10", "line does not start with '{'");
    const value = this.object(1);
    if (this.i !== this.s.length) fail("EX-10", "bytes after the object");
    return value;
  }

  private value(depth: number): Json {
    const c = this.s[this.i];
    if (c === '"') return { kind: "str", value: this.string() };
    if (c === "{") {
      if (depth >= 2) fail("ES-17", "nested object");
      return this.object(depth + 1);
    }
    if (c === "[") fail("ES-16", "array value");
    if (c === "t" || c === "f") fail("ES-16", "boolean value");
    if (c === "n") fail("ES-3", "null value");
    if (c !== undefined && /[-0-9]/.test(c)) return this.number();
    return fail("EX-10", `unexpected character at offset ${this.i}`);
  }

  private object(depth: number): Json {
    this.i++; // '{'
    const members: [string, Json][] = [];
    if (this.s[this.i] === "}") {
      this.i++;
      return { kind: "obj", members };
    }
    for (;;) {
      if (this.s[this.i] !== '"') fail("EX-10", "expected a key");
      const key = this.string();
      if (this.s[this.i] !== ":") fail("EX-10", "expected ':'");
      this.i++;
      members.push([key, this.value(depth)]);
      const c = this.s[this.i++];
      if (c === "}") return { kind: "obj", members };
      if (c !== ",") fail("EX-10", "expected ',' or '}'");
    }
  }

  private string(): string {
    this.i++; // opening quote
    let out = "";
    for (;;) {
      const c = this.s.charCodeAt(this.i);
      if (Number.isNaN(c)) fail("EX-10", "unterminated string");
      if (c === 0x22) break;
      if (c < 0x20) fail("EX-9", "raw control character in a string");
      if (c !== 0x5c) {
        out += this.s[this.i++];
        continue;
      }
      const e = this.s[this.i + 1];
      const simple: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      if (e !== undefined && simple[e] !== undefined) {
        out += simple[e];
        this.i += 2;
      } else if (e === "u") {
        const hex = this.s.slice(this.i + 2, this.i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("EX-10", "bad \\u escape");
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 6;
      } else fail("EX-10", "bad escape");
    }
    this.i++; // closing quote
    if (!isWellFormed(out)) fail("HA-2", "string is not well-formed UTF-8");
    return out;
  }

  private number(): Json {
    const start = this.i;
    while (this.i < this.s.length && /[-+.eE0-9]/.test(this.s[this.i] ?? "")) {
      this.i++;
    }
    const token = this.s.slice(start, this.i);
    if (!CANONICAL_INT.test(token)) {
      fail("ES-5", `number ${token} is not a canonical integer`);
    }
    const value = Number(token);
    if (token.length > 16 || value > MAX_INT) {
      fail("ES-5", `integer ${token} exceeds 2^53 - 1`);
    }
    return { kind: "int", value };
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function toEvent(top: Json): Event {
  if (top.kind !== "obj") return fail("ES-1", "not an object");
  const fields = new Map<string, Json>();
  for (const [key, value] of top.members) {
    if (fields.has(key)) fail("EX-10", `duplicate envelope key ${key}`);
    if (!(ENVELOPE as readonly string[]).includes(key)) {
      fail("ES-2", `unknown top-level field ${key}`);
    }
    fields.set(key, value);
  }
  for (const key of ENVELOPE) {
    if (!fields.has(key)) fail("ES-1", `missing field ${key}`);
  }
  const int = (key: string): number => {
    const v = fields.get(key);
    return v?.kind === "int" ? v.value : fail("ES-5", `${key} not an integer`);
  };
  const str = (key: string, rule: string): string => {
    const v = fields.get(key);
    return v?.kind === "str" ? v.value : fail(rule, `${key} not a string`);
  };
  const seq = int("seq");
  const type = str("type", "ES-10");
  if (!TYPE_PATTERN.test(type)) fail("ES-10", "malformed type");
  const version = int("version");
  if (version < 1) fail("ES-12", "version below 1");
  const rawPayload = fields.get("payload");
  if (rawPayload?.kind !== "obj") return fail("ES-15", "payload not an object");
  const payload: Record<string, PayloadValue> = Object.create(null);
  for (const [key, value] of rawPayload.members) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      fail("HA-6", `duplicate payload key ${key}`);
    }
    if (value.kind === "obj") fail("ES-17", "nested payload value");
    payload[key] = value.value;
  }
  const ts = str("ts", "ES-20");
  if (!isValidTs(ts)) fail("ES-20", "ts is not a real millisecond UTC instant");
  const prev_hash = str("prev_hash", "ES-23");
  if (!HEX64.test(prev_hash)) fail("ES-23", "prev_hash not 64 lowercase hex");
  const hash = str("hash", "ES-26");
  if (!HEX64.test(hash)) fail("ES-26", "hash not 64 lowercase hex");
  return { seq, type, version, payload, ts, prev_hash, hash };
}

/**
 * Strictly parse one export line (its bytes without the terminating LF).
 * Accepts exactly the canonical serialization of a structurally valid event;
 * the hash, chain links and every type rule are the checker's business.
 */
export function parseLine(line: Uint8Array): ParseResult {
  if (line.length > MAX_LINE_BYTES) {
    return refuse("cap", "EV-25", `line is ${line.length} bytes`);
  }
  // `cap` is the EV-25 producer limit, never "maybe valid": past depth 2 the
  // line is INVALID anyway (EV-24), and it is refused either way.
  if (lineDepth(line) > MAX_LINE_DEPTH) {
    return refuse("cap", "EV-25", "line nested deeper than 64");
  }
  let text: string;
  try {
    text = decoder.decode(line);
  } catch {
    return refuse("invalid", "EX-2", "line is not well-formed UTF-8");
  }
  try {
    const event = toEvent(new Reader(text).parseTop());
    if (!Buffer.from(line).equals(serializeLine(event))) {
      fail("EX-10", "line is not the canonical serialization");
    }
    return { ok: true, event };
  } catch (err) {
    if (err instanceof LineError)
      return refuse("invalid", err.rule, err.message);
    throw err;
  }
}

function refuse(
  kind: Refusal["kind"],
  rule: string,
  reason: string,
): ParseResult {
  return { ok: false, refusal: { kind, rule, reason } };
}
