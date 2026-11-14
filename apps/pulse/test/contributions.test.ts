import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { InMemoryContributionsStore } from "../src/contributions/memory-store.js";
import { PostgresContributionsStore } from "../src/contributions/pg-store.js";
import { InMemoryVoterStore } from "../src/identity/store.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import {
  creationSchema,
  parse,
  listQuery,
} from "../src/contributions/input.js";
import { databaseSkip, migratedSchema } from "./support/database.js";
const at = new Date("2026-11-10T12:00:00.000Z");
const owner = { voterId: "private-owner", sessionGeneration: 0 };
const helper = { voterId: "private-helper", sessionGeneration: 0 };
const otherHelper = { voterId: "private-other-helper", sessionGeneration: 0 };
const project = {
  title: "Community garden",
  description: "Grow vegetables together",
  communityBenefit: "Fresh food for neighbours",
  needs: "Help building beds",
  kind: "project",
  organizerName: "Ada",
};
const commercial = {
  currency: "CAD",
  regularPriceMinor: 10000,
  offeredPriceMinor: 8000,
  referenceUrl: "https://example.test/price",
  terms: "Both prices include mandatory charges for the same item.",
};
async function setup(t: TestContext, kind: "memory" | "postgres") {
  let clock = at;
  const pool = kind === "postgres" ? await migratedSchema(t) : undefined;
  const voters = pool ? new PostgresVoterStore(pool) : new InMemoryVoterStore();
  const votes = pool
    ? new PostgresVotingStore(pool)
    : new InMemoryVotingStore();
  for (const actor of [owner, helper, otherHelper])
    await voters.create(
      {
        id: actor.voterId,
        community: null,
        assurance: "email",
        claimedAt: at,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${actor.voterId}@example.test`, verifiedAt: at },
    );
  const store = pool
    ? new PostgresContributionsStore(pool, () => clock)
    : new InMemoryContributionsStore(voters as InMemoryVoterStore, votes, {
        clock: () => clock,
        communityLabels: new Map([["campus", "Campus"]]),
      });
  const other = pool
    ? new PostgresContributionsStore(pool, () => clock)
    : store;
  return {
    store,
    other,
    voters,
    pool,
    setTime: (value: Date) => {
      clock = value;
    },
  };
}
for (const kind of ["memory", "postgres"] as const) {
  const opts = { skip: kind === "postgres" ? databaseSkip : false };
  test(
    `${kind}: publish, participate, close and report preserve identity and history`,
    opts,
    async (t) => {
      const { store } = await setup(t, kind);
      const created = await store.create(owner, randomUUID(), project);
      const id = created.contribution.id;
      assert.equal(created.contribution.community.id, "pulse-general");
      assert.equal((await store.detail(id, helper.voterId)).canManage, false);
      assert.equal((await store.detail(id, owner.voterId)).canManage, true);
      await store.participate(helper, id, randomUUID(), {
        displayName: "Jo",
        kind: "help",
        message: "I can build a bed.",
      });
      await assert.rejects(
        store.update(helper, id, randomUUID(), {
          message: "Done",
          status: "completed",
        }),
        { message: "organizer_required" },
      );
      await store.update(owner, id, randomUUID(), {
        message: "Beds built",
        status: "completed",
        evidenceUrl: "https://example.test/photo",
      });
      await assert.rejects(
        store.participate(helper, id, randomUUID(), {
          displayName: "Jo",
          kind: "pledge",
          message: "More wood",
        }),
        { message: "closed" },
      );
      await store.participate(helper, id, randomUUID(), {
        displayName: "Jo",
        kind: "report",
        message: "I built two beds.",
      });
      const result = await store.detail(id);
      assert.equal(result.contribution.participations.length, 2);
      assert.equal(result.contribution.updates.length, 1);
      assert.equal(result.contribution.status, "completed");
      assert.doesNotMatch(
        JSON.stringify(result),
        /private-owner|private-helper|sessionGeneration|ownerId/,
      );
      assert.ok(
        !("participations" in (await store.list({})).contributions[0]!),
      );
    },
  );
  test(
    `${kind}: owner listing keys by account rather than organizer name`,
    opts,
    async (t) => {
      const { store, setTime } = await setup(t, kind);
      const first = await store.create(owner, randomUUID(), project);
      setTime(new Date(at.getTime() + 1));
      await store.create(helper, randomUUID(), {
        ...project,
        title: "Someone else's project",
        organizerName: project.organizerName,
      });
      const page = await store.listByOwner(owner.voterId, {});
      assert.deepEqual(
        page.contributions.map((row) => row.id),
        [first.contribution.id],
      );
      assert.doesNotMatch(JSON.stringify(page), /private-owner|private-helper/);
    },
  );
  test(
    `${kind}: owner listing pages one account's rows in order past interleaved rows`,
    opts,
    async (t) => {
      const { store, setTime } = await setup(t, kind);
      const mine: { id: string; createdAt: string }[] = [];
      // One publication per hour per account stays under the posting limit;
      // the other account publishes at the same instants, and one hour has two
      // of the owner's rows so the id tie-break is crossed too.
      for (let hour = 0; hour < 24; hour++) {
        setTime(new Date(at.getTime() + hour * 3_600_001));
        for (let copy = 0; copy < (hour === 19 ? 2 : 1); copy++)
          mine.push(
            (
              await store.create(owner, randomUUID(), {
                ...project,
                title: `Owner ${hour}.${copy}`,
              })
            ).contribution,
          );
        await store.create(helper, randomUUID(), {
          ...project,
          title: `Helper ${hour}`,
        });
      }
      const expected = [...mine]
        .sort((a, b) => {
          const [left, right] = [
            `${a.createdAt} ${a.id}`,
            `${b.createdAt} ${b.id}`,
          ];
          return left < right ? 1 : left > right ? -1 : 0;
        })
        .map((row) => row.id);
      const first = await store.listByOwner(owner.voterId, {});
      assert.equal(first.contributions.length, 20);
      assert.ok(first.nextCursor);
      const second = await store.listByOwner(
        owner.voterId,
        listQuery({ cursor: first.nextCursor }),
      );
      assert.equal(second.nextCursor, null);
      assert.deepEqual(
        [...first.contributions, ...second.contributions].map((row) => row.id),
        expected,
      );
      assert.equal(expected.length, 25);
    },
  );
  test(
    `${kind}: private messages survive other writes and are visible only to the organizer`,
    opts,
    async (t) => {
      const { store, other } = await setup(t, kind);
      const { contribution } = await store.create(owner, randomUUID(), project);
      const { id } = contribution;
      const key = randomUUID();
      const input = { message: "Private question" };
      const first = await store.sendMessage(helper, id, key, input);
      assert.equal(first.replayed, false);
      assert.deepEqual(await other.sendMessage(helper, id, key, input), {
        id: first.id,
        replayed: true,
      });
      await assert.rejects(store.messages(helper, id), {
        message: "organizer_required",
      });
      await other.update(owner, id, randomUUID(), {
        message: "Public update",
        status: "in_progress",
      });
      assert.deepEqual((await store.messages(owner, id)).messages, [
        { id: first.id, message: input.message, createdAt: at.toISOString() },
      ]);
      assert.doesNotMatch(
        JSON.stringify(await store.detail(id)),
        /Private question/,
      );
      assert.doesNotMatch(
        JSON.stringify(await store.list({})),
        /Private question/,
      );
    },
  );
  test(
    `${kind}: one sender is capped without filling the contribution for everyone`,
    opts,
    async (t) => {
      const { store } = await setup(t, kind);
      const { contribution } = await store.create(owner, randomUUID(), project);
      let lastParticipationKey = "";
      let lastMessageKey = "";
      for (let i = 0; i < 20; i++) {
        lastParticipationKey = randomUUID();
        lastMessageKey = randomUUID();
        await store.participate(helper, contribution.id, lastParticipationKey, {
          displayName: "Jo",
          kind: "help",
          message: `Help ${i}`,
        });
        await store.sendMessage(helper, contribution.id, lastMessageKey, {
          message: `Question ${i}`,
        });
      }
      assert.equal(
        (
          await store.participate(
            helper,
            contribution.id,
            lastParticipationKey,
            {
              displayName: "Jo",
              kind: "help",
              message: "Help 19",
            },
          )
        ).replayed,
        true,
      );
      assert.equal(
        (
          await store.sendMessage(helper, contribution.id, lastMessageKey, {
            message: "Question 19",
          })
        ).replayed,
        true,
      );
      await assert.rejects(
        store.participate(helper, contribution.id, randomUUID(), {
          displayName: "Jo",
          kind: "help",
          message: "One too many",
        }),
        { message: "sender_limit" },
      );
      await assert.rejects(
        store.sendMessage(helper, contribution.id, randomUUID(), {
          message: "One too many",
        }),
        { message: "sender_limit" },
      );
      await store.participate(otherHelper, contribution.id, randomUUID(), {
        displayName: "Sam",
        kind: "pledge",
        message: "I can still join.",
      });
      await store.sendMessage(otherHelper, contribution.id, randomUUID(), {
        message: "I can still write.",
      });
      assert.equal(
        (await store.detail(contribution.id)).contribution.participations
          .length,
        21,
      );
      assert.equal(
        (await store.messages(owner, contribution.id)).messages.length,
        21,
      );
    },
  );
  test(
    `${kind}: concurrent retries save once and replay original results after closure`,
    opts,
    async (t) => {
      const { store, other } = await setup(t, kind);
      const key = randomUUID();
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store : other).create(owner, key, project),
        ),
      );
      assert.equal(created.filter((r) => !r.replayed).length, 1);
      const id = created[0]!.contribution.id;
      const pkey = randomUUID();
      const body = {
        displayName: "Jo",
        kind: "pledge",
        message: "I pledge $20.",
      };
      await Promise.all([
        store.participate(helper, id, pkey, body),
        other.participate(helper, id, pkey, body),
      ]);
      assert.equal(
        (await store.detail(id)).contribution.participations.length,
        1,
      );
      await assert.rejects(
        store.create(owner, key, { ...project, title: "Different" }),
        { message: "idempotency_conflict" },
      );
      await assert.rejects(store.participate(owner, id, key, body), {
        message: "idempotency_conflict",
      });
      await store.update(owner, id, randomUUID(), {
        message: "Finished",
        status: "completed",
      });
      assert.equal(
        (await other.create(owner, key, project)).contribution.status,
        "open",
      );
    },
  );
  test(
    `${kind}: quota is atomic and revoked sessions cannot mutate or replay`,
    opts,
    async (t) => {
      const { store, other, voters, setTime } = await setup(t, kind);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store : other).create(owner, randomUUID(), project),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
      for (const r of results)
        if (r.status === "rejected")
          assert.equal(r.reason.code, "posting_limit");
      setTime(new Date(at.getTime() + 3600000));
      const key = randomUUID();
      const result = await store.create(owner, key, project);
      await voters.advanceSessionGeneration(owner.voterId);
      await assert.rejects(store.create(owner, key, project), {
        message: "signed_out",
      });
      await assert.rejects(
        store.update(owner, result.contribution.id, randomUUID(), {
          message: "Done",
          status: "completed",
        }),
        { message: "signed_out" },
      );
    },
  );
  test(
    `${kind}: missing polls and insufficient commercial savings cannot publish`,
    opts,
    async (t) => {
      const { store } = await setup(t, kind);
      await assert.rejects(
        store.create(owner, randomUUID(), { ...project, pollId: "absent" }),
        { message: "poll_not_found" },
      );
      await assert.rejects(
        store.create(owner, randomUUID(), {
          ...project,
          kind: "group_buy",
          commercial: { ...commercial, offeredPriceMinor: 8001 },
        }),
        { message: "bad_request" },
      );
      const result = await store.create(owner, randomUUID(), {
        ...project,
        kind: "group_buy",
        commercial,
        fund: { name: "Community Fund", percentage: 5 },
      });
      assert.equal(result.contribution.fund?.percentage, 5);
      assert.equal((await store.list({})).contributions.length, 1);
    },
  );
  test(
    `${kind}: cursor pagination gives stable complete traversal with tied timestamps`,
    opts,
    async (t) => {
      const { store, setTime } = await setup(t, kind);
      const ids = new Set<string>();
      for (let i = 0; i < 23; i++) {
        setTime(new Date(at.getTime() + Math.floor(i / 5) * 3600000));
        ids.add(
          (await store.create(owner, randomUUID(), project)).contribution.id,
        );
      }
      const first = await store.list({});
      assert.equal(first.contributions.length, 20);
      assert.ok(first.nextCursor);
      const second = await store.list(listQuery({ cursor: first.nextCursor }));
      assert.equal(second.contributions.length, 3);
      assert.equal(second.nextCursor, null);
      assert.deepEqual(
        new Set(
          [...first.contributions, ...second.contributions].map((r) => r.id),
        ),
        ids,
      );
    },
  );
}
test("memory contribution publications use configured community labels", async () => {
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore();
  const member = { voterId: "campus-member", sessionGeneration: 0 };
  await voters.create(
    {
      id: member.voterId,
      community: "campus",
      assurance: "email",
      claimedAt: at,
      proofEmailsOptIn: false,
    },
    { kind: "email", value: "campus@example.test", verifiedAt: at },
  );
  const store = new InMemoryContributionsStore(voters, votes, {
    clock: () => at,
    communityLabels: new Map([["campus", "Campus"]]),
  });
  assert.deepEqual(
    (await store.create(member, randomUUID(), project)).contribution.community,
    { id: "campus", label: "Campus" },
  );
});

