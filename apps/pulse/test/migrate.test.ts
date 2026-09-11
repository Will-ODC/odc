import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Pool } from "pg";
import { databaseRequired, databaseUrl } from "../src/db/config.js";
import { MigrationError, migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";

/**
 * The runner, against a real Postgres.
 *
 * Skipping is decided by `databaseUrl`/`databaseRequired` — the same pair
 * `database.test.ts` uses — so `pnpm test` works on a laptop with nothing
 * installed, while a job that says it provides a database fails loudly instead
 * of skipping and reporting success. The guard lives here, in the thing that
 * runs, and not in a workflow step: turbo strips undeclared variables, so a
 * shell that has one is no evidence the task did.
 *
 * Each test works in a throwaway schema and drops it afterwards, so pointing
 * this at a database that has other things in it changes nothing of theirs.
 */
const url = databaseUrl();
const required = databaseRequired();
const skip =
  url === undefined && !required ? "PULSE_DATABASE_URL is unset" : false;

/** Milliseconds on purpose: a stored `timestamptz` would drop the .123. */
const AT = new Date("2026-09-11T09:30:00.123Z");

const TABLES = [
  "allowed_domain",
  "pending_claim",
  "poll_choice",
  "polls",
  "schema_migrations",
  "suggestion",
  "vote",
  "vote_choice",
  "voter",
];

test("an_empty_database_url_is_unset_rather_than_a_connection_string", () => {
  // The bug this fixes: an empty PULSE_DATABASE_URL ran the database tests and
  // then failed claiming PULSE_REQUIRE_DATABASE was set when it was not.
  assert.equal(databaseUrl({ PULSE_DATABASE_URL: "" }), undefined);
  assert.equal(databaseUrl({ PULSE_DATABASE_URL: "   " }), undefined);
  assert.equal(databaseUrl({}), undefined);
  assert.equal(
    databaseUrl({ PULSE_DATABASE_URL: " postgres://pulse@localhost/pulse " }),
    "postgres://pulse@localhost/pulse",
  );
});

test("only_the_string_1_makes_a_database_required", () => {
  // `CI=false` is a real convention; "any non-empty value" would read it as
  // "on CI" and turn a skip into a failure saying the opposite.
  assert.equal(databaseRequired({ PULSE_REQUIRE_DATABASE: "1" }), true);
  assert.equal(databaseRequired({ PULSE_REQUIRE_DATABASE: "false" }), false);
  assert.equal(databaseRequired({ PULSE_REQUIRE_DATABASE: "true" }), false);
  assert.equal(databaseRequired({}), false);
});

test("applies_a_fresh_schema", { skip }, async () => {
  await inThrowawaySchema(async (pool, schema) => {
    const result = await migrate(pool, { clock: () => AT });
    assert.deepEqual(result.applied, ["001"]);
    assert.deepEqual(await tablesIn(pool, schema), TABLES);
  });
});

test("applying_twice_changes_nothing", { skip }, async () => {
  await inThrowawaySchema(async (pool, schema) => {
    const first = await migrate(pool, { clock: () => AT });
    const again = await migrate(pool, { clock: () => new Date() });

    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.alreadyApplied, first.applied);
    assert.deepEqual(await tablesIn(pool, schema), TABLES);
    const { rows } = await pool.query<{ version: string; applied_at: Date }>(
      "select version, applied_at from schema_migrations",
    );
    assert.equal(rows.length, 1);
    // Still the first run's timestamp, and still the injected clock's — to the
    // millisecond, which is what timestamptz(3) is for.
    assert.equal(rows[0]?.applied_at.getTime(), AT.getTime());
  });
});

test("refuses_a_migration_that_changed_after_it_ran", { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pulse-migrations-"));
  const file = path.join(dir, "001_probe.sql");
  try {
    await inThrowawaySchema(async (pool) => {
      await writeFile(file, "create table probe (id text primary key);");
      await migrate(pool, { dir, clock: () => AT });
      await writeFile(file, "create table probe (id text, extra text);");
      // Forward-only: a correction is a new file, never an edit to one that
      // has run somewhere.
      await assert.rejects(
        migrate(pool, { dir, clock: () => AT }),
        MigrationError,
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function inThrowawaySchema(
  run: (pool: Pool, schema: string) => Promise<void>,
): Promise<void> {
  const connectionString = url ?? "";
  assert.ok(
    connectionString,
    "PULSE_REQUIRE_DATABASE is set but PULSE_DATABASE_URL is not — the job " +
      "must provide a database, and turbo.json must declare both variables " +
      "or the task never receives them",
  );

  const schema = `pulse_test_${randomUUID().replace(/-/g, "")}`;
  const admin = createPool({ connectionString });
  const pool = createPool({ connectionString, schema });
  try {
    await admin.query(`create schema ${schema}`);
    await run(pool, schema);
  } finally {
    await pool.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
}

async function tablesIn(pool: Pool, schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables" +
      " where table_schema = $1 order by table_name",
    [schema],
  );
  return rows.map((row) => row.table_name);
}
