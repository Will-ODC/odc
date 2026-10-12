// ADR-0034: batch checks beside ballots a verifier cannot read (ET-18b, ET-22a,
// ET-24b). Every expected verdict and line set below is DECLARED from the spec,
// never calculated by a verifier or by this builder.
//
// Decision 7 of ADR-0034 limits these vectors to chains on which the
// conservative rule (ET-24b) and the exact all-assignments rule agree, so the
// rule can be tightened later without contradicting a frozen vector.
// `docs/security/attacks/check-adr-0034-agreement.py` evaluates both rules on
// each case's batch shape and must report every case `ok`.
//
// Shape shared by most cases: genesis (line 1), issues A and B (lines 2-3,
// minimum 3, 60000 ms interval unless stated), so ballots start at line 4.
// T1 and T2 are minutes 10 and 11. `U` is an opaque ballot: `vote_cast` at
// version 1000000, which EV-19 reserves, so no future contracts version can
// register it and contradict these verdicts.
import { REGISTRAR, type ChainBuilder } from "../chain.js";
import { editLine } from "../tamper.js";
import { keypairFromSeed, seedOf } from "../encode.js";
import { RESERVED_VERSION } from "./unregistered.js";
import { bad, chain, lines, partial, type Vector } from "./shared.js";

const T1 = 10;
const T2 = 11;

/** An opaque ballot: a well-formed `vote_cast` at an unregistered version. */
function opaque(
  c: ChainBuilder,
  issueId: string,
  minutes: number,
  extra: Record<string, number> = {},
): void {
  c.custom(
    "vote_cast",
    RESERVED_VERSION,
    { choice: 0, issue_id: issueId, ...extra },
    { signer: REGISTRAR, minutes },
  );
}

function votes(
  c: ChainBuilder,
  issueId: string,
  minutes: number,
  n: number,
): void {
  for (let i = 0; i < n; i++) c.vote(issueId, i % 2, { minutes });
}

/** The ADR-0034 "opaque member" chain, with the opaque payload naming `target`. */
function opaqueMember(target: "A" | "B") {
  return chain((c) => {
    const a = c.issue("Batch A", 2);
    const b = c.issue("Batch B", 2);
    votes(c, a.hash, T1, 2);
    opaque(c, (target === "A" ? a : b).hash, T1);
    votes(c, a.hash, T2, 3);
  });
}

