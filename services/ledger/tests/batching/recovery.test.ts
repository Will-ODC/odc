import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import type { Event } from "../../src/chain/index.js";
import type { BatcherLedger } from "../../src/batching/batcher.js";
import type { SignerClient } from "../../src/clients/signer.js";
import { skip, withDb } from "../db/harness.js";
import { fill, votes, world } from "./setup.js";

async function pendingRequests(app: Pool): Promise<number> {
  const { rows } = await app.query<{ n: string }>(
    `SELECT count(*) AS n FROM batch_sign_requests s
      WHERE NOT EXISTS (SELECT 1 FROM batch_completions c WHERE c.batch_id = s.batch_id)`,
  );
  return Number(rows[0]?.n);
}

test(
  "a_crash_after_the_sign_request_is_stored_replays_identical_inputs_and_appends_the_identical_run",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        let signed: Event[] = [];
        const crashing: SignerClient = {
          seal: (id, o) => w.client.seal(id, o),
          sign: async (req) => {
            const r = await w.client.sign(req);
            if (r.ok) signed = r.value;
            throw new Error("process killed before append");
          },
        };
        fill(w.fake, issue, [0, 1, 2, 1]);
        assert.equal(await w.batcher({ signer: crashing }).tick(), false);
        assert.equal(votes(await w.events()).length, 0);
        assert.equal(await pendingRequests(app), 1);

        assert.equal(await w.batcher().recover(), true);
        const run = votes(await w.events());
        assert.deepEqual(
          run.map((e) => e.hash),
          signed.map((e) => e.hash),
        );
        const [bodies] = [...w.fake.signBodies.values()] as [string[]];
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0], bodies[1]);
        assert.equal(await pendingRequests(app), 0);
        assert.equal(await w.exportValid(), true);
      }),
    ),
);

test(
  "a_crash_after_commit_before_completion_records_completion_without_appending_again",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const crashing: BatcherLedger = {
          get state() {
            return w.ledger.state;
          },
          appendRun: async (build) => {
            await w.ledger.appendRun(build);
            throw new Error("process killed before completion");
          },
        };
        fill(w.fake, issue, [0, 1, 2]);
        assert.equal(await w.batcher({ ledger: crashing }).tick(), false);
        assert.equal(await pendingRequests(app), 1);

        assert.equal(await w.batcher().recover(), true);
        assert.equal(votes(await w.events()).length, 3);
        assert.equal(await pendingRequests(app), 0);
        assert.equal(
          [...w.fake.signBodies.values()][0]?.length,
          1,
          "not re-signed",
        );
      }),
    ),
);

test(
  "a_crash_after_seal_before_its_result_is_stored_reseals_with_the_same_seal_id",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const crashing: SignerClient = {
          seal: async (id, o) => {
            await w.client.seal(id, o);
            throw new Error("process killed after seal");
          },
          sign: (req) => w.client.sign(req),
        };
        fill(w.fake, issue, [2, 2, 0]);
        assert.equal(await w.batcher({ signer: crashing }).tick(), false);
        assert.equal(votes(await w.events()).length, 0);

        assert.equal(await w.batcher().recover(), true);
        const [first, second] = w.fake.sealCalls;
        assert.equal(w.fake.sealCalls.length, 2);
        assert.equal(first?.sealId, second?.sealId);
        const run = votes(await w.events());
        assert.deepEqual(
          run.map((e) => Number(e.payload.choice)).sort(),
          [0, 2, 2],
        );
      }),
    ),
);

for (const fault of ["tamper_sig", "tamper_payload"] as const) {
  test(
    `a_signed_run_with_${fault}_is_never_appended_and_stays_pending`,
    { skip },
    () =>
      withDb(async ({ app }) =>
        world(app, [{}], async (w) => {
          const [issue] = w.issueIds as [string];
          const b = w.batcher();
          fill(w.fake, issue, [0, 1, 2]);
          w.fake.inject("sign", fault);
          assert.equal(await b.tick(), false);
          assert.equal(votes(await w.events()).length, 0);
          assert.equal(await pendingRequests(app), 1);
          assert.match(w.logs.join("\n"), /not appended/);
          assert.equal(await b.signPending(), true);
          // The next answer to the identical request is honest: it is appended.
          assert.equal(await b.tick(), true);
          assert.equal(votes(await w.events()).length, 3);
          assert.equal(await w.exportValid(), true);
          assert.equal(await b.signPending(), false);
        }),
      ),
  );
}

test(
  "a_signer_outage_or_timeout_appends_nothing_and_a_later_tick_succeeds",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const b = w.batcher();
        fill(w.fake, issue, [0, 1, 2]);
        w.fake.inject("seal", "fail");
        assert.equal(await b.tick(), false);
        w.fake.inject("seal", "timeout");
        assert.equal(await b.tick(), false);
        w.fake.inject("sign", "timeout");
        assert.equal(await b.tick(), false);
        assert.equal(votes(await w.events()).length, 0);
        assert.equal(await b.tick(), true);
        assert.equal(votes(await w.events()).length, 3);
        // Every retry of the seal used the one seal id: one batch, not three.
        assert.equal(new Set(w.fake.sealCalls.map((c) => c.sealId)).size, 1);
      }),
    ),
);

test(
  "a_400_from_the_signer_raises_an_alert_and_keeps_the_batch_pending",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        fill(w.fake, issue, [0, 1, 2]);
        w.fake.inject("sign", "bad_request");
        assert.equal(await w.batcher().tick(), false);
        assert.equal(votes(await w.events()).length, 0);
        assert.equal(await pendingRequests(app), 1);
        assert.match(w.logs.join("\n"), /^ALERT batcher: .*http_400/m);
      }),
    ),
);
