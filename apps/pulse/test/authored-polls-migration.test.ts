import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Pool } from "pg";
import { loadMigrations, migrate } from "../src/db/migrate.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import {
  databaseSkip,
  migratedSchema,
  throwawaySchema,
} from "./support/database.js";

const AT = new Date("2026-10-11T12:00:00.123Z");
const options = { skip: databaseSkip };

async function before005(t: TestContext): Promise<Pool> {
  const { pool } = await throwawaySchema(t);
  const dir = await mkdtemp(path.join(tmpdir(), "pulse-345-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const m of (await loadMigrations()).filter((m) => m.version < "005")) {
    await writeFile(path.join(dir, `${m.version}_${m.name}.sql`), m.sql);
  }
  await migrate(pool, { dir, clock: () => AT });
  return pool;
}

async function voter(pool: Pool, id: string, community: string | null = null) {
  await pool.query(
    "insert into voter (id, community, claimed_at, proof_emails_opt_in, session_generation, assurance) values ($1, $2, $3, false, 0, 'email')",
    [id, community, AT],
  );
}

async function authored(pool: Pool, id = "authored") {
  await pool.query(
    "insert into polls (id, question, method, created_at, accepts_suggestions, community, created_by, attribution_kind) values ($1, 'Q', 'single', $2, false, 'pulse-general', 'owner', 'anonymous')",
    [id, AT],
  );
}

test(
  "upgrade_preserves_ballots_and_null_membership_without_inventing_authors",
  options,
  async (t) => {
    const pool = await before005(t);
    await voter(pool, "member", "campus");
    await voter(pool, "guest");
    await pool.query(
      "insert into allowed_domain values ('domain-only', 'example.test', false)",
    );
    await pool.query(
      "insert into pending_claim (token_hash, subject, kind, community, proof_emails_opt_in, created_at, expires_at) values ('hash', 'claim@example.test', 'email', 'claim-only', false, $1, $2)",
      [AT, new Date(AT.getTime() + 1000)],
    );
    const store = new PostgresVotingStore(pool, () => AT);
    await store.createPoll({
      id: "legacy",
      question: "Q",
      choices: ["A", "B"],
      method: "single",
    });
    await store.castVote("legacy", "private-browser", [1]);
    const ballot = await store.voteOf("legacy", "private-browser");
    const results = await store.results("legacy");
    assert.deepEqual((await migrate(pool)).applied, ["005", "006"]);
    assert.deepEqual(
      (await pool.query("select id, label from community order by id")).rows,
      [
        { id: "campus", label: "campus" },
        { id: "claim-only", label: "claim-only" },
        { id: "domain-only", label: "domain-only" },
        { id: "pulse-general", label: "General" },
      ],
    );
    assert.equal(
      (await pool.query("select community from voter where id = 'guest'"))
        .rows[0].community,
      null,
    );
    assert.deepEqual(
      (
        await pool.query(
          "select community, created_by, attribution_kind, author_name, hidden from polls where id = 'legacy'",
        )
      ).rows,
      [
        {
          community: null,
          created_by: null,
          attribution_kind: null,
          author_name: null,
          hidden: false,
        },
      ],
    );
    assert.deepEqual(await store.voteOf("legacy", "private-browser"), ballot);
    assert.deepEqual(await store.results("legacy"), results);
    // Existing seed/store insert shape stays usable after the upgrade.
    await store.createPoll({
      id: "seed",
      question: "Seed",
      choices: ["A", "B"],
      method: "single",
    });
    assert.equal((await migrate(pool)).applied.length, 0);
  },
);

for (const source of ["voter", "pending_claim", "allowed_domain"] as const) {
  test(
    `reserved_general_collision_in_${source}_rolls_back_the_entire_migration`,
    options,
    async (t) => {
      const pool = await before005(t);
      if (source === "voter") await voter(pool, "collision", "pulse-general");
      if (source === "allowed_domain")
        await pool.query(
          "insert into allowed_domain values ('pulse-general', 'example.test', false)",
        );
      if (source === "pending_claim")
        await pool.query(
          "insert into pending_claim (token_hash, subject, kind, community, proof_emails_opt_in, created_at, expires_at) values ('hash', 'a@example.test', 'email', 'pulse-general', false, $1, $2)",
          [AT, new Date(AT.getTime() + 1000)],
        );
      await assert.rejects(
        migrate(pool),
        /005_authored_polls\.sql failed and was rolled back/,
      );
      assert.equal(
        (await pool.query("select to_regclass('community') as name")).rows[0]
          .name,
        null,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from schema_migrations where version = '005'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from information_schema.columns where table_schema = current_schema() and table_name = 'polls' and column_name = 'created_by'",
          )
        ).rows[0].n,
        0,
      );
    },
  );
}

