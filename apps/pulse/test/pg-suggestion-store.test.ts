import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { Pool, PoolClient } from "pg";
import { PostgresSuggestionStore } from "../src/voting/pg-suggestions.js";
import { createPoll, type Poll } from "../src/voting/poll.js";
import { UnknownPollError } from "../src/voting/store.js";
import { SuggestionError } from "../src/voting/suggestions.js";
import { suggestionStoreConformance } from "./conformance/suggestion-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

/**
 * The rows a suggestion's foreign key needs. Only `polls` is referenced —
 * `submit` is handed the whole poll, choices and all — so nothing else is
 * written.
 */
async function writePolls(pool: Pool, polls: readonly Poll[]): Promise<void> {
  for (const poll of polls) {
    await pool.query(
      "insert into polls" +
        " (id, question, method, created_at, closes_at, accepts_suggestions)" +
        " values ($1, $2, $3, $4, $5, $6)",
      [
        poll.id,
        poll.question,
        poll.method,
        poll.createdAt,
        poll.closesAt ?? null,
        poll.acceptsSuggestions,
      ],
    );
  }
}

// The Postgres suggestion store, held to the suite every implementation runs.
suggestionStoreConformance(
  "postgres",
  async (clock, t, polls) => {
    const pool = await migratedSchema(t);
    await writePolls(pool, polls);
    return new PostgresSuggestionStore(pool, { clock });
  },
  { skip: databaseSkip },
);

// What only a database store can get wrong.

const AT = new Date("2026-09-11T12:00:00.123Z");
const P1 = createPoll(
  {
    id: "p1",
    question: "How do we pay for it?",
    choices: ["Yes", "No"],
    method: "single",
    acceptsSuggestions: true,
  },
  AT,
);

async function fresh(t: TestContext) {
  const pool = await migratedSchema(t);
  await writePolls(pool, [P1]);
  return new PostgresSuggestionStore(pool, { clock: () => AT });
}

test(
  "eight_people_saying_the_same_new_thing_at_once_are_one_suggestion",
  { skip: databaseSkip },
  async (t) => {
    // Without taking turns, all eight read an empty list, all eight decide
    // "add", and the idea is listed eight times with a count of one each.
    const store = await fresh(t);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.submit(P1, "Charge the members")),
    );

    const statuses = results.map((result) => result.status);
    assert.equal(statuses.filter((s) => s === "added").length, 1);
    assert.equal(statuses.filter((s) => s === "seconded").length, 7);
    assert.deepEqual(
      (await store.list("p1")).map((s) => [s.text, s.count]),
      [["Charge the members", 8]],
    );
  },
);

test(
  "a_suggestion_on_a_poll_never_written_is_refused_by_name",
  { skip: databaseSkip },
  async (t) => {
    const store = await fresh(t);
    const nowhere = createPoll(
      { id: "nowhere", question: "Q", choices: ["a", "b"], method: "single" },
      AT,
    );
    await assert.rejects(
      store.submit(nowhere, "Charge the members"),
      UnknownPollError,
    );
  },
);

test(
  "a_submission_waits_for_one_already_under_way_on_the_same_poll",
  { skip: databaseSkip },
  async (t) => {
    // Deterministic where the test above is not: eight real submissions can
    // happen to run one after another and pass without taking turns at all.
    // Here someone else is mid-submission, about to add "Charge the members",
    // holding the poll's row in SHARE mode. A store that takes turns waits for
    // them and then seconds it. A store with a weaker lock, or none, is not
    // held up: it reads an empty list and adds a duplicate.
    const pool = await migratedSchema(t);
    await writePolls(pool, [P1]);
    const store = new PostgresSuggestionStore(pool, { clock: () => AT });
    const other = await pool.connect();
    try {
      await other.query("begin");
      await other.query("select 1 from polls where id = 'p1' for share");
      const otherPid = await backendPid(other);

      let settled = false;
      const mine = store.submit(P1, "we could charge members");
      mine.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // Until mine is waiting on the other's hold — or, not held up, is done.
      await until(async () => settled || (await blockedBy(pool, otherPid)));

      await other.query(
        "insert into suggestion (id, poll_id, text, count, added_at)" +
          " values ($1, 'p1', 'Charge the members', 1, $2)",
        [randomUUID(), AT],
      );
      await other.query("commit");

      assert.equal((await mine).status, "seconded");
      assert.deepEqual(
        (await store.list("p1")).map((s) => [s.text, s.count]),
        [["Charge the members", 2]],
      );
    } finally {
      await other.query("rollback").catch(() => undefined);
      other.release();
    }
  },
);

