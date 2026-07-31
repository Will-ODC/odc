// The rehearsal tamper tool (Phase 0 T6c). Applies one case of the
// `odc-contracts` tamper matrix to a rehearsal export, deterministically from a
// seed — so a T8 disagreement is reproducible from `(export, case, seed)` and
// not from an attached file. The byte-level mutators are
// `@odc/fixtures-gen/tamper`'s, unchanged: this module chooses WHICH line each
// attack lands on, never how the bytes are cut. Every case leaves exactly ONE
// defect, which is why `head` is computed per case (see `mutate`). No verifier
// lives here and none is coming in T6: the declared `line` is what the contract
// says a verifier MUST report, not what one was observed to report.

import type { Event } from "@odc/fixtures-gen/encode";
import {
  jsonInteger,
  jsonString,
  serializePayload,
} from "@odc/fixtures-gen/serialize";
import {
  deleteLine,
  duplicateLine,
  editLine,
  flipHashChar,
  flipPrevHashChar,
  frame,
  swapLines,
  truncate,
} from "@odc/fixtures-gen/tamper";

import { Rng } from "./rng.js";

/** The eight cases of the tamper matrix, as selector flags. */
export const TAMPER_CASES = [
  "byte-flip",
  "line-deletion",
  "line-reordering",
  "truncation",
  "duplicated-seq",
  "wrong-prev-hash",
  "reserialized-line",
  "wrong-head",
] as const;

export type TamperCase = (typeof TAMPER_CASES)[number];

export function isTamperCase(s: string): s is TamperCase {
  return (TAMPER_CASES as readonly string[]).includes(s);
}

/** EX-7: the seven envelope fields, in the order a canonical line carries. */
export const ENVELOPE_KEYS: readonly string[] =
  "seq type version payload ts prev_hash hash".split(" ");

export const MIN_EXPORT_LINES = 2;

/** What the tool tampers with. A `RehearsalChain` satisfies this structurally. */
export interface TamperTarget {
  readonly ndjson: Buffer;
  readonly head: string;
}

export interface TamperResult {
  readonly case: TamperCase;
  readonly seed: number;
  /** Tampered bytes. Byte-identical to the input for `wrong-head` only. */
  readonly ndjson: Buffer;
  /** The `--head` to pass. Wrong on purpose for `wrong-head`/`truncation`. */
  readonly head: string;
  /** EV-17: the 1-based line a verifier must attribute the failure to. */
  readonly line: number;
}

/** Splits export bytes into lines, rejecting non-canonical framing: a stray CR
 * or missing final LF rides along as a second defect and, being a framing
 * violation, masks the one this tool declares at line N. */
export function exportLines(ndjson: Buffer): string[] {
  const text = ndjson.toString("utf8");
  if (text.length === 0) throw new RangeError("empty export (EX-6)");
  if (!text.endsWith("\n")) throw new RangeError("no final LF (EX-4)");
  if (text.includes("\r")) throw new RangeError("export has a CR (EX-3)");
  const lines = text.slice(0, -1).split("\n");
  if (lines.includes("")) throw new RangeError("blank line (EX-5)");
  return lines;
}

/** EX-14 off the bytes: the `hash` the last line stores, whatever it hashes to. */
function headOfLines(lines: readonly string[]): string {
  const last = lines[lines.length - 1];
  const m = last === undefined ? null : /"hash":"([0-9a-f]{64})"\}$/.exec(last);
  if (m === null) throw new Error("last line has no trailing hash (EX-14)");
  return m[1] as string;
}

function flipHead(h: string): string {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new RangeError(`bad head: ${h}`);
  return (h[0] === "0" ? "1" : "0") + h.slice(1);
}

/** The canonical line cut into its seven `"key":value` segments — rebuilt with
 * `serialize.ts`'s own encoders, then checked against the original bytes rather
 * than split by scanning, since a payload object and an escaped title both hold
 * commas and braces. That equality check is what makes this safe: without it a
 * drift from `serializeEvent` would reserialize the line some other way. */
function canonicalSegments(line: string, lineNumber: number): string[] {
  const e = JSON.parse(line) as Event;
  const segs = [
    `"seq":${jsonInteger(e.seq)}`,
    `"type":${jsonString(e.type)}`,
    `"version":${jsonInteger(e.version)}`,
    `"payload":${serializePayload(e.payload)}`,
    `"ts":${jsonString(e.ts)}`,
    `"prev_hash":${jsonString(e.prev_hash)}`,
    `"hash":${jsonString(e.hash)}`,
  ];
  ENVELOPE_KEYS.forEach((k, i) => {
    if (!(segs[i] as string).startsWith(`"${k}":`)) throw new Error(`seg ${k}`);
  });
  if (`{${segs.join(",")}}` !== line) {
    throw new Error(`line ${String(lineNumber)} is not canonical (EX-7)`);
  }
  return segs;
}

