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

/**
 * The known column defaults: `method_params` and `vote_choice.value`, and
 * nothing else. Adding to this list is how you declare a new one deliberately.
 */
const DEFAULTS = ["'{}'::jsonb", "1"];

test("the_only_column_defaults_are_the_two_constants_we_chose", () => {
  // ADR-0020: a clock is constructor-injected in five places and every HTTP
  // test runs on a frozen one. A database default bypasses all of it while
  // most tests keep passing, which is what makes it dangerous rather than
  // merely wrong. Every timestamp is supplied by the application.
  //
  // Stated as the SET of defaults rather than as a list of forbidden spellings.
  // The forbidden-spellings version matched `default now()` and `default
  // current_timestamp` and missed `default (now())` and `default
  // timezone('utc', now())` — unreachable from 001, entirely reachable from
  // the next migration anyone writes. A guard that has to enumerate every way
  // of saying `now` is a guard that will be got past.
  const found = [...schema.matchAll(/\bdefault\s+(.+?)\s*,?\s*$/gim)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    [...new Set(found)].sort(),
    [...DEFAULTS].sort(),
    "a migration gives a column a default that was not declared here — if it " +
      "is a database clock it must not land at all (ADR-0020), and if it is a " +
      "constant, add it to DEFAULTS deliberately",
  );
});

test("every_timestamp_column_keeps_milliseconds", () => {
  // The sub-second lockout bug in 35159dd came from two timestamps disagreeing
  // on precision. A bare `timestamptz` would round-trip a different value than
  // the Date the application handed over.
  assert.equal(
    /timestamptz(?!\(3\))/i.test(schema),
    false,
    "a timestamptz column does not keep milliseconds",
  );
  // And the long spelling, which the check above cannot see at all: `timestamp
  // with time zone` is the same type and `timestamp` alone is a different and
  // worse one. Neither is reachable from 001; both are one keystroke away in
  // 002. `current_timestamp` is not matched — the underscore is a word
  // character, so there is no boundary before `timestamp`.
  assert.equal(
    /\btimestamp\b/i.test(schema),
    false,
    "a column is declared `timestamp` or `timestamp with time zone` — write " +
      "`timestamptz(3)`, which is the only spelling the guard above can read",
  );
});

test("the_schema_carries_no_is_entry_point", () => {
  // ADR-0021 specifies the column; ADR-0023 is the operator's decision not to
  // ship it, and this is what stops a later reader finding the discrepancy and
  // helpfully "fixing" it. Re-adding it is a decision with a cost — a
  // migration and a backfill nobody can do accurately — not a tidy-up.
  assert.equal(/is_entry_point/i.test(schema), false);
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
