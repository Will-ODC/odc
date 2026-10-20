import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Pool, PoolClient } from "pg";
import { loadMigrations, migrate } from "../src/db/migrate.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { votingStoreConformance } from "./conformance/voting-store.js";
import {
  databaseSkip,
  migratedSchema,
  throwawaySchema,
} from "./support/database.js";

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

/** One person's confirmation code, as `ConfirmationKey.codeFor` shapes it. */
const ADA = "a".repeat(64);
const BO = "b".repeat(64);

test(
  "confirmations_racing_for_one_person_and_poll_are_one_confirmed_vote",
  { skip: databaseSkip },
  async (t) => {
    // ADR-0040's race: the same person confirming from three browsers at once
    // — two casting while signed in, one signing in after it voted. Held at a
    // barrier, as above, so all three writes are queued together and commit
    // in whatever order Postgres picks, rather than one after another as real
    // requests usually run. Every one lands (three ballots in the totals) and
    // exactly one counts as confirmed: at the same millisecond the tie goes to
    // the greatest ballot identity, b:3, whatever order they committed in. The
    // vote written before the barrier, b:0, is the tie's loser, so a store
    // that kept the first row it found would pick it.
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "b:0", [0]);
    const barrier = await pool.connect();
    try {
      await barrier.query("begin");
      await barrier.query("lock table vote in share row exclusive mode");
      const barrierPid = await backendPid(barrier);
      const racing = Promise.all([
        store.castVote("p1", "b:1", [0], { confirmation: ADA }),
        store.castVote("p1", "b:3", [1], { confirmation: ADA }),
        store.confirmVotes("b:0", () => ADA),
      ]);
      await until(async () => (await blockedBy(pool, barrierPid)) >= 3);
      await barrier.query("commit");
      await racing;

      const results = await store.results("p1");
      assert.equal(results.voters, 3);
      assert.equal(results.confirmedVoters, 1);
      assert.deepEqual(
        results.choices.map((c) => c.confirmedCount),
        [0, 1],
      );
      // All three rows carry the code; the count is one because the rule is
      // read from the rows, not because a write was lost.
      const { rows } = await pool.query<{ n: number }>(
        "select count(*)::int as n from vote where confirmation = $1",
        [ADA],
      );
      assert.equal(rows[0]?.n, 3);
    } finally {
      await barrier.query("rollback").catch(() => null);
      barrier.release();
    }
  },
);

test(
  "confirmed_results_are_one_snapshot_even_when_a_confirmation_lands_between_reads",
  { skip: databaseSkip },
  async (t) => {
    // results() counts confirmed people, then their picks. A confirmed cast
    // committing between those two must not be half-seen.
    const { pool, store: writer } = await fresh(t);
    await writer.castVote("p1", "b:1", [1], { confirmation: ADA });
    let interleaved = false;
    const reader = new PostgresVotingStore(
      afterStatement(pool, " as n from (", async () => {
        if (interleaved) return;
        interleaved = true;
        await writer.castVote("p1", "b:2", [0], { confirmation: BO });
      }),
      () => AT,
    );

    const results = await reader.results("p1");
    assert.ok(interleaved, "the cast never landed between the two reads");
    assert.equal(results.confirmedVoters, 1);
    assert.deepEqual(
      results.choices.map((c) => c.confirmedCount),
      [0, 1],
    );
  },
);

test(
  "the_confirmation_column_takes_only_a_keyed_code",
  { skip: databaseSkip },
  async (t) => {
    // The store refuses anything else before writing; this is the storage
    // layer refusing it too, whatever writes the row (ADR-0040).
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "b:1", [0]);
    for (const bad of ["ada@example.org", "voter-123", "A".repeat(64)]) {
      await assert.rejects(
        pool.query("update vote set confirmation = $1", [bad]),
        /vote_confirmation_is_a_code/,
      );
    }
    await pool.query("update vote set confirmation = $1", [ADA]);
    assert.equal((await store.results("p1")).confirmedVoters, 1);
  },
);

test(
  "votes_from_before_007_are_kept_and_are_unconfirmed",
  { skip: databaseSkip },
  async (t) => {
    const { pool } = await throwawaySchema(t);
    const dir = await mkdtemp(path.join(tmpdir(), "pulse-352-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    for (const m of (await loadMigrations()).filter((m) => m.version < "007")) {
      await writeFile(path.join(dir, `${m.version}_${m.name}.sql`), m.sql);
    }
    await migrate(pool, { dir, clock: () => AT });
    // Rows, not the store: today's store writes the column 007 adds.
    await pool.query(
      "insert into polls (id, question, method, created_at, accepts_suggestions)" +
        " values ('old', 'Q', 'single', $1, false)",
      [AT],
    );
    await pool.query(
      "insert into poll_choice (id, poll_id, position, label) values" +
        " ($1, 'old', 0, 'A'), ($2, 'old', 1, 'B')",
      [randomUUID(), randomUUID()],
    );
    await pool.query(
      "insert into vote (id, poll_id, voter_id, cast_at)" +
        " values ($1, 'old', 'b:before', $2)",
      [randomUUID(), AT],
    );
    await pool.query(
      "insert into vote_choice (vote_id, choice_id)" +
        " select v.id, c.id from vote v join poll_choice c" +
        " on c.poll_id = v.poll_id and c.position = 1",
    );

    assert.equal((await migrate(pool)).applied[0], "007");

    const store = new PostgresVotingStore(pool, () => AT);
    const results = await store.results("old");
    assert.equal(results.voters, 1);
    assert.deepEqual(
      results.choices.map((c) => c.count),
      [0, 1],
    );
    assert.equal(results.confirmedVoters, 0);
    // And the browser that cast it can still have it confirmed by signing in.
    assert.equal(await store.confirmVotes("b:before", () => ADA), 1);
    assert.equal((await store.results("old")).confirmedVoters, 1);
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
  return afterStatement(pool, " as voters ", between);
}

/**
 * The same pool, except that each connection runs `between` right after any
 * statement whose text contains `needle` returns.
 */
function afterStatement(
  pool: Pool,
  needle: string,
  between: () => Promise<void>,
): Pool {
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
            if (typeof sql === "string" && sql.includes(needle)) {
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
