import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import type { Event } from "../../src/chain/index.js";
import type { BatcherLedger } from "../../src/batching/batcher.js";
import type { SignerClient } from "../../src/clients/signer.js";
import { issueProgress } from "../../src/db/batching.js";
import { REGISTRAR, finish } from "../chain/support/builders.js";
import { skip, withDb } from "../db/harness.js";
import type { Fault } from "../support/fake-signer.js";
import { count, fill, unhashed, votes, world, type World } from "./setup.js";

/** A stored sign request has no completion. */
const pending = async (app: Pool) =>
  (await count(app, "batch_sign_requests")) >
  (await count(app, "batch_completions"));

/** A signer whose sign call reaches the fake, then the process dies. */
function dyingSigner(w: World, onSigned: (run: Event[]) => void) {
  return {
    seal: (id, o) => w.client.seal(id, o),
    sign: async (req) => {
      const r = await w.client.sign(req);
      if (r.ok) onSigned(r.value);
      throw new Error("process killed before append");
    },
  } satisfies SignerClient;
}

test(
  "a_crash_after_the_sign_request_is_stored_replays_identical_inputs_and_appends_the_identical_run",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        let signed: Event[] = [];
        const signer = dyingSigner(w, (run) => void (signed = run));
        fill(w.fake, issue, [0, 1, 2, 1]);
        assert.equal(await w.batcher({ signer }).tick(), false);
        assert.equal(votes(await w.events()).length, 0);
        assert.equal(await pending(app), true);

        assert.equal(await (await w.restart()).recover(), true);
        assert.deepEqual(
          votes(await w.events()).map((e) => e.hash),
          signed.map((e) => e.hash),
        );
        const [bodies] = [...w.fake.signBodies.values()] as [string[]];
        assert.deepEqual(bodies, [bodies[0], bodies[0]]);
        assert.equal(await pending(app), false);
        assert.equal(await w.exportValid(), true);
      }),
    ),
);

test(
  "a_stored_sign_request_whose_positions_hold_another_run_is_never_completed",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        // Another valid run of the same ballots, in another order, takes the positions.
        let racing: Promise<unknown> | undefined;
        const signer = dyingSigner(w, (run) => {
          const head = run[0] as Event;
          const other: Event[] = [];
          for (const { payload: p } of [...run].reverse()) {
            const payload = { issue_id: issue, choice: Number(p.choice) };
            const prev_hash = other.at(-1)?.hash ?? head.prev_hash;
            const seq = head.seq + other.length;
            other.push(
              finish({ ...unhashed(head), seq, prev_hash, payload }, REGISTRAR),
            );
          }
          racing = w.ledger.appendRun(() => other.map(unhashed));
        });
        fill(w.fake, issue, [0, 1, 2, 2]);
        assert.equal(await w.batcher({ signer }).tick(), false);
        await racing;

        assert.equal(await (await w.restart()).recover(), false);
        assert.equal(await count(app, "batch_completions"), 0);
        assert.match(w.logs.join("\n"), /^ALERT batcher: .*tail moved/m);
      }),
    ),
);

test(
  "a_crash_after_the_run_is_appended_before_completion_records_completion_only",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const ledger: BatcherLedger = {
          state: w.ledger.state,
          appendRun: async (build) => {
            await w.ledger.appendRun(build);
            throw new Error("process killed before completion");
          },
        };
        fill(w.fake, issue, [0, 1, 2]);
        assert.equal(await w.batcher({ ledger }).tick(), false);
        assert.equal(await pending(app), true);

        assert.equal(await (await w.restart()).recover(), true);
        assert.equal(votes(await w.events()).length, 3);
        assert.equal(await pending(app), false);
        const bodies = [...w.fake.signBodies.values()].flat();
        assert.equal(bodies.length, 1, "not re-signed");
      }),
    ),
);

test(
  "a_crash_after_seal_before_its_result_is_stored_reseals_the_same_batch",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const signer: SignerClient = {
          seal: async (id, o) => {
            await w.client.seal(id, o);
            throw new Error("process killed after seal");
          },
          sign: (req) => w.client.sign(req),
        };
        fill(w.fake, issue, [2, 2, 0]);
        assert.equal(await w.batcher({ signer }).tick(), false);
        assert.equal(await count(app, "batch_seal_results"), 0);

        assert.equal(await (await w.restart()).recover(), true);
        const [first, second] = w.fake.sealCalls;
        assert.equal(w.fake.sealCalls.length, 2);
        assert.equal(first?.sealId, second?.sealId);
        assert.equal(w.fake.signBodies.size, 1, "one batch");
        const run = votes(await w.events());
        assert.deepEqual(
          run.map((e) => Number(e.payload.choice)).sort(),
          [0, 2, 2],
        );
      }),
    ),
);

test(
  "a_sign_timeout_blocks_other_issues_until_replay_and_a_later_tick_succeeds",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}, {}], async (w) => {
        const [issue, other] = w.issueIds as [string, string];
        const b = w.batcher();
        fill(w.fake, issue, [0, 1, 2]);
        w.fake.inject("seal", "fail");
        assert.equal(await b.tick(), false);
        const intent = (await issueProgress(app, issue)).intent;
        w.fake.inject("seal", "timeout");
        assert.equal(await b.tick(), false);
        w.clock.now += 60000;
        fill(w.fake, other, [2, 1, 0]);
        w.fake.inject("sign", "timeout");
        assert.equal(await b.tick(), false);
        assert.equal(votes(await w.events()).length, 0);
        assert.equal(await b.tick(), true);
        assert.equal(votes(await w.events(), issue).length, 3);
        assert.equal(votes(await w.events(), other).length, 3);
        assert.equal(w.fake.sealCalls[0]?.sealId, intent?.sealId);
        assert.equal(await w.exportValid(), true);
        assert.ok(!w.logs.some((l) => l.startsWith("ALERT")));
      }),
    ),
);

const ALERTS: [Fault, number[], RegExp][] = [
  ["tamper_sig", [0, 1, 2], /not appended: event 0 refused/],
  ["tamper_payload", [0, 1, 2], /not appended: payload 2/],
  ["bad_request", [0, 1, 2], /not appended: http_400/],
  ["seal_under_min", [0], /bad counts/],
  ["seal_extra_count", [0, 1, 2], /bad counts/],
];
for (const [fault, entries, why] of ALERTS) {
  test(
    `a_signer_answer_a_retry_cannot_fix_(${fault})_alerts_and_appends_nothing`,
    { skip },
    () =>
      withDb(async ({ app }) =>
        world(app, [{}], async (w) => {
          const [issue] = w.issueIds as [string];
          fill(w.fake, issue, entries);
          const sealFault = fault.startsWith("seal_");
          w.fake.inject(sealFault ? "seal" : "sign", fault);
          const b = w.batcher();
          assert.equal(await b.tick(), false);
          assert.equal(votes(await w.events()).length, 0);
          const alerts = w.logs.filter((l) => l.startsWith("ALERT batcher: "));
          assert.equal(alerts.length, 1);
          assert.match(alerts[0] as string, why);
          assert.equal(await pending(app), !sealFault);
          if (sealFault) {
            // Sealed at the signer: the same seal id gets the same bad answer.
            assert.equal(await b.tick(), false);
            assert.equal(w.logs.filter((l) => why.test(l)).length, 2);
            assert.equal(await count(app, "batch_seal_results"), 0);
            return;
          }
          // The fake is honest next time: the identical request is appended.
          assert.equal(await b.tick(), true);
          assert.equal(votes(await w.events()).length, 3);
          assert.equal(await w.exportValid(), true);
        }),
      ),
  );
}
