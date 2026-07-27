// INVALID vectors for --head, for type semantics (Stage B), and for verdict
// precedence.
//
// The --head pair is load-bearing: 053 is the SAME BYTES as the VALID vector
// 004, differing only in whether --head is supplied. EX-16 makes end-truncation
// undetectable from the export alone, so this pair is the only thing that pins
// the rule, and EX-19 attributes the failure to the last line present.
//
// The Stage B vectors are each built so that ONLY the cited rule fails: hash and
// signature are valid over the offending payload, so a verifier that skipped the
// type-specific check would report VALID. 055-058 rotate the signing key through
// the wrong-but-valid choices, which is what pins ET-9a's separation of the
// operator key from the registrar key.
//
// 069 pins precedence: a chain with BOTH an unregistered type and a Stage A
// failure is INVALID, not PARTIAL, and names the first fatal line (EV-17).
// 070 pins EV-16 from the other side — a malformed payload on an UNREGISTERED
// type is still INVALID.

import {
  A,
  AX,
  Alines,
  IMPOSTOR,
  P3,
  bad,
  chain,
  headless,
  lines,
  v,
  type Vector,
} from "./shared.js";
import { OPERATOR, REGISTRAR } from "../chain.js";
import { chainId } from "../encode.js";
import { head as headOf } from "../serialize.js";
import { editLine, flipHashChar, frame, truncate } from "../tamper.js";

export const semanticsVectors: Vector[] = [
  v(
    "053-head-mismatch-truncated",
    frame(truncate(Alines, 2)),
    { verdict: "INVALID", line: 2 },
    ["EX-15", "EX-16", "EX-19"],
    "The same bytes as 004, now run with the true head. This pair is what makes end-truncation detectable, and the failure is attributed to the last line present.",
    headOf(A),
  ),
  v(
    "054-head-mismatch-substituted",
    frame(Alines),
    { verdict: "INVALID", line: 4 },
    ["EX-15", "EX-19"],
    "A --head naming a chain this export is not.",
    `${"f".repeat(63)}0`,
  ),

  bad(
    "055-genesis-sig-wrong-key",
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          1,
          {
            chain_id: chainId(OPERATOR.publicKeyHex),
            contracts: "contracts-v1",
            operator_pk: OPERATOR.publicKeyHex,
            registrar_pk: REGISTRAR.publicKeyHex,
          },
          { signer: IMPOSTOR },
        ),
      ),
    ),
    1,
    ["ET-8"],
    "A genesis signed by a key other than the operator_pk it declares. Self-signing is the whole point of ET-8.",
  ),
  bad(
    "056-participant-sig-wrong-key",
    lines(
      chain((c) =>
        c.custom(
          "participant_registered",
          1,
          { pubkey: P3.publicKeyHex },
          { signer: IMPOSTOR },
        ),
      ),
    ),
    2,
    ["ET-10"],
    "Proof-of-possession fails: signed by a key other than the declared pubkey.",
  ),
  bad(
    "057-issue-sig-wrong-key",
    lines(
      chain((c) =>
        c.custom(
          "issue_created",
          1,
          { choice_count: 3, title: "Adopt the charter" },
          { signer: REGISTRAR },
        ),
      ),
    ),
    2,
    ["ET-13"],
    "An issue signed by the registrar key rather than the operator key — the separation ET-9a describes, enforced.",
  ),
  bad(
    "058-vote-sig-wrong-key",
    lines(
      chain((c) => {
        const issue = c.issue("Adopt the charter", 3);
        c.custom(
          "vote_cast",
          1,
          { choice: 1, issue_id: issue.hash },
          { signer: OPERATOR },
        );
      }),
    ),
    3,
    ["ET-17"],
    "A ballot signed by the operator rather than the registrar.",
  ),
  bad(
    "059-chain-id-not-derived",
    lines(
      headless((c) =>
        c.custom(
          "genesis",
          1,
          {
            chain_id: "a".repeat(64),
            contracts: "contracts-v1",
            operator_pk: OPERATOR.publicKeyHex,
            registrar_pk: REGISTRAR.publicKeyHex,
          },
          { signer: OPERATOR },
        ),
      ),
    ),
    1,
    ["ET-7"],
    "chain_id is not sha256(operator_pk bytes). Hash and signature are both valid; only the derivation fails.",
  ),
  bad(
    "060-title-control-char",
    lines(chain((c) => c.issue("Adopt\u0001the charter", 3))),
    2,
    ["ET-14"],
    "A C0 control character in a title. Hash and signature are valid, and the line is canonically escaped — only ET-14 fails.",
  ),
  bad(
    "061-title-too-long",
    lines(chain((c) => c.issue("t".repeat(201), 3))),
    2,
    ["ET-14"],
    "201 scalar values, one past the limit.",
  ),
  bad(
    "062-title-empty",
    lines(chain((c) => c.issue("", 3))),
    2,
    ["ET-14"],
    "An empty title.",
  ),
  bad(
    "063-choice-count-too-small",
    lines(chain((c) => c.issue("Adopt the charter", 1))),
    2,
    ["ET-14a"],
    "choice_count below 2.",
  ),
  bad(
    "064-choice-count-too-large",
    lines(chain((c) => c.issue("Adopt the charter", 65))),
    2,
    ["ET-14a"],
    "choice_count above 64. The ceiling exists because an unbounded choice domain re-opens a covert receipt channel.",
  ),
  bad(
    "065-choice-out-of-range",
    lines(
      chain((c) => {
        const issue = c.issue("Adopt the charter", 3);
        c.vote(issue.hash, 3);
      }),
    ),
    3,
    ["ET-18a"],
    "choice equals choice_count, one past the top of [0, choice_count).",
  ),
  bad(
    "066-vote-unknown-issue",
    lines(chain((c) => c.vote("ab".repeat(32), 0))),
    2,
    ["ET-18", "ID-8"],
    "A ballot referencing an issue_id that is not the hash of any prior issue_created.",
  ),
  bad(
    "067-payload-missing-key",
    lines(
      chain((c) =>
        c.custom("participant_registered", 1, { pubkey: P3.publicKeyHex }),
      ),
    ),
    2,
    ["ES-18"],
    "The required sig key is absent from the payload.",
  ),
  bad(
    "068-payload-extra-key",
    lines(
      chain((c) =>
        c.custom(
          "participant_registered",
          1,
          { extra: "x", pubkey: P3.publicKeyHex },
          { signer: P3 },
        ),
      ),
    ),
    2,
    ["ES-18"],
    "A key not defined for this (type, version). Hash and signature are valid over it; only ES-18 fails.",
  ),

  bad(
    "069-invalid-outranks-partial",
    flipHashChar(lines(AX), 3),
    3,
    ["EV-17"],
    "A chain with BOTH an unregistered type (line 5) and a Stage A failure (line 3). INVALID outranks PARTIAL, and the line named is the first fatal one.",
  ),
  bad(
    "070-unregistered-type-bad-payload",
    editLine(
      lines(chain((c) => c.custom("x_experimental", 1, { n: 7 }))),
      2,
      '"n":7',
      '"n":7.5',
    ),
    2,
    ["EV-16"],
    "A malformed payload on an UNREGISTERED type is still INVALID, not PARTIAL: EV-8 grants PARTIAL only when integrity is confirmable, and a float has no preimage.",
  ),
];
