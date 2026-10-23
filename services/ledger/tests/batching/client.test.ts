import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSignerClient,
  signRequestBody,
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
      ["http_408", "http_408"],
      ["http_429", "http_429"],
      ["bare_404", "http_404"],
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

async function sealed(fake: FakeSigner, choices: number[]): Promise<string> {
  for (const c of choices) fake.addEntry(ISSUE, c);
  const client = createSignerClient({ baseUrl: fake.url });
  const r = await client.seal(ISSUE, { last: false, sealId: SEAL });
  assert.ok(r.ok);
  return r.value.batchId;
}

test("a_run_whose_payload_differs_from_the_request_is_a_mismatch", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: fake.url });
    const batchId = await sealed(fake, [0, 1, 0]);
    fake.inject("sign", "tamper_payload");
    const r = await client.sign(request(batchId, [0, 0, 1]));
    assert.deepEqual(r, { ok: false, kind: "mismatch", reason: "payload 2" });
  }));

// tamper_sig leaves the run shape-valid, so the client returns it: only the
// EV-26 checker catches it, before any append. That is tested with the
// batcher in wave 2 (tests/batching/recovery.test.ts).

test("the_same_seal_id_for_another_question_is_a_conflict", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: fake.url });
    await sealed(fake, [0, 1, 2]);
    assert.deepEqual(await client.seal(ISSUE, { last: true, sealId: SEAL }), {
      ok: false,
      kind: "refused",
      code: "seal_conflict",
    });
  }));

test("a_replayed_sign_request_sends_byte_identical_bodies", () =>
  withFake(async (fake) => {
    const client = createSignerClient({ baseUrl: fake.url });
    const batchId = await sealed(fake, [2, 1, 1]);
    const saved = request(batchId, [1, 2, 1]);
    // As read back from storage: payload keys in another order.
    const reloaded: SignRequest = {
      ...saved,
      payloads: saved.payloads.map((p) => ({
        choice: p.choice,
        issue_id: p.issue_id,
      })),
    };
    assert.equal(signRequestBody(reloaded), signRequestBody(saved));
    const a = await client.sign(saved);
    const b = await client.sign(reloaded);
    assert.ok(a.ok);
    assert.deepEqual(b, a);
    const [first, second] = fake.signBodies.get(batchId) ?? [];
    assert.equal(second, first);
  }));
