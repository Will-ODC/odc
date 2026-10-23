import assert from "node:assert/strict";
import { test } from "node:test";
import {
  epochMsToTs,
  tsToEpochMs,
  type UnhashedEvent,
} from "../../src/chain/index.js";
import { shuffle } from "../../src/batching/batcher.js";
import type { SignerClient } from "../../src/clients/signer.js";
import { skip, withDb } from "../db/harness.js";
import { OPERATOR, issuePayload } from "../chain/support/builders.js";
import { START_MS, fill, unhashed, votes, world } from "./setup.js";

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

test(
  "a_full_batch_is_sealed_shuffled_signed_and_appended_as_one_run_at_a_quantized_ts",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        fill(w.fake, issue, [0, 1, 2, 2]);
        assert.equal(await w.batcher().tick(), true);
        const run = votes(await w.events());
        assert.deepEqual(
          run.map((e) => e.seq),
          [3, 4, 5, 6],
        );
        assert.ok(run.every((e) => e.ts === quantized(START_MS)));
        assert.deepEqual(
          sorted(run.map((e) => Number(e.payload.choice))),
          [0, 1, 2, 2],
        );
        assert.equal(await w.exportValid(), true);
        const { rows } = await app.query(
          "SELECT appended FROM batch_completions",
        );
        assert.deepEqual(rows, [{ appended: true }]);
      }),
    ),
);

test(
  "an_under_min_batch_stays_open_across_ticks_then_fills_and_appends",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const b = w.batcher();
        fill(w.fake, issue, [1, 1]);
        await b.tick();
        await b.tick(); // same interval: not re-asked
        w.clock.now += MIN;
        await b.tick();
        assert.equal(votes(await w.events()).length, 0);
        assert.equal(w.fake.sealCalls.length, 2);
        fill(w.fake, issue, [0]);
        w.clock.now += MIN;
        await b.tick();
        const run = votes(await w.events());
        assert.equal(run.length, 3);
        assert.ok(run.every((e) => e.ts === quantized(START_MS + 2 * MIN)));
      }),
    ),
);

test(
  "an_under_size_batch_is_appended_only_as_the_last_and_the_issue_is_never_sealed_again",
  { skip },
  () =>
    withDb(async ({ app }) =>
      world(app, [{}], async (w) => {
        const [issue] = w.issueIds as [string];
        const b = w.batcher();
        fill(w.fake, issue, [0, 1, 2]);
        await b.tick();
        fill(w.fake, issue, [2]);
        assert.equal(await b.closeIssue(issue), "closed");
        assert.equal(votes(await w.events()).length, 4);
        assert.equal(await w.exportValid(), true);
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

test("appended_order_is_the_shuffle_not_the_count_order", { skip }, () =>
  withDb(async ({ app }) =>
    world(app, [{}], async (w) => {
      const [issue] = w.issueIds as [string];
      fill(w.fake, issue, [2, 0, 1, 0]); // counts [2, 1, 1] expand to 0,0,1,2
      await w.batcher({ random: () => 0 }).tick();
      const order = votes(await w.events()).map((e) =>
        Number(e.payload.choice),
      );
      assert.deepEqual(order, [0, 1, 2, 0]);
    }),
  ),
);
