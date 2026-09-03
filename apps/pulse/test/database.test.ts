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
 * Off CI the test skips, so `pnpm test` still works on a laptop with no
 * Postgres running. On CI it must never skip: a missing DATABASE_URL there is
 * a broken pipeline, and a skip would report success while proving nothing —
 * the deletable-green shape every review of this codebase has found. The first
 * version of this test did exactly that for a full green run, because turbo's
 * strict environment stripped DATABASE_URL before the task saw it and the
 * skip swallowed the evidence. Hence the guard lives here, in the thing that
 * actually runs, rather than in a workflow step that can only see the shell.
 */
const url = process.env["DATABASE_URL"];
const onCI = (process.env["CI"] ?? "") !== "";

test(
  "connects_to_the_configured_database_and_runs_a_statement",
  { skip: url === undefined && !onCI ? "DATABASE_URL is unset" : false },
  async () => {
    assert.ok(
      url,
      "DATABASE_URL is unset on CI — the job must provide a database, and " +
        "turbo.json must declare the variable or the task never receives it",
    );

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
