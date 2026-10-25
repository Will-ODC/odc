import assert from "node:assert/strict";
import { test } from "node:test";
import {
  epochMsToTs,
  tsToEpochMs,
  type UnhashedEvent,
} from "../../src/chain/index.js";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  Batcher,
  shuffle,
  type BatcherLedger,
} from "../../src/batching/batcher.js";
import type { SignerClient } from "../../src/clients/signer.js";
import { skip, withDb } from "../db/harness.js";
import { OPERATOR, issuePayload } from "../chain/support/builders.js";
import { START_MS, count, fill, unhashed, votes, world } from "./setup.js";

const MIN = 60000;
const quantized = (ms: number) => epochMsToTs(Math.floor(ms / MIN) * MIN);
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

test("shuffle_is_a_permutation_driven_only_by_the_random_source", () => {
  const always0 = () => 0;
  assert.deepEqual(shuffle([0, 0, 1, 2], always0), [0, 1, 2, 0]);
  const xs = Array.from({ length: 50 }, (_, i) => i);
  const out = shuffle(xs, (n) => Math.floor(Math.random() * n));
  assert.deepEqual(sorted(out), xs);
});

test("a_batcher_refuses_a_pool_of_one_connection", () => {
  const o = { ledger: {} as BatcherLedger, signer: {} as SignerClient };
  const pool = new pg.Pool({ max: 1 }); // never connects
  assert.throws(() => new Batcher({ ...o, pool }), /max >= 2/);
});

test(
  "a_full_batch_is_sealed_shuffled_signed_and_appended_as_one_run_at_a_quantized_ts",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        fill(w.fake, issue, [2, 0, 1, 2]);
        assert.equal(await w.batcher({ random: () => 0 }).tick(), true);
        const run = votes(await w.events());
        assert.deepEqual(
          run.map((e) => e.seq),
          [3, 4, 5, 6],
        );
        assert.ok(run.every((e) => e.ts === quantized(START_MS)));
        // The shuffle of the counts' 0,1,2,2: neither count nor arrival order.
        const order = run.map((e) => Number(e.payload.choice));
        assert.deepEqual(order, [1, 2, 2, 0]);
        assert.equal(await w.exportValid(), true);
        const { rows } = await app.query(
          "SELECT appended FROM batch_completions",
        );
        assert.deepEqual(rows, [{ appended: true }]);
      }),
    ),
);

test(
  "a_quiet_issue_keeps_one_intent_re_asked_once_per_interval_then_fills_and_closes",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const b = w.batcher();
        fill(w.fake, issue, [1, 1]);
        for (let i = 0; i < 5; i++, w.clock.now += MIN) {
          await b.tick();
          await b.tick(); // same interval: not re-asked
        }
        const rows = async () => [
          await count(app, "batch_seal_intents"),
          await count(app, "batch_seal_refusals"),
        ];
        assert.deepEqual(await rows(), [1, 0]);
        assert.equal(w.fake.sealCalls.length, 5);
        assert.equal(new Set(w.fake.sealCalls.map((c) => c.sealId)).size, 1);
        fill(w.fake, issue, [0]);
        await b.tick();
        // It keeps its intent's instant, which no seal of the issue had.
        const run = votes(await w.events());
        assert.equal(run.length, 3);
        assert.ok(run.every((e) => e.ts === quantized(START_MS)));
        // A close drops an outstanding under-min intent (one refusal row).
        fill(w.fake, issue, [2]);
        w.clock.now += MIN;
        await b.tick();
        assert.equal(await b.closeIssue(issue), "closed");
        assert.deepEqual(await rows(), [3, 1]);
        assert.equal(new Set(votes(await w.events()).map((e) => e.ts)).size, 2);
        assert.equal(await w.exportValid(), true);
        // Closed: entries refused, never sealed again.
        assert.equal(w.fake.addEntry(issue, 0), "refused");
        const calls = w.fake.sealCalls.length;
        w.clock.now += 5 * MIN;
        await b.tick();
        assert.equal(w.fake.sealCalls.length, calls);
        assert.equal(await b.closeIssue(issue), "closed");
      }),
    ),
);