/** Transposes envelope keys `k` and `k+1` on one line (tamper matrix:
 * re-serialized but value-equivalent). The line still parses to the same event
 * and its hash still verifies — HA-11 commits to values, not key order — so
 * only EX-7/EX-10's byte-exact reading rejects it. Programmatic rather than
 * vector 049's hardcoded key pair, since rehearsal lines vary by type. */
export function swapEnvelopeKeys(
  lines: readonly string[],
  lineNumber: number,
  k: number,
): string[] {
  const line = lines[lineNumber - 1];
  if (line === undefined) throw new RangeError(`no line ${String(lineNumber)}`);
  const max = ENVELOPE_KEYS.length - 2;
  if (!Number.isInteger(k) || k < 0 || k > max) {
    throw new RangeError(`key index must be 0…${String(max)}: ${String(k)}`);
  }
  const segs = canonicalSegments(line, lineNumber);
  const a = segs[k] as string;
  const b = segs[k + 1] as string;
  const out = editLine(lines, lineNumber, `${a},${b}`, `${b},${a}`);
  // `editLine` throws only when its target is ABSENT, so a replacement equal to
  // the original is silent (the T5g defect). Distinct keys make that
  // impossible; assert rather than argue.
  if (out[lineNumber - 1] === line) throw new Error("key swap was a no-op");
  return out;
}

type Mutation = Pick<TamperResult, "head" | "line"> & {
  lines: readonly string[];
};

function mutate(
  kase: TamperCase,
  lines: readonly string[],
  rng: Rng,
  trueHead: string,
): Mutation {
  const n = lines.length;
  // Where the last line's stored `hash` stays reachable the head is read back off
  // the tampered bytes, so `--head` agrees with the file and the mutation is the
  // only defect.
  const own = (out: readonly string[], line: number): Mutation => ({
    lines: out,
    head: headOfLines(out),
    line,
  });
  switch (kase) {
    case "byte-flip": {
      const at = rng.intBetween(1, n);
      return own(flipHashChar(lines, at), at);
    }
    case "line-deletion": {
      // Fixture 040/EX-17 drops an interior line, not a boundary.
      if (n < 3) throw new RangeError("line-deletion needs 3+ lines");
      const at = rng.intBetween(2, n - 1);
      return own(deleteLine(lines, at), at);
    }
    case "line-reordering": {
      // Fixture 041/EX-17 swaps two interior lines, not boundaries.
      if (n < 4) throw new RangeError("line-reordering needs 4+ lines");
      const a = rng.intBetween(2, n - 2);
      const b = rng.intBetween(a + 1, n - 1);
      return own(swapLines(lines, a, b), a);
    }
    case "truncation": {
      // The TRUE head is the whole point: a truncated prefix is internally
      // consistent, so only the head it never reaches detects it (EX-15/EX-16),
      // attributed to the last line present (EX-19).
      const keep = rng.intBetween(1, n - 1);
      return { lines: truncate(lines, keep), head: trueHead, line: keep };
    }
    case "duplicated-seq": {
      // The copy lands at `at + 1`: it repeats a `seq` (ES-7) and its
      // `prev_hash` names the line before the one it now follows.
      const at = rng.intBetween(1, n);
      return own(duplicateLine(lines, at), at + 1);
    }
    case "wrong-prev-hash": {
      const at = rng.intBetween(2, n);
      return own(flipPrevHashChar(lines, at), at);
    }
    case "reserialized-line": {
      const at = rng.intBetween(1, n);
      const k = rng.int(ENVELOPE_KEYS.length - 1);
      // Values all survive, so the head is unchanged — and reading it back
      // would fail whenever `k` moves `hash` off the end of the line.
      const out = swapEnvelopeKeys(lines, at, k);
      return { lines: out, head: trueHead, line: at };
    }
    case "wrong-head": {
      // Not a byte mutation (vector 054's shape): the export is untouched and
      // the HEAD is wrong. EX-19 attributes that to the last line.
      return { lines, head: flipHead(trueHead), line: n };
    }
  }
}

/** Applies one tamper-matrix case to `target`, deterministically from `seed`. */
export function applyTamper(
  target: TamperTarget,
  kase: TamperCase,
  seed: number,
): TamperResult {
  const lines = exportLines(target.ndjson);
  if (lines.length < MIN_EXPORT_LINES) {
    throw new RangeError(`need 2+ lines, got ${String(lines.length)}`);
  }
  if (headOfLines(lines) !== target.head) {
    throw new Error("head is not the last line's stored hash (EX-14)");
  }
  const rng = new Rng(seed);
  const { lines: out, head, line } = mutate(kase, lines, rng, target.head);
  return { case: kase, seed, ndjson: frame(out), head, line };
}
