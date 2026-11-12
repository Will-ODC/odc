import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { Pool } from "pg";
import { PURPOSE_VERSION } from "../src/authoring/input.js";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { PostgresCreationStore } from "../src/authoring/pg-store.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import { InMemoryVoterStore } from "../src/identity/store.js";
import { PostgresImageStore } from "../src/images/pg-store.js";
import { InMemoryImageStore } from "../src/images/store.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemoryVotingStore } from "../src/voting/store.js";
import {
  ACCOUNTS,
  AT,
  OWNER_EMAIL,
  addAccounts,
  imageStoreConformance,
  type ImageFixture,
} from "./conformance/image-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

imageStoreConformance("in memory", async () => {
  let now = AT;
  const clock = () => now;
  const voters = new InMemoryVoterStore();
  await addAccounts(voters);
  const voting = new InMemoryVotingStore(clock);
  return {
    voters,
    voting,
    creation: new InMemoryCreationStore(voters, voting, {
      clock,
      ownerEmail: OWNER_EMAIL,
      communityLabels: new Map([["campus", "Campus"]]),
    }),
    images: new InMemoryImageStore(voters, voting, { clock }),
    setTime: (time) => {
      now = time;
    },
  };
});

async function postgresFixture(
  t: TestContext,
): Promise<ImageFixture & { pool: Pool }> {
  let now = AT;
  const clock = () => now;
  const pool = await migratedSchema(t);
  await pool.query(
    "insert into community (id, label) values ('campus', 'Campus')",
  );
  const voters = new PostgresVoterStore(pool);
  await addAccounts(voters);
  const voting = new PostgresVotingStore(pool, clock);
  return {
    pool,
    voters,
    voting,
    creation: new PostgresCreationStore(pool, {
      clock,
      ownerEmail: OWNER_EMAIL,
    }),
    images: new PostgresImageStore(pool, { clock }),
    setTime: (time) => {
      now = time;
    },
  };
}

imageStoreConformance("postgres", postgresFixture, { skip: databaseSkip });

// Postgres alone: what its schema promises beyond the shared behaviour.

const opt = { skip: databaseSkip };
const member = { voterId: ACCOUNTS.member.id, sessionGeneration: 0 };

function processed() {
  const variant = () => {
    const bytes = randomBytes(32);
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  return { width: 300, height: 200, display: variant(), thumb: variant() };
}

async function attached(f: Awaited<ReturnType<typeof postgresFixture>>) {
  const image = processed();
  const saved = await f.images.savePending(member, image);
  const { poll } = await f.creation.publish(member, randomUUID(), {
    question: "Plant a garden?",
    choices: ["Yes", "No"],
    method: "single",
    purposeAcknowledgement: PURPOSE_VERSION,
    image: { id: saved.id, alt: "Plot" },
  });
  return { saved, poll, image };
}

async function count(pool: Pool, table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return rows[0]?.n ?? -1;
}

test(
  "postgres: image bytes are deleted only together with their image row",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const saved = await f.images.savePending(member, processed());
    await assert.rejects(
      f.pool.query("delete from image_bytes where image_id = $1", [saved.id]),
      /deleted only with their image row/,
    );
    await assert.rejects(
      f.pool.query(
        "update image_bytes set sha256 = repeat('0', 64) where image_id = $1",
        [saved.id],
      ),
      /never updated/,
    );
    assert.equal(await count(f.pool, "image_bytes"), 2);
    await f.pool.query("delete from image where id = $1", [saved.id]);
    assert.equal(await count(f.pool, "image"), 0);
    assert.equal(await count(f.pool, "image_bytes"), 0);
  },
);

test(
  "postgres: an image row cannot be committed without both variants",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    await assert.rejects(
      f.pool.query(
        "insert into image (id, uploaded_by, uploaded_at, width, height) values ($1, $2, $3, 10, 10)",
        [randomUUID(), member.voterId, AT],
      ),
      /display and thumb variants/,
    );
    assert.equal(await count(f.pool, "image"), 0);
  },
);

