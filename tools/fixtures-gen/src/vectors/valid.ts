// Vectors a conforming verifier must accept.
//
// 001 is the calibration point: the hashing.md §6 worked example, the one golden
// value in the whole set that was derived by hand before this code existed. If
// the generator and 001 ever disagree, the generator is wrong.
//
// 004 is the counter-intuitive one. A truncated chain is VALID without --head,
// because a prefix of a valid chain IS a valid chain (EX-16). That is not a
// verifier bug; 053 is the same bytes run WITH --head, and is INVALID. The pair
// is what makes end-truncation detectable at all.
import { A, Alines, G, chain, ok, v, type Vector } from "./shared.js";
import { head as headOf } from "../serialize.js";
import { frame, truncate } from "../tamper.js";

export const validVectors: Vector[] = [
  ok(
    "001-genesis-only",
    G,
    ["HA-11", "HA-13", "HA-16", "ET-7", "ET-8"],
    "The hashing.md §6 worked example, verbatim. The only golden value in this set derived independently of this generator, and therefore the calibration point for every other vector.",
  ),
  ok(
    "002-four-types",
    A,
    ["ET-6", "ET-10", "ET-13", "ET-17", "EX-13"],
    "One event of each v1 type, correctly linked and signed under the key its own type names.",
  ),
  v(
    "003-head-match",
    frame(Alines),
    { verdict: "VALID" },
    ["EX-15"],
    "Chain 002 run with its true head, so the EX-15 check passes.",
    headOf(A),
  ),
  v(
    "004-truncated-without-head",
    frame(truncate(Alines, 2)),
    { verdict: "VALID" },
    ["EX-16"],
    "End-truncation is NOT detectable from the export alone — a prefix of a valid chain is a valid chain. VALID is the correct verdict here, not a verifier bug; the paired vector that supplies --head over these same bytes is what catches it.",
  ),
  ok(
    "005-boundaries",
    chain((c) => {
      const short = c.issue("a", 2);
      const long = c.issue("t".repeat(200), 64);
      c.vote(short.hash, 0);
      c.vote(short.hash, 1);
      c.vote(long.hash, 63);
    }),
    ["ET-14", "ET-14a", "ET-18a"],
    "Legal extremes: 1-char and 200-char titles, choice_count 2 and 64, choice 0 and choice_count-1.",
  ),
  ok(
    "006-title-multibyte",
    chain((c) => c.issue("Ratifier le règlement — 日本語 ✅", 2)),
    ["HA-2", "EX-9", "ET-16"],
    "A non-ASCII title stored as literal UTF-8 with no escape and no normalization of any form; the hash covers the decoded scalar values.",
  ),
  ok(
    "007-title-escapes",
    chain((c) => c.issue('The "charter" \\ 2026 a/b', 2)),
    ["EX-9"],
    "Quote and backslash escaped; solidus (/) left literal, which EX-9 requires and many JSON writers escape by default.",
  ),
];
