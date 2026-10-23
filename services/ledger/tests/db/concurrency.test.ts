import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  APPEND_LOCK_KEY,
  appendEvent,
  readSince,
} from "../../src/db/events.js";
import {
  ZERO_HASH,
  appendLockWaiters,
  eventRow,
  fakeHash,
  insertRaw,
  nextRow,
  waitFor,
  dbTest,
} from "./harness.js";

const N = 8;

/**
 * Holds the append lock, starts `start()` N times, waits until all N are
 * queued on the lock, then releases it: the race is forced, not hoped for.
 */
async function race<T>(
  owner: Pool,
  start: () => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  const holder = await owner.connect();
  try {
    await holder.query("SELECT pg_advisory_lock($1)", [APPEND_LOCK_KEY]);
    const settled = Promise.allSettled(Array.from({ length: N }, start));
    await waitFor(async () => (await appendLockWaiters(owner)) === N);
    await holder.query("SELECT pg_advisory_unlock($1)", [APPEND_LOCK_KEY]);
    return await settled;
  } finally {
    holder.release();
  }
}

dbTest("racing_appends_chain_contiguously", async ({ owner, app }) => {
  const results = await race(owner, () => appendEvent(app, nextRow));
  assert.ok(results.every((r) => r.status === "fulfilled"));
  const rows = await readSince(app, 0, N + 1);
  assert.deepEqual(
    rows.map((r) => r.seq),
    Array.from({ length: N }, (_, i) => i + 1),
  );
  rows.forEach((r, i) =>
    assert.equal(r.prevHash, i === 0 ? ZERO_HASH : rows[i - 1]?.hash),
  );
});

dbTest("racing_raw_inserts_store_exactly_one", async ({ owner, app }) => {
  let i = 0;
  const results = await race(owner, () =>
    insertRaw(app, eventRow(1, ZERO_HASH, { hash: fakeHash(`r${i++}`) })),
  );
  const refused = results.filter((r) => r.status === "rejected");
  assert.equal(refused.length, N - 1);
  for (const r of refused) assert.equal(r.reason.code, "23514");
  assert.equal((await readSince(app, 0, N)).length, 1);
});
