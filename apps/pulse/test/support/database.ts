import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
// `pg` is CommonJS, and its named exports are built dynamically enough that
// Node's ESM interop cannot always see them. The default import always works.
import pg, { type Pool } from "pg";
import { databaseRequired, databaseUrl } from "../../src/db/config.js";
import { migrate } from "../../src/db/migrate.js";
import { createPool } from "../../src/db/pool.js";

/**
 * Running a test against a real Postgres, in a schema nobody else can see.
 *
 * Skipping follows the rule `database.test.ts` and `migrate.test.ts` already
 * use: no URL and not required means skip, so `pnpm test` works on a laptop
 * with nothing installed; required and no URL is a failure, because a skip
 * there would report success while proving nothing.
 */
const url = databaseUrl();

/** `skip` for a test or suite that needs a database: a reason, or `false`. */
export const databaseSkip: string | false =
  url === undefined && !databaseRequired()
    ? "PULSE_DATABASE_URL is unset"
    : false;

/**
 * A pool on a fresh, empty schema. When `t` ends — pass or fail — the pool is
 * closed and the schema dropped.
 *
 * The cleanup is registered before this returns, so whatever the caller does
 * next is cleaned up after even when it throws: a migration that fails still
 * leaves nothing behind. One schema per test, so tests cannot see each
 * other's rows and can run in parallel, and pointing the suite at a database
 * that holds other things changes nothing of theirs.
 */
export async function throwawaySchema(
  t: TestContext,
): Promise<{ pool: Pool; schema: string }> {
  assert.ok(
    url,
    "PULSE_REQUIRE_DATABASE is set but PULSE_DATABASE_URL is not — the job " +
      "must provide a database, and turbo.json must declare both variables " +
      "or the task never receives them",
  );
  const connectionString = url;
  const schema = `pulse_test_${randomUUID().replace(/-/g, "")}`;

  await onOneConnection(connectionString, `create schema ${schema}`);
  const pool = createPool({ connectionString, schema });
  t.after(async () => {
    // The drop runs even if closing the pool throws.
    try {
      await pool.end();
    } finally {
      await onOneConnection(
        connectionString,
        `drop schema if exists ${schema} cascade`,
      );
    }
  });
  return { pool, schema };
}

/** A `throwawaySchema` with every migration applied. */
export async function migratedSchema(t: TestContext): Promise<Pool> {
  const { pool } = await throwawaySchema(t);
  await migrate(pool);
  return pool;
}

async function onOneConnection(
  connectionString: string,
  sql: string,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  // connect() belongs inside the try: a failure part-way through can leave the
  // socket open, and an un-ended client keeps the runner alive until timeout.
  try {
    await client.connect();
    await client.query(sql);
  } finally {
    await client.end();
  }
}
