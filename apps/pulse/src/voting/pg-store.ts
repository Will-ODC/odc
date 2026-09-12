import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction } from "../db/transaction.js";
import {
  createPoll,
  isOpen,
  type NewPoll,
  type Poll,
  type PollMethod,
} from "./poll.js";
import {
  UnknownPollError,
  resultsFor,
  validateBallot,
  type CastResult,
  type Results,
  type Vote,
  type VotingStore,
} from "./store.js";

/**
 * The voting store on Postgres — ADR-0021's four tables (`polls`,
 * `poll_choice`, `vote`, `vote_choice`) — held to the same conformance suite as
 * the in-memory store (`test/conformance/voting-store.ts`).
 *
 * Two rules the schema cannot keep, so this file does:
 *
 * - **A vote's choices belong to the vote's own poll.** Nothing ties
 *   `vote_choice`'s two foreign keys to one poll (see `001_initial.sql`), so
 *   every statement that writes or reads a pair names the poll on both sides.
 * - **Time comes from the injected clock, never the database** (ADR-0021).
 *
 * The wire still carries `ballot: number[]` — choice positions, value 1 each —
 * and this is the edge where positions become choice ids.
 */
export class PostgresVotingStore implements VotingStore {
  readonly #pool: Pool;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(
    pool: Pool,
    clock: () => Date = () => new Date(),
    newId: () => string = () => randomUUID(),
  ) {
    this.#pool = pool;
    this.#clock = clock;
    this.#newId = newId;
  }

  async createPoll(input: NewPoll): Promise<Poll> {
    // The same shape rules as every store, checked before anything is written.
    const poll = createPoll(input, this.#clock());
    await inTransaction(this.#pool, async (client) => {
      const { rowCount } = await client.query(
        "insert into polls" +
          " (id, question, method, created_at, closes_at, accepts_suggestions)" +
          " values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing",
        [
          poll.id,
          poll.question,
          poll.method,
          poll.createdAt,
          poll.closesAt ?? null,
          poll.acceptsSuggestions,
        ],
      );
      // The same refusal, and the same error, as the in-memory store.
      if (rowCount === 0) {
        throw new TypeError(`poll already exists: ${poll.id}`);
      }
      for (const [position, label] of poll.choices.entries()) {
        await client.query(
          "insert into poll_choice (id, poll_id, position, label, next_poll_id)" +
            " values ($1, $2, $3, $4, $5)",
          [
            this.#newId(),
            poll.id,
            position,
            label,
            poll.next[position] ?? null,
          ],
        );
      }
    });
    return poll;
  }

  async getPoll(pollId: string): Promise<Poll | undefined> {
    const { rows } = await this.#pool.query<PollRow>(
      "select id, question, method, created_at, closes_at, accepts_suggestions" +
        " from polls where id = $1",
      [pollId],
    );
    const row = rows[0];
    if (!row) return undefined;

    const choices = await this.#pool.query<ChoiceRow>(
      "select label, next_poll_id from poll_choice" +
        " where poll_id = $1 order by position",
      [pollId],
    );
    const poll: Poll = {
      id: row.id,
      question: row.question,
      choices: choices.rows.map((choice) => choice.label),
      // Plain text in the table on purpose (ADR-0021); `createPoll` checked it
      // against the known methods before this store ever wrote it.
      method: row.method as PollMethod,
      next: choices.rows.map((choice) => choice.next_poll_id),
      createdAt: row.created_at,
      acceptsSuggestions: row.accepts_suggestions,
    };
    // No close time means no `closesAt` key, exactly as `createPoll` builds it.
    return row.closes_at ? { ...poll, closesAt: row.closes_at } : poll;
  }

  async castVote(
    pollId: string,
    voterId: string,
    ballot: readonly number[],
  ): Promise<CastResult> {
    const poll = await this.#requirePoll(pollId);
    if (voterId.trim() === "") throw new TypeError("voterId must not be empty");
    validateBallot(poll, ballot);

    const now = this.#clock();
    // Checked before anything is written, so a late cast replaces nothing.
    if (!isOpen(poll, now)) return { status: "closed" };

    const choices = [...ballot].sort((a, b) => a - b);
    const inserted = await inTransaction(this.#pool, async (client) => {
      // One row per (poll, voter), and re-casting REPLACES it: the upsert pulse
      // is exempt to use and `services/` is not. `xmax = 0` holds only for a
      // row this statement inserted, which keeps "counted" and "changed" right
      // when two casts from one browser race — the second waits on the row
      // lock and then updates.
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        "insert into vote (id, poll_id, voter_id, cast_at)" +
          " values ($1, $2, $3, $4)" +
          " on conflict (poll_id, voter_id)" +
          " do update set cast_at = excluded.cast_at" +
          " returning id, (xmax = 0) as inserted",
        [this.#newId(), pollId, voterId, now],
      );
      const vote = only(rows);
      await client.query("delete from vote_choice where vote_id = $1", [
        vote.id,
      ]);
      // Positions become ids inside THIS poll, in the statement that writes
      // them — the guard 001_initial.sql leaves to the store.
      await client.query(
        "insert into vote_choice (vote_id, choice_id)" +
          " select $1, id from poll_choice" +
          " where poll_id = $2 and position = any($3::int[])",
        [vote.id, pollId, choices],
      );
      return vote.inserted;
    });

    const vote: Vote = { pollId, voterId, choices, castAt: now };
    return { status: inserted ? "counted" : "changed", vote };
  }

  async voteOf(pollId: string, voterId: string): Promise<Vote | undefined> {
    // The choice must be the vote's own poll's (`c.poll_id = v.poll_id`): a
    // pair naming another poll's choice is never read back as an answer.
    const { rows } = await this.#pool.query<{
      cast_at: Date;
      position: number | null;
    }>(
      "select v.cast_at, c.position from vote v" +
        " left join vote_choice vc on vc.vote_id = v.id" +
        " left join poll_choice c" +
        "   on c.id = vc.choice_id and c.poll_id = v.poll_id" +
        " where v.poll_id = $1 and v.voter_id = $2" +
        " order by c.position",
      [pollId, voterId],
    );
    const first = rows[0];
    if (!first) return undefined;
    return {
      pollId,
      voterId,
      choices: rows.flatMap((row) =>
        row.position === null ? [] : [row.position],
      ),
      castAt: first.cast_at,
    };
  }

  async results(pollId: string): Promise<Results> {
    const poll = await this.#requirePoll(pollId);
    // One snapshot for both numbers, or a cast landing between them could
    // report more choices picked than people who voted.
    const { voters, counts } = await inTransaction(
      this.#pool,
      async (client) => {
        const people = await client.query<{ voters: number }>(
          "select count(*)::int as voters from vote where poll_id = $1",
          [pollId],
        );
        const picked = await client.query<{ position: number; count: number }>(
          "select c.position, count(*)::int as count from vote_choice vc" +
            " join vote v on v.id = vc.vote_id" +
            " join poll_choice c on c.id = vc.choice_id" +
            " where v.poll_id = $1 and c.poll_id = $1" +
            " group by c.position",
          [pollId],
        );
        const counts = new Array<number>(poll.choices.length).fill(0);
        for (const row of picked.rows) counts[row.position] = row.count;
        return { voters: only(people.rows).voters, counts };
      },
      "begin isolation level repeatable read read only",
    );
    return resultsFor(poll, voters, counts);
  }

  async #requirePoll(pollId: string): Promise<Poll> {
    const poll = await this.getPoll(pollId);
    if (!poll) throw new UnknownPollError(pollId);
    return poll;
  }
}

interface PollRow {
  id: string;
  question: string;
  method: string;
  created_at: Date;
  closes_at: Date | null;
  accepts_suggestions: boolean;
}

interface ChoiceRow {
  label: string;
  next_poll_id: string | null;
}

/** For statements that always return exactly one row. */
function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected exactly one row");
  return row;
}
