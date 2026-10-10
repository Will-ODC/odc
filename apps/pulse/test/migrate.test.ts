import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Pool } from "pg";
import { databaseRequired, databaseUrl } from "../src/db/config.js";
import {
  LOCK_KEY,
  MigrationError,
  type Migration,
  loadMigrations,
  migrate,
} from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import {
  PostgresClaimStore,
  PostgresVoterStore,
} from "../src/identity/pg-store.js";
import { ClaimService, hashToken } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import { CredentialTakenError } from "../src/identity/store.js";

/**
 * The runner, against a real Postgres.
 *
 * Skipping is decided by `databaseUrl`/`databaseRequired` — the same pair
 * `database.test.ts` uses — so `pnpm test` works on a laptop with nothing
 * installed, while a job that says it provides a database fails loudly instead
 * of skipping and reporting success. The guard lives here, in the thing that
 * runs, and not in a workflow step: turbo strips undeclared variables, so a
 * shell that has one is no evidence the task did.
 *
 * Each test works in a throwaway schema and drops it afterwards, so pointing
 * this at a database that has other things in it changes nothing of theirs.
 */
const url = databaseUrl();
const required = databaseRequired();
const skip =
  url === undefined && !required ? "PULSE_DATABASE_URL is unset" : false;

/** Milliseconds on purpose: a stored `timestamptz` would drop the .123. */
const AT = new Date("2026-09-11T09:30:00.123Z");

const TABLES = [
  "allowed_domain",
  "pending_claim",
  "poll_choice",
  "polls",
  "schema_migrations",
  "suggestion",
  "vote",
  "vote_choice",
  "voter",
  "voter_credential",
];

test("an_empty_database_url_is_unset_rather_than_a_connection_string", () => {
  // The bug this fixes: an empty PULSE_DATABASE_URL ran the database tests and
  // then failed claiming PULSE_REQUIRE_DATABASE was set when it was not.
  assert.equal(databaseUrl({ PULSE_DATABASE_URL: "" }), undefined);
  assert.equal(databaseUrl({ PULSE_DATABASE_URL: "   " }), undefined);
  assert.equal(databaseUrl({}), undefined);
  assert.equal(
    databaseUrl({ PULSE_DATABASE_URL: " postgres://pulse@localhost/pulse " }),
    "postgres://pulse@localhost/pulse",
  );
});

test("only_the_string_1_makes_a_database_required", () => {
  // `CI=false` is a real convention; "any non-empty value" would read it as
  // "on CI" and turn a skip into a failure saying the opposite.
  assert.equal(databaseRequired({ PULSE_REQUIRE_DATABASE: "1" }), true);
  assert.equal(databaseRequired({ PULSE_REQUIRE_DATABASE: "false" }), false);
  assert.equal(databaseRequired({ PULSE_REQUIRE_DATABASE: "true" }), false);
  assert.equal(databaseRequired({}), false);
});

test("applies_a_fresh_schema", { skip }, async () => {
  await inThrowawaySchema(async (pool, schema) => {
    const result = await migrate(pool, { clock: () => AT });
    assert.deepEqual(result.applied, ["001", "002", "003", "004"]);
    assert.deepEqual(await tablesIn(pool, schema), TABLES);
  });
});

test("applying_twice_changes_nothing", { skip }, async () => {
  await inThrowawaySchema(async (pool, schema) => {
    const first = await migrate(pool, { clock: () => AT });
    const again = await migrate(pool, { clock: () => new Date() });

    assert.deepEqual(again.applied, []);
    assert.deepEqual(again.alreadyApplied, first.applied);
    assert.deepEqual(await tablesIn(pool, schema), TABLES);
    const { rows } = await pool.query<{ version: string; applied_at: Date }>(
      "select version, applied_at from schema_migrations",
    );
    assert.equal(rows.length, 4);
    // Still the first run's timestamp, and still the injected clock's — to the
    // millisecond, which is what timestamptz(3) is for.
    assert.equal(rows[0]?.applied_at.getTime(), AT.getTime());
  });
});

test(
  "upgrading_existing_voters_initializes_session_generation",
  { skip },
  async () => {
    await inTempDir(async (dir) => {
      const migrations = await loadMigrations();
      await writeMigrations(dir, migrations, (v) => v < "003");
      await inThrowawaySchema(async (pool) => {
        assert.deepEqual(
          (await migrate(pool, { dir, clock: () => AT })).applied,
          ["001", "002"],
        );
        await pool.query(
          "insert into voter (id, email, community, claimed_at, proof_emails_opt_in) values ($1, $2, $3, $4, $5)",
          ["voter-1", "ada@student.ubc.ca", "ubc-students", AT, false],
        );
        // 003 and everything after it: the store reads today's schema.
        await writeMigrations(dir, migrations, (v) => v >= "003");
        assert.deepEqual(
          (await migrate(pool, { dir, clock: () => AT })).applied,
          migrations.map((m) => m.version).filter((v) => v >= "003"),
        );
        const store = new PostgresVoterStore(pool);
        assert.equal((await store.byId("voter-1"))?.sessionGeneration ?? 0, 0);
        assert.equal(
          (await store.advanceSessionGeneration("voter-1"))?.sessionGeneration,
          1,
        );
      });
    });
  },
);

