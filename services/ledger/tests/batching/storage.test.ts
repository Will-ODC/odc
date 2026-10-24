import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { countOf, skip, withDb } from "../db/harness.js";

/** Each table, with an UPDATE that would change nothing if it ran. */
const TABLES = {
  batch_seal_intents: "last = last",
  batch_seal_results: "counts = counts",
  batch_seal_refusals: "code = code",
  batch_sign_requests: "ts = ts",
  batch_completions: "appended = appended",
  batch_issue_closes: "issue_id = issue_id",
} as const;

const ISSUE = "a".repeat(64);
const SEAL = "b".repeat(32);
const REFUSED = "e".repeat(32);

async function seed(pool: Pool): Promise<void> {
  await pool.query(
    "INSERT INTO batch_seal_intents (seal_id, issue_id, last, instant_ms) VALUES ($1, $2, true, 60000)",
    [SEAL, ISSUE],
  );
  await pool.query(
    "INSERT INTO batch_seal_results (seal_id, batch_id, counts) VALUES ($1, 'b1', '{1,2}')",
    [SEAL],
  );
  // A seal has one outcome, so the refusal belongs to a second seal.
  await pool.query(
    "INSERT INTO batch_seal_intents (seal_id, issue_id, last, instant_ms) VALUES ($1, $2, false, 120000)",
    [REFUSED, ISSUE],
  );
  await pool.query(
    "INSERT INTO batch_seal_refusals (seal_id, code) VALUES ($1, 'under_min')",
    [REFUSED],
  );
  await pool.query(
    `INSERT INTO batch_sign_requests (batch_id, issue_id, first_seq, ts, first_prev_hash, choices)
     VALUES ('b1', $1, 3, '1970-01-01T00:01:00.000Z', $1, '{1,0,1}')`,
    [ISSUE],
  );
  await pool.query(
    "INSERT INTO batch_completions (batch_id, appended) VALUES ('b1', true)",
  );
  await pool.query("INSERT INTO batch_issue_closes (issue_id) VALUES ($1)", [
    ISSUE,
  ]);
}

function changes(t: keyof typeof TABLES): string[] {
  return [
    `UPDATE ${t} SET ${TABLES[t]}`,
    `DELETE FROM ${t}`,
    `TRUNCATE ${t} CASCADE`,
  ];
}

test(
  "batching_tables_refuse_update_delete_and_truncate_for_the_runtime_role_and_the_owner",
  { skip },
  () =>
    withDb(async ({ owner, app }) => {
      await seed(app);
      for (const t of Object.keys(TABLES) as (keyof typeof TABLES)[]) {
        const count = `SELECT count(*) FROM ${t}`;
        const before = await countOf(owner, count);
        assert.ok(before > 0, t);
        for (const sql of changes(t)) {
          await assert.rejects(
            app.query(sql),
            { code: "42501" },
            `app: ${sql}`,
          );
          await assert.rejects(
            owner.query(sql),
            { code: "23001", message: /insert-only/ },
            `owner: ${sql}`,
          );
        }
        assert.equal(await countOf(owner, count), before, t);
      }
    }),
);

test(
  "the_runtime_role_holds_select_and_insert_only_on_batching_tables",
  { skip },
  () =>
    withDb(async ({ owner }) => {
      for (const t of Object.keys(TABLES) as (keyof typeof TABLES)[]) {
        const { rows } = await owner.query<{ p: string; ok: boolean }>(
          `SELECT p, has_table_privilege('ledger_app', $1, p) AS ok
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`,
          [t],
        );
        assert.deepEqual(
          rows.filter((r) => r.ok).map((r) => r.p),
          ["SELECT", "INSERT"],
          t,
        );
      }
    }),
);

test(
  "no_two_seals_of_one_issue_share_an_instant_and_an_issue_has_one_last_seal",
  { skip },
  () =>
    withDb(async ({ app }) => {
      await seed(app);
      const insert = (seal: string, last: boolean, ms: number) =>
        app.query(
          "INSERT INTO batch_seal_intents (seal_id, issue_id, last, instant_ms) VALUES ($1, $2, $3, $4)",
          [seal, ISSUE, last, ms],
        );
      await assert.rejects(insert("c".repeat(32), false, 60000), {
        code: "23505",
      });
      await assert.rejects(insert("d".repeat(32), true, 180000), {
        code: "23505",
      });
    }),
);

test("a_seal_has_a_result_or_a_refusal_never_both", { skip }, () =>
  withDb(async ({ app }) => {
    await seed(app);
    for (const [sql, seal] of [
      ["INSERT INTO batch_seal_refusals VALUES ($1, 'x')", SEAL],
      ["INSERT INTO batch_seal_results VALUES ($1, 'b2', '{0,0}')", REFUSED],
    ]) {
      await assert.rejects(app.query(sql as string, [seal]), {
        code: "23505",
        message: /already has an outcome/,
      });
    }
  }),
);
