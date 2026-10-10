import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainAllowlist } from "../src/identity/allowlist.js";
import { migrate } from "../src/db/migrate.js";
import { parseEmail } from "../src/identity/email.js";
import {
  PostgresClaimStore,
  PostgresDomainSource,
  PostgresVoterStore,
  allowDomain,
} from "../src/identity/pg-store.js";
import type { Pool, PoolClient } from "pg";
import {
  CredentialTakenError,
  type Credential,
  type NewVoter,
} from "../src/identity/store.js";
import { claimStoreConformance } from "./conformance/claim-store.js";
import { voterStoreConformance } from "./conformance/voter-store.js";
import {
  databaseSkip,
  migratedSchema,
  throwawaySchema,
} from "./support/database.js";

// The Postgres identity stores, held to the suites every implementation runs.
voterStoreConformance(
  "postgres",
  async (_clock, t) => new PostgresVoterStore(await migratedSchema(t)),
  { skip: databaseSkip },
);
claimStoreConformance(
  "postgres",
  async (_clock, t) => new PostgresClaimStore(await migratedSchema(t)),
  { skip: databaseSkip },
);

// What only a database store can get wrong.

const AT = new Date("2026-09-11T12:00:00.123Z");

test(
  "eight_spends_of_one_link_at_once_are_one_spend",
  { skip: databaseSkip },
  async (t) => {
    // Eight real spends rarely overlap on their own, and a read-then-write
    // store passes when they run one after another. So queue all eight behind
    // a hold on the link's row, then let go: only a store that checks and
    // spends in one step answers true exactly once.
    const pool = await migratedSchema(t);
    const store = new PostgresClaimStore(pool);
    await store.put({
      tokenHash: "hash-1",
      kind: "email",
      subject: "ada@student.ubc.ca",
      community: "ubc-students",
      proofEmailsOptIn: false,
      createdAt: AT,
      expiresAt: new Date(AT.getTime() + 15 * 60_000),
    });

    const hold = await pool.connect();
    try {
      await hold.query("begin");
      await hold.query(
        "select 1 from pending_claim where token_hash = 'hash-1' for update",
      );
      const holdPid = await backendPid(hold);
      const spends = Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          store.markUsed("hash-1", new Date(AT.getTime() + i)),
        ),
      );
      await until(async () => (await blockedBy(pool, holdPid)) >= 8);
      await hold.query("commit");
      assert.equal((await spends).filter((spent) => spent).length, 1);
    } finally {
      await hold.query("rollback").catch(() => null);
      hold.release();
    }
  },
);

test(
  "a_voter_created_already_signed_out_keeps_that_moment",
  { skip: databaseSkip },
  async (t) => {
    const store = new PostgresVoterStore(await migratedSchema(t));
    const signedOut = new Date(AT.getTime() + 1_000);
    await store.create(newVoter("voter-1", { sessionsValidFrom: signedOut }), {
      kind: "email",
      value: "ada@student.ubc.ca",
      verifiedAt: AT,
    });
    assert.equal(
      (await store.byId("voter-1"))?.sessionsValidFrom?.getTime(),
      signedOut.getTime(),
    );
  },
);

function newVoter(id: string, overrides: Partial<NewVoter> = {}): NewVoter {
  return {
    id,
    community: "ubc-students",
    assurance: "email",
    claimedAt: AT,
    proofEmailsOptIn: false,
    ...overrides,
  };
}

const ADA: Credential = {
  kind: "email",
  value: "ada@student.ubc.ca",
  verifiedAt: AT,
};

