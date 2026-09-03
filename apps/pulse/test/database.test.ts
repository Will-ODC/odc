import assert from "node:assert/strict";
import { test } from "node:test";
// `pg` is CommonJS, and its named exports are built dynamically enough that
// Node's ESM interop cannot always see them. The default import always works.
import pg from "pg";

/**
 * Proves the database CI provides is reachable and that `pg` can talk to it.
 *
 * Nothing in `src/` uses Postgres yet — this is the harness the store
 * implementations land on, checked in first and on its own so a failure here
 * is a CI problem and never a schema problem.
 *
 * The skip below is the risk worth naming: a test that quietly does nothing
 * passes while proving nothing, which is the shape every review of this
 * codebase has found. It exists so `pnpm test` still works on a laptop with no
 * Postgres running. CI closes the hole from the other side — `repo.yml`
 * asserts DATABASE_URL is set before it runs the suite, so this branch is
 * unreachable there.
 */
const url = process.env["DATABASE_URL"];

test(
  "connects_to_the_configured_database_and_runs_a_statement",
  { skip: url === undefined ? "DATABASE_URL is unset" : false },
  async () => {
    assert.ok(url, "DATABASE_URL is unset");

    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const { rows } = await client.query<{ one: number }>("select 1 as one");
      assert.deepEqual(rows, [{ one: 1 }]);
    } finally {
      await client.end();
    }
  },
);
