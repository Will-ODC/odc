// Rendering a Verdict as the CLI's stdout line.
//
// This lives in its own module rather than in cli.ts so tests can import it
// without executing cli.ts, whose last statement calls process.exit().

import type { Verdict } from "./verify.js";

/**
 * Ceiling on ONE piece of interpolated, attacker-controlled text (`excerpt`).
 * A reason names a rule and a value; 64 code points is enough to recognise the
 * value and far too few to matter as output.
 */
const EXCERPT_MAX = 64;

/**
 * Backstop ceiling on a whole rendered reason (`oneLine`). Generous enough for
 * the longest reason this verifier writes on purpose — EV-21's, which must name
 * the version encountered AND the versions registered, ~250 characters — and
 * small enough that no reason can ever be an output-size problem.
 */
const REASON_MAX = 512;

/**
 * Truncate to at most `max` CODE POINTS *including* the ellipsis that marks the
 * cut, so the returned length is a hard ceiling and not a ceiling plus one.
 */
function clip(s: string, max: number): string {
  // Counted in code points, not UTF-16 units: `slice` at a unit boundary would
  // emit an unpaired surrogate. Built by iteration rather than `[...s]` so a
  // multi-megabyte input costs `max` steps, not its own length.
  let out = "";
  let kept = "";
  let n = 0;
  for (const ch of s) {
    if (n === max) return kept + "…";
    if (n === max - 1) kept = out; // the prefix that leaves room for the mark
    out += ch;
    n++;
  }
  return out;
}

/**
 * THE OUTPUT CONTRACT: the verdict is exactly ONE line, of bounded length.
 *
 * A downstream consumer parses stdout with a single-line regex, so an advisory
 * reason printed on a SECOND line makes it throw rather than mismatch — a worse
 * failure than a wrong answer, and one no valid input triggers today, so nothing
 * else would catch it. Reason text is therefore appended after a colon on the
 * SAME line, and is run through `oneLine` first: any CR/LF (or other control
 * character, DEL, or Unicode line terminator — U+0085 NEL and U+2028/U+2029)
 * in it collapses to a single space, so no reason can ever split the verdict
 * across lines however it was constructed.
 *
 * LENGTH is the other half of that shape. `type` (ES-10) and payload strings
 * (EX-9) are attacker-controlled and unbounded in length, so a reason that
 * interpolates one could otherwise make stdout arbitrarily large. Interpolated
 * values should go through `excerpt`; this function additionally caps the whole
 * reason, so forgetting `excerpt` at a future call site cannot reopen it.
 *
 * EV-17 pins conformance on the verdict token and line number(s) alone; the
 * reason is advisory and is never conformance-checked. That is exactly why it
 * must not be allowed to damage the shape the token is read out of, and why
 * clipping it costs nothing.
 */
export function oneLine(s: string, max: number = REASON_MAX): string {
  // Any C0 control, DEL, and the Unicode line terminators U+0085 (NEL) and
  // U+2028/U+2029, which some line-oriented readers also break on.
  // eslint-disable-next-line no-control-regex
  const collapsed = s.replace(/[\u0000-\u001f\u0085\u007f\u2028\u2029]+/g, " ");
  return clip(collapsed.trim(), max);
}

/**
 * One piece of attacker-controlled text, made safe to interpolate into a
 * reason: single-line and at most `EXCERPT_MAX` code points. Use this at EVERY
 * call site that puts a value read out of the export into reason text.
 */
export function excerpt(s: string): string {
  return oneLine(s, EXCERPT_MAX);
}

