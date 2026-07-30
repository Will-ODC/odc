// The throwaway rehearsal chain (Phase 0 T6). Builds a randomized-but-reproducible chain from a
// seed, exports it as canonical NDJSON, and reports its head. Event construction, hashing and
// serialization are all `@odc/fixtures-gen`'s — this module only chooses *what* events a chain
// contains, never *how* they're encoded, to avoid a second, drifting implementation of
// hashing.md. For: giving T7's Go verifier a chain larger and less tidy than the 73 hand-built
// fixtures, and T8 a cross-language comparison target. Not a conformance suite — see
// `docs/plans/phase-0.md` T6.

import { ChainBuilder, OPERATOR, REGISTRAR } from "@odc/fixtures-gen/chain";
import type { Event } from "@odc/fixtures-gen/encode";
import { head, serializeExport } from "@odc/fixtures-gen/serialize";

import { Rng } from "./rng.js";

// 0x01/0x02 are the operator/registrar (`hashing.md` §6); participants start past them so a
// `participant_registered` self-signature can never also verify as an operator/registrar one.
const FIRST_PARTICIPANT_OCTET = 0x03;
const MAX_PARTICIPANTS = 0x100 - FIRST_PARTICIPANT_OCTET; // 253

/** ET-14a: `2 <= choice_count <= 64`. */
export const MIN_CHOICE_COUNT = 2;
export const MAX_CHOICE_COUNT = 64;

/** ET-14: a title is 1–200 Unicode scalar values. */
export const MAX_TITLE_SCALARS = 200;

// Character pool titles are drawn from, chosen to exercise encoders rather than look like prose.
// Astral characters are deliberate (M34): a TS-side bug emitting astral code points as `\u`
// escapes survives fixtures-gen's whole suite (nothing there sits above U+FFFF) while Go emits
// literal 4-byte UTF-8 — real astral text here puts that gap in front of both, for T8. Excludes
// every C0 control and U+007F by construction; `assertTitleLegal` re-checks rather than trust it.
export const TITLE_CHARS: readonly string[] = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ..." -_.,:;!?()[]{}'",
  // Characters whose canonical line form is an escape (EX-9).
  '"',
  "\\",
  "/",
  // Non-ASCII BMP: multi-byte UTF-8, literal in the canonical line.
  ..."éüñçØ¥→λΩ日本語",
  // Astral (U+10000 and above): 4-byte UTF-8, a surrogate PAIR in JS.
  ..."𝄞𝔘🜁🎯🌍",
];

export interface ChainShape {
  /** Number of `participant_registered` events. 1 … 253. */
  participants: number;
  /** Number of `issue_created` events. At least 1 if any vote is cast. */
  issues: number;
  /** Number of `vote_cast` events. */
  votes: number;
}

export interface RehearsalChain {
  readonly seed: number;
  readonly shape: ChainShape;
  readonly events: readonly Event[];
  /** Canonical NDJSON export bytes (export-format.md §1–2). */
  readonly ndjson: Buffer;
  /** EX-14: the last line's `hash`. */
  readonly head: string;
}

/** The default shape: big enough to be untidy, small enough to eyeball. */
export const DEFAULT_SHAPE: ChainShape = {
  participants: 12,
  issues: 5,
  votes: 40,
};

// ET-14, re-checked per title rather than assumed from `TITLE_CHARS`. Measured in Unicode SCALAR
// VALUES (T5i), not UTF-16 code units: `[...s]` iterates scalar values, `s.length` would not.
export function assertTitleLegal(title: string): void {
  const scalars = [...title];
  if (scalars.length < 1 || scalars.length > MAX_TITLE_SCALARS) {
    throw new RangeError(
      `title is ${String(scalars.length)} scalar values, ET-14 allows 1…${String(MAX_TITLE_SCALARS)}`,
    );
  }
  for (const ch of scalars) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x1f || c === 0x7f) {
      throw new RangeError(
        `title contains a control character U+${c.toString(16).toUpperCase().padStart(4, "0")} (ET-14)`,
      );
    }
  }
}

function randomTitle(rng: Rng): string {
  // Short titles dominate, but every chain reaches the ET-14 ceiling at least once via `buildChain` below.
  const scalars = rng.intBetween(1, 40);
  let title = "";
  for (let i = 0; i < scalars; i += 1) title += rng.pick(TITLE_CHARS);
  return title;
}

