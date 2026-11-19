import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { InMemoryVoterStore, type VoterStore } from "../src/identity/store.js";
import {
  InMemoryMemberProfileStore,
  memoryDisplayNames,
} from "../src/profiles/memory-store.js";
import { PostgresMemberProfileStore } from "../src/profiles/pg-store.js";
import type { MemberProfileStore } from "../src/profiles/store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import {
  publicVoteConformance,
  type PublicVoteWorld,
} from "./conformance/public-votes.js";
import { atBarrier } from "./support/barrier.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

// ADR-0048: both voting stores, held to the same public-vote suite.

function around(
  store: PublicVoteWorld["store"],
  voters: VoterStore,
  profiles: MemberProfileStore,
  clock: () => Date,
): Omit<PublicVoteWorld, "hide"> {
  return {
    store,
    profiles,
    async account(id) {
      await voters.create(
        {
          id,
          community: null,
          assurance: "email",
          claimedAt: clock(),
          proofEmailsOptIn: false,
        },
        { kind: "email", value: `${id}@example.test`, verifiedAt: clock() },
      );
    },
    async name(id, displayName, visible = true) {
      await profiles.save(
        { voterId: id, sessionGeneration: 0 },
        { displayName, bio: "", visible },
      );
    },
  };
}

publicVoteConformance("in memory", async (clock) => {
  const voters = new InMemoryVoterStore();
  const profiles = new InMemoryMemberProfileStore(voters, { clock });
  const store = new InMemoryVotingStore(clock, {
    displayNameOf: memoryDisplayNames(voters),
  });
  return around(store, voters, profiles, clock);
});

publicVoteConformance(
  "postgres",
  async (clock, t) => {
    const pool = await migratedSchema(t);
    const store = new PostgresVotingStore(pool, clock);
    return {
      ...around(
        store,
        new PostgresVoterStore(pool),
        new PostgresMemberProfileStore(pool, { clock }),
        clock,
      ),
      async hide(pollId) {
        await pool.query("update polls set hidden = true where id = $1", [
          pollId,
        ]);
      },
    };
  },
  { skip: databaseSkip },
);

// What only the database store can get wrong: two writes by one person at
// once, and a close that passes while a cast waits on the person lock.
const AT = new Date("2026-11-18T12:00:00.123Z");
const asAda = { confirmation: "a".repeat(64), lockKey: 1001n } as const;
const holdAda = "select pg_advisory_xact_lock($1::bigint)";

async function adaOnPublicPoll(t: TestContext, clock: () => Date) {
  const pool = await migratedSchema(t);
  await new PostgresVoterStore(pool).create(
    {
      id: "ada",
      community: null,
      assurance: "email",
      claimedAt: AT,
      proofEmailsOptIn: false,
    },
    { kind: "email", value: "ada@example.test", verifiedAt: AT },
  );
  const store = new PostgresVotingStore(pool, clock);
  await store.createPoll({
    id: "p1",
    question: "Q",
    choices: ["a", "b"],
    method: "single",
    votePrivacy: "public",
    closesAt: new Date(AT.getTime() + 60_000),
  });
  return { pool, store };
}

test(
  "postgres: two first public casts by one person at once make one vote",
  { skip: databaseSkip },
  async (t) => {
    const { pool, store } = await adaOnPublicPoll(t, () => AT);
    const results = await atBarrier(
      pool,
      holdAda,
      [asAda.lockKey.toString()],
      2,
      () =>
        Promise.all([
          store.castPublic("p1", "ada", [0], asAda),
          store.castPublic("p1", "ada", [1], asAda),
        ]),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [
      "changed",
      "counted",
    ]);
    const { rows } = await pool.query("select 1 from public_vote");
    assert.equal(rows.length, 1);
    assert.equal((await store.results("p1")).voters, 1);
  },
);

test(
  "postgres: a public cast or removal that waited past the close writes nothing",
  { skip: databaseSkip },
  async (t) => {
    let now = AT;
    const { pool, store } = await adaOnPublicPoll(t, () => now);
    await store.castPublic("p1", "ada", [0], asAda);
    // A barrier held by hand, so the clock moves only once both provably
    // wait on the person lock: a store reading it before the lock would see
    // the poll open and write.
    const barrier = await pool.connect();
    let pending: Promise<[unknown, unknown]>;
    try {
      await barrier.query("begin");
      await barrier.query(holdAda, [asAda.lockKey.toString()]);
      pending = Promise.all([
        store.castPublic("p1", "ada", [1], asAda),
        store.removePublicVote("p1", "ada", asAda.lockKey),
      ]);
      pending.catch(() => undefined);
      for (let tries = 0; ; tries++) {
        const { rows } = await pool.query(
          "select 1 from pg_locks where locktype = 'advisory' and not granted",
        );
        if (rows.length >= 2) break;
        assert.ok(tries < 500, "the writes never waited on the person lock");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      now = new Date(AT.getTime() + 60_000);
      await barrier.query("commit");
    } finally {
      await barrier.query("rollback").catch(() => undefined);
      barrier.release();
    }
    const [cast, removal] = await pending;
    assert.deepEqual(cast, { status: "closed" });
    assert.deepEqual(removal, { status: "closed" });
    assert.deepEqual((await store.publicVoteOf("p1", "ada"))?.choices, [0]);
  },
);
