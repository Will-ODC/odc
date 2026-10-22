import assert from "node:assert/strict";
import { test } from "node:test";
import pg, { type Pool } from "pg";
import {
  appendEvent,
  appendRun,
  exportLines,
  head,
  readSince,
} from "../../src/db/events.js";
import { chain, nextRow, skip, withDb } from "./harness.js";

async function collect(pool: Pool, batchSize?: number): Promise<string> {
  let out = "";
  for await (const chunk of exportLines(pool, batchSize)) out += chunk;
  return out;
}

test("an_empty_log_has_no_head_no_events_and_an_empty_export", { skip }, () =>
  withDb(async ({ app }) => {
    assert.equal(await head(app), null);
    assert.deepEqual(await readSince(app, 0, 10), []);
    assert.equal(await collect(app), "");
  }),
);

test("append_returns_the_stored_row_and_moves_the_head", { skip }, () =>
  withDb(async ({ app }) => {
    const first = await appendEvent(app, nextRow);
    assert.deepEqual(first, nextRow(null));
    const second = await appendEvent(app, nextRow);
    assert.equal(second.prevHash, first.hash);
    assert.deepEqual(await head(app), { seq: 2, hash: second.hash });
  }),
);

test("read_since_is_exclusive_ascending_and_bounded_by_limit", { skip }, () =>
  withDb(async ({ app }) => {
    const rows = chain(5);
    await appendRun(app, () => rows);
    assert.deepEqual(await readSince(app, 0, 10), rows);
    assert.deepEqual(
      (await readSince(app, 2, 2)).map((r) => r.seq),
      [3, 4],
    );
    assert.deepEqual(await readSince(app, 5, 10), []);
    assert.deepEqual(await readSince(app, 99, 10), []);
    await assert.rejects(readSince(app, -1, 10), RangeError);
    await assert.rejects(readSince(app, 0, 0), RangeError);
  }),
);

test("export_is_every_line_plus_lf_in_seq_order_across_batches", { skip }, () =>
  withDb(async ({ app }) => {
    const rows = chain(5);
    await appendRun(app, () => rows);
    const expected = rows.map((r) => `${r.line}\n`).join("");
    assert.equal(await collect(app, 2), expected);
    assert.equal(await collect(app, 5), expected);
    assert.equal(await collect(app), expected);
  }),
);

test(
  "export_reads_one_snapshot_and_ignores_appends_made_during_it",
  { skip },
  () =>
    withDb(async ({ app }) => {
      const rows = chain(4);
      await appendRun(app, () => rows);
      let out = "";
      let appended = false;
      for await (const chunk of exportLines(app, 1)) {
        out += chunk;
        if (!appended) {
          await appendEvent(app, nextRow);
          appended = true;
        }
      }
      assert.equal(out, rows.map((r) => `${r.line}\n`).join(""));
      assert.equal((await head(app))?.seq, 5);
    }),
);

test(
  "breaking_out_of_an_export_releases_its_connection",
  { skip, timeout: 10_000 },
  () =>
    withDb(async ({ app }) => {
      await appendRun(app, () => chain(3));
      // One connection: if the cursor's client leaked, the read below would hang.
      const single = new pg.Pool({ ...app.options, max: 1 });
      try {
        for await (const chunk of exportLines(single, 1)) {
          assert.ok(chunk.startsWith('{"seq":1,'));
          break;
        }
        assert.equal((await readSince(single, 0, 10)).length, 3);
      } finally {
        await single.end();
      }
    }),
);
