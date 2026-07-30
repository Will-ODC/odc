// The throwaway rehearsal chain (Phase 0 T6).
//
// Builds a randomized-but-reproducible chain from a seed, exports it as
// canonical NDJSON, and reports its head. The event construction, hashing and
// serialization are all `@odc/fixtures-gen`'s — this module chooses *what*
// events a chain contains, never *how* they are encoded. Duplicating any part of
// the preimage or line form here would create a second implementation of
// hashing.md that nobody reviews and that drifts silently.
//
// What this is for: giving T7's independent Go verifier a chain that is much
// larger and less tidy than the 73 hand-built fixture vectors, and giving T8 a
// cross-language comparison target. It is deliberately NOT a conformance suite —
// see `docs/plans/phase-0.md` T6.

import { ChainBuilder, OPERATOR, REGISTRAR } from "@odc/fixtures-gen/chain";
import type { Event } from "@odc/fixtures-gen/encode";
import { head, serializeExport } from "@odc/fixtures-gen/serialize";

import { Rng } from "./rng.js";

/**
 * Seed octets 0x01 and 0x02 are the operator and registrar of `hashing.md` §6.
 * Participants draw from what is left, so no participant key ever collides with
 * a chain authority key — a collision would make a `participant_registered`
 * self-signature also verify as an operator signature, which is a confusing
 * chain to hand a verifier and is not what any rule intends.
 */
const FIRST_PARTICIPANT_OCTET = 0x03;
const MAX_PARTICIPANTS = 0x100 - FIRST_PARTICIPANT_OCTET; // 253

/** ET-14a: `2 <= choice_count <= 64`. */
export const MIN_CHOICE_COUNT = 2;
export const MAX_CHOICE_COUNT = 64;

/** ET-14: a title is 1–200 Unicode scalar values. */
export const MAX_TITLE_SCALARS = 200;

/**
 * The character pool titles are drawn from, chosen to exercise the encoders
 * rather than to look like prose.
 *
 * The astral characters are deliberate. `memory/STATE.md` records M34: emitting
 * astral code points as `\u` surrogate-pair escapes survives the entire
 * fixtures-gen suite, because no string anywhere in that repo sits above
 * U+FFFF — while Go emits literal 4-byte UTF-8, so a TS-side regression would go
 * unnoticed until it became a cross-language mismatch. The rehearsal chain is
 * the natural place to put real astral text in front of both implementations,
 * which is precisely what T8 compares.
 *
 * Excluded by construction: every C0 control (U+0000–U+001F) and U+007F, which
 * ET-14 forbids in a title. `assertTitleLegal` re-checks rather than trusting
 * this comment.
 */
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

/**
 * ET-14, re-checked on every generated title rather than assumed from
 * `TITLE_CHARS`. A title is measured in Unicode SCALAR VALUES, not UTF-16 code
 * units — the distinction T5i settled, and one that changes the answer by up to
 * a factor of four once astral characters are in the pool. `[...s]` iterates
 * scalar values; `s.length` would not.
 */
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
  // Short titles dominate, but every chain reaches the ET-14 ceiling at least
  // once via `buildChain` below, so the boundary is always exercised.
  const scalars = rng.intBetween(1, 40);
  let title = "";
  for (let i = 0; i < scalars; i += 1) title += rng.pick(TITLE_CHARS);
  return title;
}

const ASTRAL_TITLE_CHARS: readonly string[] = TITLE_CHARS.filter(
  (ch) => (ch.codePointAt(0) as number) > 0xffff,
);

/**
 * A title of exactly `MAX_TITLE_SCALARS` scalar values — ET-14's upper bound —
 * that ALSO guarantees an astral scalar and both escape-triggering characters
 * (`"` and `\`) rather than leaving their presence to chance.
 *
 * Without this, a seed can build a `DEFAULT_SHAPE` chain with no astral scalar
 * anywhere (seeds 1411993, 1629297, 1900581, 4061444 do exactly that), or with
 * no `"` (seed 50) or no `\` (seed 4) — silently defeating the reason this pool
 * exists (see the module comment on `TITLE_CHARS`).
 *
 * The three forced scalars plus a pool-drawn fill are shuffled together so the
 * forced characters do not always land in the same three positions; each array
 * entry is one Unicode scalar value (built from `TITLE_CHARS`, whose entries
 * are themselves one scalar value each — an astral entry is a 2-code-unit JS
 * string but still one array element), so an array of exactly
 * `MAX_TITLE_SCALARS` entries joins into exactly `MAX_TITLE_SCALARS` scalar
 * values.
 */
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

/**
 * Builds one rehearsal chain.
 *
 * Event order is genesis, then all participants, then an interleaving of issues
 * and votes in which every vote references an issue that is already on the chain
 * (ET-18). Interleaving rather than issues-then-votes is the point: a verifier
 * that tracks `choice_count` only by scanning ahead, or that assumes all issues
 * precede all ballots, passes the tidy ordering and fails this one.
 */
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
    // Coverage note, stated rather than implied: `assertTitleLegal` itself is
    // directly unit-tested, but THIS CALL is not killable by any test — every
    // title the generator can produce is legal by construction, so deleting the
    // line leaves the suite green. It is defense-in-depth against a later change
    // to `TITLE_CHARS` or `maxLengthTitle`, not something the suite proves is
    // reached. Making it killable would mean adding a test-only injection point
    // to the builder's public API, which is a worse trade.
    assertTitleLegal(title);
    const choiceCount = rng.intBetween(MIN_CHOICE_COUNT, MAX_CHOICE_COUNT);
    const e = chain.issue(title, choiceCount);
    issues.push({ id: e.hash, choiceCount });
  };

  // The first issue always carries a maximum-length title, so ET-14's upper
  // bound is in every chain rather than only in chains whose draws happen to
  // reach it.
  createIssue(maxLengthTitle(rng));

  let issuesLeft = shape.issues - 1;
  let votesLeft = shape.votes;
  // The interleaving below is a weighted draw, which for rare seeds emits every
  // issue before any vote — exactly the tidy ordering this chain exists to
  // avoid (confirmed at DEFAULT_SHAPE for seeds 25109, 30093, 93305, 124336,
  // 293114). So the LAST issue is held back and refused until at least one
  // vote has been cast, whenever the shape can honour that (issues >= 2 &&
  // votes >= 1): that final issue's creation is necessarily the last
  // `issue_created` event, so forcing a vote first guarantees
  // `firstVote < lastIssue` without touching how the rest of the ordering is
  // drawn.
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
    // Copied rather than returned by reference: `shape` is typed `readonly
    // ChainShape` on `RehearsalChain`, but that only forbids reassigning the
    // property, not mutating the object it points to. Returning the caller's
    // own object would let a caller's later mutation of their `shape` corrupt
    // an already-built chain's record of what it was built with.
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
