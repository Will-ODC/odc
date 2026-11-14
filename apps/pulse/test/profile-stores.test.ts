import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Pool, PoolClient } from "pg";
import { InMemoryVoterStore, type VoterStore } from "../src/identity/store.js";
import { InMemoryMemberProfileStore } from "../src/profiles/memory-store.js";
import { PostgresMemberProfileStore } from "../src/profiles/pg-store.js";
import type {
  MemberProfileStore,
  ProfileActor,
} from "../src/profiles/store.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

const AT = new Date("2026-11-12T12:00:00.000Z");
const PUBLIC_ID = "f8cdca64-0d4f-4b99-b5bc-e6b749843ad8";
const OTHER_PUBLIC_ID = "b94ecf7f-fcf6-4131-a637-6ce4f4d671e2";
const actor: ProfileActor = {
  voterId: "private-voter-id",
  sessionGeneration: 0,
};

interface Fixture {
  store: MemberProfileStore;
  voters: VoterStore;
  pool?: Pool;
  memoryVoters?: LockableInMemoryVoterStore | undefined;
  setTime(value: Date): void;
}

class LockableInMemoryVoterStore extends InMemoryVoterStore {
  #firstRead:
    | {
        reached(): void;
        resume: Promise<void>;
      }
    | undefined;

  holdFirstRead(): { reached: Promise<void>; release(): void } {
    let reached!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    this.#firstRead = {
      reached,
      resume: new Promise<void>((resolve) => (release = resolve)),
    };
    return { reached: waiting, release };
  }

  override async byId(id: string) {
    const hold = this.#firstRead;
    this.#firstRead = undefined;
    if (hold) {
      hold.reached();
      await hold.resume;
    }
    return super.byId(id);
  }
}