test(
  "upgrading_existing_voters_and_claims_moves_each_address_to_a_credential",
  { skip },
  async () => {
    // 004 (ADR-0032): every voter that existed keeps signing in as themselves,
    // because their address becomes their `email` credential, proved when
    // they first claimed it; and a link sent before the upgrade still counts
    // against its address and still redeems.
    await inTempDir(async (dir) => {
      const migrations = await loadMigrations();
      await writeMigrations(dir, migrations, (v) => v < "004");
      await inThrowawaySchema(async (pool) => {
        assert.deepEqual(
          (await migrate(pool, { dir, clock: () => AT })).applied,
          ["001", "002", "003"],
        );
        const later = new Date(AT.getTime() + 60_000);
        await pool.query(
          "insert into voter (id, email, community, claimed_at," +
            " proof_emails_opt_in, session_generation)" +
            " values ($1, $2, $3, $4, $5, 2), ($6, $7, null, $8, true, 0)",
          [
            "voter-1",
            "ada@student.ubc.ca",
            "ubc-students",
            AT,
            false,
            "voter-2",
            "jo@gmail.com",
            later,
          ],
        );
        await pool.query(
          "insert into pending_claim (token_hash, email, community," +
            " proof_emails_opt_in, created_at, expires_at)" +
            " values ($1, 'sam@student.ubc.ca', 'ubc-students', true, $2, $3)," +
            " ($4, 'ada@student.ubc.ca', 'ubc-students', false, $2, $3)",
          [
            hashToken("before-upgrade-new"),
            AT,
            new Date(AT.getTime() + 15 * 60_000),
            hashToken("before-upgrade-existing"),
          ],
        );

        await writeMigrations(dir, migrations, (v) => v >= "004");
        assert.deepEqual(
          (await migrate(pool, { dir, clock: () => AT })).applied,
          migrations.map((m) => m.version).filter((v) => v >= "004"),
        );

        const voters = new PostgresVoterStore(pool);
        assert.deepEqual(
          await voters.byCredential("email", "ada@student.ubc.ca"),
          {
            id: "voter-1",
            email: "ada@student.ubc.ca",
            community: "ubc-students",
            assurance: "email",
            claimedAt: AT,
            proofEmailsOptIn: false,
            sessionGeneration: 2,
          },
        );
        assert.deepEqual(await voters.byCredential("email", "jo@gmail.com"), {
          id: "voter-2",
          email: "jo@gmail.com",
          community: null,
          assurance: "email",
          claimedAt: later,
          proofEmailsOptIn: true,
        });
        // Proved at the moment they first claimed it, to the millisecond.
        const { rows } = await pool.query<{
          kind: string;
          value: string;
          voter_id: string;
          params: unknown;
          verified_at: Date;
        }>(
          "select kind, value, voter_id, params, verified_at" +
            " from voter_credential order by voter_id",
        );
        assert.deepEqual(rows, [
          {
            kind: "email",
            value: "ada@student.ubc.ca",
            voter_id: "voter-1",
            params: {},
            verified_at: AT,
          },
          {
            kind: "email",
            value: "jo@gmail.com",
            voter_id: "voter-2",
            params: {},
            verified_at: later,
          },
        ]);

        // One address is still one voter: the uniqueness moved with it.
        await assert.rejects(
          () =>
            voters.create(
              {
                id: "voter-3",
                community: null,
                assurance: "email",
                claimedAt: later,
                proofEmailsOptIn: false,
              },
              { kind: "email", value: "jo@gmail.com", verifiedAt: later },
            ),
          CredentialTakenError,
        );

        const claims = new PostgresClaimStore(pool);
        assert.deepEqual(
          (await claims.liveFor("email", "sam@student.ubc.ca", AT)).map((c) => [
            c.tokenHash,
            c.kind,
            c.subject,
            c.proofEmailsOptIn,
          ]),
          [
            [
              hashToken("before-upgrade-new"),
              "email",
              "sam@student.ubc.ca",
              true,
            ],
          ],
        );
        const service = new ClaimService(
          {
            membership: { check: async () => undefined },
            voters,
            claims,
            mailer: new ConsoleMailer(() => {}),
            linkFor: (token) => token,
          },
          { clock: () => AT },
        );
        const existing = await service.redeem("before-upgrade-existing");
        assert.equal(existing.status, "signed_in");
        if (existing.status !== "signed_in")
          assert.fail("old link must sign in");
        assert.equal(existing.firstTime, false);
        assert.equal(existing.voter.id, "voter-1");
        assert.equal(existing.voter.sessionGeneration, 2);
        assert.equal(existing.voter.proofEmailsOptIn, false);
        const created = await service.redeem("before-upgrade-new");
        assert.equal(created.status, "signed_in");
        if (created.status !== "signed_in")
          assert.fail("old link must sign up");
        assert.equal(created.firstTime, true);
        assert.equal(created.voter.email, "sam@student.ubc.ca");
        assert.equal(created.voter.assurance, "email");
        assert.equal(created.voter.proofEmailsOptIn, true);
        for (const token of ["before-upgrade-existing", "before-upgrade-new"]) {
          assert.deepEqual(await service.redeem(token), {
            status: "already_used",
          });
        }
      });
    });
  },
);

