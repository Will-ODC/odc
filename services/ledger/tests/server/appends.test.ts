// POST /appends over real HTTP (API.md "Internal port").
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRAR, TestChain, testKey } from "../chain/support/builders.js";
import { eventRow, insertRaw, skip, ZERO_HASH } from "../db/harness.js";
import { getBytes, postJson, unhashed } from "./harness.js";
import { withServers } from "./write-harness.js";

test("appends_genesis_then_issues_and_answers_seq_and_hash", { skip }, () =>
  withServers(async ({ pub, submit }) => {
    const chain = new TestChain();
    for (let i = 0; i < 3; i++) {
      const e = chain.add(i === 0 ? chain.genesis() : chain.issue());
      const res = await submit(e);
      assert.equal(res.status, 201);
      assert.deepEqual(await res.json(), { seq: e.seq, hash: e.hash });
    }
    assert.ok((await getBytes(`${pub}/export`)).equals(chain.exportBytes()));
    const head = await (await fetch(`${pub}/head`)).json();
    assert.deepEqual(head, { seq: 3, hash: chain.head });
  }),
);

test("stale_seq_is_409_with_the_real_head", { skip }, () =>
  withServers(async ({ submit }) => {
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    await submit(g);
    for (const seq of [1, 3]) {
      const res = await submit(chain.issue({}, { seq }));
      assert.equal(res.status, 409, `seq ${seq}`);
      assert.deepEqual(await res.json(), {
        error: "stale_tail",
        head: { seq: 1, hash: g.hash },
      });
    }
  }),
);

test("stale_prev_hash_is_409_with_the_real_head", { skip }, () =>
  withServers(async ({ submit }) => {
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    assert.equal((await submit(g)).status, 201);
    const res = await submit(chain.issue({}, { prevHash: "ab".repeat(32) }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), {
      error: "stale_tail",
      head: { seq: 1, hash: g.hash },
    });
  }),
);

test("an_empty_log_answers_stale_with_the_zero_anchor", { skip }, () =>
  withServers(async ({ submit }) => {
    const chain = new TestChain();
    const res = await submit(chain.genesis({}, { seq: 2 }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), {
      error: "stale_tail",
      head: { seq: 0, hash: ZERO_HASH },
    });
  }),
);

test("two_submitters_racing_for_one_tail_get_one_201_one_409", { skip }, () =>
  withServers(async ({ submit, pub }) => {
    const chain = new TestChain();
    await submit(chain.add(chain.genesis()));
    for (let round = 0; round < 5; round++) {
      const a = chain.issue({ title: `A${round}` });
      const b = chain.issue({ title: `B${round}` });
      const [ra, rb] = await Promise.all([submit(a), submit(b)]);
      const statuses = [ra.status, rb.status].sort();
      assert.deepEqual(statuses, [201, 409], `round ${round}`);
      chain.add(ra.status === 201 ? a : b);
    }
    assert.ok((await getBytes(`${pub}/export`)).equals(chain.exportBytes()));
  }),
);

test("ballots_and_registrations_are_type_not_accepted", { skip }, () =>
  withServers(async ({ submit }) => {
    const chain = new TestChain();
    await submit(chain.add(chain.genesis()));
    const issue = chain.add(chain.issue());
    await submit(issue);
    const vote = chain.vote(issue.hash, 0, "2026-07-21T00:10:00.000Z");
    const participant = chain.participant(testKey(0x07));
    for (const e of [vote, participant]) {
      const res = await submit(e);
      assert.equal(res.status, 422, e.type);
      assert.deepEqual(await res.json(), { error: "type_not_accepted" });
    }
  }),
);

test("a_bad_signature_is_422_rejected", { skip }, () =>
  withServers(async ({ submit, pub }) => {
    const chain = new TestChain();
    await submit(chain.add(chain.genesis()));
    // Signed by the registrar, not the operator (ET-13).
    const res = await submit(chain.issue({}, { signer: REGISTRAR }));
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: string; reason: string };
    assert.equal(body.error, "rejected");
    assert.match(body.reason, /ET-13/);
    assert.ok((await getBytes(`${pub}/export`)).equals(chain.exportBytes()));
  }),
);

