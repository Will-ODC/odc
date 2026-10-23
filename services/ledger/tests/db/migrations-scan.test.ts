import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMigrations } from "../../src/db/migrate.js";

/**
 * The owner role can switch off rule 4's guards, so no migration may contain a
 * statement that changes rows or weakens a guard. `ALTER TABLE events ADD` is
 * the one additive change allowed (odc-storage). Errs on the side of refusing.
 */
const FORBIDDEN: RegExp[] = [
  /\bUPDATE\s+(ONLY\s+)?\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\s+(?!ON\b)\w/i,
  /\b(DISABLE|ENABLE)\s+(ALWAYS\s+|REPLICA\s+)?TRIGGER\b/i,
  /\bDROP\s+(TRIGGER|FUNCTION|TABLE|RULE|POLICY)\b/i,
  /\bCREATE\s+OR\s+REPLACE\b/i,
  /\bCREATE\s+RULE\b/i,
  /\bsession_replication_role\b/i,
  /\bGRANT\b[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b/i,
  /\bALTER\s+(FUNCTION|TRIGGER)\b/i,
  /\bALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(ONLY\s+)?events\b(?!\s+ADD\b)/i,
  /\bALTER\s+TABLE\b[^;]*\bevents\b[^;]*,\s*(DROP|ALTER|DISABLE|RENAME)\b/i,
];

/** The FORBIDDEN patterns found in `sql`, comments stripped, any case. */
function forbiddenIn(sql: string): string[] {
  const text = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
}

test("no_migration_changes_rows_or_weakens_the_events_guards", async () => {
  const migrations = await loadMigrations();
  assert.ok(migrations.length > 0);
  for (const m of migrations) assert.deepEqual(forbiddenIn(m.sql), [], m.file);
});

test("the_scan_catches_each_way_around_the_guards", () => {
  for (const sql of [
    "UPDATE events SET type = 'x';",
    "delete from events;",
    "TRUNCATE events;",
    "CREATE OR REPLACE FUNCTION events_check_link() ...",
    "ALTER TABLE events DISABLE TRIGGER events_link;",
    "DROP TRIGGER events_link ON events;",
    "SET session_replication_role = replica;",
    "GRANT UPDATE ON events TO ledger_app;",
    "ALTER TABLE events RENAME TO old_events;",
    "ALTER TABLE events ADD COLUMN x int, DROP CONSTRAINT events_line_tail;",
  ]) {
    assert.notDeepEqual(forbiddenIn(sql), [], sql);
  }
  assert.deepEqual(forbiddenIn("ALTER TABLE events ADD COLUMN x int;"), []);
  assert.deepEqual(forbiddenIn("-- DELETE FROM events\nSELECT 1;"), []);
});
