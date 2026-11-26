import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Pool } from "pg";
import { loadMigrations, migrate } from "../src/db/migrate.js";
import { isReservedName } from "../src/profiles/input.js";
import {
  databaseSkip,
  migratedSchema,
  throwawaySchema,
} from "./support/database.js";
import {
  ALLOWED_SPELLINGS,
  RESERVED_SPELLINGS,
} from "./support/reserved-names.js";

/**
 * ADR-0048 decision 3: the storage layer refuses what the stores above it
 * never do, whatever code runs. Raw SQL, so no store can stand in for the
 * schema. The conformance suite (`conformance/public-votes.ts`) runs the same
 * cases through both stores.
 */
const AT = new Date("2026-11-18T12:00:00.123Z");
const options = { skip: databaseSkip };

async function before018(t: TestContext): Promise<Pool> {
  return before(t, "018");
}

/** A schema migrated up to, not including, `version`. */
async function before(t: TestContext, version: string): Promise<Pool> {
  const { pool } = await throwawaySchema(t);
  const dir = await mkdtemp(path.join(tmpdir(), "pulse-685-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const m of (await loadMigrations()).filter((m) => m.version < version))
    await writeFile(path.join(dir, `${m.version}_${m.name}.sql`), m.sql);
  await migrate(pool, { dir, clock: () => AT });
  return pool;
}

async function account(pool: Pool, id: string): Promise<void> {
  await pool.query(
    "insert into voter (id, community, claimed_at, proof_emails_opt_in, session_generation, assurance) values ($1, null, $2, false, 0, 'email')",
    [id, AT],
  );
}

async function pollOf(pool: Pool, id: string, privacy: string): Promise<void> {
  await pool.query(
    "insert into polls (id, question, method, created_at, accepts_suggestions, vote_privacy) values ($1, 'Q', 'single', $2, false, $3)",
    [id, AT, privacy],
  );
}

async function vote(pool: Pool, poll: string, voter: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into vote (id, poll_id, voter_id, cast_at) values ($1, $2, $3, $4)",
    [id, poll, voter, AT],
  );
  return id;
}

async function link(
  pool: Pool,
  voteId: string,
  poll: string,
  voter: string,
  acct: string,
  privacy = "public",
): Promise<void> {
  await pool.query(
    "insert into public_vote (vote_id, poll_id, voter_id, vote_privacy, account_id, list_key) values ($1, $2, $3, $4, $5, $6)",
    [voteId, poll, voter, privacy, acct, randomUUID()],
  );
}

const count = async (pool: Pool, sql: string, args: unknown[] = []) =>
  Number((await pool.query<{ n: string }>(sql, args)).rows[0]?.n);

test(
  "upgrading_makes_every_existing_poll_anonymous_with_no_default",
  options,
  async (t) => {
    const pool = await before018(t);
    await pool.query(
      "insert into polls (id, question, method, created_at, accepts_suggestions) values ('legacy', 'Q', 'single', $1, false)",
      [AT],
    );
    await vote(pool, "legacy", "b:browser");
    assert.deepEqual((await migrate(pool)).applied, ["018", "019", "020"]);
    assert.deepEqual(
      (await pool.query("select id, vote_privacy from polls")).rows,
      [{ id: "legacy", vote_privacy: "anonymous" }],
    );
    // No default: an insert that does not say which is refused.
    await assert.rejects(
      pool.query(
        "insert into polls (id, question, method, created_at, accepts_suggestions) values ('new', 'Q', 'single', $1, false)",
        [AT],
      ),
      /null value in column "vote_privacy"/,
    );
    await assert.rejects(
      pollOf(pool, "odd", "secret"),
      /polls_vote_privacy_check/,
    );
  },
);

test(
  "018_refuses_to_run_over_a_reserved_profile_name_and_leaves_nothing_applied",
  options,
  async (t) => {
    const pool = await before018(t);
    await account(pool, "ada");
    await pool.query(
      "insert into member_profile (voter_id, public_id, display_name, bio, visible, created_at, updated_at) values ('ada', $1, 'Verified  VOTER', '', true, $2, $2)",
      [randomUUID(), AT],
    );
    await assert.rejects(migrate(pool), (error: Error) => {
      assert.match(String(error.cause), /reserved name "Verified voter"/);
      return true;
    });
    assert.equal(
      await count(
        pool,
        "select count(*) as n from information_schema.columns where table_schema = current_schema() and table_name = 'polls' and column_name = 'vote_privacy'",
      ),
      0,
    );
    // Fixed by hand, it runs.
    await pool.query("update member_profile set display_name = 'Ada'");
    assert.deepEqual((await migrate(pool)).applied, ["018", "019", "020"]);
    await assert.rejects(
      pool.query("update member_profile set display_name = 'verified voter'"),
      /member_profile_name_not_reserved/,
    );
  },
);

test("a_polls_vote_privacy_never_changes", options, async (t) => {
  const pool = await migratedSchema(t);
  await pollOf(pool, "anon", "anonymous");
  await pollOf(pool, "pub", "public");
  await assert.rejects(
    pool.query("update polls set vote_privacy = 'public' where id = 'anon'"),
    /vote privacy is fixed at creation/,
  );
  await assert.rejects(
    pool.query("update polls set vote_privacy = 'anonymous' where id = 'pub'"),
    /vote privacy is fixed at creation/,
  );
  // Other columns still change.
  await pool.query("update polls set hidden = true where id = 'pub'");
});

test(
  "the_database_refuses_every_mix_of_public_and_ballot_identities",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await account(pool, "ada");
    await account(pool, "bo");
    await pollOf(pool, "anon", "anonymous");
    await pollOf(pool, "pub", "public");

    // A cookie-filed row on a public-vote poll, a pv: row on an anonymous one.
    await assert.rejects(vote(pool, "pub", "b:browser"), /filed under a pv:/);
    await assert.rejects(vote(pool, "anon", "pv:x"), /never filed under a pv:/);

    // An account on an anonymous poll's vote, whatever the row claims.
    const cookie = await vote(pool, "anon", "b:browser");
    await assert.rejects(
      link(pool, cookie, "anon", "b:browser", "ada"),
      /public_vote_voter_id_check/,
    );
    await assert.rejects(
      link(pool, cookie, "anon", "pv:x", "ada"),
      /public_vote_vote_id_poll_id_voter_id_fkey/,
    );
    await assert.rejects(
      link(pool, cookie, "anon", "b:browser", "ada", "anonymous"),
      /public_vote_voter_id_check|public_vote_vote_privacy_check/,
    );

    // A linked row: its voter_id cannot move, nor its poll.
    const named = await vote(pool, "pub", "pv:ada");
    await link(pool, named, "pub", "pv:ada", "ada");
    await assert.rejects(
      pool.query("update vote set voter_id = 'pv:other' where id = $1", [
        named,
      ]),
      /public_vote_vote_id_poll_id_voter_id_fkey/,
    );
    await assert.rejects(
      pool.query("update vote set voter_id = 'b:browser2' where id = $1", [
        named,
      ]),
      /filed under a pv:/,
    );
    // A second row for the same (poll, account).
    const twice = await vote(pool, "pub", "pv:ada-2");
    await assert.rejects(
      link(pool, twice, "pub", "pv:ada-2", "ada"),
      /public_vote_poll_id_account_id_key/,
    );

    // What still works: an unlinked anonymous row moves (the ADR-0046 shape),
    // and a re-cast updates cast_at.
    await pool.query("update vote set voter_id = 'b:moved' where id = $1", [
      cookie,
    ]);
    await pool.query("update vote set cast_at = $2 where id = $1", [
      named,
      new Date(AT.getTime() + 1000),
    ]);
  },
);

