import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { inTransaction } from "../db/transaction.js";
import type { Poll } from "./poll.js";
import { UnknownPollError } from "./store.js";
import {
  decide,
  tidy,
  type SubmitResult,
  type Suggestion,
  type SuggestionStore,
} from "./suggestions.js";

const COLUMNS = "id, poll_id, text, count, added_at";

/**
 * Suggestions on Postgres, held to the same conformance suite as the
 * in-memory store (`test/conformance/suggestion-store.ts`). What counts as the
 * same idea is decided by `decide` in suggestions.ts; this file keeps rows.
 */
export class PostgresSuggestionStore implements SuggestionStore {
  readonly #pool: Pool;
  readonly #clock: () => Date;
  readonly #newId: () => string;

  constructor(
    pool: Pool,
    options: { clock?: () => Date; newId?: () => string } = {},
  ) {
    this.#pool = pool;
    this.#clock = options.clock ?? (() => new Date());
    this.#newId = options.newId ?? (() => randomUUID());
  }

  async submit(poll: Poll, text: string): Promise<SubmitResult> {
    // Junk is refused before a connection or a lock is taken.
    const tidied = tidy(text);
    return inTransaction<SubmitResult>(this.#pool, async (client) => {
      // One submission per poll at a time. Two people saying the same new
      // thing at once must be one suggestion seconded, not two added, and
      // that needs each to see the other's row — so they take turns on the
      // poll's own row. `for no key update` conflicts with itself, which is
      // the turn-taking, but not with the key-share lock every foreign-key
      // insert takes: votes on the same poll carry on meanwhile.
      const locked = await client.query(
        "select 1 from polls where id = $1 for no key update",
        [poll.id],
      );
      if (locked.rowCount === 0) throw new UnknownPollError(poll.id);

      const { rows } = await client.query<SuggestionRow>(
        `select ${COLUMNS} from suggestion where poll_id = $1` +
          " order by added_at, id",
        [poll.id],
      );
      const decision = decide(poll, tidied, rows.map(toSuggestion));
      switch (decision.kind) {
        case "on_ballot":
          return {
            status: "on_ballot",
            choice: decision.choice,
            related: decision.related,
          };
        case "second": {
          const updated = await client.query<SuggestionRow>(
            "update suggestion set count = count + 1 where id = $1" +
              ` returning ${COLUMNS}`,
            [decision.suggestion.id],
          );
          return {
            status: "seconded",
            suggestion: toSuggestion(only(updated.rows)),
            related: decision.related,
          };
        }
        case "add": {
          const suggestion: Suggestion = {
            id: this.#newId(),
            pollId: poll.id,
            text: decision.text,
            count: 1,
            addedAt: this.#clock(),
          };
          await client.query(
            `insert into suggestion (${COLUMNS}) values ($1, $2, $3, $4, $5)`,
            [
              suggestion.id,
              suggestion.pollId,
              suggestion.text,
              suggestion.count,
              suggestion.addedAt,
            ],
          );
          return { status: "added", suggestion, related: decision.related };
        }
      }
    });
  }

  async list(pollId: string): Promise<Suggestion[]> {
    // Most-said first, then oldest first: the in-memory store's order. Two
    // added in the same millisecond have no order between them; the id keeps
    // the list from shuffling between reads.
    const { rows } = await this.#pool.query<SuggestionRow>(
      `select ${COLUMNS} from suggestion where poll_id = $1` +
        " order by count desc, added_at, id",
      [pollId],
    );
    return rows.map(toSuggestion);
  }
}

interface SuggestionRow {
  id: string;
  poll_id: string;
  text: string;
  count: number;
  added_at: Date;
}

function toSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    pollId: row.poll_id,
    text: row.text,
    count: row.count,
    addedAt: row.added_at,
  };
}

/** For statements that always return exactly one row. */
function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error("expected exactly one row");
  return row;
}