const ASTRAL_TITLE_CHARS: readonly string[] = TITLE_CHARS.filter(
  (ch) => (ch.codePointAt(0) as number) > 0xffff,
);

// A title of exactly `MAX_TITLE_SCALARS` scalar values (ET-14's ceiling) that ALSO guarantees an
// astral scalar and both escape-triggering characters (`"`, `\`) rather than leaving them to
// chance — left to the pool draw, some seeds build a `DEFAULT_SHAPE` chain missing one of the
// three. Forced scalars plus a pool-drawn fill are shuffled so they don't always land the same.
function maxLengthTitle(rng: Rng): string {
  const scalars: string[] = [rng.pick(ASTRAL_TITLE_CHARS), '"', "\\"];
  while (scalars.length < MAX_TITLE_SCALARS)
    scalars.push(rng.pick(TITLE_CHARS));
  for (let i = scalars.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    const tmp = scalars[i] as string;
    scalars[i] = scalars[j] as string;
    scalars[j] = tmp;
  }
  return scalars.join("");
}

// Builds one rehearsal chain: genesis, then all participants, then an interleaving of issues and
// votes where every vote references an already-on-chain issue (ET-18). Interleaving, not
// issues-then-votes, is the point — it's what fails a verifier assuming all issues precede ballots.
export function buildChain(
  seed: number,
  shape: ChainShape = DEFAULT_SHAPE,
): RehearsalChain {
  assertShape(shape);
  const rng = new Rng(seed);
  const chain = new ChainBuilder();
  chain.genesis({ operator: OPERATOR, registrar: REGISTRAR });

  for (let i = 0; i < shape.participants; i += 1) {
    chain.participant(FIRST_PARTICIPANT_OCTET + i);
  }

  // `issue_id` → `choice_count`, so every ballot honours ET-18a.
  const issues: { id: string; choiceCount: number }[] = [];

  const createIssue = (title: string): void => {
    // Coverage note: this call is not killable — every generated title is legal by construction,
    // so deleting it leaves the suite green. Defense-in-depth against a future `TITLE_CHARS` change.
    assertTitleLegal(title);
    const choiceCount = rng.intBetween(MIN_CHOICE_COUNT, MAX_CHOICE_COUNT);
    const e = chain.issue(title, choiceCount);
    issues.push({ id: e.hash, choiceCount });
  };

  // The first issue always carries a maximum-length title, so ET-14's upper bound is in every chain.
  createIssue(maxLengthTitle(rng));

  let issuesLeft = shape.issues - 1;
  let votesLeft = shape.votes;
  // The weighted draw below can, for rare seeds, emit every issue before any vote — the tidy
  // ordering this chain exists to avoid. So the LAST issue is held back until at least one vote
  // is cast, whenever the shape allows (issues >= 2 && votes >= 1), guaranteeing `firstVote < lastIssue`.
  let voteCast = false;
  while (issuesLeft > 0 || votesLeft > 0) {
    const isLastIssue = issuesLeft === 1;
    const mustCastVoteFirst = isLastIssue && votesLeft > 0 && !voteCast;
    // Weighted so issues appear throughout rather than clustering at the front.
    const makeIssue =
      !mustCastVoteFirst &&
      (votesLeft === 0 ||
        (issuesLeft > 0 && rng.int(issuesLeft + votesLeft) < issuesLeft));
    if (makeIssue) {
      createIssue(randomTitle(rng));
      issuesLeft -= 1;
    } else {
      const issue = rng.pick(issues);
      chain.vote(issue.id, rng.int(issue.choiceCount));
      votesLeft -= 1;
      voteCast = true;
    }
  }

  const events = chain.all;
  return {
    seed,
    // Copied, not returned by reference: `readonly` only forbids reassigning, not mutating the caller's own object.
    shape: { ...shape },
    events,
    ndjson: serializeExport(events),
    head: head(events),
  };
}

function assertShape(shape: ChainShape): void {
  const { participants, issues, votes } = shape;
  if (
    !Number.isInteger(participants) ||
    participants < 1 ||
    participants > MAX_PARTICIPANTS
  ) {
    throw new RangeError(
      `participants must be 1…${String(MAX_PARTICIPANTS)}, got ${String(participants)}`,
    );
  }
  if (!Number.isInteger(issues) || issues < 1) {
    throw new RangeError(`issues must be at least 1, got ${String(issues)}`);
  }
  if (!Number.isInteger(votes) || votes < 0) {
    throw new RangeError(`votes must be at least 0, got ${String(votes)}`);
  }
}