test(
  "a_submission_is_not_held_up_by_a_vote_being_cast_on_the_same_poll",
  { skip: databaseSkip },
  async (t) => {
    // A vote being cast holds the key-share lock its foreign key takes on the
    // poll's row. Taking turns must not wait for that: `for update` would, and
    // every suggestion would stall behind whoever was voting.
    const pool = await migratedSchema(t);
    await writePolls(pool, [P1]);
    const store = new PostgresSuggestionStore(pool, { clock: () => AT });
    const voting = await pool.connect();
    try {
      await voting.query("begin");
      await voting.query("select 1 from polls where id = 'p1' for key share");
      const votingPid = await backendPid(voting);

      let settled = false;
      const mine = store.submit(P1, "Charge the members");
      mine.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      // Until mine is done — or is waiting on the vote, which it must not.
      await until(async () => settled || (await blockedBy(pool, votingPid)));
      assert.equal(settled, true, "the submission waited for a vote");
      assert.equal((await mine).status, "added");
    } finally {
      await voting.query("rollback").catch(() => undefined);
      voting.release();
    }
  },
);

test(
  "equal_counts_are_listed_oldest_first_at_the_time_the_clock_gave",
  { skip: databaseSkip },
  async (t) => {
    let now = AT;
    const pool = await migratedSchema(t);
    await writePolls(pool, [P1]);
    const store = new PostgresSuggestionStore(pool, { clock: () => now });
    await store.submit(P1, "Apply for grants");
    now = new Date(AT.getTime() + 60_000);
    await store.submit(P1, "Charge the members");

    assert.deepEqual(
      (await store.list("p1")).map((s) => [s.text, s.addedAt.getTime()]),
      [
        ["Apply for grants", AT.getTime()],
        ["Charge the members", now.getTime()],
      ],
    );
  },
);

test(
  "a_tie_between_two_matches_seconds_the_older",
  { skip: databaseSkip },
  async (t) => {
    // Two rows saying the same thing only exist if written around the store,
    // which would have seconded the second. But when they do, a new
    // submission joins the older, as it does in memory. Written newest first,
    // so the order rows happen to sit in cannot supply the answer.
    const pool = await migratedSchema(t);
    await writePolls(pool, [P1]);
    const older = randomUUID();
    const newer = randomUUID();
    for (const [id, at] of [
      [newer, new Date(AT.getTime() + 1_000)],
      [older, AT],
    ] as const) {
      await pool.query(
        "insert into suggestion (id, poll_id, text, count, added_at)" +
          " values ($1, 'p1', 'Charge the members', 1, $2)",
        [id, at],
      );
    }
    const store = new PostgresSuggestionStore(pool, { clock: () => AT });
    const result = await store.submit(P1, "charge members");
    assert.equal(
      result.status === "seconded" ? result.suggestion.id : undefined,
      older,
    );
  },
);

test(
  "junk_is_refused_before_the_poll_is_looked_up",
  { skip: databaseSkip },
  async (t) => {
    // Checked before a connection or a lock is taken, so blank text on a poll
    // this store has never heard of is refused for the text, as in memory.
    const store = await fresh(t);
    const nowhere = createPoll(
      { id: "nowhere", question: "Q", choices: ["a", "b"], method: "single" },
      AT,
    );
    await assert.rejects(store.submit(nowhere, "   "), SuggestionError);
  },
);

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return rows[0]?.pid ?? -1;
}

/** Whether any session is waiting on a lock the session `pid` holds. */
async function blockedBy(pool: Pool, pid: number): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity" +
      " where $1 = any(pg_blocking_pids(pid))",
    [pid],
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function until(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
