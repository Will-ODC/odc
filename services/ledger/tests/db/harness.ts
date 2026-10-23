import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import pg, { type Pool } from "pg";
import {
  APP_ROLE,
  databaseRequired,
  databaseUrl,
} from "../../src/db/config.js";
import {
  APPEND_LOCK_KEY,
  type EventRow,
  type Head,
} from "../../src/db/events.js";
import { migrate } from "../../src/db/migrate.js";

/**
 * Throwaway databases for the DB tests. Skipped when LEDGER_DATABASE_URL is
 * unset, unless LEDGER_REQUIRE_DATABASE=1, in which case `withDb` fails.
 */
const url = databaseUrl();
export const skip =
  url === undefined && !databaseRequired() && "no LEDGER_DATABASE_URL";

/** Tests only; production sets LEDGER_APP_PASSWORD. Same in every file. */
const APP_PASSWORD = "ledger_app_test";

/**
 * Roles are cluster-wide, so parallel test files race creating `ledger_app`
 * and setting its password. Advisory locks are per database, so this one is
 * taken in the shared admin database to serialize that work.
 */
const SETUP_LOCK_KEY = 1818588276;

/** `owner` is the migration role; `app` the runtime role the service uses. */
export type TestDb = Record<"owner" | "app", Pool>;

function dbUrl(base: string, name: string, user?: string, pw?: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  if (user !== undefined) [u.username, u.password] = [user, pw ?? ""];
  return u.toString();
}

/** Runs `fn` against a freshly created and migrated database, then drops it. */
export async function withDb(fn: (db: TestDb) => Promise<void>): Promise<void> {
  if (url === undefined) throw new Error("LEDGER_DATABASE_URL is required");
  const name = `ledger_t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  const owner = new pg.Pool({ connectionString: dbUrl(url, name) });
  let app: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.query(`SELECT pg_advisory_lock(${SETUP_LOCK_KEY})`);
    try {
      await migrate(owner, { appPassword: APP_PASSWORD });
    } finally {
      await admin.query(`SELECT pg_advisory_unlock(${SETUP_LOCK_KEY})`);
    }
    const appUrl = dbUrl(url, name, APP_ROLE, APP_PASSWORD);
    app = new pg.Pool({ connectionString: appUrl });
    await fn({ owner, app });
  } finally {
    await app?.end();
    await owner.end();
    // pg's Pool.end() resolves before its sockets close; a FORCE drop while
    // they linger raises an uncaught error into the next test. Wait first.
    const sessions = "SELECT count(*) FROM pg_stat_activity WHERE datname = $1";
    await waitFor(async () => (await countOf(admin, sessions, [name])) === 0);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
}

/** A test that runs in its own throwaway database. */
export function dbTest(name: string, fn: (db: TestDb) => Promise<void>): void {
  test(name, { skip, timeout: 30_000 }, () => withDb(fn));
}

/** A dummy but well-shaped hash: 64 lowercase hex, distinct per input. */
export function fakeHash(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

export const ZERO_HASH = "0".repeat(64);

/** A row whose `line` is shaped like a canonical export line. */
export function eventRow(
  seq: number,
  prevHash: string,
  { type = "test_event", hash = fakeHash(`event-${seq}-${prevHash}`) } = {},
): EventRow {
  const ts = "2026-10-21T00:00:00.000Z";
  const line =
    `{"seq":${seq},"type":"${type}","version":1,"payload":{"n":${seq}},` +
    `"ts":"${ts}","prev_hash":"${prevHash}","hash":"${hash}"}`;
  return { seq, type, version: 1, ts, prevHash, hash, line };
}

/** The row that correctly continues `head`. */
export function nextRow(head: Head | null): EventRow {
  return head === null
    ? eventRow(1, ZERO_HASH)
    : eventRow(head.seq + 1, head.hash);
}

/** `n` correctly linked rows starting at seq 1. */
export function chain(n: number): EventRow[] {
  const rows: EventRow[] = [];
  for (let i = 0; i < n; i++) rows.push(nextRow(rows.at(-1) ?? null));
  return rows;
}

/** A plain INSERT, bypassing the writer's lock: what only the DB guards stop. */
export async function insertRaw(pool: Pool, row: EventRow): Promise<void> {
  await pool.query(
    "INSERT INTO events (seq, type, version, ts, prev_hash, hash, line) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [row.seq, row.type, row.version, row.ts, row.prevHash, row.hash, row.line],
  );
}

/** Resolves when `pred` does, polling; fails after `ms`. */
export async function waitFor(
  pred: () => Promise<boolean>,
  ms = 10_000,
): Promise<void> {
  const until = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The count a `SELECT count(*) ...` query returns. */
export async function countOf(
  db: Pool | pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(sql, params);
  return Number(rows[0]?.count);
}

/** How many sessions in this database are queued on the append lock. */
export function appendLockWaiters(pool: Pool): Promise<number> {
  return countOf(
    pool,
    `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
       AND classid = 0 AND objid = $1 AND database =
       (SELECT oid FROM pg_database WHERE datname = current_database())`,
    [APPEND_LOCK_KEY],
  );
}
