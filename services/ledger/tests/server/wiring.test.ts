// The internal port with the REAL batcher and the signer double, wired as
// main.ts wires them (API.md "POST /appends" 503, "POST /issues/.../close").
import assert from "node:assert/strict";
import { test } from "node:test";
import { Batcher } from "../../src/batching/batcher.js";
import {
  epochMsToTs,
  verifyExport,
  type Event,
} from "../../src/chain/index.js";
import { createSignerClient } from "../../src/clients/signer.js";
import { closeMessage } from "../../src/server/index.js";
import { START_MS, fill } from "../batching/setup.js";
import { OPERATOR, TestChain, sign } from "../chain/support/builders.js";
import { skip } from "../db/harness.js";
import { FakeSigner } from "../support/fake-signer.js";
import { getBytes, postJson } from "./harness.js";
import { withServers, type WriteCtx } from "./write-harness.js";

const clock = (): number => START_MS;

/** A fake signer, and servers whose batcher signs through it. */
async function wired(
  fn: (ctx: WriteCtx & { fake: FakeSigner; b: Batcher }) => Promise<void>,
): Promise<void> {
  const fake = await FakeSigner.start();
  const signer = createSignerClient({ baseUrl: fake.url, timeoutMs: 300 });
  try {
    await withServers(
      (ctx) => fn({ ...ctx, fake, b: ctx.batcher as Batcher }),
      {
        clock,
        batcher: (ledger, pool) =>
          new Batcher({ ledger, pool, signer, clock, log: () => undefined }),
      },
    );
  } finally {
    await fake.close();
  }
}

async function head(pub: string): Promise<{ seq: number; hash: string }> {
  return (await (await fetch(`${pub}/head`)).json()) as {
    seq: number;
    hash: string;
  };
}

async function votes(pub: string): Promise<Event[]> {
  const res = await fetch(`${pub}/events?since=0`);
  const { events } = (await res.json()) as { events: Event[] };
  return events.filter((e) => e.type === "vote_cast");
}

/** Genesis and one issue through POST /appends; the signer opens the issue. */
async function start(ctx: WriteCtx, fake: FakeSigner) {
  const chain = new TestChain();
  const g = chain.add(chain.genesis());
  const issue = chain.add(chain.issue());
  for (const e of [g, issue]) assert.equal((await ctx.submit(e)).status, 201);
  fake.openIssue(issue.hash);
  return { chain, genesis: g.hash, issueId: issue.hash };
}

test(
  "a_pending_sign_request_makes_operator_appends_503_until_its_batch_lands",
  { skip },
  () =>
    wired(async (ctx) => {
      const { pub, submit, fake, b } = ctx;
      const { chain, issueId } = await start(ctx, fake);
      fill(fake, issueId, [0, 1, 2]);
      fake.inject("sign", "fail");
      assert.equal(await b.tick(), false);
      assert.equal(await b.signPending(), true);

      // Signed for seq 3 against the current head: refused, nothing appended.
      const op = chain.issue();
      const res = await submit(op);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: "batch_pending" });
      assert.equal((await head(pub)).seq, 2);

      // The signer recovers: the batch lands at its stored positions.
      assert.equal(await b.tick(), true);
      assert.equal(await b.signPending(), false);
      const run = await votes(pub);
      assert.deepEqual(
        run.map((e) => e.seq),
        [3, 4, 5],
      );
      assert.equal(run[0]?.prev_hash, issueId);

      // The old submission is now stale; re-signed against the new head, 201.
      assert.equal((await submit(op)).status, 409);
      const h = await head(pub);
      const retry = chain.issue({}, { seq: h.seq + 1, prevHash: h.hash });
      assert.equal((await submit(retry)).status, 201);
      assert.ok(verifyExport(await getBytes(`${pub}/export`)).ok);
    }),
);

test(
  "close_through_the_real_batcher_is_202_while_signing_is_pending_then_200",
  { skip },
  () =>
    wired(async (ctx) => {
      const { pub, internal, fake } = ctx;
      const { genesis, issueId } = await start(ctx, fake);
      const ts = epochMsToTs(START_MS);
      const sig = sign(OPERATOR.seed, closeMessage(genesis, issueId, ts));
      const close = () =>
        postJson(`${internal}/issues/${issueId}/close`, { ts, sig });
      fill(fake, issueId, [1]); // under ballot_batch_min: only a last seal
      fake.inject("sign", "fail");
      const first = await close();
      assert.equal(first.status, 202);
      assert.deepEqual(await first.json(), { status: "closing" });
      const second = await close();
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), { status: "closed" });
      assert.equal((await votes(pub)).length, 1);
      assert.equal(fake.addEntry(issueId, 0), "refused");
      assert.ok(verifyExport(await getBytes(`${pub}/export`)).ok);
    }),
);