test(
  "two_first_sign_ins_for_one_address_at_once_make_one_voter",
  { skip: databaseSkip },
  async (t) => {
    // Race 2 of #158, now across two tables (ADR-0033). Two creates for one
    // credential rarely overlap on their own, and a store that checks before
    // it writes passes when they run one after another. So hold the
    // credential's key in an open transaction — both creates then wait on it
    // — and let go: only a store whose uniqueness lives in the credential's
    // key, and that names the loser's failure, ends with one voter and one
    // CredentialTakenError.
    const pool = await migratedSchema(t);
    const store = new PostgresVoterStore(pool);

    const hold = await pool.connect();
    try {
      await hold.query("begin");
      await hold.query(
        "insert into voter" +
          " (id, community, assurance, claimed_at, proof_emails_opt_in," +
          " session_generation) values ('holder', null, 'email', $1, false, 0)",
        [AT],
      );
      await hold.query(
        "insert into voter_credential (kind, value, voter_id, verified_at)" +
          " values ('email', $1, 'holder', $2)",
        [ADA.value, AT],
      );
      const holdPid = await backendPid(hold);
      const creates = Promise.allSettled([
        store.create(newVoter("voter-a"), ADA),
        store.create(newVoter("voter-b"), ADA),
      ]);
      await until(async () => (await blockedBy(pool, holdPid)) >= 2);
      // Rolled back, not committed: the key is free again, and the two
      // waiting creates now race each other for it.
      await hold.query("rollback");

      const results = await creates;
      const won = results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      const lost = results.flatMap((r) =>
        r.status === "rejected" ? [r.reason as unknown] : [],
      );
      assert.equal(won.length, 1);
      assert.equal(lost.length, 1);
      assert.ok(
        lost[0] instanceof CredentialTakenError,
        `the loser failed with ${String(lost[0])}`,
      );

      const winner = won[0];
      assert.ok(winner);
      assert.equal(
        (await store.byCredential("email", ADA.value))?.id,
        winner.id,
      );
      // And the loser's voter row went with its refused credential.
      const { rows } = await pool.query<{ id: string }>(
        "select id from voter order by id",
      );
      assert.deepEqual(
        rows.map((row) => row.id),
        [winner.id],
      );
    } finally {
      await hold.query("rollback").catch(() => null);
      hold.release();
    }
  },
);

test(
  "a_credential_the_database_refuses_leaves_no_voter_behind",
  { skip: databaseSkip },
  async (t) => {
    // Atomicity forced from the credential side by something other than a
    // taken key: jsonb cannot hold a NUL character, so the credential insert
    // fails after the voter insert has succeeded. Only a store that writes
    // the two in one transaction is left with no voter-1.
    const pool = await migratedSchema(t);
    const store = new PostgresVoterStore(pool);
    await assert.rejects(() =>
      store.create(newVoter("voter-1"), {
        ...ADA,
        params: { vouchedBy: "\u0000" },
      }),
    );
    assert.equal(await store.byId("voter-1"), undefined);
    const { rows } = await pool.query("select id from voter");
    assert.equal(rows.length, 0);
    assert.equal(await store.byCredential("email", ADA.value), undefined);
  },
);

test(
  "a_voter_with_no_credential_is_a_voter_with_no_address",
  { skip: databaseSkip },
  async (t) => {
    // Deliberately representable (ADR-0033): a public-link or anonymous
    // voter (P10) is a voter row with no credential. Nothing in pulse writes
    // one yet, so it is written here by hand — and every read must hand it
    // back with `email: null` rather than fail or invent an address.
    const pool = await migratedSchema(t);
    await pool.query(
      "insert into voter" +
        " (id, community, assurance, claimed_at, proof_emails_opt_in," +
        " session_generation) values ('guest', null, 'link', $1, false, 0)",
      [AT],
    );
    const store = new PostgresVoterStore(pool);
    const guest = await store.byId("guest");
    assert.deepEqual(guest, {
      id: "guest",
      email: null,
      community: null,
      assurance: "link",
      claimedAt: AT,
      proofEmailsOptIn: false,
    });
    assert.equal((await store.advanceSessionGeneration("guest"))?.email, null);
  },
);

test(
  "a_credential_that_is_not_an_email_is_never_shown_as_the_address",
  { skip: databaseSkip },
  async (t) => {
    // P10/P11 will add kinds like `in_person`, whose value is who vouched,
    // not where to send mail. Only an `email` credential is an address:
    // anything else read back as one would put the vouch on /api/me and
    // address proof-of-action mail to it.
    const pool = await migratedSchema(t);
    await pool.query(
      "insert into voter" +
        " (id, community, assurance, claimed_at, proof_emails_opt_in," +
        " session_generation) values ('met', null, 'link', $1, false, 0)",
      [AT],
    );
    await pool.query(
      "insert into voter_credential (kind, value, voter_id, verified_at)" +
        " values ('in_person', 'vouched-by-voter-7', 'met', $1)",
      [AT],
    );
    const store = new PostgresVoterStore(pool);
    assert.equal((await store.byId("met"))?.email, null);
  },
);

test(
  "an_assurance_word_this_build_does_not_know_is_refused",
  { skip: databaseSkip },
  async (t) => {
    // Levels are words with the order in code. A word the code does not know
    // — written by a newer build, say — must not be read as some level it is
    // not.
    const pool = await migratedSchema(t);
    await pool.query(
      "insert into voter" +
        " (id, community, assurance, claimed_at, proof_emails_opt_in," +
        " session_generation) values ('v', null, 'telepathy', $1, false, 0)",
      [AT],
    );
    await assert.rejects(
      () => new PostgresVoterStore(pool).byId("v"),
      /unknown assurance level/,
    );
  },
);

