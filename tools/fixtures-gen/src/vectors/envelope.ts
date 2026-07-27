// INVALID vectors for the envelope itself — Stage A, the checks that never
// consult the type registry (EV-15).
//
// These are the failures a frozen verifier must catch on ANY chain, including one
// whose types it does not know. Several are pairs that look alike and are not:
// 018/019 are both non-canonical integers but exercise different parser paths
// (fractional vs leading zero), and 021 is a MALFORMED type, which is INVALID
// rather than the PARTIAL that a well-formed unregistered type earns — that
// boundary is the whole point of EV-9.
//
// 023-028 all carry a payload HA-7 cannot encode, so they have no computable
// preimage at all; EV-16 makes them INVALID even on an unregistered type,
// because EV-8's "integrity confirmed, semantics unchecked" rationale does not
// hold when integrity is not confirmable.

import {
  Alines,
  Glines,
  P3,
  a2,
  a3,
  bad,
  chain,
  headless,
  lines,
  type Vector,
} from "./shared.js";
import {
  deleteLine,
  duplicateLine,
  editLine,
  flipHashChar,
  swapLines,
} from "../tamper.js";

export const envelopeVectors: Vector[] = [
  bad(
    "012-missing-field",
    editLine(Alines, 2, `"ts":"${a2.ts}",`, ""),
    2,
    ["ES-1"],
    "The ts field is absent.",
  ),
  bad(
    "013-extra-top-level-field",
    editLine(Alines, 2, '"seq":2,', '"seq":2,"extra":1,'),
    2,
    ["ES-2"],
    "An eighth top-level field.",
  ),
  bad(
    "014-null-field",
    editLine(Alines, 2, `"ts":"${a2.ts}"`, '"ts":null'),
    2,
    ["ES-3"],
    "A field present but null. Absence is never expressed as null.",
  ),
  bad(
    "015-seq-first-not-one",
    editLine(Glines, 1, '"seq":1,', '"seq":2,'),
    1,
    ["ES-6"],
    "The first event does not carry seq 1.",
  ),
  bad(
    "016-seq-gap",
    editLine(Alines, 3, '"seq":3,', '"seq":4,'),
    3,
    ["ES-7"],
    "seq jumps, leaving a gap.",
  ),
  bad(
    "017-seq-duplicate",
    duplicateLine(Alines, 2),
    3,
    ["ES-7"],
    "Tamper matrix: a line repeated, so seq repeats. The duplicate is line 3.",
  ),
  bad(
    "018-seq-fractional",
    editLine(Alines, 2, '"seq":2,', '"seq":2.0,'),
    2,
    ["ES-5"],
    "Non-canonical integer: fractional form.",
  ),
  bad(
    "019-seq-leading-zero",
    editLine(Alines, 2, '"seq":2,', '"seq":02,'),
    2,
    ["ES-5"],
    "Non-canonical integer: leading zero.",
  ),
  bad(
    "020-integer-out-of-range",
    editLine(
      Alines,
      3,
      '"choice_count":3,',
      '"choice_count":9007199254740992,',
    ),
    3,
    ["ES-5"],
    "An integer above 2^53-1, which no longer round-trips losslessly.",
  ),
  bad(
    "021-type-malformed",
    editLine(Glines, 1, '"type":"genesis"', '"type":"Genesis"'),
    1,
    ["ES-10", "ES-11"],
    "A MALFORMED type is INVALID, never PARTIAL. The PARTIAL path exists only for well-formed unregistered types; this is the boundary between them.",
  ),
  bad(
    "022-version-zero",
    editLine(Alines, 2, '"version":1,', '"version":0,'),
    2,
    ["ES-12"],
    "version below 1.",
  ),
  bad(
    "023-payload-not-object",
    editLine(
      Alines,
      2,
      `"payload":{"pubkey":"${String(a2.payload["pubkey"])}","sig":"${String(a2.payload["sig"])}"}`,
      '"payload":"x"',
    ),
    2,
    ["ES-15", "EV-16"],
    "A non-object payload has no computable preimage (HA-7), so it is INVALID rather than PARTIAL: integrity cannot be confirmed even structurally.",
  ),
  bad(
    "024-payload-float",
    editLine(Alines, 3, '"choice_count":3,', '"choice_count":3.5,'),
    3,
    ["ES-16", "EV-16"],
    "A float in the payload. HA-7 defines no encoding for one.",
  ),
  bad(
    "025-payload-boolean",
    editLine(Alines, 3, '"choice_count":3,', '"choice_count":true,'),
    3,
    ["ES-16"],
    "A boolean in the payload.",
  ),
  bad(
    "026-payload-null-value",
    editLine(Alines, 3, '"choice_count":3,', '"choice_count":null,'),
    3,
    ["ES-16"],
    "A null payload value.",
  ),
  bad(
    "027-payload-nested-object",
    editLine(Alines, 3, '"choice_count":3,', '"choice_count":{"n":3},'),
    3,
    ["ES-17"],
    "A nested object breaks flatness.",
  ),
  bad(
    "028-payload-array",
    editLine(Alines, 3, '"choice_count":3,', '"choice_count":[3],'),
    3,
    ["ES-17"],
    "An array breaks flatness.",
  ),
  bad(
    "029-payload-duplicate-key",
    editLine(
      Alines,
      2,
      '"pubkey":"',
      `"pubkey":"${String(a2.payload["pubkey"])}","pubkey":"`,
    ),
    2,
    ["HA-6"],
    "The same payload key twice: non-canonical, and never de-duplicated to conform.",
  ),
  bad(
    "030-ts-bad-format",
    editLine(Alines, 2, `"ts":"${a2.ts}"`, '"ts":"2026-07-21 00:02:00Z"'),
    2,
    ["ES-20"],
    "Fails the syntactic gate: a space instead of T, and no milliseconds.",
  ),
  bad(
    "031-ts-not-a-real-instant",
    editLine(Alines, 2, `"ts":"${a2.ts}"`, '"ts":"2026-02-30T00:00:00.000Z"'),
    2,
    ["ES-20"],
    "Passes the regex, fails the calendar gate — February 30 does not exist.",
  ),
  bad(
    "032-ts-leap-second",
    editLine(Alines, 2, `"ts":"${a2.ts}"`, '"ts":"2026-06-30T23:59:60.000Z"'),
    2,
    ["ES-20"],
    "A leap second, rejected even though RFC 3339 permits it, so that a regex-only and a calendar-parsing implementation reach the same verdict.",
  ),
  bad(
    "033-prev-hash-uppercase",
    editLine(
      Alines,
      2,
      `"prev_hash":"${a2.prev_hash}"`,
      `"prev_hash":"${a2.prev_hash.toUpperCase()}"`,
    ),
    2,
    ["ES-23", "ID-2"],
    "Uppercase hex, never lowercased to conform.",
  ),
  bad(
    "034-genesis-prev-hash-nonzero",
    editLine(
      Glines,
      1,
      `"prev_hash":"${"0".repeat(64)}"`,
      `"prev_hash":"${"1".repeat(64)}"`,
    ),
    1,
    ["ES-24"],
    "The first event must anchor to 64 zeros.",
  ),
  bad(
    "035-prev-hash-link-broken",
    editLine(
      Alines,
      3,
      `"prev_hash":"${a3.prev_hash}"`,
      `"prev_hash":"${"0".repeat(63)}1"`,
    ),
    3,
    ["ES-25"],
    "Tamper matrix: prev_hash does not match the predecessor hash.",
  ),
  bad(
    "036-hash-uppercase",
    editLine(
      Alines,
      2,
      `"hash":"${a2.hash}"`,
      `"hash":"${a2.hash.toUpperCase()}"`,
    ),
    2,
    ["ES-26"],
    "An uppercase digest.",
  ),
  bad(
    "037-hash-mismatch",
    flipHashChar(Alines, 2),
    2,
    ["ES-28", "HA-14"],
    "Tamper matrix: a byte flipped in the stored hash, so the recomputed digest disagrees.",
  ),
  bad(
    "038-genesis-not-at-seq-1",
    lines(
      chain((c) => {
        c.participant(0x03);
        const issue = c.issue("Adopt the charter", 3);
        c.vote(issue.hash, 1);
        c.genesis();
      }),
    ),
    5,
    ["ES-33"],
    "A second genesis later in the chain. genesis occurs exactly once, at seq 1.",
  ),
  bad(
    "039-first-event-not-genesis",
    lines(
      headless((c) =>
        c.custom(
          "participant_registered",
          1,
          { pubkey: P3.publicKeyHex },
          { signer: P3 },
        ),
      ),
    ),
    1,
    ["ES-33", "EX-12"],
    "A chain whose first line is well-formed and correctly self-signed but is not a genesis event.",
  ),
  bad(
    "040-line-deleted",
    deleteLine(Alines, 3),
    3,
    ["ES-7"],
    "Tamper matrix: an interior line dropped, breaking seq contiguity at the line that took its place.",
  ),
  bad(
    "041-lines-reordered",
    swapLines(Alines, 2, 3),
    2,
    ["ES-7"],
    "Tamper matrix: two interior lines swapped.",
  ),
];