for (const kind of ["memory", "postgres"] as const) {
  const skip = kind === "postgres" ? databaseSkip : false;
  const fresh = async (
    t: TestContext,
    sequences?: { ids: string[]; times: Date[] },
  ): Promise<Fixture> => {
    let now = AT;
    let nextId = 0;
    let nextTime = 0;
    const pool = kind === "postgres" ? await migratedSchema(t) : undefined;
    const memoryVoters = pool ? undefined : new LockableInMemoryVoterStore();
    const voters: VoterStore = pool
      ? new PostgresVoterStore(pool)
      : (memoryVoters as LockableInMemoryVoterStore);
    await voters.create(
      {
        id: actor.voterId,
        community: null,
        assurance: "email",
        claimedAt: AT,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: "private@example.test", verifiedAt: AT },
    );
    const options = {
      clock: () => sequences?.times[nextTime++] ?? now,
      newId: () => sequences?.ids[nextId++] ?? PUBLIC_ID,
    };
    return {
      store: pool
        ? new PostgresMemberProfileStore(pool, options)
        : new InMemoryMemberProfileStore(
            memoryVoters as LockableInMemoryVoterStore,
            options,
          ),
      voters,
      ...(pool ? { pool } : { memoryVoters }),
      setTime(value) {
        now = value;
      },
    };
  };

  test(
    `${kind}: profile_is_opt_in_public_and_keeps_its_opaque_id`,
    { skip },
    async (t) => {
      const f = await fresh(t);
      assert.equal(await f.store.byOwner(actor), undefined);
      assert.equal(await f.store.publicById(PUBLIC_ID), undefined);

      const created = await f.store.save(actor, {
        displayName: " Ada ",
        bio: " Neighbour ",
        visible: true,
      });
      assert.equal(created.publicId, PUBLIC_ID);
      assert.deepEqual(await f.store.publicById(PUBLIC_ID), {
        publicId: PUBLIC_ID,
        displayName: "Ada",
        bio: "Neighbour",
        createdAt: AT,
      });
      assert.deepEqual(await f.store.publicByOwnerId(actor.voterId), {
        publicId: PUBLIC_ID,
        displayName: "Ada",
        bio: "Neighbour",
        createdAt: AT,
      });
      assert.deepEqual(await f.store.visibleOwnerById(PUBLIC_ID), {
        voterId: actor.voterId,
        profile: {
          publicId: PUBLIC_ID,
          displayName: "Ada",
          bio: "Neighbour",
          createdAt: AT,
        },
      });
      assert.doesNotMatch(
        JSON.stringify(await f.store.publicById(PUBLIC_ID)),
        /private-voter-id|private@example\.test|visible|updatedAt/,
      );

      const later = new Date(AT.getTime() + 1000);
      f.setTime(later);
      const hidden = await f.store.save(actor, {
        displayName: "Ada Lovelace",
        bio: "",
        visible: false,
      });
      assert.equal(hidden.publicId, PUBLIC_ID);
      assert.equal(hidden.createdAt.getTime(), AT.getTime());
      assert.equal(hidden.updatedAt.getTime(), later.getTime());
      assert.equal(await f.store.publicById(PUBLIC_ID), undefined);
      assert.equal(await f.store.publicByOwnerId(actor.voterId), undefined);
      assert.equal(await f.store.visibleOwnerById(PUBLIC_ID), undefined);
    },
  );

  test(
    `${kind}: a_save_on_a_clock_behind_the_creation_time_keeps_updated_at_no_earlier`,
    { skip },
    async (t) => {
      const f = await fresh(t);
      await f.store.save(actor, { displayName: "Ada", bio: "", visible: true });
      f.setTime(new Date(AT.getTime() - 60_000));
      const saved = await f.store.save(actor, {
        displayName: "Ada L",
        bio: "",
        visible: true,
      });
      assert.equal(saved.displayName, "Ada L");
      assert.equal(saved.createdAt.getTime(), AT.getTime());
      assert.equal(saved.updatedAt.getTime(), AT.getTime());
    },
  );

  test(
    `${kind}: overlapping_first_saves_keep_one_id_and_the_first_creation_time`,
    { skip },
    async (t) => {
      const later = new Date(AT.getTime() + 1000);
      const f = await fresh(t, {
        ids: [PUBLIC_ID, OTHER_PUBLIC_ID],
        times: [AT, later],
      });

      let release: () => Promise<void> | void;
      let firstBlocked: Promise<void>;
      let secondBlocked: Promise<void>;
      let held: PoolClient | undefined;
      if (f.pool) {
        held = await f.pool.connect();
        await held.query("begin");
        await held.query("select 1 from voter where id = $1 for update", [
          actor.voterId,
        ]);
        const pid = await backendPid(held);
        firstBlocked = until(async () => (await blockedBy(f.pool!, pid)) >= 1);
        secondBlocked = until(async () => (await blockedBy(f.pool!, pid)) >= 2);
        release = () => held!.query("commit").then(() => undefined);
      } else {
        const hold = f.memoryVoters!.holdFirstRead();
        firstBlocked = hold.reached;
        secondBlocked = Promise.resolve();
        release = hold.release;
      }

      try {
        const first = f.store.save(actor, {
          displayName: "First",
          bio: "",
          visible: true,
        });
        await firstBlocked;
        const second = f.store.save(actor, {
          displayName: "Second",
          bio: "",
          visible: true,
        });
        await secondBlocked;
        await release();

        const results = await Promise.all([first, second]);
        assert.deepEqual(
          results.map((profile) => profile.publicId),
          [PUBLIC_ID, PUBLIC_ID],
        );
        assert.deepEqual(
          results.map((profile) => profile.createdAt),
          [AT, AT],
        );
        assert.equal((await f.store.byOwner(actor))?.displayName, "Second");
        const publicRows = await Promise.all(
          [PUBLIC_ID, OTHER_PUBLIC_ID].map((id) => f.store.publicById(id)),
        );
        assert.equal(publicRows.filter(Boolean).length, 1);
        if (f.pool) {
          const count = await f.pool.query<{ count: number }>(
            "select count(*)::int as count from member_profile where voter_id = $1",
            [actor.voterId],
          );
          assert.equal(count.rows[0]?.count, 1);
        }
      } finally {
        if (held) {
          await held.query("rollback").catch(() => null);
          held.release();
        }
      }
    },
  );

  test(
    `${kind}: only_the_current_owner_session_can_read_or_write`,
    { skip },
    async (t) => {
      const f = await fresh(t);
      const outsider = { voterId: "someone-else", sessionGeneration: 0 };
      await assert.rejects(f.store.byOwner(outsider), {
        message: "signed_out",
      });
      await f.voters.advanceSessionGeneration(actor.voterId);
      await assert.rejects(
        f.store.save(actor, { displayName: "Ada", bio: "", visible: true }),
        { message: "signed_out" },
      );
    },
  );
}

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return rows[0]?.pid ?? -1;
}

async function blockedBy(pool: Pool, pid: number): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "with recursive waiting(pid) as (" +
      " select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))" +
      " union" +
      " select a.pid from pg_stat_activity a join waiting w" +
      " on w.pid = any(pg_blocking_pids(a.pid))" +
      ") select count(*)::int as n from waiting",
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
