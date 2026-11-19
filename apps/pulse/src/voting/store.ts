import type { PollImage } from "../images/public.js";
import { memoryImageDatabase } from "../images/store.js";
import { mayServe } from "../images/visibility.js";
import {
  comparePolls,
  type PollListQuery,
  type PollSummary,
} from "./listing.js";
import { randomUUID } from "node:crypto";
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
 * poll — casting again replaces it — and, among confirmed votes, one per person
 * per poll (ADR-0046).
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
 * One row of a browser's vote history: its ballot, and enough of its poll to
 * show it without another read. `poll` is absent only for a poll deleted
 * while the page was read; the row still marks the page boundary.
 */
export interface HistoryVote {
  pollId: string;
  castAt: Date;
  /** Chosen positions, ascending. */
  ballot: number[];
  poll?: {
    question: string;
    /** Labels of the chosen positions, in the same order as `ballot`. */
    choices: string[];
    closesAt?: Date;
  };
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
  /**
   * Ballots on the poll — not the number of selections made. A confirmed
   * person holds one ballot per poll (ADR-0046) and counts once; a vote nobody
   * confirmed counts once per browser.
   */
  voters: number;
  /**
   * People who confirmed by email, counted once each (ADR-0040). Always at
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
 * How a cast relates to confirmation (ADR-0040, ADR-0046).
 *
 * `confirmation` is the one-way code from `ConfirmationKey.codeFor` for the
 * signed-in account and this poll. The store never sees the account id or the
 * address, only this code. Given, it replaces whatever code the vote held, and
 * the person's ballot in any other browser on this poll is deleted: this cast
 * is their latest answer. Left out (nobody signed in), the vote keeps the code
 * it had, so changing an answer keeps it confirmed, and nothing else changes.
 *
 * `lockKey` is `ConfirmationKey.lockKeyFor` for the same account, and comes
 * with every confirmation: the store serializes one person's confirming
 * writes on it. Never stored.
 */
export type CastOptions =
  | { confirmation?: undefined; lockKey?: undefined }
  | { confirmation: string; lockKey: bigint };

/**
 * The person signing in, as `confirmVotes` sees them (ADR-0046): the code for
 * each poll and the key of their vote lock, never the account id.
 */
export interface ConfirmingPerson {
  codeFor: (pollId: string) => string;
  lockKey: bigint;
}

/**
 * A signed-in person casting on a public-vote poll (ADR-0048): their code and
 * lock key, both required. The account id is passed beside them, because a
 * public vote is found by account, never by recomputing the code.
 */
export interface PublicCastOptions {
  confirmation: string;
  lockKey: bigint;
}

/**
 * One entry of a public-vote poll's list: the voter's current profile name,
 * read live and whether or not the profile is visible (`null` without one),
 * and the chosen positions, ascending. `listKey` orders the list and is
 * random, fixed at first cast; it leaves the server only sealed in a cursor.
 */
export interface PublicVoteEntry {
  name: string | null;
  choices: number[];
  listKey: string;
}

/** What removing one's public vote did (ADR-0048 decision 10). */
export type RemovalResult =
  { status: "removed" } | { status: "none" } | { status: "closed" };

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
   * still open, with the code `person.codeFor(pollId)` gives for each — what
   * signing in does for a browser that voted first (ADR-0040). A closed poll's
   * votes are left alone, so its results stop changing when it closes.
   *
   * When the person already holds a ballot on that poll in another browser,
   * one survives (ADR-0046): the later cast, an exact tie going to the greater
   * ballot identity (`moreRecent`). It is filed under THIS ballot identity
   * either way: if the other one wins, its answer and cast time move here and
   * the other browser no longer holds a vote. Returns how many votes were
   * confirmed.
   */
  confirmVotes(voterId: string, person: ConfirmingPerson): Promise<number>;
  /** The voter's own ballot, so the UI can show what they picked. */
  voteOf(pollId: string, voterId: string): Promise<Vote | undefined>;
  /**
   * The ballots filed under this ballot identity, and, given an account, that
   * account's public votes (ADR-0048), newest cast first (ties by poll id,
   * bytewise), with one extra row so the caller can offer another page.
   */
  voteHistory(
    voterId: string | undefined,
    limit: number,
    before?: VoteBefore,
    accountId?: string,
  ): Promise<HistoryVote[]>;
  /**
   * Cast or re-cast an account's vote on a public-vote poll (ADR-0048). A
   * first cast files it under a fresh `pv:` identity with this code and a
   * random list key; a re-cast replaces the answer and cast time and keeps
   * the rest. Serialized on the person's lock, and the poll's openness is
   * read after it. Throws `VotePrivacyError` on an anonymous poll.
   */
  castPublic(
    pollId: string,
    accountId: string,
    ballot: readonly number[],
    options: PublicCastOptions,
  ): Promise<CastResult>;
  /** The account's vote on a public-vote poll, from any browser. */
  publicVoteOf(pollId: string, accountId: string): Promise<Vote | undefined>;
  /**
   * Remove the account's public vote while the poll is open, with its name.
   * Throws `VotePrivacyError` on an anonymous poll.
   */
  removePublicVote(
    pollId: string,
    accountId: string,
    lockKey: bigint,
  ): Promise<RemovalResult>;
  /**
   * A page of a public-vote poll's list, in list-key order after `after`,
   * with one extra row. Empty for an anonymous, hidden or unknown poll.
   */
  listPublicVotes(
    pollId: string,
    limit: number,
    after?: string,
  ): Promise<PublicVoteEntry[]>;
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
 * Thrown when a write does not match the poll's vote privacy (ADR-0048): an
 * account on an anonymous poll, a ballot identity on a public-vote one, or a
 * `pv:` identity anywhere but through `castPublic`. Nothing is written.
 */
export class VotePrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VotePrivacyError";
  }
}