test("an_event_type_rule_breach_is_422_rejected", { skip }, () =>
  withServers(async ({ submit }) => {
    const chain = new TestChain();
    await submit(chain.add(chain.genesis()));
    const res = await submit(chain.issue({ choice_count: 1 }));
    assert.equal(res.status, 422);
    const body = (await res.json()) as { error: string; reason: string };
    assert.equal(body.error, "rejected");
    assert.match(body.reason, /^ET-14a:/);
    // An unregistered type is refused the same way (EV-26).
    const odd = await submit(chain.make("tally_note", { n: 1 }));
    assert.equal(odd.status, 422);
    assert.equal(((await odd.json()) as { error: string }).error, "rejected");
  }),
);

test(
  "unencodable_event_values_are_422_and_leave_the_head_unchanged",
  { skip },
  () =>
    withServers(async ({ internal, pub, submit }) => {
      const chain = new TestChain();
      await submit(chain.add(chain.genesis()));
      const e = unhashed(chain.issue());
      const invalid = [
        { ...e, version: -1 },
        ...[-1, 1.5, 2 ** 53].map((n) => ({
          ...e,
          payload: { ...e.payload, n },
        })),
        { ...e, payload: { ...e.payload, title: "\ud800" } },
      ];
      for (const event of invalid) {
        const res = await postJson(`${internal}/appends`, { event });
        assert.equal(res.status, 422);
        assert.equal(
          ((await res.json()) as { error: string }).error,
          "rejected",
        );
        assert.deepEqual(await (await fetch(`${pub}/head`)).json(), {
          seq: 1,
          hash: chain.head,
        });
        assert.ok(
          (await getBytes(`${pub}/export`)).equals(chain.exportBytes()),
        );
      }
      assert.equal((await submit(chain.issue())).status, 201);
    }),
);

test("a_corrupted_stored_log_is_422_chain_not_valid", { skip }, () => {
  const chain = new TestChain();
  const g = chain.add(chain.genesis());
  return withServers(
    async ({ submit }) => {
      const res = await submit(
        chain.issue({}, { seq: 3, prevHash: "cd".repeat(32) }),
      );
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: "chain_not_valid" });
    },
    {
      before: async ({ owner }) => {
        const line = Buffer.from(chain.lines()[0] as Uint8Array).toString();
        await insertRaw(owner, {
          seq: 1,
          type: g.type,
          version: g.version,
          ts: g.ts,
          prevHash: g.prev_hash,
          hash: g.hash,
          line,
        });
        // Linked by hash, but not a registered event: the log is not VALID.
        await insertRaw(owner, eventRow(2, g.hash, { hash: "cd".repeat(32) }));
      },
    },
  );
});

test("malformed_bodies_are_400_bad_request", { skip }, () =>
  withServers(async ({ internal }) => {
    const chain = new TestChain();
    const g = unhashed(chain.genesis());
    const bodies: unknown[] = [
      [],
      "null",
      "{not json",
      {},
      { event: g, extra: 1 },
      { event: [] },
      { event: { ...g, hash: "00".repeat(32) } },
      { event: { ...g, seq: "1" } },
      { event: { ...g, seq: 2 ** 53 } },
      { event: { ...g, version: 1.5 } },
      { event: { ...g, payload: [] } },
      { event: { ...g, payload: { ...g.payload, nested: { a: 1 } } } },
      { event: { ...g, payload: { ...g.payload, flag: true } } },
      { event: { ...g, ts: 0 } },
      { event: { ...g, ts: undefined } }, // JSON drops it: a missing key
    ];
    for (const body of bodies) {
      const res = await postJson(`${internal}/appends`, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(await res.json(), { error: "bad_request" });
    }
    const xml = await fetch(`${internal}/appends`, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: "<event/>",
    });
    assert.equal(xml.status, 415);
    assert.deepEqual(await xml.json(), { error: "unsupported_media_type" });
    const huge = await postJson(`${internal}/appends`, {
      event: { ...g, payload: { title: "x".repeat(200_000) } },
    });
    assert.equal(huge.status, 413);
    assert.deepEqual(await huge.json(), { error: "payload_too_large" });
  }),
);

test("the_public_port_has_no_write_routes", { skip }, () =>
  withServers(async ({ pub }) => {
    const chain = new TestChain();
    const g = chain.genesis();
    const appends = await postJson(`${pub}/appends`, { event: unhashed(g) });
    assert.equal(appends.status, 404);
    const close = await postJson(`${pub}/issues/${"a".repeat(64)}/close`, {
      ts: g.ts,
      sig: "0".repeat(128),
    });
    assert.equal(close.status, 404);
  }),
);
