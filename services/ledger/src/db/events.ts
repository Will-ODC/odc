import pg, { type Pool, type PoolClient } from "pg";

/**
 * The event store, used as the runtime role (`ledger_app`: SELECT, INSERT).
 *
 * This module stores and reads; it does not hash, serialize or verify. The
 * caller supplies each row's canonical `line` and `hash`. The database itself
 * refuses a row that breaks the chain (migrations/001_events.sql), so a bug
 * above this layer surfaces as a failed append, never as a broken log.
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

export interface Head {
  seq: number;
  hash: string;
}

/** "ledg". The insert trigger takes the same key. Per database. */
export const APPEND_LOCK_KEY = 1818584167;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString });
}

const COLUMNS = "seq, type, version, ts, prev_hash, hash, line";

interface DbRow {
  seq: string;
  type: string;
  version: string;
  ts: string;
  prev_hash: string;
  hash: string;
  line: string;
}

/** bigint arrives as a string; the column CHECKs keep it within 2^53 - 1. */
function toRow(r: DbRow): EventRow {
  return {
    seq: Number(r.seq),
    type: r.type,
    version: Number(r.version),
    ts: r.ts,
    prevHash: r.prev_hash,
    hash: r.hash,
    line: r.line,
  };
}

function assertCount(name: string, value: number, min: number): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(
      `${name} must be a safe integer >= ${min}, got ${value}`,
    );
  }
}

async function headOn(client: Pool | PoolClient): Promise<Head | null> {
  const { rows } = await client.query<{ seq: string; hash: string }>(
    "SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1",
  );
  const r = rows[0];
  return r === undefined ? null : { seq: Number(r.seq), hash: r.hash };
}

/** The highest-seq event's seq and hash, or null for an empty log. */
export function head(pool: Pool): Promise<Head | null> {
  return headOn(pool);
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
    const rows = await prepare(await headOn(client));
    const stored: EventRow[] = [];
    for (const row of rows) {
      const { rows: out } = await client.query<DbRow>(
        `INSERT INTO events (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
        [
          row.seq,
          row.type,
          row.version,
          row.ts,
          row.prevHash,
          row.hash,
          row.line,
        ],
      );
      stored.push(toRow(out[0] as DbRow));
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
  const { rows } = await pool.query<DbRow>(
    `SELECT ${COLUMNS} FROM events WHERE seq > $1 ORDER BY seq LIMIT $2`,
    [since, limit],
  );
  return rows.map(toRow);
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
