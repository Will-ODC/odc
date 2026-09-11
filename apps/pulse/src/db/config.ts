/**
 * How pulse is told where its database is.
 *
 * Both variables are pulse-owned and nothing is inferred from the ambient
 * environment (ADR-0020). A bare `DATABASE_URL` is among the most widely
 * exported variables there is, so reading it would aim pulse — and the tests
 * that run migrations — at whatever unrelated database a developer already has
 * configured. And whether a missing database is fatal is stated outright
 * rather than guessed from `CI`, which developers carry in their shells for
 * other reasons and which is sometimes set to the string "false".
 */
type Env = Record<string, string | undefined>;

/**
 * The configured connection string, or `undefined` when there is none.
 *
 * An empty or whitespace-only value is **unset**, not a connection string.
 * `PULSE_DATABASE_URL=` in a shell, a blank CI secret and an unset variable
 * all mean the same thing to a person, and treating the empty string as
 * configured sends the caller on to fail somewhere far less obvious.
 */
export function databaseUrl(env: Env = process.env): string | undefined {
  const raw = env["PULSE_DATABASE_URL"]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

/**
 * Whether a missing database is a failure rather than a reason to skip.
 *
 * Exactly `"1"`, never "any non-empty value": `PULSE_REQUIRE_DATABASE=false`
 * must not mean "required". That is the trap `CI` fell into.
 */
export function databaseRequired(env: Env = process.env): boolean {
  return env["PULSE_REQUIRE_DATABASE"] === "1";
}
