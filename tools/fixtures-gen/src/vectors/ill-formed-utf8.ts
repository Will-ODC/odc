// Ill-formed UTF-8 (hashing.md HA-2, closing sentence): "An implementation MUST
// reject a string whose decoded value is not well-formed UTF-8." Until these
// vectors no fixture exercised that sentence (T9 re-audit S-E, carried from S4).
//
// Each vector is the same three-line chain: a valid genesis, an `issue_created`
// whose title carries ONE ill-formed sequence, and a valid
// `participant_registered` linked to the stored hash of line 2. The fault is on
// line 2, so every vector expects `INVALID` at line 2, and a verifier that
// blames the line after it, or skips the bad line, names the wrong line.
//
// The trap these vectors set is a LENIENT decoder: one that replaces each
// ill-formed sequence with U+FFFD instead of rejecting it. That is the default
// of `Buffer.toString("utf8")` and `TextDecoder` in JavaScript, and of
// `encoding/json` in Go. So line 2 is sealed — hashed and signed — over the
// title a lenient decoder would see, and only then are the U+FFFD octets on the
// line replaced by the ill-formed sequence. To a lenient verifier the stored
// `hash` and `sig` both check out, and the chain links; only rejecting the
// sequence gives the declared verdict.
//
// No canonical line can carry an ill-formed string. A raw ill-formed octet
// also breaks EX-2 (the file is not UTF-8), and an escaped surrogate also
// breaks EX-9 (a non-ASCII value written as a `\u` escape). So these vectors pin
// the verdict and the line (EV-17), not which of those rules a verifier names.

import { chain, lines, v, type Vector } from "./shared.js";
import { frame, editLine } from "../tamper.js";

const REPLACEMENT = "�";

/** The title shape every vector uses; `x` is where the fault goes. */
const titleWith = (x: string): string => `Adopt the ${x} charter`;

/** What a lenient (WHATWG) decoder turns these octets into. */
const lenient = (octets: Buffer): string =>
  new TextDecoder("utf-8", { fatal: false }).decode(octets);

/**
 * Genesis, an issue whose title holds `decoded`, and a participant after it.
 * The participant links to the issue's stored hash, sealed over `decoded`.
 */
const chainWithTitle = (decoded: string): string[] =>
  lines(
    chain((c) => {
      c.issue(titleWith(decoded), 2);
      c.participant(0x03);
    }),
  );

/**
 * A raw ill-formed sequence on line 2: the chain is sealed over the U+FFFD
 * string a lenient decoder yields for `octets`, then those U+FFFD octets are
 * replaced on the line by `octets` themselves.
 */
function rawIllFormed(octets: Buffer): Buffer {
  const decoded = lenient(octets);
  if (!/^�+$/u.test(decoded)) {
    throw new Error(
      `${octets.toString("hex")} is not ill-formed: it decodes to ${JSON.stringify(decoded)}`,
    );
  }
  const replaced = Buffer.from(decoded, "utf8");
  const bytes = frame(chainWithTitle(decoded));
  const at = bytes.indexOf(replaced);
  if (at === -1 || bytes.indexOf(replaced, at + 1) !== -1) {
    throw new Error("the U+FFFD octets must occur exactly once in the export");
  }
  return Buffer.concat([
    bytes.subarray(0, at),
    octets,
    bytes.subarray(at + replaced.length),
  ]);
}

/**
 * An escaped lone surrogate on line 2: sealed over U+FFFD, which is what both
 * a lenient JavaScript writer (`Buffer.from` of the lone surrogate) and Go's
 * `encoding/json` produce for it, then the literal U+FFFD on the line is
 * replaced by the six characters of the escape.
 */
function escapedIllFormed(escape: string): Buffer {
  return frame(editLine(chainWithTitle(REPLACEMENT), 2, REPLACEMENT, escape));
}

const inv = (
  id: string,
  bytes: Buffer,
  cites: string[],
  note: string,
): Vector => v(id, bytes, { verdict: "INVALID", line: 2 }, cites, note);

