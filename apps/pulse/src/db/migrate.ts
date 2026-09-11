import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Type-only: this module never loads the driver, so it stays runnable in any
// context that already has a pool.
import type { Pool, PoolClient } from "pg";

/**
 * The migration runner: plain reviewed SQL files applied in order, no ORM and
 * no auto-migration (ADR-0020).
 *
 * Forward-only, which is two separate promises and the runner keeps both:
 *
 *   * **A file that has run is never edited.** A mistake is corrected by a new
 *     numbered file. The recorded checksum is what enforces this.
 *   * **A file never runs out of order.** A migration that sorts below the
 *     highest one already applied is refused. This is not a theoretical case:
 *     two branches that each add a migration merge cleanly, and whichever
 *     merges second lands a lower-numbered file that has never run. Applying
 *     it on top would leave `schema_migrations` recording a history that never
 *     happened, and the previous version of this comment claimed the property
 *     was enforced when only the first half of it was.
 *
 * Running it twice is a no-op, so it is safe on every boot, and several
 * processes may boot at once, so the whole run holds an advisory lock — taken
 * under a `lock_timeout`, because a process that dies holding it would
 * otherwise block every other boot forever with nothing printed.
 */
export interface Migration {
  /** The file's numeric prefix, as written: `"001"`. */
  version: string;
  name: string;
  sql: string;
  /** SHA-256 of `sql`, hex. */
  checksum: string;
}

export interface MigrateOptions {
  /** Defaults to `apps/pulse/migrations`. */
  dir?: string;
  /** Injected, like every other clock in pulse — never `default now()`. */
  clock?: () => Date;
  /**
   * How long to wait for the advisory lock before giving up, in milliseconds.
   *
   * Long enough that a slow but healthy migration on another process is waited
   * out, short enough that a lock nobody will ever release becomes an error
   * naming it rather than a boot that hangs in silence.
   */
  lockTimeoutMs?: number;
}

export interface MigrateResult {
  /** Versions applied by this run, in order. Empty on a second run. */
  applied: string[];
  /** Versions that were already recorded and were left alone. */
  alreadyApplied: string[];
}

/**
 * The one table the runner owns. Created outside the numbered files, because
 * it is what says which of them have run.
 */
export const SCHEMA_MIGRATIONS_DDL = `create table if not exists schema_migrations (
  version    text primary key,
  name       text not null,
  checksum   text not null,
  applied_at timestamptz(3) not null
)`;

/**
 * Arbitrary, constant, and pulse's alone: "puls" as an integer. Exported so a
 * test can hold the lock the runner will ask for, and so the number in the
 * error message has one definition.
 */
export const LOCK_KEY = 1886546803;

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/**
 * `<digits>_<name>.sql`. The name may carry `_` as well as `-`, because both
 * read fine and a runner that accepts one and rejects the other fails the
 * whole run over a filename — `loadMigrations` throws on any `.sql` it cannot
 * parse, so one mis-styled file stops every migration, including the ones that
 * were already fine.
 */
const FILENAME = /^(\d{3,})_([a-z0-9_-]+)\.sql$/;

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
  }
}

export async function migrate(
  pool: Pool,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const clock = options.clock ?? (() => new Date());
  const migrations = await loadMigrations(options.dir);
  const result: MigrateResult = { applied: [], alreadyApplied: [] };

  const client = await pool.connect();
  let locked = false;
  try {
    // Held for the whole run: two processes booting together must not both
    // decide the same file is pending.
    await lock(client, options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    locked = true;
    await client.query(SCHEMA_MIGRATIONS_DDL);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from schema_migrations",
    );
    const seen = new Map(rows.map((row) => [row.version, row.checksum]));
    refuseOutOfOrder(migrations, rows);

    for (const migration of migrations) {
      const applied = seen.get(migration.version);
      if (applied !== undefined) {
        if (applied !== migration.checksum) {
          throw new MigrationError(
            `${fileOf(migration)} has changed since it was applied — ` +
              "migrations are forward-only; correct it in a new file",
          );
        }
        result.alreadyApplied.push(migration.version);
        continue;
      }
      await apply(client, migration, clock());
      result.applied.push(migration.version);
    }
    return result;
  } finally {
    // Advisory locks are held by the session, and a pooled connection is
    // reused, so this has to be explicit. Failing to unlock a connection that
    // is already broken must not mask the error that broke it.
    if (locked) {
      await client
        .query(`select pg_advisory_unlock(${LOCK_KEY})`)
        .catch(() => undefined);
    }
    client.release();
  }
}