test(
  "deleting_the_vote_or_the_poll_deletes_the_account_link",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await account(pool, "ada");
    for (const id of ["pub", "pub2"]) {
      await pollOf(pool, id, "public");
      const v = await vote(pool, id, `pv:${id}`);
      await link(pool, v, id, `pv:${id}`, "ada");
    }
    await pool.query("delete from vote where poll_id = 'pub'");
    await pool.query("delete from polls where id = 'pub2'");
    assert.equal(await count(pool, "select count(*) as n from public_vote"), 0);
  },
);

// Migration 019: the reserved name in every spelling that reads the same
// (ADR-0048 decision 8), held to the same table as `isReservedName`.
async function profile(pool: Pool, voter: string, name: string) {
  await pool.query(
    "insert into member_profile (voter_id, public_id, display_name, bio, visible, created_at, updated_at) values ($1, $2, $3, '', true, $4, $4)",
    [voter, randomUUID(), name, AT],
  );
}

test(
  "019_reserves_every_spelling_the_app_check_reserves_and_no_other",
  options,
  async (t) => {
    const pool = await migratedSchema(t);
    await account(pool, "ada");
    await profile(pool, "ada", "Ada");
    // Trimmed, as the app stores every name (015 refuses any other).
    const rename = (name: string) =>
      pool.query("update member_profile set display_name = $1", [name.trim()]);
    for (const name of RESERVED_SPELLINGS) {
      assert.equal(isReservedName(name), true);
      await assert.rejects(
        rename(name),
        /member_profile_name_not_reserved/,
        JSON.stringify(name),
      );
    }
    for (const name of ALLOWED_SPELLINGS) {
      assert.equal(isReservedName(name), false);
      await rename(name);
    }
  },
);

test(
  "019_key_reserves_the_same_spellings_whatever_the_collation",
  options,
  async (t) => {
    // lower() follows the locale; the key must not (under "C", U+0130 would
    // stay itself and "Ver\u0130fied voter" would pass).
    const pool = await migratedSchema(t);
    for (const collation of ["C", "POSIX", "default"])
      for (const [name, reserved] of [
        ...RESERVED_SPELLINGS.map((n) => [n.trim(), true] as const),
        ...ALLOWED_SPELLINGS.map((n) => [n, false] as const),
      ]) {
        const { rows } = await pool.query(
          `select pulse_reserved_name_key($1::text collate "${collation}") = 'verifiedvoter' as hit`,
          [name],
        );
        assert.equal(
          rows[0].hit,
          reserved,
          `${collation} ${JSON.stringify(name)}`,
        );
      }
  },
);

test(
  "019_refuses_to_run_over_a_hidden_reserved_name_and_leaves_018s_check",
  options,
  async (t) => {
    const pool = await before(t, "019");
    await account(pool, "ada");
    await profile(pool, "ada", "Verified\u200D voter");
    await assert.rejects(migrate(pool), (error: Error) => {
      assert.match(String(error.cause), /re-run 019/);
      return true;
    });
    // 018's check is still there.
    await assert.rejects(
      pool.query("update member_profile set display_name = 'verified voter'"),
      /member_profile_name_not_reserved/,
    );
    // Fixed by hand, it runs.
    await pool.query("update member_profile set display_name = 'Ada'");
    assert.deepEqual((await migrate(pool)).applied, ["019", "020"]);
  },
);
