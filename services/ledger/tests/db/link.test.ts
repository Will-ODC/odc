import assert from "node:assert/strict";
import { appendRun, head, type EventRow } from "../../src/db/events.js";
import {
  ZERO_HASH,
  chain,
  eventRow,
  fakeHash,
  insertRaw,
  dbTest,
} from "./harness.js";

const BROKEN_CHAIN = { code: "23514" };

dbTest("a_correct_chain_is_accepted", async ({ app }) => {
  const rows = chain(4);
  for (const row of rows) await insertRaw(app, row);
  assert.deepEqual(await head(app), { seq: 4, hash: rows[3]?.hash });
});

dbTest("first_event_must_be_seq_1_with_zero_prev_hash", async ({ app }) => {
  await assert.rejects(insertRaw(app, eventRow(2, ZERO_HASH)), BROKEN_CHAIN);
  await assert.rejects(
    insertRaw(app, eventRow(1, fakeHash("not-genesis"))),
    BROKEN_CHAIN,
  );
  assert.equal(await head(app), null);
});

dbTest("a_row_not_continuing_the_head_is_rejected", async ({ app }) => {
  const [a, b] = chain(2) as [EventRow, EventRow];
  for (const row of [a, b]) await insertRaw(app, row);
  for (const bad of [
    eventRow(4, b.hash), // a seq gap
    eventRow(2, a.hash, { hash: fakeHash("dup") }), // a duplicate seq
    eventRow(3, fakeHash("elsewhere")), // a wrong prev_hash
  ]) {
    await assert.rejects(insertRaw(app, bad), BROKEN_CHAIN, bad.line);
  }
  assert.deepEqual(await head(app), { seq: 2, hash: b.hash });
});

dbTest("uppercase_hash_or_raw_lf_in_line_is_rejected", async ({ app }) => {
  const upper = eventRow(1, ZERO_HASH, { hash: "A".repeat(64) });
  await assert.rejects(insertRaw(app, upper), BROKEN_CHAIN);
  const row = eventRow(1, ZERO_HASH);
  const line = row.line.replace(`"payload":{`, `"payload":{\n`);
  await assert.rejects(insertRaw(app, { ...row, line }), BROKEN_CHAIN);
});

// Each envelope field in `line` disagreeing with its column, one at a time.
const ROW = eventRow(1, ZERO_HASH);
const LINE_EDITS: Record<string, [string, string]> = {
  seq: ['{"seq":1,', '{"seq":7,'],
  type: ['"type":"test_event"', '"type":"other_event"'],
  version: ['"version":1', '"version":2'],
  ts: ['"ts":"2026-10-21T', '"ts":"2026-10-22T'],
  prev_hash: [`"prev_hash":"${ZERO_HASH}"`, `"prev_hash":"${fakeHash("p")}"`],
  hash: [`"hash":"${ROW.hash}"`, `"hash":"${fakeHash("h")}"`],
};

for (const [field, [from, to]] of Object.entries(LINE_EDITS)) {
  dbTest(`a_line_with_a_different_${field}_is_rejected`, async ({ app }) => {
    const line = ROW.line.replace(from, to);
    assert.notEqual(line, ROW.line);
    await assert.rejects(insertRaw(app, { ...ROW, line }), BROKEN_CHAIN);
    assert.equal(await head(app), null);
  });
}

dbTest("a_run_with_one_bad_row_stores_none_of_it", async ({ app }) => {
  await assert.rejects(
    appendRun(app, () => [eventRow(1, ZERO_HASH), eventRow(3, ZERO_HASH)]),
    BROKEN_CHAIN,
  );
  assert.equal(await head(app), null);
});
