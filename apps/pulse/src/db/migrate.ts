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
 * Forward-only. There are no down migrations: a mistake is corrected by a new
 * numbered file, never by editing one that has been applied — which is what
 * the recorded checksum enforces. Running it twice is a no-op, so it is safe
 * on every boot, and several processes may boot at once, so the whole run
 * holds an advisory lock.
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

/** Arbitrary, constant, and pulse's alone: "puls" as an integer. */
const LOCK_KEY = 1886546803;

const FILENAME = /^(\d{3,})_([a-z0-9-]+)\.sql$/;

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
  try {
    // Held for the whole run: two processes booting together must not both
    // decide the same file is pending.
    await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
    await client.query(SCHEMA_MIGRATIONS_DDL);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "select version, checksum from schema_migrations",
    );
    const seen = new Map(rows.map((row) => [row.version, row.checksum]));

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
    await client
      .query(`select pg_advisory_unlock(${LOCK_KEY})`)
      .catch(() => undefined);
    client.release();
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
    await client.query("rollback");
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
        `a migration file is named <number>_<name>.sql: ${file}`,
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