/** Render a verdict as the single stdout line, WITHOUT its trailing newline. */
export function verdictLine(result: Verdict): string {
  switch (result.verdict) {
    case "VALID":
      return "VALID";
    case "INVALID": {
      const head = `INVALID at line ${result.line}`;
      const reason = result.reason === undefined ? "" : oneLine(result.reason);
      return reason.length === 0 ? head : `${head}: ${reason}`;
    }
    case "PARTIAL":
      return `PARTIAL at line${result.lines.length > 1 ? "s" : ""} ${result.lines.join(", ")}`;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const LF = 0x0a;
const UNAVAILABLE = "unavailable";

/**
 * Strict UTF-8. A candidate whose bytes are not UTF-8 is not a JSON text
 * (RFC 8259 §8.1), so it does not "decode as a JSON object" (EX-24); a lossy
 * decoder would substitute U+FFFD and let it through, which is the
 * substitution EX-24 forbids. `ignoreBOM: true` KEEPS a leading U+FEFF in the
 * decoded text instead of silently stripping it; JSON.parse then rejects it,
 * so a BOM-prefixed candidate is `unavailable` rather than normalised.
 */
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The stored `hash` claim of one EX-24 candidate record, or "unavailable".
 *
 * Available only if the candidate decodes as a JSON OBJECT whose top-level
 * `hash` is a string of exactly 64 lowercase hex characters. JSON.parse keeps
 * the LAST occurrence of a repeated key, which is EX-24's rule for a repeated
 * top-level `hash`; nested `hash` keys are never read. Keys and values are
 * taken as DECODED JSON strings, so `"hash"` is the key `hash` and a
 * `\u`-escaped value that decodes to 64 lowercase hex is available — decoding
 * is not normalisation. Beyond JSON decoding the value is never lowercased,
 * trimmed or otherwise normalised to make it available.
 *
 * This is NOT a canonical-form or integrity check (EX-24): a candidate EX-7–
 * EX-10 would reject — whitespace, reordered or duplicated keys — still yields
 * its claim, and nothing here recomputes a hash.
 */
export function storedHashClaim(candidate: Uint8Array): string {
  try {
    const v: unknown = JSON.parse(UTF8.decode(candidate));
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.hasOwn(v, "hash") // never a value inherited from Object.prototype
    ) {
      const h = (v as Record<string, unknown>)["hash"];
      if (typeof h === "string" && HEX64.test(h)) return h;
    }
  } catch {
    // fall through: not UTF-8, not JSON, or too large to decode
  }
  return UNAVAILABLE;
}

/** The two EX-24 endpoint claims, each 64 lowercase hex or "unavailable". */
export interface StoredClaims {
  genesis: string;
  head: string;
}

/**
 * EX-24 candidate extraction and claim recovery, independent of the verdict.
 * Returns null for an empty input, which has no endpoints.
 *
 * Candidates are the input split at LF, with exactly ONE terminal LF taken as
 * ending the last record (it adds no empty candidate):
 *   "a\n" -> ["a"]    "a" -> ["a"] (no final LF: the fragment is the last)
 *   "a\n\n" -> ["a", ""]    "\n" -> [""]
 * An additional trailing blank record IS a candidate, so on "a\n\n" the head
 * claim is `unavailable`. These rules apply whether or not framing, or any
 * other file check, fails. Each endpoint is recovered on its own, so one
 * `unavailable` never suppresses the other.
 */
export function storedClaims(bytes: Uint8Array): StoredClaims | null {
  if (bytes.length === 0) return null;
  const firstEnd = bytes.indexOf(LF);
  const first = firstEnd === -1 ? bytes : bytes.subarray(0, firstEnd);
  // Set aside the one terminal framing LF, if any; the last candidate is what
  // follows the last LF before that point.
  const end = bytes[bytes.length - 1] === LF ? bytes.length - 1 : bytes.length;
  // end === 0 only for the one-byte input "\n"; a negative fromIndex would make
  // lastIndexOf count from the END, so handle it explicitly.
  const lastStart = end === 0 ? 0 : bytes.lastIndexOf(LF, end - 1) + 1;
  const last = bytes.subarray(lastStart, end);
  return { genesis: storedHashClaim(first), head: storedHashClaim(last) };
}

/**
 * Labels of the two EX-24 stderr lines; the value follows after ": ".
 * "(stored claim)" says the value is the stored `hash` field's decoded string
 * — not a recomputed or verified hash. The exact labels are pinned so the two
 * verifiers' stderr can be diffed (operator choice; EX-24 leaves labels free).
 */
export const GENESIS_CLAIM_LABEL = "genesis hash (stored claim)";
export const HEAD_CLAIM_LABEL = "head hash (stored claim)";

/**
 * EX-24: the report for STDERR on every run that produces a chain verdict over
 * a NON-EMPTY input — one line per endpoint, each with its trailing newline —
 * or null for an empty input, which has no endpoints.
 *
 * The labels say "(stored claim)" because that is all these values are: the
 * decoded JSON string value of the `hash` field in the first / last candidate
 * record, with no normalisation beyond JSON decoding. On an INVALID verdict
 * they are what the file asserts, never verified chain anchors; a reader must
 * take them together with the verdict and an independently trusted `--chain` /
 * `--head`. On a VALID or PARTIAL file they coincide with EX-21's genesis hash
 * and EX-14's head.
 *
 * Tool output, not conformance surface (EV-17, EX-24): no fixture asserts it.
 */
export function storedClaimLines(bytes: Uint8Array): string | null {
  const c = storedClaims(bytes);
  if (c === null) return null;
  return `${GENESIS_CLAIM_LABEL}: ${c.genesis}\n${HEAD_CLAIM_LABEL}: ${c.head}\n`;
}
