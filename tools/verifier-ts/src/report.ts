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
