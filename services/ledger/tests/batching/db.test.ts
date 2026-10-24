import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { SignRequest } from "../../src/clients/signer.js";
import * as db from "../../src/db/batching.js";
import { dbTest, fakeHash } from "../db/harness.js";

const ISSUE = fakeHash("issue");
const OTHER = fakeHash("other");

function intent(n: number, issueId = ISSUE, last = false): db.SealIntent {
  const sealId = fakeHash(`seal-${n}`).slice(0, 32);
  return { sealId, issueId, last, instantMs: n * 60_000 };
}

/** Seals batch `b<n>` for `i`; returns its (unstored) sign request. */
async function sealed(pool: Pool, n: number, i: db.SealIntent) {
  await db.insertSealIntent(pool, i);
  await db.insertSealResult(pool, i.sealId, `b${n}`, [1, 2]);
  const request: SignRequest = {
    batchId: `b${n}`,
    issueId: i.issueId,
    firstSeq: 100 - n, // later batches sit earlier in the log
    ts: "2026-10-21T00:01:00.000Z",
    firstPrevHash: fakeHash(`prev-${n}`),
    payloads: [2, 0, 1].map((choice) => ({ issue_id: i.issueId, choice })),
  };
  return request;
}

dbTest("a_sign_request_round_trips_and_one_issue_only", async ({ app }) => {
  const request = await sealed(app, 1, intent(1));
  const payloads = [...request.payloads, { issue_id: OTHER, choice: 0 }];
  await assert.rejects(
    db.insertSignRequest(app, { ...request, payloads }),
    /issue_id must equal/,
  );
  assert.deepEqual(await db.pendingSignRequests(app), []);
  await db.insertSignRequest(app, request);
  assert.deepEqual(await db.pendingSignRequests(app), [request]);
  assert.deepEqual((await db.issueProgress(app, ISSUE)).request, request);
});

dbTest("pending_requests_in_log_order_minus_completed", async ({ app }) => {
  const later = await sealed(app, 1, intent(1));
  const earlier = await sealed(app, 2, intent(2, OTHER));
  await db.insertSignRequest(app, later);
  await db.insertSignRequest(app, earlier);
  assert.deepEqual(await db.pendingSignRequests(app), [earlier, later]);
  await db.insertCompletion(app, earlier.batchId, true);
  assert.deepEqual(await db.pendingSignRequests(app), [later]);
});

dbTest("issue_progress_follows_each_recorded_fact", async ({ app }) => {
  const empty = {
    intent: null,
    sealed: null,
    request: null,
    lastInstantMs: null,
    closeRequested: false,
    closed: false,
  };
  const expect = async (over: object, issue = ISSUE) =>
    assert.deepEqual(await db.issueProgress(app, issue), { ...empty, ...over });
  await expect({});
  const [a, b, c] = [intent(1), intent(2), intent(3, ISSUE, true)];
  await db.insertSealIntent(app, a);
  await expect({ intent: a, lastInstantMs: a.instantMs });
  await db.insertSealRefusal(app, a.sealId, "under_min");
  const request = await sealed(app, 2, b);
  const sealedB = { ...b, batchId: "b2", counts: [1, 2] };
  await expect({ sealed: sealedB, lastInstantMs: b.instantMs });
  await db.insertSignRequest(app, request);
  await db.insertSealIntent(app, c);
  await db.insertCloseIntent(app, ISSUE);
  await db.insertCloseIntent(app, ISSUE); // idempotent
  const closing = { lastInstantMs: c.instantMs, closeRequested: true };
  await expect({ ...closing, intent: c, sealed: sealedB, request });
  await db.insertCompletion(app, "b2", true);
  await db.insertSealResult(app, c.sealId, "b3", [0, 0]);
  await expect({ ...closing, sealed: { ...c, batchId: "b3", counts: [0, 0] } });
  await db.insertCompletion(app, "b3", false);
  await expect({ ...closing, closed: true });
  await expect({}, OTHER);
});