/** The prefix of every public vote's `voter_id`, and of nothing else. */
export const PUBLIC_VOTER_PREFIX = "pv:";

/** A fresh public-vote identity, derived from nothing (ADR-0048 decision 3). */
export function newPublicVoterId(): string {
  return `${PUBLIC_VOTER_PREFIX}${randomUUID()}`;
}

/** Every store's check that a cookie ballot may be filed on this poll. */
export function assertBallotIdentity(poll: Poll, voterId: string): void {
  if (poll.votePrivacy !== "anonymous")
    throw new VotePrivacyError("a public-vote poll is cast with castPublic");
  if (voterId.startsWith(PUBLIC_VOTER_PREFIX))
    throw new VotePrivacyError("a ballot identity never starts pv:");
}

/** Every store's checks before a public cast writes anything. */
export function assertPublicCast(
  poll: Poll,
  accountId: string,
  ballot: readonly number[],
  options: PublicCastOptions,
): void {
  if (poll.votePrivacy !== "public")
    throw new VotePrivacyError("an anonymous poll takes no account");
  if (accountId.trim() === "")
    throw new TypeError("accountId must not be empty");
  validateBallot(poll, ballot);
  if (options.confirmation === undefined)
    throw new TypeError("a public vote needs a confirmation");
  assertCastOptions(options);
}

