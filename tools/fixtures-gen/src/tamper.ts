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

/** Removes the given 1-based line (tamper matrix: line deletion). */
export function deleteLine(
  lines: readonly string[],
  lineNumber: number,
): string[] {
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

/** Keeps the first `count` lines (tamper matrix: end-truncation, EX-16). */
export function truncate(lines: readonly string[], count: number): string[] {
  return lines.slice(0, count);
}

/** Inserts an empty line after the given 1-based line (EX-5). */
export function insertBlankLine(
  lines: readonly string[],
  after: number,
): string[] {
  const out = [...lines];
  out.splice(after, 0, "");
  return out;
}
