// Rendering a Verdict as the CLI's stdout line.
//
// This lives in its own module rather than in cli.ts so tests can import it
// without executing cli.ts, whose last statement calls process.exit().

import type { Verdict } from "./verify.js";

/**
 * THE OUTPUT CONTRACT: the verdict is exactly ONE line.
 *
 * A downstream consumer parses stdout with a single-line regex, so an advisory
 * reason printed on a SECOND line makes it throw rather than mismatch — a worse
 * failure than a wrong answer, and one no valid input triggers today, so nothing
 * else would catch it. Reason text is therefore appended after a colon on the
 * SAME line, and is run through `oneLine` first: any CR/LF (or other control
 * character) in it collapses to a single space, so no reason can ever split the
 * verdict across lines however it was constructed.
 *
 * EV-17 pins conformance on the verdict token and line number(s) alone; the
 * reason is advisory and is never conformance-checked. That is exactly why it
 * must not be allowed to damage the shape the token is read out of.
 */
export function oneLine(s: string): string {
  // Any C0 control, DEL, and the Unicode line terminators U+2028/U+2029, which
  // some line-oriented readers also break on.
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
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
