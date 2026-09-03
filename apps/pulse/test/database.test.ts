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
 * Both variables are pulse-owned, and neither is inferred from the ambient
 * environment. That is deliberate on both counts:
 *
 * - A bare `DATABASE_URL` is among the most widely exported variables there
 *   is, so reading it would aim this suite at whatever unrelated database the
 *   developer already has configured. `select 1` would do no harm there; the
 *   store tests that land on this harness will run migrations, and those very
 *   much would.
 * - Whether a missing database is fatal is stated outright rather than guessed
 *   from `CI`, which developers carry in their shells for other reasons and
 *   which is sometimes set to the string "false".
 *
 * So: no URL and not required means skip, and `pnpm test` still works on a
 * laptop with nothing installed. Required and no URL is a failure, because a
 * skip there would report success while proving nothing — the deletable-green
 * shape every review of this codebase has found. The first version of this
 * test did exactly that for a full green run, because turbo's strict
 * environment stripped the variable before the task saw it and the skip
 * swallowed the evidence. The guard lives here, in the thing that actually
 * runs, rather than in a workflow step that can only see the shell.
 */
const url = process.env["PULSE_DATABASE_URL"];
const required = process.env["PULSE_REQUIRE_DATABASE"] === "1";

test(
  "connects_to_the_configured_database_and_runs_a_statement",
  {
    skip:
      url === undefined && !required ? "PULSE_DATABASE_URL is unset" : false,
  },
  async () => {
    assert.ok(
      url,
      "PULSE_REQUIRE_DATABASE is set but PULSE_DATABASE_URL is not — the job " +
        "must provide a database, and turbo.json must declare both variables " +
        "or the task never receives them",
    );

    const client = new pg.Client({ connectionString: url });
    // connect() belongs inside the try: a failure part-way through it can
    // leave the socket open, and an un-ended client keeps the test runner
    // alive until CI times out instead of reporting the failure.
    try {
      await client.connect();
      const { rows } = await client.query<{ one: number }>("select 1 as one");
      assert.deepEqual(rows, [{ one: 1 }]);
    } finally {
      await client.end();
    }
  },
);