test("closing_an_issue_with_no_open_ballots_appends_nothing", { skip }, () =>
  withDb(async ({ app }) =>
    world(app, [{}], async (w) => {
      const [issue] = w.issueIds as [string];
      assert.equal(await w.batcher().closeIssue(issue), "closed");
      assert.equal((await w.events()).length, 2);
      const { rows } = await app.query(
        "SELECT appended FROM batch_completions",
      );
      assert.deepEqual(rows, [{ appended: false }]);
    }),
  ),
);

test("two_issues_interleave_without_breaking_batch_rules", { skip }, () =>
  withDb(async ({ app }) =>
    world(
      app,
      [{}, { title: "Second", ballot_batch_interval_ms: 120000 }],
      async (w) => {
        const [a, c] = w.issueIds as [string, string];
        const b = w.batcher();
        for (let round = 0; round < 4; round++) {
          fill(w.fake, a, [0, 1, 2]);
          fill(w.fake, c, [round % 3, 1, 0, 2]);
          await b.tick();
          w.clock.now += MIN;
        }
        await b.closeIssue(a);
        await b.closeIssue(c);
        const events = await w.events();
        assert.equal(votes(events, a).length, 12);
        assert.equal(votes(events, c).length, 16);
        assert.equal(await w.exportValid(), true);
      },
    ),
  ),
);

test(
  "an_operator_append_racing_a_batch_never_lands_inside_the_run",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        let racing: Promise<unknown> | undefined;
        const signer: SignerClient = {
          seal: (id, o) => w.client.seal(id, o),
          sign: (req) => {
            racing = w.ledger.appendRun((state): UnhashedEvent[] => {
              const e = w.chain.make(
                "issue_created",
                issuePayload({ title: "Raced" }),
                {
                  signer: OPERATOR,
                  seq: state.nextSeq,
                  prevHash: state.headHash,
                  ts: epochMsToTs(START_MS),
                },
              );
              return [unhashed(e)];
            });
            return w.client.sign(req);
          },
        };
        fill(w.fake, issue, [0, 1, 2, 0, 1]);
        await w.batcher({ signer }).tick();
        await racing;
        const types = (await w.events()).map((e) => e.type);
        assert.deepEqual(types.slice(2), [
          ...Array<string>(5).fill("vote_cast"),
          "issue_created",
        ]);
        assert.equal(await w.exportValid(), true);
      }),
    ),
);

test("a_clock_stepping_backwards_never_reuses_a_batch_instant", { skip }, () =>
  withDb(async ({ app }) =>
    world(app, [{}], async (w) => {
      const [issue] = w.issueIds as [string];
      const b = w.batcher();
      w.clock.now += MIN;
      fill(w.fake, issue, [0, 1, 2]);
      await b.tick();
      const first = quantized(w.clock.now);
      w.clock.now -= 2 * MIN; // steps back across two boundaries
      fill(w.fake, issue, [0, 1, 2]);
      await b.tick();
      assert.equal(
        votes(await w.events()).length,
        3,
        "holds rather than reuse",
      );
      fill(w.fake, issue, [1]);
      assert.equal(await b.closeIssue(issue), "closed");
      const run = votes(await w.events());
      const instants = [...new Set(run.map((e) => e.ts))];
      assert.deepEqual(instants, [
        first,
        epochMsToTs(tsToEpochMs(first) + MIN),
      ]);
      assert.equal(await w.exportValid(), true);
    }),
  ),
);

