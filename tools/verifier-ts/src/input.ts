// Splitting an export into records at LF, from a file or from memory, under
// this verifier's one within-line limit (evolution.md EV-23, EV-24).
//
// EV-24 lets a verifier impose limits on what sits WITHIN one line, provided no
// input within EV-23's minimums (65536 bytes per line, nesting depth 64) can
// reach them, and forbids any fixed limit on the number of lines or on the size
// of the input. So the file is read in chunks, never whole: `readFileSync`
// refuses any file over 2 GiB, which would be exactly such a fixed limit. A
// record is held in memory only while it is being verified.
//
// Records are split as export-format.md EX-24 splits candidates (and EV-23
// splits lines): at every LF; one terminal LF ends the last record and adds no
// empty one; without a final LF, a non-empty final fragment is the last record,
// flagged `terminated: false` so the verifier can report EX-4 against it.
//
// Nesting depth needs no limit here: the line parser (parse.ts) is a single
// non-recursive pass that rejects the first `{` or `[` opening a third level
// (ES-17, EV-16), so it establishes INVALID on every line deeper than 2 without
// ever reaching a depth it would have to bound.

import { readSync } from "node:fs";

const LF = 0x0a;

/** EV-23's line-length minimum: every verifier accepts lines this long. */
export const LINE_MINIMUM = 65536;

/**
 * This verifier's own line-length limit, in bytes without the LF: 1024 times
 * EV-23's minimum, so no input within the minimums can reach it (EV-24). It
 * exists so that a line far past any conforming one is refused deliberately,
 * with a tool-level failure, rather than by whatever the JavaScript engine
 * does first (a string past V8's length cap throws a RangeError).
 */
export const MAX_LINE_BYTES = 1024 * LINE_MINIMUM; // 64 MiB

/**
 * EV-24: a limit this verifier reached BEFORE it had established the verdict.
 * The CLI reports it as a tool-level failure (exit 3, no verdict line, no
 * EX-24 report); it is never a chain verdict.
 */
export class LimitReached extends Error {}

/** A record: one line's bytes without its LF, or a line over the limit. */
export type InputRecord =
  | { overLimit: false; bytes: Buffer; terminated: boolean }
  | { overLimit: true };

/**
 * The records of an in-memory export, under the same limit the file reader
 * applies, so `verifyExport(bytes)` and the CLI reach the same answer.
 * `maxLine` is a parameter only so tests can exercise the over-limit path
 * without allocating 64 MiB.
 */
export function* recordsOf(
  bytes: Buffer,
  maxLine: number = MAX_LINE_BYTES,
): Generator<InputRecord> {
  let start = 0;
  for (;;) {
    const lf = bytes.indexOf(LF, start);
    if (lf === -1) break;
    yield record(bytes.subarray(start, lf), true, maxLine);
    start = lf + 1;
  }
  if (start < bytes.length) {
    yield record(bytes.subarray(start), false, maxLine);
  }
}

function record(
  bytes: Buffer,
  terminated: boolean,
  maxLine: number,
): InputRecord {
  return bytes.length > maxLine
    ? { overLimit: true }
    : { overLimit: false, bytes, terminated };
}

/**
 * The two EX-24 candidates as the reader saw them. `null` for an endpoint
 * whose candidate passed the line limit and was never held: its claim is
 * `unavailable`, which EV-24 permits for a limit reached only while recovering
 * a claim. `undefined` (the whole object) for an empty input, which has no
 * endpoints.
 */
export interface Candidates {
  first: Buffer | null;
  last: Buffer | null;
}

/**
 * Reads a file descriptor in fixed-size chunks and yields its records lazily,
 * so verification can stop at the first fatal line without the rest of the
 * file ever being held. It also remembers the first and last EX-24 candidate:
 * after a verdict, `drain()` reads to the end to find the last one.
 *
 * A record that passes `maxLine` is yielded as `overLimit` as soon as it does,
 * before its LF is found; the rest of that record is then skipped without
 * being held, so a single enormous line costs a bounded amount of memory.
 */
export class FileRecords implements Iterable<InputRecord> {
  private readonly it: Iterator<InputRecord>;
  private sawAny = false;
  private first: Buffer | null = null;
  private last: Buffer | null = null;

  constructor(
    private readonly fd: number,
    private readonly maxLine: number = MAX_LINE_BYTES,
    private readonly chunkSize: number = 1 << 20,
  ) {
    this.it = this.generate();
  }

  [Symbol.iterator](): Iterator<InputRecord> {
    return this.it;
  }

  /** Read whatever the consumer did not, so the last candidate is known. */
  drain(): void {
    while (!this.it.next().done) {
      // keep reading
    }
  }

  /** The EX-24 candidates, or undefined for an empty input. Call after drain. */
  candidates(): Candidates | undefined {
    return this.sawAny ? { first: this.first, last: this.last } : undefined;
  }

  // Every completed record passes through here, held or not.
  private complete(bytes: Buffer | null): void {
    if (!this.sawAny) this.first = bytes;
    this.sawAny = true;
    this.last = bytes;
  }

  private *generate(): Generator<InputRecord> {
    let parts: Buffer[] = [];
    let partLen = 0;
    let over = false; // the current record has passed maxLine

    for (;;) {
      // A fresh buffer per read: a yielded record is a view into it, and it
      // must stay intact while the verifier (or `last`) still holds it.
      const chunk = Buffer.allocUnsafe(this.chunkSize);
      const n = readSync(this.fd, chunk, 0, this.chunkSize, null);
      if (n === 0) break;
      const buf = chunk.subarray(0, n);

      let start = 0;
      for (;;) {
        const lf = buf.indexOf(LF, start);
        const end = lf === -1 ? buf.length : lf;
        const piece = buf.subarray(start, end);

        if (!over) {
          if (partLen + piece.length > this.maxLine) {
            over = true;
            parts = [];
            partLen = 0;
            yield { overLimit: true };
          } else if (piece.length > 0 || lf !== -1) {
            parts.push(piece);
            partLen += piece.length;
          }
        }

        if (lf === -1) break;
        // The record ends at this LF.
        if (over) {
          this.complete(null);
        } else {
          const bytes =
            parts.length === 1 ? (parts[0] as Buffer) : Buffer.concat(parts);
          this.complete(bytes);
          yield { overLimit: false, bytes, terminated: true };
        }
        parts = [];
        partLen = 0;
        over = false;
        start = lf + 1;
      }
    }

    // A non-empty final fragment, with no LF after it, is the last record.
    if (over) {
      this.complete(null);
    } else if (partLen > 0) {
      const bytes = Buffer.concat(parts);
      this.complete(bytes);
      yield { overLimit: false, bytes, terminated: false };
    }
  }
}