/** The first page's lower bound: below every version-4 UUID. */
export const FIRST_LIST_KEY = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Every store's check of a list position before reading. */
export function assertListKey(key: string): void {
  if (!UUID.test(key)) throw new TypeError("a list key is a lowercase UUID");
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
  /**
   * `voteKey(pollId, voterId)` of a public vote → its account and list key:
   * the in-memory `public_vote`. Every refusal its keys and triggers make in
   * Postgres is made in code here (ADR-0048 decision 3).
   */
  readonly #publicVotes = new Map<
    string,
    { accountId: string; listKey: string }
  >();
  readonly #displayNameOf: (accountId: string) => string | undefined;
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

  /**
   * `displayNameOf` reads an account's profile name, visible or not, as the
   * Postgres store joins `member_profile` (ADR-0048 decision 8); the
   * in-memory profile store gives one with `memoryDisplayNames`. Without it
   * every public vote is unnamed.
   */
  constructor(
    clock: () => Date = () => new Date(),
    options: { displayNameOf?: (accountId: string) => string | undefined } = {},
  ) {
    this.#clock = clock;
    this.#displayNameOf = options.displayNameOf ?? (() => undefined);
  }

  /**
   * `publication` is for the in-memory creation store only, which shares this
   * store as its database (ADR-0037): it is the in-memory equivalent of the
   * `community`, `attribution_kind` and `author_name` columns that the
   * Postgres creation store writes on the poll row. It takes the public facts
   * alone — the author's account stays in the creation store — and is copied,
   * so the caller cannot change it afterwards. Not on `VotingStore`: seed
   * polls have no author and none is invented for them.
   *
   * `image` is likewise the in-memory creation store's: the picture it
   * attached in the same publication, the equivalent of `polls.image_id`.
   */
  async createPoll(
    input: NewPoll,
    publication?: Publication,
    image?: PollImage,
  ): Promise<Poll> {
    if (this.#polls.has(input.id))
      throw new TypeError(`poll already exists: ${input.id}`);
    const created = createPoll(input, this.#clock());
    const poll: Poll = {
      ...created,
      ...(publication === undefined
        ? {}
        : { publication: structuredClone(publication) }),
      ...(image === undefined ? {} : { image: { ...image } }),
    };
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
    const poll = this.#polls.get(pollId);
    if (!poll) return undefined;
    const { image: _stored, ...rest } = poll;
    void _stored;
    const image = this.#shownImage(poll);
    return image ? { ...rest, image } : rest;
  }

  /**
   * The poll's picture only while `mayServe` would serve it, read against
   * the picture's own owner link in the in-memory picture tables, as the
   * Postgres store reads it against `image`. The in-memory store has no
   * hidden polls.
   */
  #shownImage(poll: Poll): PollImage | undefined {
    if (poll.image === undefined) return undefined;
    const link = memoryImageDatabase(this).images.get(poll.image.id);
    if (link === undefined || link.ownerId !== poll.id) return undefined;
    const shown = mayServe(link, {
      kind: "poll",
      currentImageId: poll.image.id,
      visible: true,
    });
    return shown ? { ...poll.image } : undefined;
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
      .map((p) => {
        const image = this.#shownImage(p);
        return {
          id: p.id,
          question: p.question,
          method: p.method,
          createdAt: p.createdAt,
          ...(p.closesAt ? { closesAt: p.closesAt } : {}),
          votePrivacy: p.votePrivacy,
          ...(image ? { image } : {}),
        };
      });
  }

  async castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
    options: CastOptions = {},
  ): Promise<CastResult> {
    const poll = this.#requirePoll(pollId);
    if (voterId.trim() === "") throw new TypeError("voterId must not be empty");
    assertBallotIdentity(poll, voterId);
    validateBallot(poll, ballot);
    assertCastOptions(options);

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
    // Left out means "keep what it had", never "unconfirm": changing an answer
    // keeps it confirmed. Given, this cast is the person's latest answer and
    // replaces their ballot in any other browser (ADR-0046).
    if (options.confirmation !== undefined) {
      const other = this.#confirmedAs(pollId, options.confirmation, key);
      if (other !== undefined) this.#forget(other);
      this.#confirmations.set(key, options.confirmation);
    }
    this.#votes.set(key, vote);
    return { status: replacing ? "changed" : "counted", vote };
  }

  async confirmVotes(
    voterId: string,
    person: ConfirmingPerson,
  ): Promise<number> {
    assertLockKey(person.lockKey);
    const now = this.#clock();
    // Every code is made and checked before any is written, so a bad one
    // leaves nothing half-confirmed — all or nothing, as Postgres's
    // transaction is.
    const writes: [string, Vote, string][] = [];
    for (const [key, vote] of this.#votes) {
      if (vote.voterId !== voterId) continue;
      const poll = this.#polls.get(vote.pollId);
      // Never a public vote (ADR-0048 decision 6): its row stays where it is.
      if (!poll || poll.votePrivacy !== "anonymous" || !isOpen(poll, now))
        continue;
      const code = person.codeFor(vote.pollId);
      assertConfirmation(code);
      writes.push([key, vote, code]);
    }
    for (const [key, vote, code] of writes) {
      // One ballot per person per poll (ADR-0046): the later cast survives,
      // and under this ballot identity either way.
      const other = this.#confirmedAs(vote.pollId, code, key);
      const rival = other === undefined ? undefined : this.#votes.get(other);
      if (other !== undefined && rival !== undefined) {
        this.#forget(other);
        if (!moreRecent(vote, rival)) {
          // The other browser's answer is newer: it moves here.
          this.#votes.set(key, { ...rival, voterId });
        }
      }
      this.#confirmations.set(key, code);
    }
    return writes.length;
  }

  async voteOf(pollId: string, voterId: string): Promise<Vote | undefined> {
    return this.#votes.get(voteKey(pollId, voterId));
  }

  async voteHistory(
    voterId: string | undefined,
    limit: number,
    before?: VoteBefore,
    accountId?: string,
  ): Promise<HistoryVote[]> {
    return [...this.#votes.entries()]
      .filter(
        ([key, vote]) =>
          (vote.voterId === voterId ||
            (accountId !== undefined &&
              this.#publicVotes.get(key)?.accountId === accountId)) &&
          (before === undefined ||
            vote.castAt < before.castAt ||
            (vote.castAt.getTime() === before.castAt.getTime() &&
              Buffer.compare(
                Buffer.from(vote.pollId),
                Buffer.from(before.pollId),
              ) < 0)),
      )
      .map(([, vote]) => vote)
      .sort(
        (a, b) =>
          b.castAt.getTime() - a.castAt.getTime() ||
          Buffer.compare(Buffer.from(b.pollId), Buffer.from(a.pollId)),
      )
      .slice(0, limit + 1)
      .map((vote) => {
        const poll = this.#polls.get(vote.pollId);
        const ballot = [...vote.choices].sort((a, b) => a - b);
        return {
          pollId: vote.pollId,
          castAt: vote.castAt,
          ballot,
          ...(poll
            ? {
                poll: {
                  question: poll.question,
                  choices: ballot.flatMap((at) => poll.choices[at] ?? []),
                  ...(poll.closesAt ? { closesAt: poll.closesAt } : {}),
                },
              }
            : {}),
        };
      });
  }

  async castPublic(
    pollId: string,
    accountId: string,
    ballot: readonly number[],
    options: PublicCastOptions,
  ): Promise<CastResult> {
    const poll = this.#requirePoll(pollId);
    assertPublicCast(poll, accountId, ballot, options);
    const now = this.#clock();
    if (!isOpen(poll, now)) return { status: "closed" };

    const held = this.#publicKeyOf(pollId, accountId);
    const voterId =
      held === undefined
        ? newPublicVoterId()
        : (this.#votes.get(held)?.voterId as string);
    const choices = [...ballot].sort((a, b) => a - b);
    const vote: Vote = { pollId, voterId, choices, castAt: now };
    const key = voteKey(pollId, voterId);
    this.#votes.set(key, vote);
    // A re-cast keeps its code, as Postgres keeps the row's (decision 3).
    if (held === undefined) {
      this.#confirmations.set(key, options.confirmation);
      this.#publicVotes.set(key, { accountId, listKey: randomUUID() });
    }
    return { status: held === undefined ? "counted" : "changed", vote };
  }

  async publicVoteOf(
    pollId: string,
    accountId: string,
  ): Promise<Vote | undefined> {
    const key = this.#publicKeyOf(pollId, accountId);
    return key === undefined ? undefined : this.#votes.get(key);
  }

  async removePublicVote(
    pollId: string,
    accountId: string,
    lockKey: bigint,
  ): Promise<RemovalResult> {
    const poll = this.#requirePoll(pollId);
    if (poll.votePrivacy !== "public")
      throw new VotePrivacyError("an anonymous poll's votes are not removed");
    assertLockKey(lockKey);
    if (!isOpen(poll, this.#clock())) return { status: "closed" };
    const key = this.#publicKeyOf(pollId, accountId);
    if (key === undefined) return { status: "none" };
    this.#forget(key);
    return { status: "removed" };
  }

  async listPublicVotes(
    pollId: string,
    limit: number,
    after: string = FIRST_LIST_KEY,
  ): Promise<PublicVoteEntry[]> {
    assertListKey(after);
    // The in-memory store has no hidden polls.
    if (this.#polls.get(pollId)?.votePrivacy !== "public") return [];
    return [...this.#publicVotes.entries()]
      .flatMap(([key, link]) => {
        const vote = this.#votes.get(key);
        return vote?.pollId === pollId && link.listKey > after
          ? [{ vote, ...link }]
          : [];
      })
      .sort((a, b) => (a.listKey < b.listKey ? -1 : 1))
      .slice(0, limit + 1)
      .map(({ vote, accountId, listKey }) => ({
        name: this.#displayNameOf(accountId) ?? null,
        choices: [...vote.choices],
        listKey,
      }));
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

  /** The key of the vote on this poll that carries `code`, other than `not`. */
  #confirmedAs(pollId: string, code: string, not: string): string | undefined {
    for (const [key, held] of this.#confirmations) {
      if (key === not || held !== code) continue;
      if (this.#votes.get(key)?.pollId === pollId) return key;
    }
    return undefined;
  }

  /** The key of the account's public vote on this poll. */
  #publicKeyOf(pollId: string, accountId: string): string | undefined {
    for (const [key, link] of this.#publicVotes) {
      if (
        link.accountId === accountId &&
        this.#votes.get(key)?.pollId === pollId
      )
        return key;
    }
    return undefined;
  }

  #forget(key: string): void {
    this.#votes.delete(key);
    this.#confirmations.delete(key);
    this.#publicVotes.delete(key);
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

/**
 * Every store's check of a cast's options: a code of the right shape, and the
 * person's lock key with it (ADR-0046), so no store can confirm a vote outside
 * that person's lock.
 */
export function assertCastOptions(options: CastOptions): void {
  assertConfirmation(options.confirmation);
  if (options.confirmation !== undefined) assertLockKey(options.lockKey);
}

/** A lock key is a signed 64-bit integer: what `pg_advisory_xact_lock` takes. */
export function assertLockKey(key: unknown): void {
  if (typeof key !== "bigint" || key < -(2n ** 63n) || key >= 2n ** 63n) {
    throw new TypeError("a confirmation needs the person's lock key");
  }
}

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
