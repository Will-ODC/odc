import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainAllowlist } from "../src/identity/allowlist.js";
import { parseEmail } from "../src/identity/email.js";
import {
  PostgresClaimStore,
  PostgresDomainSource,
  PostgresVoterStore,
  allowDomain,
} from "../src/identity/pg-store.js";
import type { Pool, PoolClient } from "pg";
import { claimStoreConformance } from "./conformance/claim-store.js";
import { voterStoreConformance } from "./conformance/voter-store.js";
import { databaseSkip, migratedSchema } from "./support/database.js";

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
      email: "ada@student.ubc.ca",
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
    await store.create({
      id: "voter-1",
      email: "ada@student.ubc.ca",
      community: "ubc-students",
      claimedAt: AT,
      proofEmailsOptIn: false,
      sessionsValidFrom: signedOut,
    });
    assert.equal(
      (await store.byId("voter-1"))?.sessionsValidFrom?.getTime(),
      signedOut.getTime(),
    );
  },
);

test(
  "a_domain_row_typed_by_hand_in_mixed_case_still_admits_its_members",
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
    const ada = await allowlist.check(parseEmail("ada@student.ubc.ca"));
    assert.equal(ada?.community, "ubc-students");
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
  "a_domain_row_admits_its_members_through_the_allowlist",
  { skip: databaseSkip },
  async (t) => {
    // The whole point of the table: membership decided by a row, read by the
    // same DomainAllowlist the sign-in flow uses.
    const pool = await migratedSchema(t);
    await allowDomain(pool, {
      community: "ubc-students",
      domain: "student.ubc.ca",
    });
    const allowlist = new DomainAllowlist(new PostgresDomainSource(pool));

    const ada = await allowlist.check(parseEmail("ada@student.ubc.ca"));
    assert.equal(ada?.community, "ubc-students");
    assert.equal(await allowlist.check(parseEmail("ada@gmail.com")), undefined);
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