test(
  "postgres keeps contributions from two different senders that overlap on one row",
  { skip: databaseSkip },
  async (t) => {
    const { store, other, pool } = await setup(t, "postgres");
    const { contribution } = await store.create(owner, randomUUID(), project);
    const barrier = await pool!.connect();
    try {
      await barrier.query("begin");
      await barrier.query(
        "select id from contribution where id=$1 for update",
        [contribution.id],
      );
      const pid = (
        await barrier.query<{ pid: number }>("select pg_backend_pid() as pid")
      ).rows[0]!.pid;
      const writes = Promise.all([
        store.participate(helper, contribution.id, randomUUID(), {
          displayName: "Jo",
          kind: "help",
          message: "First helper",
        }),
        other.participate(otherHelper, contribution.id, randomUUID(), {
          displayName: "Sam",
          kind: "help",
          message: "Second helper",
        }),
      ]);
      const deadline = Date.now() + 5_000;
      while (true) {
        const waiting = (
          await pool!.query<{ count: number }>(
            "with recursive blocked(pid) as (select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))) select count(*)::int as count from blocked",
            [pid],
          )
        ).rows[0]?.count;
        if ((waiting ?? 0) >= 2) break;
        if (Date.now() > deadline)
          throw new Error(
            "contribution writes did not reach the row-lock barrier",
          );
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await barrier.query("commit");
      await writes;
    } finally {
      await barrier.query("rollback");
      barrier.release();
    }
    assert.deepEqual(
      new Set(
        (await store.detail(contribution.id)).contribution.participations.map(
          (entry) => entry.message,
        ),
      ),
      new Set(["First helper", "Second helper"]),
    );
  },
);
test("input rejects unsafe links, invalid Unicode and invalid cursors", () => {
  for (const data of [
    { ...project, kind: "offer", fund: { name: "Fund", percentage: 5 } },
    { ...project, commercial },
    { ...project, fund: { name: "Fund", percentage: 5 } },
    { ...project, title: "\ud800" },
    { ...project, unknown: true },
    {
      ...project,
      kind: "offer",
      commercial: { ...commercial, referenceUrl: "javascript:alert(1)" },
    },
    {
      ...project,
      kind: "offer",
      commercial: {
        ...commercial,
        referenceUrl: "https://user:password@example.test",
      },
    },
    {
      ...project,
      kind: "offer",
      commercial: { ...commercial, offeredPriceMinor: -1 },
    },
    {
      ...project,
      kind: "offer",
      commercial: { ...commercial, currency: "JPY" },
    },
  ])
    assert.throws(() => parse(creationSchema, data), {
      message: "bad_request",
    });
  assert.throws(() => listQuery({ cursor: "garbage" }), {
    message: "bad_request",
  });
  assert.throws(() => listQuery({ limit: "500" }), { message: "bad_request" });
});
test(
  "postgres rolls back publication if replay persistence fails",
  { skip: databaseSkip },
  async (t) => {
    const { store, pool } = await setup(t, "postgres");
    await pool!.query(
      "create function reject_contribution_replay() returns trigger language plpgsql as $$ begin raise exception 'test replay failure'; end $$; create trigger reject_replay before insert on contribution_replay for each row execute function reject_contribution_replay()",
    );
    await assert.rejects(
      store.create(owner, randomUUID(), project),
      /test replay failure/,
    );
    assert.equal((await store.list({})).contributions.length, 0);
  },
);
