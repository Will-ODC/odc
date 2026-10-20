import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { Pool } from "pg";
import {
  PostgresCreationStore,
  type PublicationActor,
} from "../src/authoring/pg-store.js";
import { HOUR_MS, PURPOSE_VERSION, WEEK_MS } from "../src/authoring/input.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";
const AT = new Date("2026-10-12T12:00:00.123Z");
const opt = { skip: databaseSkip };
const body = {
  question: " Q ",
  choices: [" A ", " B "],
  method: "single",
  purposeAcknowledgement: PURPOSE_VERSION,
};
const owner: PublicationActor = {
  voterId: "owner-account",
  sessionGeneration: 0,
};
const member: PublicationActor = {
  voterId: "member-private",
  sessionGeneration: 0,
};
async function fresh(t: TestContext) {
  const pool = await migratedSchema(t);
  await pool.query("insert into community values ('campus', 'Campus')");
  const voters = new PostgresVoterStore(pool);
  for (const [id, community] of [
    [owner.voterId, null],
    [member.voterId, "campus"],
    ["guest-account", null],
  ] as const)
    await voters.create(
      {
        id,
        community,
        assurance: "email",
        claimedAt: AT,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${id}@example.test`, verifiedAt: AT },
    );
  let now = AT;
  const clock = () => now;
  const options = { ownerEmail: "OWNER-ACCOUNT@example.test", clock };
  return {
    pool,
    voters,
    store: new PostgresCreationStore(pool, options),
    other: new PostgresCreationStore(pool, options),
    setTime: (time: Date) => {
      now = time;
    },
  };
}
async function counts(pool: Pool) {
  const result = await pool.query(
    "select (select count(*)::int from polls) as polls, (select count(*)::int from poll_choice) as choices, (select count(*)::int from publication_acknowledgement) as acknowledgements, (select count(*)::int from poll_creation_replay) as replays",
  );
  return result.rows[0];
}
async function raced<T>(pool: Pool, run: () => Promise<T>): Promise<T> {
  const barrier = await pool.connect();
  try {
    await barrier.query("begin");
    await barrier.query("lock table voter in access exclusive mode");
    const pid = (
      await barrier.query<{ pid: number }>("select pg_backend_pid() as pid")
    ).rows[0]?.pid;
    const pending = run();
    const deadline = Date.now() + 5000;
    while (true) {
      const n =
        (
          await pool.query<{ n: number }>(
            "select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))",
            [pid],
          )
        ).rows[0]?.n ?? 0;
      if (n >= 8) break;
      if (Date.now() > deadline)
        throw new Error("requests did not reach the real lock barrier");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await barrier.query("commit");
    return await pending;
  } finally {
    await barrier.query("rollback");
    barrier.release();
  }
}

test(
  "publication_is_public_anonymous_by_default_with_a_one_week_close_and_no_ballot_link",
  opt,
  async (t) => {
    const { store, pool } = await fresh(t);
    const result = await store.publish(member, randomUUID(), body);
    assert.deepEqual(result.poll.community, { id: "campus", label: "Campus" });
    assert.deepEqual(result.poll.attribution, { kind: "anonymous" });
    assert.equal(
      result.poll.closesAt,
      new Date(AT.getTime() + WEEK_MS).toISOString(),
    );
    assert.equal(result.poll.acceptsSuggestions, false);
    assert.deepEqual(result.poll.next, [null, null]);
    assert.doesNotMatch(
      JSON.stringify(result),
      /member-private|example.test|created_by|voterId|request_key/,
    );
    assert.equal(
      (await pool.query("select count(*)::int as n from vote")).rows[0].n,
      0,
    );
    const voting = new PostgresVotingStore(pool, () => AT);
    assert.equal((await voting.getPoll(result.poll.id))?.question, "Q");
    assert.equal(
      (await voting.castVote(result.poll.id, "independent-ballot", [1])).status,
      "counted",
    );
    assert.equal((await voting.results(result.poll.id)).voters, 1);
  },
);

test(
  "null_membership_posts_to_General_without_changing_membership",
  opt,
  async (t) => {
    const { store, voters } = await fresh(t);
    const guest = { voterId: "guest-account", sessionGeneration: 0 };
    const result = await store.publish(guest, randomUUID(), {
      ...body,
      attribution: { kind: "named", name: " Ada " },
      closesAt: new Date(AT.getTime() + 1000).toISOString(),
    });
    assert.deepEqual(result.poll.community, {
      id: "pulse-general",
      label: "General",
    });
    assert.deepEqual(result.poll.attribution, { kind: "named", name: "Ada" });
    assert.equal((await voters.byId(guest.voterId))?.community, null);
  },
);

test(
  "first_publication_requires_promise_and_failures_consume_nothing",
  opt,
  async (t) => {
    const { store, pool } = await fresh(t);
    const without = {
      question: body.question,
      choices: body.choices,
      method: body.method,
    };
    await assert.rejects(store.publish(member, randomUUID(), without), {
      message: "purpose_required",
    });
    assert.deepEqual(await counts(pool), {
      polls: 0,
      choices: 0,
      acknowledgements: 0,
      replays: 0,
    });
    await assert.rejects(
      store.publish(member, randomUUID(), {
        ...body,
        closesAt: AT.toISOString(),
      }),
      { message: "bad_request" },
    );
    await store.publish(member, randomUUID(), body);
    assert.equal((await store.context(member)).purposeAcknowledged, true);
    await store.publish(member, randomUUID(), without);
  },
);

test(
  "eight_concurrent_publications_across_instances_respect_one_shared_quota",
  opt,
  async (t) => {
    const { store, other, pool, setTime } = await fresh(t);
    const results = await raced(pool, () =>
      Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store : other).publish(member, randomUUID(), body),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
    for (const r of results)
      if (r.status === "rejected") {
        assert.equal(r.reason.code, "posting_limit");
        assert.equal(r.reason.retryAfter, 3600);
      }
    assert.deepEqual(await counts(pool), {
      polls: 5,
      choices: 10,
      acknowledgements: 1,
      replays: 5,
    });
    setTime(new Date(AT.getTime() + HOUR_MS));
    await store.publish(member, randomUUID(), body);
  },
);

test(
  "concurrent_retries_commit_once_and_replay_after_close_without_extra_quota",
  opt,
  async (t) => {
    const { store, other, pool, setTime } = await fresh(t);
    const key = randomUUID();
    const results = await raced(pool, () =>
      Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store : other).publish(member, key, body),
        ),
      ),
    );
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    assert.equal(new Set(results.map((r) => r.poll.id)).size, 1);
    assert.deepEqual(await counts(pool), {
      polls: 1,
      choices: 2,
      acknowledgements: 1,
      replays: 1,
    });
    await assert.rejects(
      store.publish(member, key, { ...body, question: "Different" }),
      { message: "idempotency_conflict" },
    );
    const guestResult = await store.publish(
      { voterId: "guest-account", sessionGeneration: 0 },
      key,
      body,
    );
    assert.notEqual(guestResult.poll.id, results[0]?.poll.id);
    setTime(new Date(AT.getTime() + WEEK_MS + 1));
    assert.deepEqual(
      (await other.publish(member, key, body)).poll,
      results[0]?.poll,
    );
  },
);

test(
  "late_replay_failure_rolls_back_poll_choices_acknowledgement_and_quota",
  opt,
  async (t) => {
    const { store, pool } = await fresh(t);
    await pool.query(
      "create function reject_replay() returns trigger language plpgsql as $$ begin raise exception 'test write failure'; end $$; create trigger reject_replay before insert on poll_creation_replay for each row execute function reject_replay()",
    );
    const key = randomUUID();
    await assert.rejects(
      store.publish(member, key, body),
      /test write failure/,
    );
    assert.deepEqual(await counts(pool), {
      polls: 0,
      choices: 0,
      acknowledgements: 0,
      replays: 0,
    });
    await pool.query("drop trigger reject_replay on poll_creation_replay");
    await store.publish(member, key, body);
  },
);

test(
  "owner_bootstrap_and_granular_grants_only_bypass_quota_and_keep_an_idempotent_audit",
  opt,
  async (t) => {
    const { store, other, pool } = await fresh(t);
    assert.equal((await store.context(owner)).canPostUnlimited, true);
    await assert.rejects(store.setUnlimited(member, "missing", true), {
      message: "owner_required",
    });
    await assert.rejects(store.setUnlimited(owner, "missing", true), {
      message: "not_found",
    });
    await store.setUnlimited(owner, member.voterId, true);
    await other.setUnlimited(owner, member.voterId, true);
    for (let i = 0; i < 6; i++) await store.publish(member, randomUUID(), body);
    await assert.rejects(store.setUnlimited(member, owner.voterId, true), {
      message: "owner_required",
    });
    await store.setUnlimited(owner, member.voterId, false);
    await other.setUnlimited(owner, member.voterId, false);
    await assert.rejects(store.publish(member, randomUUID(), body), {
      message: "posting_limit",
    });
    assert.equal(
      (
        await pool.query(
          "select count(*)::int as n from posting_permission_change",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (await new PostgresCreationStore(pool).context(owner)).canPostUnlimited,
      false,
    );
    assert.throws(
      () => new PostgresCreationStore(pool, { ownerEmail: "private-invalid" }),
      { message: "PULSE_OWNER_EMAIL is not a usable address" },
    );
  },
);

test(
  "revoked_or_absent_sessions_cannot_publish_replay_or_manage_permissions",
  opt,
  async (t) => {
    const { store, voters } = await fresh(t);
    const key = randomUUID();
    await store.publish(member, key, body);
    await voters.advanceSessionGeneration(member.voterId);
    await assert.rejects(store.publish(member, key, body), {
      message: "signed_out",
    });
    await assert.rejects(store.context(member), { message: "signed_out" });
    await voters.advanceSessionGeneration(owner.voterId);
    await assert.rejects(store.setUnlimited(owner, member.voterId, true), {
      message: "signed_out",
    });
    await assert.rejects(
      store.publish(
        { voterId: "missing", sessionGeneration: 0 },
        randomUUID(),
        body,
      ),
      { message: "signed_out" },
    );
  },
);

test("grant_audit_failure_rolls_back_effective_permission", opt, async (t) => {
  const { store, pool } = await fresh(t);
  await pool.query(
    "create function reject_grant() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end $$; create trigger reject_grant before insert on posting_permission_change for each row execute function reject_grant()",
  );
  await assert.rejects(
    store.setUnlimited(owner, member.voterId, true),
    /test audit failure/,
  );
  assert.equal((await store.context(member)).canPostUnlimited, false);
  assert.equal(
    (await pool.query("select count(*)::int as n from posting_permission"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int as n from posting_permission_change",
      )
    ).rows[0].n,
    0,
  );
});

test(
  "revoked_unlimited_grant_waits_until_enough_recent_slots_expire",
  opt,
  async (t) => {
    const { store, setTime } = await fresh(t);
    await store.setUnlimited(owner, member.voterId, true);
    for (let i = 0; i < 6; i++) {
      setTime(new Date(AT.getTime() + i * 1000));
      await store.publish(member, randomUUID(), body);
    }
    await store.setUnlimited(owner, member.voterId, false);
    await assert.rejects(
      store.publish(member, randomUUID(), body),
      (error: unknown) => {
        assert.ok(error instanceof Error && "retryAfter" in error);
        assert.equal(error.retryAfter, 3596);
        return true;
      },
    );
    setTime(new Date(AT.getTime() + HOUR_MS + 1000));
    await store.publish(member, randomUUID(), body);
  },
);
