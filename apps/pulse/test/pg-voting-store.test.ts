import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Pool, PoolClient } from "pg";
import { loadMigrations, migrate } from "../src/db/migrate.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
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

/** Their lock keys, as `ConfirmationKey.lockKeyFor` gives (ADR-0046). */
const asAda = { confirmation: ADA, lockKey: 7_001n } as const;
const asBo = { confirmation: BO, lockKey: 7_002n } as const;
const adaSignsIn = { codeFor: () => ADA, lockKey: asAda.lockKey };

/**
 * Holds `run`'s confirming writes at a barrier until `expected` of them are
 * queued behind it, then lets them all go at once.
 *
 * Real requests rarely overlap on their own (each reads the poll first, and
 * some open a connection), and `Promise.all` alone can run them one after
 * another by chance. So the barrier session locks the vote table against
 * writes, and the test waits until Postgres itself reports `expected`
 * sessions waiting on it — directly, or behind a session that is. With the
 * person's lock (ADR-0046) one write waits on the table and the rest wait on
 * that write's advisory lock; without it, every write waits on the table.
 * Either way all of them are in flight before any of them writes.
 */
async function racing<T>(
  pool: Pool,
  expected: number,
  run: () => Promise<T>,
): Promise<T> {
  const barrier = await pool.connect();
  try {
    await barrier.query("begin");
    await barrier.query("lock table vote in share row exclusive mode");
    const barrierPid = await backendPid(barrier);
    const writes = run();
    // Not awaited yet: a write that fails early must not be an unhandled
    // rejection while the barrier is still up.
    writes.catch(() => null);
    await until(
      async () => (await waitingBehind(pool, barrierPid)) >= expected,
    );
    await barrier.query("commit");
    return await writes;
  } finally {
    await barrier.query("rollback").catch(() => null);
    barrier.release();
  }
}

/** How many ballots on `pollId` carry `code`, read from the rows. */
async function ballotsCarrying(
  pool: Pool,
  pollId: string,
  code: string,
): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from vote where poll_id = $1 and confirmation = $2",
    [pollId, code],
  );
  return rows[0]?.n ?? -1;
}

test(
  "one_person_casting_from_several_browsers_at_once_keeps_one_ballot",
  { skip: databaseSkip },
  async (t) => {
    // ADR-0046's race: one person signed in on four browsers, all casting at
    // once. Each cast deletes the person's other ballot, then writes its own.
    // Interleaved without a lock, two casts both delete nothing and both
    // write, which the unique index refuses or, without it, double counts.
    const { pool, store } = await fresh(t);
    const outcomes = await racing(pool, 4, () =>
      Promise.all(
        ["b:1", "b:2", "b:3", "b:4"].map((browser, i) =>
          store.castVote("p1", browser, [i % 2], asAda),
        ),
      ),
    );

    assert.deepEqual(
      outcomes.map((o) => o.status),
      ["counted", "counted", "counted", "counted"],
    );
    assert.equal(await ballotsCarrying(pool, "p1", ADA), 1);
    const results = await store.results("p1");
    assert.equal(results.voters, 1);
    assert.equal(results.confirmedVoters, 1);
    assert.equal(
      results.choices.reduce((sum, choice) => sum + choice.count, 0),
      1,
    );
    // And no choice rows are left behind by a deleted ballot.
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from vote_choice",
    );
    assert.equal(rows[0]?.n, 1);
  },
);

test(
  "a_cast_during_a_sign_in_by_the_same_person_leaves_one_ballot",
  { skip: databaseSkip },
  async (t) => {
    // The person casts on b:1 while b:0, which voted before, signs in. In
    // either order exactly one ballot survives: cast first, then the sign-in
    // keeps the later (a same-millisecond tie here, which b:1 wins and moves
    // to b:0); sign-in first, then the cast replaces b:0's.
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "b:0", [0]);
    await store.castVote("p1", "b:9", [1], asBo);
    await racing(pool, 2, () =>
      Promise.all([
        store.castVote("p1", "b:1", [1], asAda),
        store.confirmVotes("b:0", adaSignsIn),
      ]),
    );

    assert.equal(await ballotsCarrying(pool, "p1", ADA), 1);
    const results = await store.results("p1");
    assert.equal(results.voters, 2);
    assert.equal(results.confirmedVoters, 2);
    // Ada's surviving answer is the cast's, whichever browser holds it; Bo's
    // ballot is not touched.
    assert.deepEqual(
      results.choices.map((c) => c.confirmedCount),
      [0, 2],
    );
    assert.deepEqual((await store.voteOf("p1", "b:9"))?.choices, [1]);
  },
);

test(
  "two_casts_and_a_sign_in_by_one_person_racing_leave_one_ballot",
  { skip: databaseSkip },
  async (t) => {
    // ADR-0040's three-way race, now under ADR-0046: two browsers casting
    // signed in and a third signing in after it voted, all held at the
    // barrier. They commit in whatever order the person's lock grants, and
    // exactly one ballot remains.
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "b:0", [0]);
    await racing(pool, 3, () =>
      Promise.all([
        store.castVote("p1", "b:1", [0], asAda),
        store.castVote("p1", "b:3", [1], asAda),
        store.confirmVotes("b:0", adaSignsIn),
      ]),
    );

    assert.equal(await ballotsCarrying(pool, "p1", ADA), 1);
    const results = await store.results("p1");
    assert.equal(results.voters, 1);
    assert.equal(results.confirmedVoters, 1);
  },
);

