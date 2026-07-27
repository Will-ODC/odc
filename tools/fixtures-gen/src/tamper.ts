// Adversarial mutations. Each produces the exact bytes of one attack, applied to
// an already-canonical export so that the mutation is the *only* thing wrong.
//
// These operate on lines-as-text rather than on parsed events on purpose: several
// attacks (whitespace, key order, escaping, framing) are invisible at the object
// level — they exist only in the stored bytes, which is precisely what
// export-format.md §2 pins.

/** Framing options, so EX-2/EX-3/EX-4 violations are expressible. */
export interface FrameOptions {
  /** EX-3: use CRLF instead of LF. */
  crlf?: boolean;
  /** EX-4: omit the required final newline. */
  noFinalNewline?: boolean;
  /** EX-2: prepend a UTF-8 byte-order mark. */
  bom?: boolean;
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Joins lines into export bytes. Canonical by default (EX-1/EX-3/EX-4). */
export function frame(
  lines: readonly string[],
  opts: FrameOptions = {},
): Buffer {
  const eol = opts.crlf === true ? "\r\n" : "\n";
  let text = lines.join(eol);
  if (opts.noFinalNewline !== true && lines.length > 0) text += eol;
  const body = Buffer.from(text, "utf8");
  return opts.bom === true ? Buffer.concat([BOM, body]) : body;
}

/** Replaces the first occurrence of `find` in the given 1-based line. */
export function editLine(
  lines: readonly string[],
  lineNumber: number,
  find: string,
  replace: string,
): string[] {
  const out = [...lines];
  const i = lineNumber - 1;
  const line = out[i];
  if (line === undefined) throw new RangeError(`no line ${lineNumber}`);
  if (!line.includes(find)) {
    throw new Error(
      `line ${lineNumber} does not contain ${JSON.stringify(find)}`,
    );
  }
  out[i] = line.replace(find, replace);
  return out;
}

/** Flips the low bit of one hex character inside the given line's `hash`. */
export function flipHashChar(
  lines: readonly string[],
  lineNumber: number,
): string[] {
  const out = [...lines];
  const i = lineNumber - 1;
  const line = out[i];
  if (line === undefined) throw new RangeError(`no line ${lineNumber}`);
  const m = /"hash":"([0-9a-f]{64})"\}$/.exec(line);
  if (m === null) throw new Error(`line ${lineNumber} has no trailing hash`);
  const hash = m[1] as string;
  const first = hash[0] as string;
  const flipped = (first === "0" ? "1" : "0") + hash.slice(1);
  out[i] = line.replace(`"hash":"${hash}"}`, `"hash":"${flipped}"}`);
  return out;
}

/**
 * Removes the given 1-based line (tamper matrix: line deletion).
 *
 * Bounds-checked for the same reason `editLine` throws. `splice` is silent in
 * both directions of failure: an out-of-range index is a NO-OP, which emits an
 * untampered file under an `INVALID` declaration; and `lineNumber` 0 splices at
 * -1, which END-truncates — exercising EX-16 while the vector claims mid-chain
 * deletion (EX-13). Both read as verifier bugs, not fixture bugs.
 */
export function deleteLine(
  lines: readonly string[],
  lineNumber: number,
): string[] {
  if (
    !Number.isInteger(lineNumber) ||
    lineNumber < 1 ||
    lineNumber > lines.length
  ) {
    throw new RangeError(
      `no line ${String(lineNumber)} in a ${String(lines.length)}-line file`,
    );
  }
  const out = [...lines];
  out.splice(lineNumber - 1, 1);
  return out;
}

/** Swaps two 1-based lines (tamper matrix: line reordering). */
export function swapLines(
  lines: readonly string[],
  a: number,
  b: number,
): string[] {
  const out = [...lines];
  const la = out[a - 1];
  const lb = out[b - 1];
  if (la === undefined || lb === undefined)
    throw new RangeError("line out of range");
  out[a - 1] = lb;
  out[b - 1] = la;
  return out;
}

/** Repeats a line immediately after itself (tamper matrix: duplicated seq). */
export function duplicateLine(
  lines: readonly string[],
  lineNumber: number,
): string[] {
  const out = [...lines];
  const line = out[lineNumber - 1];
  if (line === undefined) throw new RangeError(`no line ${lineNumber}`);
  out.splice(lineNumber, 0, line);
  return out;
}

/**
 * Keeps the first `count` lines (tamper matrix: end-truncation, EX-16).
 *
 * `count` must actually truncate: `0 <= count < lines.length`. `slice` fails
 * silently at both ends — `count >= lines.length` returns the whole file, so the
 * vector's bytes are the untruncated chain, and a negative `count` drops lines
 * from the END, making the argument mean the opposite of what it says.
 */
export function truncate(lines: readonly string[], count: number): string[] {
  if (!Number.isInteger(count) || count < 0 || count >= lines.length) {
    throw new RangeError(
      `truncate needs 0 <= count < ${String(lines.length)}, got ${String(count)}`,
    );
  }
  return lines.slice(0, count);
}

/**
 * Inserts an empty line after the given 1-based line (EX-5).
 *
 * `after` must land the blank INSIDE the file: `0 <= after <= lines.length`.
 * `splice` fails open at both ends — a too-large `after` appends the blank at
 * the end instead of where the caller said, so the vector's declared line number
 * points at a line that is fine, and a negative `after` counts from the end. The
 * blank is still there and the file is still INVALID, which is why this survives
 * every byte-level check: the verdict is right and the LINE is wrong, and a
 * wrong line is a wrong fixture (EV-17).
 */
export function insertBlankLine(
  lines: readonly string[],
  after: number,
): string[] {
  if (!Number.isInteger(after) || after < 0 || after > lines.length) {
    throw new RangeError(
      `insertBlankLine needs 0 <= after <= ${String(lines.length)}, got ${String(after)}`,
    );
  }
  const out = [...lines];
  out.splice(after, 0, "");
  return out;
}
