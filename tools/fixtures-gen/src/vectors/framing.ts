// INVALID vectors for the export framing and the canonical line form.
//
// Every one of these is invisible at the object level: parse the file and the
// events are fine. They exist only in the stored bytes, which is exactly what
// export-format.md §2 pins and why a verifier must compare received bytes
// against the canonical form rather than re-serialise and compare values.
//
// 049 is the sharpest case — envelope keys reordered. The hash check PASSES
// (HA-11 commits to values, not key order) and EX-10 rejects it anyway. That is
// how "semantically-equal JSON with different bytes is INVALID" (D5) is actually
// enforced, and it is the tamper matrix's "re-serialised but equivalent" case.
//
// Line attribution for these comes from EX-20, not from any offending event:
// a CR at the first line containing one, a missing final LF at the last line, a
// blank line at that line, a BOM at line 1. 047 is the empty export, which
// EX-18 attributes to line 1 — the position where the required genesis is
// absent.

import {
  Alines,
  ESC,
  a3,
  bad,
  chain,
  lines,
  v,
  type Vector,
} from "./shared.js";
import { editLine, insertBlankLine } from "../tamper.js";

export const framingVectors: Vector[] = [
  bad(
    "043-crlf",
    Alines,
    1,
    ["EX-3", "EX-20"],
    "CRLF line endings. Attributed to the first line containing a CR.",
    { crlf: true },
  ),
  bad(
    "044-no-final-newline",
    Alines,
    4,
    ["EX-4", "EX-20"],
    "The required final LF is absent. Attributed to the last line.",
    { noFinalNewline: true },
  ),
  bad(
    "045-blank-line",
    insertBlankLine(Alines, 2),
    3,
    ["EX-5", "EX-20"],
    "A blank line, which becomes line 3.",
  ),
  bad(
    "046-byte-order-mark",
    Alines,
    1,
    ["EX-2", "EX-20"],
    "A UTF-8 BOM before line 1.",
    { bom: true },
  ),
  v(
    "047-empty-export",
    Buffer.alloc(0),
    { verdict: "INVALID", line: 1 },
    ["EX-6", "EX-18"],
    "The zero-length file is a well-formed export but not a valid chain: it has no genesis. Attributed to line 1, where the required genesis line is absent.",
  ),
  bad(
    "048-insignificant-whitespace",
    editLine(Alines, 2, '"seq":2,', '"seq": 2, '),
    2,
    ["EX-7", "EX-10"],
    "Whitespace between tokens. The hash check would still pass — this is an EX-10 rejection.",
  ),
  bad(
    "049-envelope-keys-reordered",
    editLine(
      Alines,
      2,
      '"seq":2,"type":"participant_registered",',
      '"type":"participant_registered","seq":2,',
    ),
    2,
    ["EX-7", "EX-10", "EX-11"],
    'The tamper matrix "re-serialized but value-equivalent" case: the hash check passes and EX-10 rejects it anyway. This is exactly how "equivalent JSON with different bytes is INVALID" is enforced.',
  ),
  bad(
    "050-payload-keys-unsorted",
    editLine(
      Alines,
      3,
      `"choice_count":3,"sig":"${String(a3.payload["sig"])}"`,
      `"sig":"${String(a3.payload["sig"])}","choice_count":3`,
    ),
    3,
    ["EX-8", "EX-10"],
    "Payload keys not in ascending UTF-8-byte order. The hash is insensitive to line key order, so only EX-8 catches this.",
  ),
  bad(
    "051-escape-where-literal-required",
    editLine(
      lines(chain((c) => c.issue("Ratifier le règlement", 2))),
      2,
      "règlement",
      "r\\u00e8glement",
    ),
    2,
    ["EX-9"],
    "A non-ASCII character written as a \\u escape where EX-9 requires literal UTF-8.",
  ),
  bad(
    "052-uppercase-hex-escape",
    editLine(lines(ESC), 2, "\\u001f", "\\u001F"),
    2,
    ["EX-9"],
    "A control-character escape with an uppercase hex digit.",
  ),
];
