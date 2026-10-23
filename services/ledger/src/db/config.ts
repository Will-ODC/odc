/**
 * Ledger-owned environment names. Never a bare DATABASE_URL: that one is
 * exported for unrelated databases everywhere, and these tests run migrations.
 *
 * - LEDGER_DATABASE_URL: the migration (owner) role's connection. Tests also
 *   use it to create and drop throwaway databases, so there it needs CREATEDB
 *   and CREATEROLE (the compose superuser has both).
 * - LEDGER_REQUIRE_DATABASE: exactly "1" means a missing database is a test
 *   failure, not a reason to skip. Set on CI and nowhere else.
 * - LEDGER_APP_PASSWORD: the password the migration runner gives the runtime
 *   role `ledger_app`.
 */
type Env = Readonly<Record<string, string | undefined>>;

/** A blank value is unset: `LEDGER_DATABASE_URL=` must not run the DB tests. */
export function databaseUrl(env: Env = process.env): string | undefined {
  const raw = env["LEDGER_DATABASE_URL"]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

/** Exactly "1": `LEDGER_REQUIRE_DATABASE=false` must not mean required. */
export function databaseRequired(env: Env = process.env): boolean {
  return env["LEDGER_REQUIRE_DATABASE"] === "1";
}

/** The runtime role the migrations create. */
export const APP_ROLE = "ledger_app";