export const opaqueBatchingVectors: Vector[] = [
  partial(
    "116-opaque-member",
    opaqueMember("A"),
    [6, 7],
    ["ET-22a", "ET-24", "ET-24b", "EV-7", "EV-8", "EV-17"],
    "Two A ballots and an opaque ballot at T1, then three A ballots at T2. The opaque ballot could be A's third T1 ballot, so the check at the first T2 (line 7) is unresolved, not INVALID: |R| + F = 2 + 1 meets the minimum. PARTIAL names the opaque line and the unresolved line.",
  ),
  partial(
    "117-opaque-payload-names-other-issue",
    opaqueMember("B"),
    [6, 7],
    ["ET-24", "ET-24b", "EV-8", "EV-19"],
    "Byte-for-byte 116 except that the opaque ballot's payload names issue B. A verifier MUST NOT read an unregistered version's payload for batch membership, so the verdict and lines equal 116's.",
  ),
  bad(
    "118-opaque-insufficient-even-optimistically",
    lines(
      chain((c) => {
        const a = c.issue("Batch A", 2);
        c.issue("Batch B", 2);
        votes(c, a.hash, T1, 1);
        opaque(c, a.hash, T1);
        votes(c, a.hash, T2, 3);
      }),
    ),
    6,
    ["ET-24", "ET-24b", "ET-22a"],
    "One A ballot and one opaque ballot at T1, then T2. Even if the opaque ballot is A's, the T1 batch holds two against a minimum of three: |R| + F = 1 + 1 < 3, a definite failure at the first T2 (line 6). The one-ballot bound (ET-22a) is what makes F a bound.",
  ),
  partial(
    "119-opaque-closure",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      c.issue("Batch B", 2);
      votes(c, a.hash, T1, 3);
      opaque(c, a.hash, T2);
      votes(c, a.hash, T1, 1);
    }),
    [7, 8],
    ["ET-24a", "ET-24b", "EV-7", "EV-17"],
    "A full T1 batch, an opaque ballot at T2, then an A ballot at T1. If the opaque ballot is A's, A has left T1 and line 8 returns to it (ET-24a); if not, line 8 extends the T1 batch. Unresolved, so PARTIAL names lines 7 and 8.",
  ),
  bad(
    "120-definite-resumed-instant",
    lines(
      chain((c) => {
        const a = c.issue("Batch A", 2);
        c.issue("Batch B", 2);
        votes(c, a.hash, T1, 3);
        votes(c, a.hash, T2, 3);
        opaque(c, a.hash, T1);
        votes(c, a.hash, T1, 1);
      }),
    ),
    11,
    ["ET-24a", "ET-24b"],
    "Full batches at T1 and T2 are known, so A has definitely left T1. The opaque ballot cannot reopen a known closed instant: the A ballot at T1 is a definite ET-24a failure at line 11. Uncertainty never erases known batch history.",
  ),
  partial(
    "121-opaque-after-full-batch",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      c.issue("Batch B", 2);
      votes(c, a.hash, T1, 3);
      opaque(c, a.hash, T1);
      votes(c, a.hash, T2, 3);
    }),
    [7],
    ["ET-24", "ET-24b", "EV-7"],
    "The T1 batch is already full, so the opaque ballot at T1 changes no check. An opaque line that affects nothing is still listed, and only it.",
  ),
  bad(
    "122-known-only-control",
    lines(
      chain((c) => {
        const a = c.issue("Batch A", 2);
        c.issue("Batch B", 2);
        votes(c, a.hash, T1, 2);
        votes(c, a.hash, T2, 3);
      }),
    ),
    6,
    ["ET-24", "ET-24b"],
    "The 116 shape without its opaque ballot. With no candidate, F is 0 and ET-24b reduces exactly to ET-24: the two-ballot T1 batch fails at line 6.",
  ),
  bad(
    "123-opaque-cannot-excuse-off-interval",
    lines(
      chain((c) => {
        const a = c.issue("Two-minute A", 2, { batchIntervalMs: 120_000 });
        c.issue("Batch B", 2);
        opaque(c, a.hash, T1);
        c.vote(a.hash, 0, { minutes: T2 });
      }),
    ),
    5,
    ["ET-23", "ET-24b"],
    "A known ballot off its issue's two-minute interval is a definite ET-23 failure at line 5, whatever the opaque ballot before it is. ADR-0034's case writes it as T1 + 1 ms; an odd minute against a 120000 ms interval is the same failure built from whole-minute timestamps.",
  ),
  partial(
    "124-ballot-of-unreadable-issue",
    chain((c) => {
      c.issue("Batch A", 2);
      const x = c.custom(
        "issue_created",
        RESERVED_VERSION,
        { choice_count: 2, title: "Unreadable issue" },
        { signer: REGISTRAR },
      );
      // The builder records choice counts only for issues it creates; this
      // issue's is unreadable to a verifier (ET-18b), so register it here only
      // to let the builder emit an ordinary v1 ballot naming it.
      c.issues.set(x.hash, 2);
      c.vote(x.hash, 0, { minutes: T1 });
    }),
    [3, 4],
    ["ET-18", "ET-18b", "EV-7", "EV-17"],
    "A registered ballot names an issue_created at an unregistered version. It passes ET-18, and its ET-18a/ET-23/ET-24/ET-24a checks are unresolved, so PARTIAL names the issue's line and the ballot's.",
  ),
  partial(
    "125-two-opaque-ballots-fill-a-batch",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      c.issue("Batch B", 2);
      votes(c, a.hash, T1, 1);
      opaque(c, a.hash, T1);
      opaque(c, a.hash, T1);
      votes(c, a.hash, T2, 3);
    }),
    [5, 6, 7],
    ["ET-22a", "ET-24", "ET-24b"],
    "One A ballot and two opaque ballots at T1: |R| + F = 1 + 2 meets the minimum, so the first T2 (line 7) is unresolved. Both opaque lines are listed.",
  ),
  partial(
    "126-opaque-before-first-ballot",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      c.issue("Batch B", 2);
      opaque(c, a.hash, T1);
      votes(c, a.hash, T1, 2);
      votes(c, a.hash, T2, 3);
    }),
    [4, 7],
    ["ET-24", "ET-24b"],
    "The opaque ballot comes before A's first registered ballot. With no P(f), w is the issue's own line, so the opaque ballot still counts toward the T1 batch and line 7 is unresolved.",
  ),
  partial(
    "127-issues-share-an-instant",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      const b = c.issue("Batch B", 2);
      c.vote(a.hash, 0, { minutes: T1 });
      c.vote(b.hash, 0, { minutes: T1 });
      opaque(c, a.hash, T1);
      opaque(c, b.hash, T1);
      c.vote(a.hash, 1, { minutes: T1 });
      c.vote(b.hash, 1, { minutes: T1 });
      c.vote(a.hash, 0, { minutes: T2 });
      c.vote(b.hash, 0, { minutes: T2 });
    }),
    [6, 7, 10, 11],
    ["ET-24", "ET-24b"],
    "A and B both hold two ballots at T1, and two opaque ballots at T1 are candidates of both. Each counts in each issue's F, so both first-T2 ballots (lines 10 and 11) are unresolved. Two opaque ballots are needed: with one, every assignment leaves A or B short, which only a search over assignments could prove (INVALID) — the over-reporting ADR-0034 keeps out of vectors.",
  ),
  bad(
    "128-opaque-off-one-issues-interval",
    lines(
      chain((c) => {
        c.issue("Batch A", 2);
        const b = c.issue("Two-minute B", 2, { batchIntervalMs: 120_000 });
        votes(c, b.hash, T1, 2);
        opaque(c, b.hash, T2);
        votes(c, b.hash, 12, 1);
      }),
    ),
    7,
    ["ET-23", "ET-24", "ET-24b"],
    "The opaque ballot's minute 11 is a multiple of A's one-minute interval but not of B's two-minute one, so it is no candidate of B whatever its payload says. B's two-ballot batch at minute 10 is a definite ET-24 failure at line 7.",
  ),
  bad(
    "129-opaque-before-the-issue",
    lines(
      chain((c) => {
        c.issue("Batch A", 2);
        // Made before issue B exists: seq(U) is not > c for B, so no candidate.
        opaque(c, "0".repeat(64), T1);
        const b = c.issue("Batch B", 2);
        votes(c, b.hash, T1, 2);
        votes(c, b.hash, T2, 3);
      }),
    ),
    7,
    ["ET-24", "ET-24b"],
    "An opaque ballot made before issue B is created is no candidate of B (seq(U) > c fails). B's two-ballot batch at T1 is a definite ET-24 failure at line 7.",
  ),
  bad(
    "130-opaque-ballot-malformed-payload",
    editLine(
      lines(
        chain((c) => {
          const a = c.issue("Batch A", 2);
          c.issue("Batch B", 2);
          votes(c, a.hash, T1, 2);
          opaque(c, a.hash, T1, { n: 3 });
          votes(c, a.hash, T2, 3);
        }),
      ),
      6,
      '"n":3',
      '"n":3.5',
    ),
    6,
    ["ES-16", "EV-16", "ET-24b"],
    "The 116 shape, but the opaque ballot's payload holds a float. ET-24b's opaque ballot must pass Stage A and ES-15 to ES-17; this one has no computable preimage, so it is INVALID at its own line (EV-16), never PARTIAL. Its stored hash is the pre-mutation digest, so the line is also HA-14-mismatched; both failures are on line 6.",
  ),
  partial(
    "131-opaque-in-an-earlier-run",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      c.issue("Batch B", 2);
      votes(c, a.hash, T1, 3);
      opaque(c, a.hash, 12);
      votes(c, a.hash, T2, 3);
      votes(c, a.hash, 5, 1);
    }),
    [7, 8],
    ["ET-24", "ET-24a", "ET-24b", "EV-17"],
    "A full T1 batch, an opaque ballot at minute 12, a full T2 batch, then a ballot at minute 5. The opaque ballot could split the T1-to-T2 boundary, so line 8 is unresolved. It lies before T2's first ballot, so it cannot touch the run that line 11 ends: line 11 is resolved and NOT listed. Pins against over-reporting that carries an earlier run's state into a later run start.",
  ),
  bad(
    "132-unregistered-non-ballot-is-no-candidate",
    lines(
      chain((c) => {
        const a = c.issue("Batch A", 2);
        c.issue("Batch B", 2);
        votes(c, a.hash, T1, 2);
        c.custom(
          "participant_registered",
          RESERVED_VERSION,
          { pubkey: keypairFromSeed(seedOf(0x05)).publicKeyHex },
          { minutes: T1 },
        );
        votes(c, a.hash, T2, 3);
      }),
    ),
    7,
    ["ET-22a", "ET-24", "ET-24b", "EV-17"],
    "The 116 shape with an unregistered participant_registered where the opaque ballot was. Only vote_cast carries ballots (ET-22a), so it is no candidate: the two-ballot T1 batch is a definite ET-24 failure at line 7, and INVALID outranks the PARTIAL its own line would give. A verifier that treats every unregistered event as a possible ballot reports PARTIAL 6, 7 instead.",
  ),
  bad(
    "133-candidate-before-the-runs-window",
    lines(
      chain((c) => {
        const a = c.issue("Batch A", 2);
        c.issue("Batch B", 2);
        opaque(c, a.hash, T2);
        votes(c, a.hash, T1, 3);
        votes(c, a.hash, T2, 2);
        votes(c, a.hash, 12, 1);
      }),
    ),
    10,
    ["ET-24", "ET-24b"],
    "The opaque ballot at T2 (line 4) comes before the T1 run, so it lies before w = seq(P(f)) = 7 for the T2 run and is not counted in its F. The two-ballot T2 run is a definite ET-24 failure at line 10, and INVALID outranks the earlier unresolved lines. Measuring F from c instead of w would count it and report PARTIAL.",
  ),
  partial(
    "134-candidate-at-a-run-starts-instant",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      c.issue("Batch B", 2);
      opaque(c, a.hash, T2);
      votes(c, a.hash, T1, 3);
      votes(c, a.hash, T2, 1);
    }),
    [4, 5, 8],
    ["ET-24a", "ET-24b"],
    "An opaque ballot at T2 before A's full T1 run. If it is A's, A left T2 before T1, so the ballot at T2 (line 8) returns to a closed instant; if not, line 8 starts a fresh batch. ET-24b's run-start clause ts(U) = ts(L) leaves line 8 unresolved; line 5 is unresolved because the opaque ballot could end a batch before it.",
  ),
];