test(
  "authored_metadata_refuses_unknown_accounts_communities_and_inconsistent_attribution",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await voter(pool, "owner");
    await authored(pool);
    for (const statement of [
      "update polls set created_by = 'unknown' where id = 'authored'",
      "update polls set community = 'unknown' where id = 'authored'",
      "update polls set attribution_kind = null where id = 'authored'",
      "update polls set author_name = 'Exposed name' where id = 'authored'",
      "update polls set attribution_kind = 'named' where id = 'authored'",
      "update polls set attribution_kind = 'named', author_name = '   ' where id = 'authored'",
    ])
      await assert.rejects(pool.query(statement));
    await pool.query(
      "update polls set attribution_kind = 'named', author_name = 'Ada' where id = 'authored'",
    );
    assert.equal(
      (await pool.query("select author_name from polls where id = 'authored'"))
        .rows[0].author_name,
      "Ada",
    );
  },
);

test(
  "replays_are_account_scoped_and_cannot_reference_another_authors_poll",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await voter(pool, "owner");
    await voter(pool, "other");
    await authored(pool);
    const key = randomUUID();
    const insert = (account: string, replayKey = key) =>
      pool.query(
        "insert into poll_creation_replay values ($1, $2, 'authored', '{}'::jsonb, '{}'::jsonb)",
        [account, replayKey],
      );
    await assert.rejects(insert("other"));
    await insert("owner");
    await assert.rejects(insert("owner"));
    await assert.rejects(insert("owner", randomUUID()));
    await assert.rejects(pool.query("delete from polls where id = 'authored'"));
    assert.equal(
      (await pool.query("select count(*)::int as n from poll_creation_replay"))
        .rows[0].n,
      1,
    );
  },
);

test(
  "acknowledgements_and_grants_keep_milliseconds_and_require_existing_accounts",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await voter(pool, "owner");
    await voter(pool, "recipient");
    await pool.query(
      "insert into publication_acknowledgement values ('recipient', 'community-purpose-v1', $1)",
      [AT],
    );
    await assert.rejects(
      pool.query(
        "insert into publication_acknowledgement values ('owner', 'unknown-version', $1)",
        [AT],
      ),
    );
    await assert.rejects(
      pool.query(
        "insert into publication_acknowledgement values ('recipient', 'community-purpose-v1', $1)",
        [AT],
      ),
    );
    await pool.query(
      "insert into posting_permission values ('recipient', true, 'owner', $1)",
      [AT],
    );
    await pool.query(
      "insert into posting_permission_change values ($1, 'recipient', true, 'owner', $2)",
      [randomUUID(), AT],
    );
    await assert.rejects(
      pool.query(
        "insert into posting_permission values ('unknown', true, 'owner', $1)",
        [AT],
      ),
    );
    await assert.rejects(
      pool.query("update posting_permission set changed_by = 'unknown'"),
    );
    const ack = (
      await pool.query(
        "select acknowledged_at from publication_acknowledgement",
      )
    ).rows[0].acknowledged_at as Date;
    const grant = (
      await pool.query("select changed_at from posting_permission")
    ).rows[0].changed_at as Date;
    assert.equal(ack.getTime(), AT.getTime());
    assert.equal(grant.getTime(), AT.getTime());
  },
);
