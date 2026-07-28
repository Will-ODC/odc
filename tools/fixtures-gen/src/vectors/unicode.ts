// Vectors that pin how a title is ENCODED above U+FFFF and how it is COUNTED.
//
// Both gaps are cross-language divergences the other 70 vectors cannot see:
// until this module, no committed fixture byte under contracts/ carried a code
// point above U+FFFF.
//
// Encoding (071): EX-9 says every non-ASCII character is emitted as its literal
// UTF-8 bytes, never a \u escape. A writer that escapes a surrogate PAIR as two
// \u escapes — one of JSON.stringify's legal outputs — still round-trips
// through JSON.parse and still hashes to the same preimage, so the GOLDEN
// ARTIFACTS were blind to it: no vector's bytes held an astral scalar value.
// serialize.test.ts does catch that mutation at the unit level, and has since
// PR #26; what was missing is the same guarantee over the COMMITTED bytes,
// which are what a Go verifier actually reads. Go emits the four octets, so the
// two languages would disagree on the canonical bytes of a legal title while
// every digest still matched.
//
// Counting (072/073): ET-14 says "1–200 Unicode scalar values". `061` is 201
// ASCII `t`, where JS `.length` (UTF-16 code units), Go `len()` (bytes) and
// `utf8.RuneCountInString` (scalar values) all return 201 and the three
// readings agree. A title of U+1D11E repeated is 4 bytes and 2 code units
// per scalar value, so the readings diverge by a factor of 4 and only one of
// them gives the verdicts declared here.
import { bad, chain, lines, ok, type Vector } from "./shared.js";

/** U+1D11E G CLEF: 1 scalar value, 2 UTF-16 code units, 4 UTF-8 octets. */
export const CLEF = "\u{1d11e}";

/** ET-14's ceiling, in the unit ET-14 actually names. */
export const TITLE_MAX_SCALARS = 200;

export const unicodeVectors: Vector[] = [
  ok(
    "071-title-astral",
    chain((c) => c.issue(`Ratify the anthem ${CLEF}`, 2)),
    ["EX-9", "HA-2", "ET-16"],
    "A title containing U+1D11E, above the BMP. The canonical line MUST carry the four literal UTF-8 octets f0 9d 84 9e — not the \\ud834\\udd1e surrogate escape pair, which parses back to the same string and hashes to the same preimage, and so is invisible to every other vector. 006 does not reach this: its non-ASCII characters are all BMP, where a UTF-16-shaped writer and a UTF-8 one agree.",
  ),
  ok(
    "072-title-200-astral",
    chain((c) => c.issue(CLEF.repeat(TITLE_MAX_SCALARS), 2)),
    ["ET-14", "ET-16"],
    "Exactly 200 Unicode scalar values, and therefore 400 UTF-16 code units and 800 UTF-8 octets. VALID, because ET-14 counts scalar values. A verifier counting UTF-16 code units (JS `.length`) or bytes (Go `len()`) rejects this legal title; only `utf8.RuneCountInString` semantics accepts it. 005's 200-character title is ASCII, where all three counts coincide, so this is the first vector where the reading is decidable.",
  ),
  bad(
    "073-title-201-astral",
    lines(chain((c) => c.issue(CLEF.repeat(TITLE_MAX_SCALARS + 1), 2))),
    2,
    ["ET-14", "ET-16"],
    "201 scalar values: the same one-past-the-limit case as 061, but in the regime where the three counting readings diverge. 072 alone already rules out the byte and code-unit readings, so this vector is not needed to identify the unit — it is here because the over-limit branch is a DIFFERENT code path from the accept branch, and 061 exercises that branch only on ASCII, where an implementation may take a fast path that never counts scalar values at all. The pair 072/073 makes the ceiling bite at 200 in the multi-byte path too.",
  ),
];
