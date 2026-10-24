import {
  comparePolls,
  type PollListQuery,
  type PollSummary,
} from "./listing.js";
import {
  createPoll,
  isOpen,
  type NewPoll,
  type Poll,
  type PollMethod,
  type Publication,
} from "./poll.js";

/**
 * One voter's answer to one poll.
 *
 * A ballot is an array of choice indices, not one index: `single` polls carry
 * at most one entry, `approval` polls carry several. The array is the shape in
 * both cases (the client calls it `ballot` on the wire). One row per voter per
 * poll — casting again replaces it.
 */
export interface Vote {
  pollId: string;
  voterId: string;
  /** Indices into `Poll.choices`. Distinct; at most one for a `single` poll. */
  choices: number[];
  castAt: Date;
}

/** A page boundary for one browser's private vote history. */
export interface VoteBefore {
  castAt: Date;
  pollId: string;
}

/**
 * The outcome of a cast. `counted` is a first ballot, `changed` replaces a
 * prior ballot while the poll is still open, `closed` is a poll past its time.
 * There is no "already voted" outcome: a vote is changeable until close, so a
 * second cast replaces the first rather than being refused.
 */
export type CastResult =
  | { status: "counted"; vote: Vote }
  | { status: "changed"; vote: Vote }
  | { status: "closed" };

/** What the UI renders after a vote: counts per choice, in choice order. */
export interface Results {
  pollId: string;
  question: string;
  method: PollMethod;
  choices: readonly ChoiceResult[];
  /** Distinct people who voted — not the number of selections made. */
  voters: number;
  /**
   * People who confirmed by email, counted once each (ADR-0040). A person who
   * confirmed from two browsers is one here and two in `voters`. Always at
   * most `voters`; 0 when nobody has confirmed.
   */
  confirmedVoters: number;
}

export interface ChoiceResult {
  index: number;
  label: string;
  count: number;
  /**
   * `count / voters * 100`, rounded to one decimal; 0 when nobody has voted.
   * For `approval` a voter picks several choices, so these legitimately sum to
   * more than 100. That is correct and must not be normalised away.
   */
  share: number;
  /** How many confirmed voters picked this choice (see `confirmedVoters`). */
  confirmedCount: number;
  /** `confirmedCount / confirmedVoters * 100`, as `share` is; 0 when none. */
  confirmedShare: number;
}

/**
 * How a cast relates to confirmation (ADR-0040).
 *
 * `confirmation` is the one-way code from `ConfirmationKey.codeFor` for the
 * signed-in account and this poll. The store never sees the account id or the
 * address, only this code. Given, it replaces whatever code the vote held;
 * left out (nobody signed in), the vote keeps the code it had, so changing an
 * answer keeps it confirmed.
 */
export interface CastOptions {
  confirmation?: string;
}

export interface VotingStore {
  /** Public summaries, newest first; at most limit + 1 rows. */
  listPolls(query: PollListQuery): Promise<PollSummary[]>;
  createPoll(input: NewPoll): Promise<Poll>;
  /** Development seeds only: assign a listing community without authorship. */
  setSeedCommunity(pollId: string, community: string): Promise<void>;
  getPoll(pollId: string): Promise<Poll | undefined>;
  castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
    options?: CastOptions,
  ): Promise<CastResult>;
  /**
   * Confirm every vote filed under this ballot identity on a poll that is
   * still open, with the code `codeFor(pollId)` gives for each — what signing
   * in does for a browser that voted first (ADR-0040). A closed poll's votes
   * are left alone, so its results stop changing when it closes. Returns how
   * many votes were confirmed.
   */
  confirmVotes(
    voterId: string,
    codeFor: (pollId: string) => string,
  ): Promise<number>;
  /** The voter's own ballot, so the UI can show what they picked. */
  voteOf(pollId: string, voterId: string): Promise<Vote | undefined>;
  /** Newest first, with one extra row so the caller can offer another page. */
  listVotes(
    voterId: string,
    limit: number,
    before?: VoteBefore,
  ): Promise<Vote[]>;
  results(pollId: string): Promise<Results>;
}

/** Thrown when an operation names a poll that does not exist. */
export class UnknownPollError extends Error {
  constructor(pollId: string) {
    super(`no such poll: ${pollId}`);
    this.name = "UnknownPollError";
  }
}

/**
 * Thrown when a ballot is not a valid answer to its poll. The message is a
 * plain sentence safe to show a person; the HTTP layer maps this to a 400.
 */
export class BallotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BallotError";
  }
}

/**
 * Validate a ballot against its poll, mirroring `isValidBallot` in the client
 * (`apps/pulse-web/src/flow/story.ts`): entries are integers in range and
 * distinct, and a `single` poll takes at most one.
 *
 * An empty ballot is rejected here rather than treated as a retraction:
 * `CastResult` has no "retracted" state, and the client's `isCastable` never
 * sends an empty ballot. An empty ballot reaching the server is therefore a
 * bug, not someone withdrawing a vote — so it is an error, not a no-op.
 */