test("start_ticks_on_a_timer_and_stop_ends_it_cleanly", { skip }, () =>
  withDb(async ({ app }) =>
    world(app, [{}], async (w) => {
      const [issue] = w.issueIds as [string];
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      fill(w.fake, issue, [0, 1, 2]);
      const idle = w.batcher({ tickMs: 20 });
      idle.start();
      await idle.stop(); // before its first tick: it never ticks
      await sleep(60);
      assert.equal(w.fake.sealCalls.length, 0);

      const b = w.batcher({ tickMs: 10 });
      w.fake.inject("sign", "fail"); // the batch lands only on a later tick
      b.start();
      b.start(); // idempotent: still one loop
      for (let i = 0; i < 200 && votes(await w.events()).length === 0; i++) {
        await sleep(10);
      }
      await b.stop();
      assert.equal(votes(await w.events()).length, 3);
      const calls = w.fake.sealCalls.length;
      w.clock.now += MIN;
      fill(w.fake, issue, [0, 1, 2]);
      await sleep(60);
      assert.equal(w.fake.sealCalls.length, calls);
    }),
  ),
);

test(
  "stop_during_a_running_tick_lets_it_finish_and_never_ticks_again",
  { skip, timeout: 30_000 },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        fill(w.fake, issue, [0, 1, 2]);
        w.fake.inject("seal", "timeout"); // holds the tick for the client timeout
        const b = w.batcher({ tickMs: 10 });
        b.start();
        for (let i = 0; i < 200 && w.fake.sealCalls.length === 0; i++) {
          await sleep(5);
        }
        assert.equal(w.fake.sealCalls.length, 1); // mid-tick
        await b.stop(); // returns once that tick has finished
        // Give a still-running loop every reason to seal again: a new
        // interval and a full batch. A stopped batcher makes no call.
        w.clock.now += MIN;
        fill(w.fake, issue, [0, 1, 2]);
        await sleep(80);
        assert.equal(w.fake.sealCalls.length, 1);
      }),
    ),
);

test(
  "sign_pending_is_true_only_while_a_sign_request_has_no_run",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const b = w.batcher();
        assert.equal(await b.signPending(), false);
        fill(w.fake, issue, [0, 1, 2]);
        w.fake.inject("seal", "fail");
        assert.equal(await b.tick(), false);
        assert.equal(await b.signPending(), false); // a seal holds no position
        w.fake.inject("sign", "timeout");
        assert.equal(await b.tick(), false);
        assert.equal(await b.signPending(), true);
        assert.equal(await b.tick(), true);
        assert.equal(await b.signPending(), false);
      }),
    ),
);

test(
  "a_last_seal_refused_for_good_alerts_and_does_not_starve_another_issue",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}, {}], async (w) => {
        const [a, other] = w.issueIds as [string, string];
        // The signer already closed `a` under a seal id the ledger never saw.
        const sealId = randomBytes(16).toString("hex");
        assert.ok((await w.client.seal(a, { last: true, sealId })).ok);
        const b = w.batcher();
        assert.equal(await b.closeIssue(a), "closing");
        const alerts = w.logs.filter((l) => l.startsWith("ALERT batcher: "));
        assert.equal(alerts.length, 1);
        assert.match(alerts[0] as string, /seal of issue .* issue_closed/);
        fill(w.fake, other, [0, 1, 2]);
        assert.equal(await b.tick(), false); // `a` is still not done
        assert.equal(votes(await w.events(), other).length, 3);
        assert.equal(await w.exportValid(), true);
        // Paced: another refusal within the minute is a plain line, and one
        // after the minute is an ALERT again.
        const count = () =>
          w.logs.filter((l) => l.startsWith("ALERT batcher: seal of issue"))
            .length;
        const before = w.logs.length;
        await b.tick();
        assert.equal(count(), 1);
        assert.ok(
          w.logs.slice(before).some((l) => /issue_closed/.test(l)),
          "the refusal is still logged",
        );
        w.clock.now += 60_000;
        await b.tick();
        assert.equal(count(), 2);
      }),
    ),
);
