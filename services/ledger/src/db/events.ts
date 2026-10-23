import type { Pool, PoolClient } from "pg";

/**
 * The event store, used as the runtime role (`ledger_app`: SELECT, INSERT).
 *
 * This module stores and reads; it does not hash, serialize or verify. The
 * caller supplies each row's `line` and `hash`. The database refuses a row
 * whose seq or prev_hash breaks the chain, or whose columns disagree with its
 * `line` (migrations/001_events.sql), so those bugs fail the append. It does
 * not recompute `hash` or check the line is canonical: that is EV-26, above.
 */
export interface EventRow {
  seq: number;
  type: string;
  version: number;
  /** The envelope's RFC 3339 `ts` string, as written in `line`. */
  ts: string;
  prevHash: string;
  hash: string;
  /** The canonical export line (EX-7..EX-9), without its trailing LF. */
  line: string;
}

export type Head = Pick<EventRow, "seq" | "hash">;

/** "ledg". The insert trigger takes the same key. Per database. */
export const APPEND_LOCK_KEY = 1818584167;

// bigint arrives from pg as a string; float8 arrives as a number, exact here
// because the column CHECKs keep seq and version within 2^53 - 1.
const COLUMNS = `seq::float8 AS seq, type, version::float8 AS version, ts,
  prev_hash AS "prevHash", hash, line`;

function assertCount(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a safe integer >= ${min}`);
  }
}

/** The highest-seq event's seq and hash, or null for an empty log. */
export async function head(client: Pool | PoolClient): Promise<Head | null> {
  const { rows } = await client.query<Head>(
    "SELECT seq::float8 AS seq, hash FROM events ORDER BY events.seq DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

/**
 * Appends a run of events as one transaction under the single-writer lock.
 *
 * `prepare` runs INSIDE the lock, given the current head, and returns the rows
 * to append in order; the tail cannot move until they commit or the call
 * fails. This is where the caller builds and verifies lines (EV-26), since
 * each hash covers `seq` and `prev_hash`. Returns the stored rows, as read
 * back. An empty run appends nothing. Any error rolls back the whole run.
 */
export async function appendRun(
  pool: Pool,
  prepare: (head: Head | null) => EventRow[] | Promise<EventRow[]>,
): Promise<EventRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [APPEND_LOCK_KEY]);
    const stored: EventRow[] = [];
    for (const r of await prepare(await head(client))) {
      const { rows } = await client.query<EventRow>(
        `INSERT INTO events (seq, type, version, ts, prev_hash, hash, line)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [r.seq, r.type, r.version, r.ts, r.prevHash, r.hash, r.line],
      );
      stored.push(rows[0] as EventRow);
    }
    await client.query("COMMIT");
    return stored;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** One event: `appendRun` with a single row. */
export async function appendEvent(
  pool: Pool,
  prepare: (head: Head | null) => EventRow | Promise<EventRow>,
): Promise<EventRow> {
  const [row] = await appendRun(pool, async (h) => [await prepare(h)]);
  return row as EventRow;
}

/** Events with seq > since, ascending, at most `limit` (read-api.md RA-2). */
export async function readSince(
  pool: Pool,
  since: number,
  limit: number,
): Promise<EventRow[]> {
  assertCount("since", since, 0);
  assertCount("limit", limit, 1);
  const { rows } = await pool.query<EventRow>(
    `SELECT ${COLUMNS} FROM events WHERE seq > $1 ORDER BY events.seq LIMIT $2`,
    [since, limit],
  );
  return rows;
}

/**
 * The export, one chunk per event: its line plus "\n", in seq order, so the
 * chunks concatenated are the export file byte for byte (EX-4). Reads through
 * a server-side cursor in one snapshot, `batchSize` lines at a time, so the
 * log is never held in memory. Breaking out of the loop releases the cursor.
 */
export async function* exportLines(
  pool: Pool,
  batchSize = 500,
): AsyncGenerator<string> {
  assertCount("batchSize", batchSize, 1);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(
      "DECLARE export_cursor NO SCROLL CURSOR FOR SELECT line FROM events ORDER BY seq",
    );
    for (;;) {
      const { rows } = await client.query<{ line: string }>(
        `FETCH FORWARD ${batchSize} FROM export_cursor`,
      );
      for (const r of rows) yield `${r.line}\n`;
      if (rows.length < batchSize) break;
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