export function validateBallot(poll: Poll, ballot: readonly number[]): void {
  if (ballot.length === 0) {
    throw new BallotError("Choose an option to vote.");
  }
  if (poll.method === "single" && ballot.length > 1) {
    throw new BallotError("This poll takes a single choice.");
  }
  if (new Set(ballot).size !== ballot.length) {
    throw new BallotError("A choice can only be picked once.");
  }
  for (const choice of ballot) {
    if (
      !Number.isInteger(choice) ||
      choice < 0 ||
      choice >= poll.choices.length
    ) {
      throw new BallotError("That is not one of this poll's choices.");
    }
  }
}

/**
 * In-memory reference implementation. Tests run against this; the database one
 * lands with the first deployed slice and must behave identically — same
 * change-until-close rule, same result shape.
 */
export class InMemoryVotingStore implements VotingStore {
  readonly #polls = new Map<string, Poll>();
  readonly #seedCommunities = new Map<string, string>();
  /** `voteKey(pollId, voterId)` → vote. One row per voter per poll. */
  readonly #votes = new Map<string, Vote>();
  /**
   * `voteKey(pollId, voterId)` → the vote's confirmation code (ADR-0040).
   * Beside `#votes` rather than on `Vote`, so the code is never handed out
   * with a ballot.
   */
  readonly #confirmations = new Map<string, string>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  /**
   * `publication` is for the in-memory creation store only, which shares this
   * store as its database (ADR-0037): it is the in-memory equivalent of the
   * `community`, `attribution_kind` and `author_name` columns that the
   * Postgres creation store writes on the poll row. It takes the public facts
   * alone — the author's account stays in the creation store — and is copied,
   * so the caller cannot change it afterwards. Not on `VotingStore`: seed
   * polls have no author and none is invented for them.
   */
  async createPoll(input: NewPoll, publication?: Publication): Promise<Poll> {
    if (this.#polls.has(input.id))
      throw new TypeError(`poll already exists: ${input.id}`);
    const created = createPoll(input, this.#clock());
    const poll: Poll =
      publication === undefined
        ? created
        : { ...created, publication: structuredClone(publication) };
    this.#polls.set(poll.id, poll);
    return poll;
  }

  async setSeedCommunity(pollId: string, community: string): Promise<void> {
    const poll = this.#polls.get(pollId);
    if (!poll || poll.publication)
      throw new TypeError("seed poll missing or authored");
    this.#seedCommunities.set(pollId, community);
  }

  async getPoll(pollId: string): Promise<Poll | undefined> {
    return this.#polls.get(pollId);
  }

  async listPolls(query: PollListQuery): Promise<PollSummary[]> {
    return [...this.#polls.values()]
      .filter(
        (p) =>
          (p.publication?.community.id ?? this.#seedCommunities.get(p.id)) ===
            query.community &&
          (query.before === undefined || comparePolls(p, query.before) < 0),
      )
      .sort((a, b) => comparePolls(b, a))
      .slice(0, query.limit + 1)
      .map((p) => ({
        id: p.id,
        question: p.question,
        method: p.method,
        createdAt: p.createdAt,
        ...(p.closesAt ? { closesAt: p.closesAt } : {}),
      }));
  }

  async castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
    options: CastOptions = {},
  ): Promise<CastResult> {
    const poll = this.#requirePoll(pollId);
    if (voterId.trim() === "") throw new TypeError("voterId must not be empty");
    validateBallot(poll, ballot);
    assertConfirmation(options.confirmation);

    const now = this.#clock();
    // Checked before the replacement so a late cast reads as "closed", which is
    // the more useful thing to tell someone than silently changing nothing.
    if (!isOpen(poll, now)) return { status: "closed" };

    const key = voteKey(pollId, voterId);
    const replacing = this.#votes.has(key);
    // A copy, so a caller mutating theirs later cannot reach into ours, and in
    // choice order: a single or approval ballot — the only methods there are —
    // says which choices, not an order, and a database store can only give
    // them back in the poll's own order. A ranked method will carry its order
    // in `vote_choice.value`, not in the order of this array.
    const choices = [...ballot].sort((a, b) => a - b);
    const vote: Vote = { pollId, voterId, choices, castAt: now };
    this.#votes.set(key, vote);
    // Left out means "keep what it had", never "unconfirm": changing an answer
    // keeps it confirmed.
    if (options.confirmation !== undefined) {
      this.#confirmations.set(key, options.confirmation);
    }
    return { status: replacing ? "changed" : "counted", vote };
  }

  async confirmVotes(
    voterId: string,
    codeFor: (pollId: string) => string,
  ): Promise<number> {
    const now = this.#clock();
    // Every code is made and checked before any is written, so a bad one
    // leaves nothing half-confirmed — all or nothing, as Postgres's
    // transaction is.
    const writes: [string, string][] = [];
    for (const [key, vote] of this.#votes) {
      if (vote.voterId !== voterId) continue;
      const poll = this.#polls.get(vote.pollId);
      if (!poll || !isOpen(poll, now)) continue;
      const code = codeFor(vote.pollId);
      assertConfirmation(code);
      writes.push([key, code]);
    }
    for (const [key, code] of writes) this.#confirmations.set(key, code);
    return writes.length;
  }

  async voteOf(pollId: string, voterId: string): Promise<Vote | undefined> {
    return this.#votes.get(voteKey(pollId, voterId));
  }

  async listVotes(
    voterId: string,
    limit: number,
    before?: VoteBefore,
  ): Promise<Vote[]> {
    return [...this.#votes.values()]
      .filter(
        (vote) =>
          vote.voterId === voterId &&
          (before === undefined ||
            vote.castAt < before.castAt ||
            (vote.castAt.getTime() === before.castAt.getTime() &&
              Buffer.compare(
                Buffer.from(vote.pollId),
                Buffer.from(before.pollId),
              ) < 0)),
      )
      .sort(
        (a, b) =>
          b.castAt.getTime() - a.castAt.getTime() ||
          Buffer.compare(Buffer.from(b.pollId), Buffer.from(a.pollId)),
      )
      .slice(0, limit + 1)
      .map((vote) => ({ ...vote, choices: [...vote.choices] }));
  }

  async results(pollId: string): Promise<Results> {
    const poll = this.#requirePoll(pollId);
    const counts = new Array<number>(poll.choices.length).fill(0);
    let voters = 0;
    /** Code → that person's most recent vote on this poll. */
    const latest = new Map<string, Vote>();
    for (const [key, vote] of this.#votes) {
      if (vote.pollId !== pollId) continue;
      // One person, counted once, however many choices their ballot names.
      voters++;
      for (const choice of vote.choices) {
        counts[choice] = (counts[choice] ?? 0) + 1;
      }
      const code = this.#confirmations.get(key);
      if (code === undefined) continue;
      const held = latest.get(code);
      if (held === undefined || moreRecent(vote, held)) latest.set(code, vote);
    }

    // One confirmed vote per code, which is one per person per poll.
    const confirmedCounts = new Array<number>(poll.choices.length).fill(0);
    for (const vote of latest.values()) {
      for (const choice of vote.choices) {
        confirmedCounts[choice] = (confirmedCounts[choice] ?? 0) + 1;
      }
    }

    return resultsFor(poll, voters, counts, latest.size, confirmedCounts);
  }

  #requirePoll(pollId: string): Poll {
    const poll = this.#polls.get(pollId);
    if (!poll) throw new UnknownPollError(pollId);
    return poll;
  }
}

/**
 * A collision-proof key for `(pollId, voterId)`.
 *
 * Length-prefixing the first part means no pair of ids can produce the same
 * key: `("a", "b:c")` → `1:a:b:c`, `("a:b", "c")` → `3:a:b:c`. A plain
 * separator could collide across the boundary, and the previous separator was
 * a literal NUL byte — which made git treat this whole file as binary, so its
 * diffs were never reviewable. Printable and safe.
 */
function voteKey(pollId: string, voterId: string): string {
  return `${pollId.length}:${pollId}:${voterId}`;
}

/**
 * Which of two votes carrying one person's confirmation code is the confirmed
 * one: the most recently cast (ADR-0040). A tie in time — the same
 * millisecond — goes to the greater ballot identity, compared by code unit;
 * arbitrary, but the same in every store (Postgres sorts it `collate "C"`),
 * so the in-memory and database stores can never disagree about which vote
 * counts.
 */
export function moreRecent(a: Vote, b: Vote): boolean {
  const at = a.castAt.getTime() - b.castAt.getTime();
  if (at !== 0) return at > 0;
  return a.voterId > b.voterId;
}

/**
 * What a confirmation code looks like: the 64 lowercase hex digits of an
 * HMAC-SHA256. Checked by every store (and by a constraint in Postgres) so an
 * account id or an address can never be stored in its place by mistake —
 * which would put the very connection ADR-0040 keeps out of the database
 * right beside the answer.
 */
export const CONFIRMATION_CODE = /^[0-9a-f]{64}$/;

/** Every store's check of a code before writing it. */
export function assertConfirmation(code: string | undefined): void {
  if (code !== undefined && !CONFIRMATION_CODE.test(code)) {
    // The value is never part of the message.
    throw new TypeError("a confirmation must be a keyed code");
  }
}

/**
 * A poll's results from how many people voted and how many picked each choice
 * (indexed by position), and the same two numbers for confirmed votes only.
 * Every store builds its results here, so the share arithmetic — of voters,
 * not of selections, rounded to one decimal — cannot differ between them.
 */
export function resultsFor(
  poll: Poll,
  voters: number,
  counts: readonly number[],
  confirmedVoters: number,
  confirmedCounts: readonly number[],
): Results {
  return {
    pollId: poll.id,
    question: poll.question,
    method: poll.method,
    voters,
    confirmedVoters,
    choices: poll.choices.map((label, index) => {
      const count = counts[index] ?? 0;
      const confirmedCount = confirmedCounts[index] ?? 0;
      return {
        index,
        label,
        count,
        share: shareOf(count, voters),
        confirmedCount,
        confirmedShare: shareOf(confirmedCount, confirmedVoters),
      };
    }),
  };
}

function shareOf(count: number, of: number): number {
  return of === 0 ? 0 : round1((count / of) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