/** Copy the migrations whose version `keep` accepts into `dir`. */
async function writeMigrations(
  dir: string,
  migrations: readonly Migration[],
  keep: (version: string) => boolean,
): Promise<void> {
  for (const migration of migrations.filter((m) => keep(m.version))) {
    await writeFile(
      path.join(dir, `${migration.version}_${migration.name}.sql`),
      migration.sql,
    );
  }
}

test("refuses_a_migration_that_changed_after_it_ran", { skip }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pulse-migrations-"));
  const file = path.join(dir, "001_probe.sql");
  try {
    await inThrowawaySchema(async (pool) => {
      await writeFile(file, "create table probe (id text primary key);");
      await migrate(pool, { dir, clock: () => AT });
      await writeFile(file, "create table probe (id text, extra text);");
      // Forward-only: a correction is a new file, never an edit to one that
      // has run somewhere.
      await assert.rejects(
        migrate(pool, { dir, clock: () => AT }),
        MigrationError,
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a_migration_name_may_use_underscores_as_well_as_hyphens", async () => {
  // Both spellings read fine and neither is wrong, so the runner accepting one
  // and rejecting the other is a trap: `loadMigrations` throws on any .sql it
  // cannot parse, so one mis-styled file stops every migration on the boot.
  await inTempDir(async (dir) => {
    await writeFile(path.join(dir, "001_add-vote-indexes.sql"), "select 1;");
    await writeFile(path.join(dir, "002_add_vote_indexes.sql"), "select 1;");
    const loaded = await loadMigrations(dir);
    assert.deepEqual(
      loaded.map((m) => m.name),
      ["add-vote-indexes", "add_vote_indexes"],
    );
  });
});

test("a_filename_it_cannot_parse_says_which_characters_are_allowed", async () => {
  // The old message was "a migration file is named <number>_<name>.sql",
  // printed for a file that IS named that way — it described the shape the
  // author had already followed and never mentioned the character set, which
  // is the only thing they got wrong.
  await inTempDir(async (dir) => {
    await writeFile(path.join(dir, "002_Add Vote Indexes.sql"), "select 1;");
    await assert.rejects(loadMigrations(dir), (error: unknown) => {
      assert.ok(error instanceof MigrationError);
      assert.match(error.message, /002_Add Vote Indexes\.sql/);
      assert.match(
        error.message,
        /lowercase letters, digits, underscores and hyphens/,
      );
      return true;
    });
  });
});

test("a_failed_rollback_does_not_swallow_the_error_that_caused_it", async () => {
  // No database: the point is a connection that has already gone away, where
  // `rollback` throws too. Letting that throw replaces the error that explains
  // the failure with a meaningless one about the rollback — the same masking
  // the advisory unlock already avoids.
  await inTempDir(async (dir) => {
    await writeFile(path.join(dir, "001_probe.sql"), "create table probe ();");
    const boom = new Error('syntax error at or near ")"');
    const client = {
      async query(sql: string): Promise<{ rows: never[] }> {
        if (sql.includes("create table probe")) throw boom;
        if (sql === "rollback") throw new Error("Connection terminated");
        return { rows: [] };
      },
      release(): void {},
    };
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;

    await assert.rejects(
      migrate(pool, { dir, clock: () => AT }),
      (error: unknown) => {
        assert.ok(error instanceof MigrationError);
        assert.equal(error.cause, boom);
        return true;
      },
    );
  });
});

test(
  "refuses_a_migration_that_numbers_below_one_already_applied",
  { skip },
  async () => {
    // Two branches each add a migration, they merge without conflicting, and
    // whichever merges second lands a lower number that has never run. Before
    // this guard it simply ran, after the higher one, and schema_migrations
    // was left recording an order that never happened.
    await inTempDir(async (dir) => {
      await inThrowawaySchema(async (pool, schema) => {
        await writeFile(path.join(dir, "001_first.sql"), "create table a ();");
        await writeFile(path.join(dir, "003_third.sql"), "create table c ();");
        const first = await migrate(pool, { dir, clock: () => AT });
        assert.deepEqual(first.applied, ["001", "003"]);

        await writeFile(path.join(dir, "002_second.sql"), "create table b ();");
        await assert.rejects(
          migrate(pool, { dir, clock: () => AT }),
          (error: unknown) => {
            assert.ok(error instanceof MigrationError);
            // Names the offending file, and the version it sorts below.
            assert.match(error.message, /002_second\.sql/);
            assert.match(error.message, /003/);
            return true;
          },
        );

        // And it refused before writing anything, so a run that is going to be
        // rejected leaves the database exactly as it was.
        assert.deepEqual(await tablesIn(pool, schema), [
          "a",
          "c",
          "schema_migrations",
        ]);
        const { rows } = await pool.query<{ version: string }>(
          "select version from schema_migrations order by version",
        );
        assert.deepEqual(
          rows.map((row) => row.version),
          ["001", "003"],
        );
      });
    });
  },
);

test(
  "gives_up_on_a_lock_it_cannot_get_and_names_it",
  // A real timeout on the test itself: without `lock_timeout` the runner waits
  // on the advisory lock forever, and a hung suite is a worse signal than a
  // failing one.
  { skip, timeout: 30_000 },
  async () => {
    await inThrowawaySchema(async (pool) => {
      // Stands in for a process that died holding the lock. Before the
      // timeout, every subsequent boot blocked here in silence.
      const holder = await pool.connect();
      try {
        await holder.query(`select pg_advisory_lock(${LOCK_KEY})`);
        await assert.rejects(
          migrate(pool, { clock: () => AT, lockTimeoutMs: 250 }),
          (error: unknown) => {
            assert.ok(error instanceof MigrationError);
            assert.match(error.message, new RegExp(String(LOCK_KEY)));
            assert.match(error.message, /pg_locks/);
            return true;
          },
        );
      } finally {
        await holder.query(`select pg_advisory_unlock(${LOCK_KEY})`);
        holder.release();
      }
    });
  },
);

test(
  "indexes_the_two_queries_that_would_otherwise_scan",
  { skip },
  async () => {
    // suggestion.poll_id serves SuggestionStore.list(pollId); vote_choice
    // .choice_id serves the tally's GROUP BY, which the primary key cannot,
    // since vote_id leads it. Both also serve an `on delete cascade`. Asserted
    // as the whole set rather than as two `assert.ok`s, so an index quietly
    // dropped in a later migration shows up here.
    await inThrowawaySchema(async (pool, schema) => {
      await migrate(pool, { clock: () => AT });
      assert.deepEqual(await indexesIn(pool, schema), [
        "allowed_domain_pkey",
        "pending_claim_kind_subject_idx",
        "pending_claim_pkey",
        "poll_choice_pkey",
        "poll_choice_poll_id_position_key",
        "polls_pkey",
        "schema_migrations_pkey",
        "suggestion_pkey",
        "suggestion_poll_id_idx",
        "vote_choice_choice_id_idx",
        "vote_choice_pkey",
        "vote_pkey",
        "vote_poll_id_voter_id_key",
        "voter_credential_pkey",
        "voter_credential_voter_id_idx",
        "voter_pkey",
      ]);
    });
  },
);

async function inTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "pulse-migrations-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function inThrowawaySchema(
  run: (pool: Pool, schema: string) => Promise<void>,
): Promise<void> {
  const connectionString = url ?? "";
  assert.ok(
    connectionString,
    "PULSE_REQUIRE_DATABASE is set but PULSE_DATABASE_URL is not — the job " +
      "must provide a database, and turbo.json must declare both variables " +
      "or the task never receives them",
  );

  const schema = `pulse_test_${randomUUID().replace(/-/g, "")}`;
  const admin = createPool({ connectionString });
  const pool = createPool({ connectionString, schema });
  try {
    await admin.query(`create schema ${schema}`);
    await run(pool, schema);
  } finally {
    await pool.end();
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  }
}

async function indexesIn(pool: Pool, schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ indexname: string }>(
    "select indexname from pg_indexes where schemaname = $1" +
      " order by indexname",
    [schema],
  );
  return rows.map((row) => row.indexname);
}

async function tablesIn(pool: Pool, schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables" +
      " where table_schema = $1 order by table_name",
    [schema],
  );
  return rows.map((row) => row.table_name);
}