test(
  "the_database_refuses_a_second_ballot_for_one_code_on_one_poll",
  { skip: databaseSkip },
  async (t) => {
    // The backstop under the lock (vote_poll_confirmation_key): a write that
    // skipped the store's rule is an error, never a double count.
    const { pool, store } = await fresh(t);
    await store.castVote("p1", "b:1", [0], asAda);
    await store.castVote("p1", "b:2", [0]);
    await store.castVote("p2", "b:2", [0], asAda);
    await assert.rejects(
      pool.query(
        "update vote set confirmation = $1 where poll_id = 'p1' and voter_id = 'b:2'",
        [ADA],
      ),
      /vote_poll_confirmation_key/,
    );
  },
);

test(
  "confirmed_results_are_one_snapshot_even_when_a_confirmation_lands_between_reads",
  { skip: databaseSkip },
  async (t) => {
    // results() counts confirmed people, then their picks. A confirmed cast
    // committing between those two must not be half-seen.
    const { pool, store: writer } = await fresh(t);
    await writer.castVote("p1", "b:1", [1], asAda);
    let interleaved = false;
    const reader = new PostgresVotingStore(
      afterStatement(pool, " as n from (", async () => {
        if (interleaved) return;
        interleaved = true;
        await writer.castVote("p1", "b:2", [0], asBo);
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
    assert.equal(await store.confirmVotes("b:before", adaSignsIn), 1);
    assert.equal((await store.results("old")).confirmedVoters, 1);
  },
);

// Public attribution (ADR-0037), read from rows the creation store writes.
// Written here by hand, so these hold whatever writer produced the row.

async function authoredRow(
  pool: Pool,
  id: string,
  attribution: { kind: string; name: string | null },
  community = "pulse-general",
) {
  const voters = new PostgresVoterStore(pool);
  if (!(await voters.byId("author-account-7f3a")))
    await voters.create(
      {
        id: "author-account-7f3a",
        community: null,
        assurance: "email",
        claimedAt: AT,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: "author-7f3a@example.test", verifiedAt: AT },
    );
  await pool.query(
    "insert into polls (id, question, method, created_at, closes_at," +
      " accepts_suggestions, community, created_by, attribution_kind, author_name)" +
      " values ($1, 'Q', 'single', $2, null, false, $3, 'author-account-7f3a', $4, $5)",
    [id, AT, community, attribution.kind, attribution.name],
  );
  for (const [position, label] of ["a", "b"].entries())
    await pool.query(
      "insert into poll_choice (id, poll_id, position, label) values ($1, $2, $3, $4)",
      [randomUUID(), id, position, label],
    );
}

test(
  "an_authored_row_reads_back_its_public_facts_and_never_its_author",
  { skip: databaseSkip },
  async (t) => {
    const { pool, store } = await fresh(t);
    await pool.query("insert into community values ('campus', 'Campus')");
    await authoredRow(pool, "anon", { kind: "anonymous", name: null });
    await authoredRow(pool, "named", { kind: "named", name: "Ada" }, "campus");

    const anon = await store.getPoll("anon");
    assert.deepEqual(anon?.publication, {
      community: { id: "pulse-general", label: "General" },
      attribution: { kind: "anonymous" },
    });
    const named = await store.getPoll("named");
    assert.deepEqual(named?.publication, {
      community: { id: "campus", label: "Campus" },
      attribution: { kind: "named", name: "Ada" },
    });
    // The author's account is never read onto the poll at all.
    for (const poll of [anon, named])
      assert.doesNotMatch(
        JSON.stringify(poll),
        /author-account-7f3a|author-7f3a@example\.test/,
      );

    // The label is the community table's at read time, as the creation
    // store's own answer is.
    await pool.query(
      "update community set label = 'Main campus' where id = 'campus'",
    );
    assert.deepEqual((await store.getPoll("named"))?.publication?.community, {
      id: "campus",
      label: "Main campus",
    });
  },
);

test(
  "a_poll_with_a_community_but_no_author_has_no_publication",
  { skip: databaseSkip },
  async (t) => {
    // 005 lets a legacy row carry a community without authorship. Nothing
    // about an author is invented for it, and the community alone is not
    // published: the two public fields travel together.
    const { pool, store } = await fresh(t);
    await pool.query(
      "update polls set community = 'pulse-general' where id = 'p1'",
    );
    const poll = await store.getPoll("p1");
    assert.ok(poll);
    assert.equal("publication" in poll, false);
    assert.equal((await store.getPoll("p2"))?.publication, undefined);
  },
);

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return rows[0]?.pid ?? -1;
}

/**
 * How many sessions are waiting, directly or through a chain of waiters, on a
 * lock the session `pid` holds. Asked of Postgres directly, so other runs
 * sharing the database are never counted.
 */
async function waitingBehind(pool: Pool, pid: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "with recursive behind(pid) as (" +
      " select $1::int" +
      " union" +
      " select a.pid from pg_stat_activity a join behind b" +
      " on b.pid = any(pg_blocking_pids(a.pid))" +
      ") select count(*)::int - 1 as n from behind",
    [pid],
  );
  return rows[0]?.n ?? 0;
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
