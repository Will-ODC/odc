// Phase 3 F2: each expected verdict and first fatal line is declared from
// ET-14b/ET-23/ET-24/ET-24a, never calculated by a verifier or this builder.
import { bad, chain, lines, ok, type Vector } from "./shared.js";

export const batchingVectors: Vector[] = [
  bad(
    "099-batch-resumed",
    lines(
      chain((c) => {
        const issue = c.issue("Batch A", 2);
        for (let i = 0; i < 3; i++) c.vote(issue.hash, i % 2, { minutes: 10 });
        for (let i = 0; i < 3; i++) c.vote(issue.hash, i % 2, { minutes: 11 });
        c.vote(issue.hash, 0, { minutes: 10 });
      }),
    ),
    9,
    ["ET-24a"],
    "Two full batches at T1 and T2; returning to T1 is fatal at the returning ballot, without an ET-24 size fault.",
  ),

  ok(
    "100-batch-interleaved-issues",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      const b = c.issue("Batch B", 2);
      c.vote(a.hash, 0, { minutes: 10 });
      c.vote(b.hash, 0, { minutes: 12 });
      c.vote(a.hash, 1, { minutes: 10 });
      c.vote(a.hash, 0, { minutes: 10 });
    }),
    ["ET-24", "ET-24a"],
    "Another issue's ballot falls between A's batch members; A's three ballots are still one full batch.",
  ),

  bad(
    "101-under-size-not-last",
    lines(
      chain((c) => {
        const issue = c.issue("Batch A", 2);
        c.vote(issue.hash, 0, { minutes: 10 });
        c.vote(issue.hash, 1, { minutes: 10 });
        c.participant(3);
        c.vote(issue.hash, 0, { minutes: 11 });
      }),
    ),
    6,
    ["ET-24"],
    "The first batch has two ballots against minimum three; the next ballot of that issue ends it at line 6.",
  ),

  ok(
    "102-under-size-last-interleaved",
    chain((c) => {
      const a = c.issue("Batch A", 2);
      const b = c.issue("Batch B", 2);
      c.vote(a.hash, 0, { minutes: 10 });
      c.vote(b.hash, 0, { minutes: 11 });
      c.vote(a.hash, 1, { minutes: 10 });
      c.vote(b.hash, 1, { minutes: 11 });
    }),
    ["ET-24"],
    "A's final batch contains two ballots, and B's ballots after A's last ballot do not make A's batch non-last.",
  ),

  bad(
    "103-off-interval-ballot",
    lines(
      chain((c) => {
        c.participant(3);
        const issue = c.issue("Two-minute interval", 2, {
          batchIntervalMs: 120_000,
        });
        c.vote(issue.hash, 0, { minutes: 5 });
      }),
    ),
    4,
    ["ET-23"],
    "Five minutes after midnight is on a whole-minute boundary but off this issue's two-minute interval.",
  ),

  bad(
    "104-interval-below-floor",
    lines(
      chain((c) => {
        c.issue("Bad interval", 2, {
          batchIntervalMs: 59_999,
          violates: ["ET-14b"],
        });
      }),
    ),
    2,
    ["ET-14b"],
    "The declared interval is one millisecond below the permanent 60000 ms floor.",
  ),

  bad(
    "105-minimum-below-floor",
    lines(
      chain((c) => {
        c.issue("Bad minimum", 2, { batchMin: 2, violates: ["ET-14b"] });
      }),
    ),
    2,
    ["ET-14b"],
    "The declared minimum is one below the permanent three-ballot floor.",
  ),

  bad(
    "106-run-two-then-three-return",
    lines(
      chain((c) => {
        const issue = c.issue("Run counterexample", 2);
        for (let i = 0; i < 2; i++) c.vote(issue.hash, i, { minutes: 10 });
        for (let i = 0; i < 3; i++) c.vote(issue.hash, i % 2, { minutes: 11 });
        c.vote(issue.hash, 0, { minutes: 10 });
      }),
    ),
    5,
    ["ET-24", "ET-24a"],
    "T1,T1,T2,T2,T2,T1: first T2 ends the under-size T1 run; the later return cannot repair it.",
  ),

  bad(
    "107-run-one-then-three-return",
    lines(
      chain((c) => {
        const issue = c.issue("Prefix counterexample", 2);
        c.vote(issue.hash, 0, { minutes: 10 });
        for (let i = 0; i < 3; i++) c.vote(issue.hash, i % 2, { minutes: 11 });
        c.vote(issue.hash, 0, { minutes: 10 });
        c.vote(issue.hash, 1, { minutes: 10 });
      }),
    ),
    4,
    ["ET-24", "ET-24a", "EX-16"],
    "T1,T2,T2,T2,T1,T1: the first T2 is fatal even though a set-based count would later fill T1.",
  ),

  ok(
    "108-two-full-batches",
    chain((c) => {
      const issue = c.issue("Two full batches", 2);
      for (let i = 0; i < 3; i++) c.vote(issue.hash, i % 2, { minutes: 10 });
      for (let i = 0; i < 3; i++) c.vote(issue.hash, i % 2, { minutes: 11 });
    }),
    ["ET-23", "ET-24", "ET-24a"],
    "One issue has two distinct full three-ballot batches; the first is non-last and still legal.",
  ),
];
