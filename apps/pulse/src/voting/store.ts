import {
  createPoll,
  isOpen,
  type NewPoll,
  type Poll,
  type PollMethod,
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
}

export interface VotingStore {
  createPoll(input: NewPoll): Promise<Poll>;
  getPoll(pollId: string): Promise<Poll | undefined>;
  castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
  ): Promise<CastResult>;
  /** The voter's own ballot, so the UI can show what they picked. */
  voteOf(pollId: string, voterId: string): Promise<Vote | undefined>;
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
  /** `voteKey(pollId, voterId)` → vote. One row per voter per poll. */
  readonly #votes = new Map<string, Vote>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  async createPoll(input: NewPoll): Promise<Poll> {
    if (this.#polls.has(input.id))
      throw new TypeError(`poll already exists: ${input.id}`);
    const poll = createPoll(input, this.#clock());
    this.#polls.set(poll.id, poll);
    return poll;
  }

  async getPoll(pollId: string): Promise<Poll | undefined> {
    return this.#polls.get(pollId);
  }

  async castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
  ): Promise<CastResult> {
    const poll = this.#requirePoll(pollId);
    if (voterId.trim() === "") throw new TypeError("voterId must not be empty");
    validateBallot(poll, ballot);

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
    return { status: replacing ? "changed" : "counted", vote };
  }

  async voteOf(pollId: string, voterId: string): Promise<Vote | undefined> {
    return this.#votes.get(voteKey(pollId, voterId));
  }

  async results(pollId: string): Promise<Results> {
    const poll = this.#requirePoll(pollId);
    const counts = new Array<number>(poll.choices.length).fill(0);
    let voters = 0;
    for (const vote of this.#votes.values()) {
      if (vote.pollId !== pollId) continue;
      // One person, counted once, however many choices their ballot names.
      voters++;
      for (const choice of vote.choices) {
        counts[choice] = (counts[choice] ?? 0) + 1;
      }
    }

    return {
      pollId,
      question: poll.question,
      method: poll.method,
      voters,
      choices: poll.choices.map((label, index) => {
        const count = counts[index] ?? 0;
        return {
          index,
          label,
          count,
          share: voters === 0 ? 0 : round1((count / voters) * 100),
        };
      }),
    };
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
