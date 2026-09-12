import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { Pool, PoolClient } from "pg";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { votingStoreConformance } from "./conformance/voting-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

// The Postgres voting store, held to the suite every implementation runs.
votingStoreConformance(
  "postgres",
  async (clock, t) => new PostgresVotingStore(await migratedSchema(t), clock),
  { skip: databaseSkip },
);

// What only a database store can get wrong: concurrency, the order rows sit
// in, and rows it did not write itself.

const AT = new Date("2026-09-11T12:00:00.123Z");

async function fresh(t: TestContext, clock: () => Date = () => AT) {
  const pool = await migratedSchema(t);
  const store = new PostgresVotingStore(pool, clock);
  for (const id of ["p1", "p2"]) {
    await store.createPoll({
      id,
      question: "Q",
      choices: ["a", "b"],
      method: "single",
    });
  }
  return { pool, store };
}

test(
  "one_browser_racing_itself_is_one_voter_counted_once",
  { skip: databaseSkip },
  async (t) => {
    // Eight casts from one ballot identity at once — a double tap, a retry, two
    // tabs. Eight real casts rarely overlap on their own (each reads the poll
    // first, and some open a connection), and a check-then-write store passes
    // when they run one after another. So hold them at a barrier: a lock on the
    // vote table every cast's write must wait for, released only once all
    // eight are queued behind it.
    const { pool, store } = await fresh(t);
    const barrier = await pool.connect();
    try {
      await barrier.query("begin");
      await barrier.query("lock table vote in share row exclusive mode");
      const barrierPid = await backendPid(barrier);
      const casts = Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          store.castVote("p1", "voter-a", [i % 2]),
        ),
      );
      await until(async () => (await blockedBy(pool, barrierPid)) >= 8);
      await barrier.query("commit");

      const statuses = (await casts).map((cast) => cast.status);
      assert.equal(statuses.filter((s) => s === "counted").length, 1);
      assert.equal(statuses.filter((s) => s === "changed").length, 7);
      const results = await store.results("p1");
      assert.equal(results.voters, 1);
      assert.equal(
        results.choices.reduce((sum, choice) => sum + choice.count, 0),
        1,
      );
    } finally {
      await barrier.query("rollback").catch(() => null);
      barrier.release();
    }
  },
);

test(
  "results_are_one_snapshot_even_when_a_cast_lands_between_its_reads",
  { skip: databaseSkip },
  async (t) => {
    // results() counts the people, then the picks. A cast committing between
    // the two must not be half-seen: without one snapshot the picks include it
    // and the people do not, and a single-choice poll shows more picks than
    // voters.
    const { pool, store: writer } = await fresh(t);
    await writer.castVote("p1", "voter-a", [1]);
    let interleaved = false;
    const reader = new PostgresVotingStore(
      afterVoterCount(pool, async () => {
        if (interleaved) return;
        interleaved = true;
        await writer.castVote("p1", "voter-b", [0]);
      }),
      () => AT,
    );

    const results = await reader.results("p1");
    assert.ok(interleaved, "the cast never landed between the two reads");
    assert.equal(results.voters, 1);
    assert.deepEqual(
      results.choices.map((c) => c.count),
      [0, 1],
    );
  },
);

test(
  "a_changed_vote_takes_the_time_it_was_changed",
  { skip: databaseSkip },
  async (t) => {
    let now = AT;
    const { store } = await fresh(t, () => now);
    await store.castVote("p1", "voter-a", [0]);
    now = new Date(AT.getTime() + 60_000);
    await store.castVote("p1", "voter-a", [1]);
    assert.equal(
      (await store.voteOf("p1", "voter-a"))?.castAt.getTime(),
      now.getTime(),
    );
  },
);

