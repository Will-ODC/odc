import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../src/db/transaction.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

const AT = new Date("2026-09-11T12:00:00.123Z");

function insertPoll(db: Pool | PoolClient, id: string) {
  return db.query(
    "insert into polls (id, question, method, created_at, accepts_suggestions)" +
      " values ($1, 'Q', 'single', $2, false)",
    [id, AT],
  );
}

async function pollCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from polls",
  );
  return rows[0]?.n ?? -1;
}

/**
 * The count as any other connection sees it. The pool hands back the most
 * recently released connection first, and a transaction that never committed
 * would see its own row there — so hold that one while counting.
 */
async function pollCountElsewhere(pool: Pool): Promise<number> {
  const held = await pool.connect();
  try {
    return await pollCount(pool);
  } finally {
    held.release();
  }
}

/**
 * A pool of one fake connection, to see what `inTransaction` hands back. A
 * real pool cannot show it: pg already discards a connection that DIED, so
 * only a rollback failing on a live one tells the two apart.
 */
function onePool(options: { rollbackFails: boolean }) {
  const released: unknown[] = [];
  const client = {
    query: async (sql: string) => {
      if (sql === "rollback" && options.rollbackFails) {
        throw new Error("rollback failed");
      }
      return { rows: [], rowCount: 0 };
    },
    on: () => undefined,
    off: () => undefined,
    release: (destroy?: unknown) => {
      released.push(destroy);
    },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, released };
}

test("a_connection_whose_rollback_fails_is_discarded_not_reused", async () => {
  const { pool, released } = onePool({ rollbackFails: true });
  const boom = new Error("boom");
  await assert.rejects(
    inTransaction(pool, async () => {
      throw boom;
    }),
    (error: unknown) => error === boom,
  );
  assert.deepEqual(released, [true]);
});

test("a_connection_that_rolled_back_cleanly_goes_back_to_the_pool", async () => {
  const { pool, released } = onePool({ rollbackFails: false });
  await assert.rejects(
    inTransaction(pool, async () => {
      throw new Error("boom");
    }),
  );
  assert.deepEqual(released, [false]);
});

test("commits_what_the_work_wrote", { skip: databaseSkip }, async (t) => {
  const pool = await migratedSchema(t);
  const answer = await inTransaction(pool, async (client) => {
    await insertPoll(client, "p1");
    return "done";
  });
  assert.equal(answer, "done");
  assert.equal(await pollCountElsewhere(pool), 1);
});

test(
  "a_transaction_the_database_rolled_back_is_not_reported_as_committed",
  { skip: databaseSkip },
  async (t) => {
    // Work that catches a SQL error and carries on leaves the transaction
    // aborted; Postgres answers the COMMIT with a rollback and the write is
    // gone. That has to be an error, not a result.
    const pool = await migratedSchema(t);
    await assert.rejects(
      inTransaction(pool, async (client) => {
        await insertPoll(client, "p1");
        await client.query("select * from no_such_table").catch(() => null);
        return "done";
      }),
      /rolled this transaction back/,
    );
    assert.equal(await pollCountElsewhere(pool), 0);
  },
);

test(
  "rolls_back_and_reports_the_error_the_work_threw",
  { skip: databaseSkip },
  async (t) => {
    const pool = await migratedSchema(t);
    const boom = new Error("boom");
    await assert.rejects(
      inTransaction(pool, async (client) => {
        await insertPoll(client, "p1");
        throw boom;
      }),
      (error: unknown) => error === boom,
    );
    assert.equal(await pollCount(pool), 0);
  },
);

test(
  "a_dead_connection_does_not_hide_the_error_or_poison_the_pool",
  { skip: databaseSkip },
  async (t) => {
    // The work's connection is killed mid-transaction, so the rollback fails
    // too. The caller must hear why the WORK failed, not that rollback could
    // not run — and the next caller must get a working connection.
    const pool = await migratedSchema(t);
    let workError: unknown;
    await assert.rejects(
      inTransaction(pool, async (client) => {
        // Killing its own backend can fail this very statement or the next;
        // either way, it is the work's error the caller must see.
        try {
          await client.query("select pg_terminate_backend(pg_backend_pid())");
          await client.query("select 1");
        } catch (error) {
          workError = error;
          throw error;
        }
      }),
      (error: unknown) => error !== undefined && error === workError,
    );
    assert.equal(await pollCount(pool), 0);
  },
);
