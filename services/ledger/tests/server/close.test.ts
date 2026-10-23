// POST /issues/{issue_id}/close over real HTTP (API.md "Internal port").
import assert from "node:assert/strict";
import { test } from "node:test";
import { epochMsToTs, tsToEpochMs } from "../../src/chain/index.js";
import { closeMessage, type CloseIssue } from "../../src/server/index.js";
import {
  OPERATOR,
  REGISTRAR,
  TestChain,
  sign,
  type TestKey,
} from "../chain/support/builders.js";
import { fakeHash, skip } from "../db/harness.js";
import { postJson } from "./harness.js";
import { withServers, type WriteCtx } from "./write-harness.js";

const NOW = "2026-10-21T12:00:00.000Z";
const clock = (): number => tsToEpochMs(NOW);

interface Setup {
  genesisHash: string;
  issueId: string;
  close: (
    issueId: string,
    opts?: { ts?: string; key?: TestKey; genesisHash?: string; sig?: string },
  ) => Promise<Response>;
}

/** A genesis and one issue, appended through the write path. */
async function setup(ctx: WriteCtx): Promise<Setup> {
  const chain = new TestChain();
  const g = chain.add(chain.genesis());
  const issue = chain.add(chain.issue());
  for (const e of [g, issue]) assert.equal((await ctx.submit(e)).status, 201);
  return {
    genesisHash: g.hash,
    issueId: issue.hash,
    close: (issueId, opts = {}) => {
      const ts = opts.ts ?? NOW;
      const sig =
        opts.sig ??
        sign(
          (opts.key ?? OPERATOR).seed,
          closeMessage(opts.genesisHash ?? g.hash, issueId, ts),
        );
      return postJson(`${ctx.internal}/issues/${issueId}/close`, { ts, sig });
    },
  };
}

function recorder(answer: "closing" | "closed"): {
  closeIssue: CloseIssue;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    closeIssue: (id) => {
      calls.push(id);
      return Promise.resolve(answer);
    },
  };
}

async function expectError(
  res: Response,
  status: number,
  error: string,
): Promise<void> {
  assert.equal(res.status, status);
  assert.deepEqual(await res.json(), { error });
}

test("a_signed_close_calls_close_issue_and_answers_202", { skip }, () => {
  const r = recorder("closing");
  return withServers(
    async (ctx) => {
      const s = await setup(ctx);
      const res = await s.close(s.issueId);
      assert.equal(res.status, 202);
      assert.deepEqual(await res.json(), { status: "closing" });
      assert.deepEqual(r.calls, [s.issueId]);
    },
    { closeIssue: r.closeIssue, clock },
  );
});

test("an_already_closed_issue_answers_200_closed", { skip }, () => {
  const r = recorder("closed");
  return withServers(
    async (ctx) => {
      const s = await setup(ctx);
      const res = await s.close(s.issueId);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: "closed" });
    },
    { closeIssue: r.closeIssue, clock },
  );
});

test("a_bad_signature_is_401_and_closes_nothing", { skip }, () => {
  const r = recorder("closing");
  return withServers(
    async (ctx) => {
      const s = await setup(ctx);
      await expectError(
        await s.close(s.issueId, { key: REGISTRAR }),
        401,
        "bad_signature",
      );
      await expectError(
        await s.close(s.issueId, { sig: "zz" }),
        401,
        "bad_signature",
      );
      // Signed over another issue's id.
      const other = sign(
        OPERATOR.seed,
        closeMessage(s.genesisHash, fakeHash("x"), NOW),
      );
      await expectError(
        await s.close(s.issueId, { sig: other }),
        401,
        "bad_signature",
      );
      assert.deepEqual(r.calls, []);
    },
    { closeIssue: r.closeIssue, clock },
  );
});

test("a_signature_for_another_chains_genesis_is_401", { skip }, () => {
  const r = recorder("closing");
  return withServers(
    async (ctx) => {
      const s = await setup(ctx);
      const res = await s.close(s.issueId, {
        genesisHash: fakeHash("another chain"),
      });
      await expectError(res, 401, "bad_signature");
      assert.deepEqual(r.calls, []);
    },
    { closeIssue: r.closeIssue, clock },
  );
});

test("an_unknown_issue_is_404", { skip }, () => {
  const r = recorder("closing");
  return withServers(
    async (ctx) => {
      const s = await setup(ctx);
      await expectError(
        await s.close(fakeHash("no such issue")),
        404,
        "unknown_issue",
      );
      // The genesis is on the log but is not an issue.
      await expectError(await s.close(s.genesisHash), 404, "unknown_issue");
      await expectError(await s.close("not-hex"), 404, "unknown_issue");
      assert.deepEqual(r.calls, []);
    },
    { closeIssue: r.closeIssue, clock },
  );
});

test("a_ts_outside_five_minutes_or_malformed_is_400", { skip }, () => {
  const r = recorder("closing");
  return withServers(
    async (ctx) => {
      const s = await setup(ctx);
      const at = (deltaMs: number): string =>
        epochMsToTs(tsToEpochMs(NOW) + deltaMs);
      for (const ts of [at(300_001), at(-300_001), "2026-10-21T12:00:00Z"]) {
        await expectError(await s.close(s.issueId, { ts }), 400, "bad_ts");
      }
      for (const ts of [at(300_000), at(-300_000)]) {
        assert.equal((await s.close(s.issueId, { ts })).status, 202, ts);
      }
      const shape = await postJson(
        `${ctx.internal}/issues/${s.issueId}/close`,
        { ts: NOW },
      );
      await expectError(shape, 400, "bad_request");
    },
    { closeIssue: r.closeIssue, clock },
  );
});

test("without_batching_a_valid_close_is_503", { skip }, () =>
  withServers(
    async (ctx) => {
      const s = await setup(ctx);
      await expectError(await s.close(s.issueId), 503, "batching_unavailable");
      // Authentication still comes first.
      await expectError(
        await s.close(s.issueId, { key: REGISTRAR }),
        401,
        "bad_signature",
      );
    },
    { clock },
  ),
);
