import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { databaseRequired, databaseUrl } from "../../src/db/config.js";
import { migrate } from "../../src/db/migrate.js";
import { chain, insertRaw, skip, withDb } from "./harness.js";

const CHANGES = [
  "UPDATE events SET type = 'tampered'",
  "DELETE FROM events",
  "TRUNCATE events",
] as const;

async function seed(pool: Pool): Promise<void> {
  for (const row of chain(3)) await insertRaw(pool, row);
}

async function count(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM events",
  );
  return Number(rows[0]?.n);
}

test("blank_and_non_1_env_values_do_not_enable_the_database", () => {
  assert.equal(databaseUrl({ LEDGER_DATABASE_URL: "  " }), undefined);
  assert.equal(databaseUrl({}), undefined);
  assert.equal(databaseRequired({ LEDGER_REQUIRE_DATABASE: "true" }), false);
  assert.equal(databaseRequired({ LEDGER_REQUIRE_DATABASE: "1" }), true);
});

test(
  "runtime_role_is_refused_update_delete_and_truncate_by_privilege",
  { skip },
  () =>
    withDb(async ({ app }) => {
      await seed(app);
      for (const sql of CHANGES) {
        await assert.rejects(app.query(sql), { code: "42501" }, sql);
      }
      assert.equal(await count(app), 3);
    }),
);

test(
  "triggers_refuse_update_delete_and_truncate_even_for_the_owner",
  { skip },
  () =>
    withDb(async ({ owner }) => {
      await seed(owner);
      for (const sql of CHANGES) {
        await assert.rejects(
          owner.query(sql),
          { code: "23001", message: /insert-only/ },
          sql,
        );
      }
      // Statement-level: refused even when no row matches.
      await assert.rejects(owner.query("DELETE FROM events WHERE seq = 999"), {
        code: "23001",
      });
      assert.equal(await count(owner), 3);
    }),
);

test(
  "fresh_migration_grants_the_runtime_role_select_and_insert_only",
  { skip },
  () =>
    withDb(async ({ owner }) => {
      const { rows } = await owner.query<{ p: string; ok: boolean }>(
        `SELECT p, has_table_privilege('ledger_app', 'events', p) AS ok
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`,
      );
      const granted = rows.filter((r) => r.ok).map((r) => r.p);
      assert.deepEqual(granted, ["SELECT", "INSERT"]);
      const migrations = await owner.query(
        "SELECT has_table_privilege('ledger_app', 'schema_migrations', 'SELECT') AS ok",
      );
      assert.equal(migrations.rows[0]?.ok, false);
    }),
);

test("migrating_twice_applies_nothing_the_second_time", { skip }, () =>
  withDb(async ({ owner }) => {
    assert.deepEqual(await migrate(owner), []);
  }),
);