test(
  "postgres: attaching records an audit row with the display hash and no content",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const { saved, poll, image } = await attached(f);
    const { rows } = await f.pool.query(
      "select target_kind, target_id, image_id, image_sha256, action, actor_kind, actor_id, reason, changed_at from content_change",
    );
    assert.deepEqual(rows, [
      {
        target_kind: "poll",
        target_id: poll.id,
        image_id: saved.id,
        image_sha256: image.display.sha256,
        action: "image_attach",
        actor_kind: "poster",
        actor_id: member.voterId,
        reason: null,
        changed_at: AT,
      },
    ]);
    const stored = await f.pool.query(
      "select owner_kind, owner_id, alt, attached_at from image where id = $1",
      [saved.id],
    );
    assert.deepEqual(stored.rows, [
      { owner_kind: "poll", owner_id: poll.id, alt: "Plot", attached_at: AT },
    ]);
    const link = await f.pool.query(
      "select image_id from polls where id = $1",
      [poll.id],
    );
    assert.deepEqual(link.rows, [{ image_id: saved.id }]);
  },
);

test(
  "postgres: the change table is append-only and its targets are not foreign keys",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const { saved, poll } = await attached(f);
    await assert.rejects(
      f.pool.query("update content_change set reason = 'x'"),
      /append-only/,
    );
    await assert.rejects(
      f.pool.query("delete from content_change"),
      /append-only/,
    );
    await assert.rejects(
      f.pool.query("truncate content_change"),
      /append-only/,
    );
    const fks = await f.pool.query(
      "select conname from pg_constraint where contype = 'f'" +
        " and conrelid = 'content_change'::regclass",
    );
    assert.deepEqual(fks.rows, []);
    // The audit row outlives the picture and the poll it names, as a purge needs.
    await f.pool.query("update polls set image_id = null where id = $1", [
      poll.id,
    ]);
    await f.pool.query("delete from image where id = $1", [saved.id]);
    await f.pool.query("delete from poll_creation_replay where poll_id = $1", [
      poll.id,
    ]);
    await f.pool.query("delete from poll_choice where poll_id = $1", [poll.id]);
    await f.pool.query("delete from polls where id = $1", [poll.id]);
    assert.equal(await count(f.pool, "content_change"), 1);
  },
);

test(
  "postgres: a hidden poll's picture is not served and its body falls back to the tile",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const { saved, poll } = await attached(f);
    assert.ok(await f.images.servable(saved.id, "thumb"));
    await f.pool.query("update polls set hidden = true where id = $1", [
      poll.id,
    ]);
    assert.equal(await f.images.servable(saved.id, "thumb"), undefined);
    assert.equal(await f.images.servable(saved.id, "display"), undefined);
    assert.equal((await f.voting.getPoll(poll.id))?.image, undefined);
  },
);

test(
  "postgres: a picture whose poll no longer names it is not served or shown",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const { saved, poll } = await attached(f);
    await f.pool.query("update polls set image_id = null where id = $1", [
      poll.id,
    ]);
    assert.equal(await f.images.servable(saved.id, "display"), undefined);
    assert.equal((await f.voting.getPoll(poll.id))?.image, undefined);
  },
);

test(
  "postgres: a community-owned picture is not served before category defaults exist",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const saved = await f.images.savePending(member, processed());
    await f.pool.query(
      "update image set owner_kind = 'community', owner_id = 'campus', alt = 'Campus', attached_at = $2 where id = $1",
      [saved.id, AT],
    );
    assert.equal(await f.images.servable(saved.id, "display"), undefined);
  },
);

test(
  "postgres: a pending picture holds no alt text and an attached one must",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    const saved = await f.images.savePending(member, processed());
    await assert.rejects(
      f.pool.query("update image set alt = 'x' where id = $1", [saved.id]),
      /image_pending_or_attached/,
    );
    await assert.rejects(
      f.pool.query(
        "update image set owner_kind = 'poll', owner_id = 'p', attached_at = $2 where id = $1",
        [saved.id, AT],
      ),
      /image_pending_or_attached/,
    );
  },
);

test(
  "postgres: two uploads racing for the last pending slot cannot both win",
  opt,
  async (t) => {
    const f = await postgresFixture(t);
    for (let n = 0; n < 4; n++) await f.images.savePending(member, processed());
    const other = new PostgresImageStore(f.pool, { clock: () => AT });
    const results = await Promise.allSettled([
      f.images.savePending(member, processed()),
      other.savePending(member, processed()),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    assert.equal(await count(f.pool, "image"), 5);
  },
);
