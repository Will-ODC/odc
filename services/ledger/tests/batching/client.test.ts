import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSignerClient,
  type SignRequest,
} from "../../src/clients/signer.js";
import { minute } from "../chain/support/builders.js";
import { FakeSigner } from "../support/fake-signer.js";

const ISSUE = "c".repeat(64);
const PREV = "d".repeat(64);
const SEAL = "e".repeat(32);

async function withFake(
  fn: (fake: FakeSigner) => Promise<void>,
): Promise<void> {
  const fake = await FakeSigner.start();
  fake.openIssue(ISSUE);
  try {
    await fn(fake);
  } finally {
    await fake.close();
  }
}

function request(batchId: string, choices: number[]): SignRequest {
  return {
    batchId,
    issueId: ISSUE,
    firstSeq: 7,
    ts: minute(10),
    firstPrevHash: PREV,
    payloads: choices.map((choice) => ({ issue_id: ISSUE, choice })),
  };
}

test("seal_returns_the_batch_and_counts_and_the_same_seal_id_returns_the_same_batch", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: `${fake.url}/` });
    for (const c of [0, 2, 2]) fake.addEntry(ISSUE, c);
    const a = await client.seal(ISSUE, { last: false, sealId: SEAL });
    const b = await client.seal(ISSUE, { last: false, sealId: SEAL });
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.value.counts, [1, 0, 2]);
    assert.deepEqual(b.value, a.value);
  }));

test("refusals_are_definite_answers_with_their_code", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: fake.url });
    assert.deepEqual(await client.seal(ISSUE, { last: false, sealId: SEAL }), {
      ok: false,
      kind: "refused",
      code: "under_min",
    });
    const unknown = await client.seal("f".repeat(64), {
      last: true,
      sealId: SEAL.replace(/e/g, "a"),
    });
    assert.deepEqual(unknown, {
      ok: false,
      kind: "refused",
      code: "unknown_issue",
    });
  }));

test("sign_returns_the_positioned_run_and_refuses_another_position", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: fake.url });
    for (const c of [1, 0, 1]) fake.addEntry(ISSUE, c);
    const sealed = await client.seal(ISSUE, { last: false, sealId: SEAL });
    assert.ok(sealed.ok);
    const r = await client.sign(request(sealed.value.batchId, [1, 1, 0]));
    assert.ok(r.ok);
    assert.deepEqual(
      r.value.map((e) => e.seq),
      [7, 8, 9],
    );
    assert.equal(r.value[0]?.prev_hash, PREV);
    const again = await client.sign(request(sealed.value.batchId, [1, 1, 0]));
    assert.deepEqual(again, r);
    const moved = await client.sign(request(sealed.value.batchId, [0, 1, 1]));
    assert.deepEqual(moved, {
      ok: false,
      kind: "refused",
      code: "position_taken",
    });
  }));

test("an_outage_a_timeout_or_a_malformed_body_is_unavailable_never_a_throw", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: fake.url, timeoutMs: 200 });
    const seal = () => client.seal(ISSUE, { last: true, sealId: SEAL });
    for (const [fault, reason] of [
      ["fail", "http_503"],
      ["timeout", "timeout"],
      ["malformed", "malformed_body"],
    ] as const) {
      fake.inject("seal", fault);
      assert.deepEqual(await seal(), {
        ok: false,
        kind: "unavailable",
        reason,
      });
    }
    const down = createSignerClient({
      baseUrl: "http://127.0.0.1:1",
      timeoutMs: 200,
    });
    assert.deepEqual(await down.sign(request("x", [0])), {
      ok: false,
      kind: "unavailable",
      reason: "network",
    });
  }));