test(
  "choices_come_back_by_position_whatever_order_the_rows_were_written_in",
  { skip: databaseSkip },
  async (t) => {
    // Rows usually sit in the order they were written, which is position
    // order, so a missing ORDER BY would go unnoticed. Write them backwards.
    const pool = await migratedSchema(t);
    await pool.query(
      "insert into polls (id, question, method, created_at, accepts_suggestions)" +
        " values ('rev', 'Q', 'approval', $1, false)",
      [AT],
    );
    for (const [position, label] of [
      [2, "c"],
      [1, "b"],
      [0, "a"],
    ] as const) {
      await pool.query(
        "insert into poll_choice (id, poll_id, position, label, next_poll_id)" +
          " values ($1, 'rev', $2, $3, null)",
        [randomUUID(), position, label],
      );
    }
    const store = new PostgresVotingStore(pool, () => AT);

    assert.deepEqual((await store.getPoll("rev"))?.choices, ["a", "b", "c"]);

    // And the ballot's own rows, rewritten backwards: the store writes them by
    // looking choices up through an index, which hands them over in order.
    await store.castVote("rev", "voter-a", [0, 2]);
    await pool.query("delete from vote_choice");
    for (const position of [2, 0]) {
      await pool.query(
        "insert into vote_choice (vote_id, choice_id)" +
          " select v.id, c.id from vote v" +
          " join poll_choice c on c.poll_id = v.poll_id" +
          " where v.poll_id = 'rev' and c.position = $1",
        [position],
      );
    }
    assert.deepEqual((await store.voteOf("rev", "voter-a"))?.choices, [0, 2]);
  },
);

test(
  "a_stored_pair_naming_another_polls_choice_is_never_read_as_an_answer",
  { skip: databaseSkip },
  async (t) => {
    // The schema accepts this row (see `vote_choice` in 001_initial.sql). The
    // store never writes one; this forges one to prove it never reads one
    // either — not into results, and not into the voter's own ballot.
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "voter-a", [0]);
    await pool.query(
      "insert into vote_choice (vote_id, choice_id)" +
        " select v.id, c.id from vote v, poll_choice c" +
        " where v.poll_id = 'p1' and c.poll_id = 'p2' and c.position = 1",
    );

    const p1 = await store.results("p1");
    assert.deepEqual(
      p1.choices.map((c) => c.count),
      [1, 0],
    );
    assert.deepEqual(
      (await store.results("p2")).choices.map((c) => c.count),
      [0, 0],
    );
    assert.deepEqual((await store.voteOf("p1", "voter-a"))?.choices, [0]);
  },
);

test(
  "a_cast_stores_no_pair_that_names_another_polls_choice",
  { skip: databaseSkip },
  async (t) => {
    // The reads ignore such a pair (the test above), which would also hide a
    // write that made one. So look at the rows themselves: every stored
    // choice belongs to its vote's own poll, and a replaced ballot is gone.
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "voter-a", [1]);
    await store.castVote("p2", "voter-a", [0]);
    await store.castVote("p1", "voter-a", [0]);

    const { rows: crossed } = await pool.query<{ n: number }>(
      "select count(*)::int as n from vote_choice vc" +
        " join vote v on v.id = vc.vote_id" +
        " join poll_choice c on c.id = vc.choice_id" +
        " where c.poll_id <> v.poll_id",
    );
    assert.equal(crossed[0]?.n, 0, "a pair names another poll's choice");
    const { rows: stored } = await pool.query<{ n: number }>(
      "select count(*)::int as n from vote_choice",
    );
    assert.equal(stored[0]?.n, 2, "one choice per ballot, none left over");
  },
);

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return rows[0]?.pid ?? -1;
}

/**
 * How many sessions are waiting on a lock the session `pid` holds. Asked of
 * Postgres directly, so other runs sharing the database are never counted.
 */
async function blockedBy(pool: Pool, pid: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity" +
      " where $1 = any(pg_blocking_pids(pid))",
    [pid],
  );
  return rows[0]?.n ?? 0;
}

async function until(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * The same pool, except that each connection runs `between` right after a
 * statement that counts voters returns — the moment a concurrent cast would
 * land in the middle of `results()`.
 */
function afterVoterCount(pool: Pool, between: () => Promise<void>): Pool {
  const connect = async (): Promise<PoolClient> => {
    const client = await pool.connect();
    return new Proxy(client, {
      get(target, property) {
        if (property === "query") {
          return async (...args: unknown[]) => {
            const query = target.query as unknown as (
              ...a: unknown[]
            ) => Promise<unknown>;
            const result = await query.apply(target, args);
            const [sql] = args;
            if (typeof sql === "string" && sql.includes(" as voters ")) {
              await between();
            }
            return result;
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return new Proxy(pool, {
    get(target, property) {
      if (property === "connect") return connect;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
