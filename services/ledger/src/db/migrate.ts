import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { APP_ROLE } from "./config.js";

/**
 * The migration runner: plain reviewed SQL files in `services/ledger/migrations`,
 * applied in order, one transaction each, as the migration (owner) role. No ORM.
 *
 * Forward-only: an applied file whose checksum changed is refused, and so is a
 * pending file that sorts below one already applied. Running it twice is a
 * no-op. The whole run holds an advisory lock so concurrent boots do not race.
 */
export interface MigrateOptions {
  dir?: string;
  /** Sets the runtime role's password (LEDGER_APP_PASSWORD). Omitted: left as is. */
  appPassword?: string;
}

export interface Migration {
  version: string;
  file: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  override name = "MigrationError";
}

/** "lmig". Distinct from the append lock, and per database. */
export const MIGRATION_LOCK_KEY = 1818585447;

const FILENAME = /^(\d{3,})_[a-z0-9_-]+\.sql$/;

const DEFAULT_DIR = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
);

export async function loadMigrations(
  dir: string = DEFAULT_DIR,
): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const out: Migration[] = [];
  for (const file of files) {
    const version = FILENAME.exec(file)?.[1];
    if (version === undefined)
      throw new MigrationError(`unparseable migration file name: ${file}`);
    if (out.some((m) => m.version === version)) {
      throw new MigrationError(`two migrations share version ${version}`);
    }
    const sql = await readFile(`${dir}/${file}`, "utf8");
    out.push({
      version,
      file,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return out;
}

/** Applies pending migrations; returns the versions applied by this run. */
export async function migrate(
  pool: Pool,
  options: MigrateOptions = {},
): Promise<string[]> {
  const migrations = await loadMigrations(options.dir);
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY, checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const seen = new Map(rows.map((r) => [r.version, r.checksum]));
    const highest = rows.reduce(
      (max, r) => Math.max(max, Number(r.version)),
      0,
    );
    for (const m of migrations) {
      const sum = seen.get(m.version);
      if (sum !== undefined && sum !== m.checksum) {
        throw new MigrationError(
          `${m.file} changed after it was applied; add a new file instead`,
        );
      }
      if (sum === undefined && Number(m.version) < highest) {
        throw new MigrationError(
          `${m.file} has never run but sorts below applied ${highest}`,
        );
      }
    }
    const applied: string[] = [];
    for (const m of migrations) {
      if (seen.has(m.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [m.version, m.checksum],
        );
        await client.query("COMMIT");
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new MigrationError(`${m.file} failed and was rolled back`, {
          cause,
        });
      }
      applied.push(m.version);
    }
    if (options.appPassword !== undefined) {
      // A utility statement takes no bind parameters; escapeLiteral quotes it.
      await client.query(
        `ALTER ROLE ${APP_ROLE} LOGIN PASSWORD ${client.escapeLiteral(options.appPassword)}`,
      );
    }
    return applied;
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`)
      .catch(() => undefined);
    client.release();
  }
}