const SEALED =
  "Line 2 is hashed and signed over the title a lenient decoder sees, with each ill-formed sequence replaced by U+FFFD, and line 3 links to that hash. So a verifier that substitutes U+FFFD instead of rejecting finds the hash, the signature and the link all correct, and reports VALID.";

export const illFormedUtf8Vectors: Vector[] = [
  inv(
    "146-utf8-raw-surrogate",
    rawIllFormed(Buffer.from([0xed, 0xa0, 0x80])),
    ["HA-2", "EX-2"],
    `A title holding the raw octets ed a0 80, the three-byte form of the surrogate U+D800. A surrogate is not a Unicode scalar value, so this is not well-formed UTF-8 and HA-2 requires rejection: INVALID at line 2. A decoder that accepts surrogates in three-byte form (CESU-8, WTF-8, Java's modified UTF-8) reads it as a lone U+D800. A lenient decoder reads three U+FFFD. ${SEALED} EX-2 also rejects these octets; the vector pins the verdict and the line, not which rule a verifier names.`,
  ),
  inv(
    "147-utf8-escaped-surrogate",
    escapedIllFormed("\\ud800"),
    ["HA-2", "EX-9"],
    `A title holding the six characters \\ud800: an escape that decodes to the lone surrogate U+D800, which no UTF-8 can encode. HA-2 says the decoded value is what must be well-formed, so the escape is rejected even though every octet of the line is ASCII: INVALID at line 2. JavaScript's JSON.parse yields the lone surrogate, Buffer.from then encodes it as U+FFFD, and JSON.stringify writes it back as \\ud800, so a JavaScript verifier built from those three calls passes both the hash and the canonical-form check. Go's encoding/json decodes it to U+FFFD. Line 2 is hashed and signed over U+FFFD and line 3 links to that hash, so only rejecting the escape gives INVALID. EX-9 also rejects a \\u escape of a non-ASCII value, and no canonical line can carry this string at all; the vector pins the verdict and the line.`,
  ),
  inv(
    "148-utf8-overlong",
    rawIllFormed(Buffer.from([0xc0, 0x80])),
    ["HA-2", "EX-2"],
    `A title holding the raw octets c0 80, an overlong two-byte form of U+0000. UTF-8 allows only the shortest form of each scalar value, so c0 never begins a well-formed sequence: INVALID at line 2. Java's modified UTF-8 writes U+0000 exactly this way, and a decoder that computes the value from the bits without checking the form reads a NUL; a lenient decoder reads two U+FFFD. ${SEALED} EX-2 also rejects these octets.`,
  ),
  inv(
    "149-utf8-above-max",
    rawIllFormed(Buffer.from([0xf5, 0x80, 0x80, 0x80])),
    ["HA-2", "EX-2"],
    `A title holding the raw octets f5 80 80 80, a four-byte form of U+140000, above U+10FFFF, the last Unicode scalar value. f5 never begins a well-formed sequence: INVALID at line 2. A decoder that checks only the lead byte's bit pattern accepts it; a lenient decoder reads four U+FFFD. ${SEALED} EX-2 also rejects these octets.`,
  ),
  inv(
    "150-utf8-truncated",
    rawIllFormed(Buffer.from([0xe2, 0x82])),
    ["HA-2", "EX-2"],
    `A title holding the raw octets e2 82 followed by a space: the first two octets of the three-byte sequence for U+20AC, cut short, so the space arrives where a continuation octet is required: INVALID at line 2. A WHATWG decoder (JavaScript's TextDecoder and Buffer) reads one U+FFFD for the cut-short sequence, and line 2 is hashed and signed over that title, so a JavaScript verifier that substitutes instead of rejecting finds the hash, the signature and the link correct. Go's utf8 package substitutes one U+FFFD per octet, two here, so a lenient Go verifier fails the hash check instead, and still reports INVALID at line 2. EX-2 also rejects these octets.`,
  ),
];
