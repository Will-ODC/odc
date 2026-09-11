import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import pg from "pg";
import { databaseUrl } from "../src/db/config.js";
import { migrate } from "../src/db/migrate.js";
import {
  databaseSkip,
  migratedSchema,
  throwawaySchema,
} from "./support/database.js";

/**
 * The harness every Postgres store test stands on. If it shared a schema
 * between tests, one test's rows would leak into another's assertions; if it
 * left schemas behind, every run would grow the database.
 */
test(
  "each_test_gets_a_migrated_schema_of_its_own_and_loses_it_after",
  { skip: databaseSkip },
  async (t) => {
    const schemas: string[] = [];
    for (const name of ["first", "second"]) {
      await t.test(name, async (inner) => {
        const pool = await migratedSchema(inner);
        const { rows } = await pool.query<{ schema: string; polls: string }>(
          "select current_schema() as schema," +
            " to_regclass('polls')::text as polls",
        );
        assert.equal(rows[0]?.polls, "polls", "the schema was not migrated");
        schemas.push(rows[0]?.schema ?? "");
      });
    }

    assert.equal(schemas.length, 2);
    assert.ok(schemas.every((s) => s.startsWith("pulse_test_")));
    assert.notEqual(schemas[0], schemas[1], "two tests shared a schema");
    assert.deepEqual(
      await surviving(schemas),
      [],
      "a test's schema outlived it",
    );
  },
);

test(
  "a_schema_whose_migration_fails_is_still_removed",
  { skip: databaseSkip },
  async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), "pulse-harness-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(path.join(dir, "001_broken.sql"), "this is not sql;");

    let schema = "";
    await t.test("migrating fails", async (inner) => {
      const made = await throwawaySchema(inner);
      schema = made.schema;
      await assert.rejects(migrate(made.pool, { dir }));
    });

    assert.ok(schema.startsWith("pulse_test_"));
    assert.deepEqual(
      await surviving([schema]),
      [],
      "a failed test's schema outlived it",
    );
  },
);

/** Which of these schemas still exist. */
async function surviving(schemas: string[]): Promise<unknown[]> {
  const client = new pg.Client({ connectionString: databaseUrl() ?? "" });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select nspname from pg_namespace where nspname = any($1)",
      [schemas],
    );
    return rows;
  } finally {
    await client.end();
  }
}
