import assert from "node:assert/strict";
import { test } from "node:test";
import { appendRun, head } from "../../src/db/events.js";
import {
  ZERO_HASH,
  chain,
  eventRow,
  fakeHash,
  insertRaw,
  skip,
  withDb,
} from "./harness.js";

const BROKEN_CHAIN = { code: "23514" };

test("a_correct_chain_is_accepted", { skip }, () =>
  withDb(async ({ app }) => {
    const rows = chain(4);
    for (const row of rows) await insertRaw(app, row);
    assert.deepEqual(await head(app), { seq: 4, hash: rows[3]?.hash });
  }),
);

test("the_first_event_must_be_seq_1_with_a_zero_prev_hash", { skip }, () =>
  withDb(async ({ app }) => {
    await assert.rejects(insertRaw(app, eventRow(2, ZERO_HASH)), BROKEN_CHAIN);
    await assert.rejects(
      insertRaw(app, eventRow(1, fakeHash("not-genesis"))),
      BROKEN_CHAIN,
    );
    assert.equal(await head(app), null);
  }),
);

test("a_seq_gap_is_rejected", { skip }, () =>
  withDb(async ({ app }) => {
    const [first] = chain(1);
    await insertRaw(app, first!);
    await assert.rejects(
      insertRaw(app, eventRow(3, first!.hash)),
      BROKEN_CHAIN,
    );
  }),
);

test("a_duplicate_seq_is_rejected", { skip }, () =>
  withDb(async ({ app }) => {
    const rows = chain(2);
    for (const row of rows) await insertRaw(app, row);
    await assert.rejects(
      insertRaw(app, eventRow(2, rows[0]!.hash, { hash: fakeHash("dup") })),
      BROKEN_CHAIN,
    );
  }),
);

test("a_wrong_prev_hash_is_rejected", { skip }, () =>
  withDb(async ({ app }) => {
    const [first] = chain(1);
    await insertRaw(app, first!);
    await assert.rejects(
      insertRaw(app, eventRow(2, fakeHash("elsewhere"))),
      BROKEN_CHAIN,
    );
  }),
);

test("hash_shape_and_line_consistency_are_checked", { skip }, () =>
  withDb(async ({ app }) => {
    const upper = eventRow(1, ZERO_HASH, { hash: "A".repeat(64) });
    await assert.rejects(insertRaw(app, upper), BROKEN_CHAIN);
    const mismatched = { ...eventRow(1, ZERO_HASH), hash: fakeHash("other") };
    await assert.rejects(insertRaw(app, mismatched), BROKEN_CHAIN);
    const wrongSeq = {
      ...eventRow(1, ZERO_HASH),
      line: eventRow(7, ZERO_HASH).line,
    };
    await assert.rejects(insertRaw(app, wrongSeq), BROKEN_CHAIN);
    const twoLines = { ...eventRow(1, ZERO_HASH) };
    twoLines.line = twoLines.line.replace(`"payload":{`, `"payload":{\n`);
    await assert.rejects(insertRaw(app, twoLines), BROKEN_CHAIN);
  }),
);

test("a_run_with_one_bad_row_stores_none_of_it", { skip }, () =>
  withDb(async ({ app }) => {
    await assert.rejects(
      appendRun(app, () => [eventRow(1, ZERO_HASH), eventRow(3, ZERO_HASH)]),
      BROKEN_CHAIN,
    );
    assert.equal(await head(app), null);
  }),
);
