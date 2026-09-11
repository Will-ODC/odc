import assert from "node:assert/strict";
import { test } from "node:test";
import { SCHEMA_MIGRATIONS_DDL, loadMigrations } from "../src/db/migrate.js";

/**
 * Guards on the SQL itself. No database: these read the migration files and
 * are the only thing standing between the two rules the schema rests on and a
 * later reader tidying them back in.
 */
const migrations = await loadMigrations();
const schema = [...migrations.map((m) => m.sql), SCHEMA_MIGRATIONS_DDL]
  .map(code)
  .join("\n");

/** SQL with its comments removed, so a rule can be named without tripping it. */
function code(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

test("migrations_are_numbered_uniquely_and_load_oldest_first", () => {
  const versions = migrations.map((m) => m.version);
  assert.deepEqual(versions, [...new Set(versions)].sort());
  assert.equal(versions[0], "001");
});

test("no_column_takes_its_timestamp_from_the_database_clock", () => {
  // ADR-0020: a clock is constructor-injected in five places and every HTTP
  // test runs on a frozen one. A database default bypasses all of it while
  // most tests keep passing, which is what makes it dangerous rather than
  // merely wrong. Every timestamp is supplied by the application.
  const generated =
    /default\s+(now\s*\(|current_timestamp|localtimestamp|clock_timestamp|statement_timestamp|transaction_timestamp)/i;
  assert.equal(
    generated.test(schema),
    false,
    "a migration gives a column a database-generated timestamp default",
  );
});

test("every_timestamp_column_keeps_milliseconds", () => {
  // The sub-second lockout bug in 35159dd came from two timestamps disagreeing
  // on precision. A bare `timestamptz` would round-trip a different value than
  // the Date the application handed over.
  assert.equal(/timestamptz(?!\(3\))/i.test(schema), false);
});

test("the_poll_method_column_is_plain_text", () => {
  // ADR-0021's single most load-bearing line: an enum or a check constraint
  // would make adding a vote method a schema migration.
  assert.match(schema, /^\s*method\s+text\s+not null,\s*$/m);
  assert.equal(/create\s+type/i.test(schema), false);
  assert.equal(/check\s*\([^)]*method/i.test(schema), false);
});

test("method_params_is_there_before_anything_writes_it", () => {
  // Deliberately unused until the vote-method registry lands. It is in the
  // schema now so the first method with knobs is a code change, not a
  // migration — do not delete it as dead.
  assert.match(schema, /^\s*method_params\s+jsonb\s+not null/m);
});

test("a_choice_keeps_one_position_per_poll", () => {
  // `position` is display order only; a vote references `poll_choice.id`.
  assert.match(schema, /unique\s*\(poll_id,\s*position\)/i);
});