test(
  "a_domain_row_typed_by_hand_in_mixed_case_still_names_its_community",
  { skip: databaseSkip },
  async (t) => {
    // The allowlist is managed by inserts, not only through allowDomain. A
    // row typed by hand must work the same as one written through it.
    const pool = await migratedSchema(t);
    await pool.query(
      "insert into allowed_domain (community, domain, include_subdomains)" +
        " values ('ubc-students', $1, false)",
      ["\t Student.UBC.ca \n"],
    );
    const allowlist = new DomainAllowlist(new PostgresDomainSource(pool));
    const ada = await allowlist.memberships(parseEmail("ada@student.ubc.ca"));
    assert.deepEqual(
      ada.map((m) => m.community),
      ["ubc-students"],
    );
  },
);

async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  return rows[0]?.pid ?? -1;
}

/**
 * How many sessions are waiting behind the session `pid`, directly or in a
 * chain. Waiters for one row queue on each other — only the first names the
 * holder as its blocker — so this follows the chain. Asked of Postgres
 * directly, so other runs sharing the database are never counted.
 */
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

test(
  "two_communities_on_one_domain_both_come_back_from_the_table",
  { skip: databaseSkip },
  async (t) => {
    // The (community, domain) key is what lets this happen at all (ADR-0023);
    // the picker (P2) is only reachable if the table hands both rows over.
    const pool = await migratedSchema(t);
    await allowDomain(pool, { community: "ubc-staff", domain: "ubc.ca" });
    await allowDomain(pool, { community: "ubc-alumni", domain: "ubc.ca" });
    const allowlist = new DomainAllowlist(new PostgresDomainSource(pool));

    const found = await allowlist.memberships(parseEmail("ada@ubc.ca"));
    assert.deepEqual(
      found.map((m) => m.community),
      ["ubc-alumni", "ubc-staff"],
    );
  },
);

test(
  "a_domain_row_names_its_community_through_the_allowlist",
  { skip: databaseSkip },
  async (t) => {
    // The whole point of the table: the community decided by a row, read by the
    // same DomainAllowlist the sign-in flow uses.
    const pool = await migratedSchema(t);
    await allowDomain(pool, {
      community: "ubc-students",
      domain: "student.ubc.ca",
    });
    const allowlist = new DomainAllowlist(new PostgresDomainSource(pool));

    const ada = await allowlist.memberships(parseEmail("ada@student.ubc.ca"));
    assert.deepEqual(
      ada.map((m) => m.community),
      ["ubc-students"],
    );
    assert.deepEqual(
      await allowlist.memberships(parseEmail("ada@gmail.com")),
      [],
    );
  },
);

test(
  "allowed_domains_read_back_normalised_and_adding_one_twice_updates_it",
  { skip: databaseSkip },
  async (t) => {
    const pool = await migratedSchema(t);
    await allowDomain(pool, {
      community: "ubc-students",
      domain: "  Student.UBC.ca ",
    });
    await allowDomain(pool, {
      community: "ubc-staff",
      domain: "ubc.ca",
      includeSubdomains: true,
    });
    // The same row again, now widened to subdomains: an update, not a second row.
    await allowDomain(pool, {
      community: "ubc-students",
      domain: "student.ubc.ca",
      includeSubdomains: true,
    });

    assert.deepEqual(await new PostgresDomainSource(pool).rows(), [
      { community: "ubc-staff", domain: "ubc.ca", includeSubdomains: true },
      {
        community: "ubc-students",
        domain: "student.ubc.ca",
        includeSubdomains: true,
      },
    ]);
  },
);

test(
  "migration_002_makes_community_optional_and_nothing_else",
  { skip: databaseSkip },
  async (t) => {
    // ADR-0030. The conformance suites prove a null community round-trips;
    // this pins that the migration dropped exactly the two `not null`s it
    // names, so a later file loosening `email` or `community` on the
    // allowlist by accident is a red test rather than a quiet change.
    const { pool, schema } = await throwawaySchema(t);
    await migrate(pool);
    const { rows } = await pool.query<{
      table_name: string;
      column_name: string;
    }>(
      "select table_name, column_name from information_schema.columns" +
        " where table_schema = $1 and is_nullable = 'YES'" +
        " and table_name in ('voter', 'voter_credential', 'pending_claim', 'allowed_domain')" +
        " order by table_name, column_name",
      [schema],
    );
    assert.deepEqual(
      rows.map((row) => `${row.table_name}.${row.column_name}`),
      [
        "pending_claim.community",
        "pending_claim.used_at",
        "voter.community",
        "voter.sessions_valid_from",
      ],
    );
  },
);
