import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { loadMigrations, migrate } from "../src/db/migrate.js";
import { PostgresCreationStore } from "../src/authoring/pg-store.js";
import {
  PostgresClaimStore,
  PostgresVoterStore,
  allowDomain,
} from "../src/identity/pg-store.js";
import {
  databaseSkip,
  migratedSchema,
  throwawaySchema,
} from "./support/database.js";

const AT = new Date("2026-10-12T12:00:00.123Z");
const options = { skip: databaseSkip };
const account = (id: string, community: string | null) => ({
  id,
  community,
  assurance: "email" as const,
  claimedAt: AT,
  proofEmailsOptIn: false,
});
const credential = (id: string) => ({
  kind: "email" as const,
  value: `${id}@example.test`,
  verifiedAt: AT,
});
const claim = (community: string | null) => ({
  tokenHash: "claim",
  kind: "email" as const,
  subject: "claim@example.test",
  community,
  proofEmailsOptIn: false,
  createdAt: AT,
  expiresAt: new Date(AT.getTime() + 1000),
});

async function before006(t: TestContext) {
  const { pool } = await throwawaySchema(t);
  const dir = await mkdtemp(path.join(tmpdir(), "pulse-356-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const m of (await loadMigrations()).filter((m) => m.version < "006"))
    await writeFile(path.join(dir, `${m.version}_${m.name}.sql`), m.sql);
  await migrate(pool, { dir });
  return pool;
}

test(
  "identity_writes_register_posting_destinations_and_preserve_null_membership",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    const voters = new PostgresVoterStore(pool);
    await voters.create(account("member", "new-campus"), credential("member"));
    await voters.create(account("guest", null), credential("guest"));
    await new PostgresClaimStore(pool).put(claim("claim-campus"));
    await allowDomain(pool, {
      community: "domain-campus",
      domain: "example.test",
    });
    const creation = new PostgresCreationStore(pool);
    assert.deepEqual(
      (await creation.context({ voterId: "member", sessionGeneration: 0 }))
        .community,
      { id: "new-campus", label: "new-campus" },
    );
    assert.deepEqual(
      (await creation.context({ voterId: "guest", sessionGeneration: 0 }))
        .community,
      { id: "pulse-general", label: "General" },
    );
    assert.equal((await voters.byId("guest"))?.community, null);
    assert.deepEqual(
      (await pool.query("select id from community order by id")).rows.map(
        (r) => r.id,
      ),
      ["claim-campus", "domain-campus", "new-campus", "pulse-general"],
    );
    await pool.query(
      "update community set label = 'Campus name' where id = 'new-campus'",
    );
    await voters.create(account("second", "new-campus"), credential("second"));
    assert.equal(
      (await creation.context({ voterId: "second", sessionGeneration: 0 }))
        .community.label,
      "Campus name",
    );
    for (const table of ["voter", "pending_claim", "allowed_domain"])
      for (const community of ["unknown", "pulse-general"])
        await assert.rejects(
          pool.query(`update ${table} set community = $1`, [community]),
        );
    await assert.rejects(
      pool.query("delete from community where id = 'new-campus'"),
    );
  },
);

test(
  "failed_identity_writes_roll_back_new_community_registration",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await assert.rejects(
      new PostgresVoterStore(pool).create(account("bad", "voter-failed"), {
        ...credential("bad"),
        params: { bad: "\u0000" },
      }),
    );
    const claims = new PostgresClaimStore(pool);
    await claims.put(claim(null));
    await assert.rejects(claims.put(claim("claim-failed")));
    await assert.rejects(
      allowDomain(pool, { community: "domain-failed", domain: "\u0000" }),
    );
    assert.deepEqual(
      (await pool.query("select id from community")).rows.map((r) => r.id),
      ["pulse-general"],
    );
    for (const write of [
      () =>
        new PostgresVoterStore(pool).create(
          account("reserved", "pulse-general"),
          credential("reserved"),
        ),
      () => claims.put({ ...claim("pulse-general"), tokenHash: "reserved" }),
      () =>
        allowDomain(pool, {
          community: "pulse-general",
          domain: "reserved.test",
        }),
    ])
      await assert.rejects(write);
  },
);

test(
  "upgrade_backfills_labels_added_after_005_without_overwriting_labels_or_membership",
  options,
  async (t) => {
    const pool = await before006(t);
    await pool.query(
      "insert into community values ('known', 'Known display name')",
    );
    await pool.query(
      "insert into voter (id, community, assurance, claimed_at, proof_emails_opt_in, session_generation) values ('member', 'late-voter', 'email', $1, false, 0), ('guest', null, 'email', $1, false, 0)",
      [AT],
    );
    await pool.query(
      "insert into pending_claim (token_hash, kind, subject, community, created_at, expires_at, proof_emails_opt_in) values ('late', 'email', 'late@example.test', 'late-claim', $1, $2, false)",
      [AT, new Date(AT.getTime() + 1000)],
    );
    await pool.query(
      "insert into allowed_domain values ('late-domain', 'example.test', false), ('known', 'known.test', false)",
    );
    assert.deepEqual((await migrate(pool)).applied, ["006"]);
    assert.deepEqual(
      (await pool.query("select * from community order by id")).rows,
      [
        { id: "known", label: "Known display name" },
        { id: "late-claim", label: "late-claim" },
        { id: "late-domain", label: "late-domain" },
        { id: "late-voter", label: "late-voter" },
        { id: "pulse-general", label: "General" },
      ],
    );
    assert.deepEqual(
      (await pool.query("select id, community from voter order by id")).rows,
      [
        { id: "guest", community: null },
        { id: "member", community: "late-voter" },
      ],
    );
    assert.deepEqual((await migrate(pool)).applied, []);
  },
);

for (const table of ["voter", "pending_claim", "allowed_domain"] as const)
  test(
    `reserved_general_collision_after_005_in_${table}_rolls_back_006`,
    options,
    async (t) => {
      const pool = await before006(t);
      if (table === "voter")
        await pool.query(
          "insert into voter (id, community, assurance, claimed_at, proof_emails_opt_in, session_generation) values ('collision', 'pulse-general', 'email', $1, false, 0)",
          [AT],
        );
      if (table === "pending_claim")
        await pool.query(
          "insert into pending_claim (token_hash, kind, subject, community, created_at, expires_at, proof_emails_opt_in) values ('collision', 'email', 'a@example.test', 'pulse-general', $1, $2, false)",
          [AT, new Date(AT.getTime() + 1000)],
        );
      if (table === "allowed_domain")
        await pool.query(
          "insert into allowed_domain values ('pulse-general', 'example.test', false)",
        );
      await assert.rejects(
        migrate(pool),
        /006_identity_community_keys.sql failed and was rolled back/,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from schema_migrations where version = '006'",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from pg_constraint where conname = 'voter_community_fk' and connamespace = current_schema()::regnamespace",
          )
        ).rows[0].n,
        0,
      );
    },
  );