/**
 * Take the run's advisory lock, or say who is holding it.
 *
 * `lock_timeout` does apply to `pg_advisory_lock` — checked against a real
 * server, because the documentation's list of lockable things does not name
 * advisory locks outright. Without it a process that died holding the lock
 * blocks every subsequent boot forever, printing nothing at all: the most
 * expensive failure shape there is, because it looks like a hang rather than
 * an error. The timeout is reset before the migrations themselves run — it is
 * for waiting on this lock, not a budget for the DDL.
 */
async function lock(client: PoolClient, timeoutMs: number): Promise<void> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
    // Interpolated into SQL, so it is never free text.
    throw new MigrationError(`not a usable lock timeout: ${timeoutMs}`);
  }
  await client.query(`set lock_timeout = ${timeoutMs}`);
  try {
    await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
  } catch (cause) {
    throw new MigrationError(
      `waited ${timeoutMs}ms for pulse's migration advisory lock ` +
        `(${LOCK_KEY}) and did not get it — another process is migrating, or ` +
        "one died holding it; `select * from pg_locks where locktype = " +
        "'advisory'` names the session to end",
      { cause },
    );
  } finally {
    await client.query("reset lock_timeout").catch(() => undefined);
  }
}

/**
 * Refuse a pending migration that sorts below one already applied.
 *
 * The case is ordinary rather than exotic: two branches each add a migration,
 * they merge without conflicting, and whichever merges second contributes a
 * lower number that has never run. Applying it after the higher one would
 * leave `schema_migrations` describing an order that never happened, and every
 * environment would then disagree about what the schema is depending on when
 * each first booted.
 *
 * Checked for every pending file before any of them is applied, so a run that
 * is going to be refused changes nothing.
 */
function refuseOutOfOrder(
  migrations: readonly Migration[],
  rows: readonly { version: string }[],
): void {
  let highest: string | undefined;
  for (const row of rows) {
    if (highest === undefined || Number(row.version) > Number(highest)) {
      highest = row.version;
    }
  }
  if (highest === undefined) return;

  const applied = new Set(rows.map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    if (Number(migration.version) < Number(highest)) {
      throw new MigrationError(
        `${fileOf(migration)} has never run but sorts below ${highest}, ` +
          "which has — migrations are forward-only in file order too; " +
          "renumber it above the highest applied version",
      );
    }
  }
}

/** One file, one transaction: a failed migration leaves nothing behind. */
async function apply(
  client: PoolClient,
  migration: Migration,
  at: Date,
): Promise<void> {
  await client.query("begin");
  try {
    await client.query(migration.sql);
    await client.query(
      "insert into schema_migrations (version, name, checksum, applied_at)" +
        " values ($1, $2, $3, $4)",
      [migration.version, migration.name, migration.checksum, at],
    );
    await client.query("commit");
  } catch (cause) {
    // Same reason the unlock above is swallowed: a rollback that fails is
    // almost always a connection that has already gone, and letting it throw
    // would replace the error that actually explains the failure — carried
    // here as `cause` — with a meaningless one about the rollback.
    await client.query("rollback").catch(() => undefined);
    throw new MigrationError(
      `${fileOf(migration)} failed and was rolled back`,
      {
        cause,
      },
    );
  }
}

/** The migration files, oldest first. */
export async function loadMigrations(
  dir: string = migrationsDir(),
): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql"));
  const migrations: Migration[] = [];
  const versions = new Set<string>();

  for (const file of files) {
    const match = FILENAME.exec(file);
    const version = match?.[1];
    const name = match?.[2];
    if (version === undefined || name === undefined) {
      throw new MigrationError(
        `${file} is not a usable migration filename: it must be at least ` +
          "three digits, an underscore, then a name of lowercase letters, " +
          "digits, underscores and hyphens, then `.sql`",
      );
    }
    if (versions.has(version)) {
      throw new MigrationError(`two migrations claim version ${version}`);
    }
    versions.add(version);
    const sql = await readFile(path.join(dir, file), "utf8");
    migrations.push({
      version,
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }

  return migrations.sort((a, b) => Number(a.version) - Number(b.version));
}

/**
 * `apps/pulse/migrations`, found by walking up from this module — which sits
 * in `src/db` before the build and `dist/src/db` after it, so neither a fixed
 * relative path nor the process's working directory would do.
 */
export function migrationsDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 6; up += 1) {
    const candidate = path.join(dir, "migrations");
    if (existsSync(path.join(dir, "package.json")) && existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new MigrationError("no migrations directory above this module");
}

function fileOf(migration: Migration): string {
  return `${migration.version}_${migration.name}.sql`;
}
