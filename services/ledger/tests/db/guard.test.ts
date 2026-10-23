import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import pg, { type Pool } from "pg";
import { databaseRequired, databaseUrl } from "../../src/db/config.js";
import { migrate, scramVerifier } from "../../src/db/migrate.js";
import { chain, countOf, insertRaw, dbTest } from "./harness.js";

const CHANGES = [
  "UPDATE events SET type = 'tampered'",
  "DELETE FROM events",
  "TRUNCATE events",
] as const;

async function seed(pool: Pool): Promise<void> {
  for (const row of chain(3)) await insertRaw(pool, row);
}

const count = (pool: Pool) => countOf(pool, "SELECT count(*) FROM events");

test("blank_and_non_1_env_values_do_not_enable_the_database", () => {
  assert.equal(databaseUrl({ LEDGER_DATABASE_URL: "  " }), undefined);
  assert.equal(databaseUrl({}), undefined);
  assert.equal(databaseRequired({ LEDGER_REQUIRE_DATABASE: "true" }), false);
  assert.equal(databaseRequired({ LEDGER_REQUIRE_DATABASE: "1" }), true);
});

dbTest("app_role_lacks_update_delete_truncate_privilege", async ({ app }) => {
  await seed(app);
  for (const sql of CHANGES) {
    await assert.rejects(app.query(sql), { code: "42501" }, sql);
  }
  assert.equal(await count(app), 3);
});

dbTest("triggers_refuse_changes_even_for_the_owner", async ({ owner }) => {
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
});

dbTest("app_role_is_granted_select_and_insert_only", async ({ owner }) => {
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
});

dbTest("migrating_twice_applies_nothing_the_second_time", async ({ owner }) => {
  assert.deepEqual(await migrate(owner), []);
});

dbTest("migrate_refuses_when_an_applied_file_is_gone", async ({ owner }) => {
  const empty = await mkdtemp(`${tmpdir()}/ledger-migrations-`);
  await assert.rejects(migrate(owner, { dir: empty }), /001 has no file/);
});

dbTest("app_password_is_a_scram_verifier_and_works", async ({ owner, app }) => {
  const { rows } = await owner.query<{ p: string }>(
    "SELECT rolpassword AS p FROM pg_authid WHERE rolname = 'ledger_app'",
  );
  assert.match(rows[0]?.p ?? "", /^SCRAM-SHA-256\$4096:[^$]+\$[^:]+:.+$/);
  const who = await app.query<{ u: string }>("SELECT current_user AS u");
  assert.equal(who.rows[0]?.u, "ledger_app");
  const url = new URL(String(app.options.connectionString));
  url.password = "wrong";
  const bad = new pg.Client({ connectionString: url.toString() });
  await assert.rejects(bad.connect(), { code: "28P01" });
});

test("scram_verifier_refuses_a_password_it_cannot_prepare_exactly", () => {
  assert.throws(() => scramVerifier("pässword"), /printable ASCII/);
  assert.throws(() => scramVerifier(""), /printable ASCII/);
});
