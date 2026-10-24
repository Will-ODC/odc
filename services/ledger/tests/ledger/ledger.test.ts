import assert from "node:assert/strict";
import { test } from "node:test";
import {
  serializeLine,
  type Event,
  type UnhashedEvent,
} from "../../src/chain/index.js";
import type { EventRow } from "../../src/db/events.js";
import { AppendRefused, ChainNotValid, Ledger } from "../../src/ledger.js";
import { readSince } from "../../src/db/events.js";
import { TestChain, testKey } from "../chain/support/builders.js";
import { insertRaw, skip, withDb } from "../db/harness.js";

function row(e: Event): EventRow {
  return {
    seq: e.seq,
    type: e.type,
    version: e.version,
    ts: e.ts,
    prevHash: e.prev_hash,
    hash: e.hash,
    line: Buffer.from(serializeLine(e)).toString("utf8"),
  };
}

function unhashed(e: Event): UnhashedEvent {
  return {
    seq: e.seq,
    type: e.type,
    version: e.version,
    payload: e.payload,
    ts: e.ts,
    prev_hash: e.prev_hash,
  };
}

test("appends_verified_events_and_stores_canonical_lines", { skip }, () =>
  withDb(async ({ app }) => {
    const ledger = await Ledger.open(app);
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    const i = chain.add(chain.issue());
    const stored = await ledger.appendRun(() => [unhashed(g), unhashed(i)]);
    assert.deepEqual(
      stored.map((e) => e.hash),
      [g.hash, i.hash],
    );
    assert.equal(ledger.state.nextSeq, 3);
    assert.equal(ledger.state.headHash, i.hash);
    const rows = await readSince(app, 0, 10);
    const lines = chain.lines().map((l) => Buffer.from(l).toString("utf8"));
    assert.deepEqual(
      rows.map((r) => r.line),
      lines,
    );
    const reopened = await Ledger.open(app);
    assert.equal(reopened.state.headHash, i.hash);
    assert.equal(reopened.notValid, null);
  }),
);

test("refuses_a_run_with_a_bad_event_and_appends_none_of_it", { skip }, () =>
  withDb(async ({ app }) => {
    const ledger = await Ledger.open(app);
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    const bad = chain.issue({}, { sig: "00".repeat(64) });
    await assert.rejects(
      ledger.appendRun(() => [unhashed(g), unhashed(bad)]),
      (err: unknown) => err instanceof AppendRefused && err.index === 1,
    );
    assert.equal((await readSince(app, 0, 10)).length, 0);
    assert.equal(ledger.state.nextSeq, 1);
  }),
);

test("a_stored_log_that_is_not_valid_bars_every_append", { skip }, () =>
  withDb(async ({ owner, app }) => {
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    const bad = chain.add(chain.issue({}, { sig: "00".repeat(64) }));
    for (const e of [g, bad]) await insertRaw(owner, row(e));
    const ledger = await Ledger.open(app);
    assert.ok(ledger.notValid instanceof ChainNotValid);
    assert.equal(ledger.notValid.line, 2);
    await assert.rejects(
      ledger.appendRun(() => []),
      ChainNotValid,
    );
  }),
);

test("a_second_run_waits_for_the_first_and_builds_on_its_state", { skip }, () =>
  withDb(async ({ app }) => {
    const ledger = await Ledger.open(app);
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    const i = chain.add(chain.issue());
    const p = chain.add(chain.participant(testKey(0x10)));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inFirst = new Promise<void>((r) => (entered = r));
    const first = ledger.appendRun(async () => {
      entered();
      await gate;
      return [unhashed(g), unhashed(i)];
    });
    await inFirst;
    const seen: [number, string, number | undefined][] = [];
    const second = ledger.appendRun((state, head) => {
      seen.push([state.nextSeq, state.headHash, head?.seq]);
      return [unhashed(p)];
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(seen, [], "second build ran early");
    release();
    await Promise.all([first, second]);
    assert.deepEqual(seen, [[3, i.hash, 2]]);
    const rows = await readSince(app, 0, 10);
    // Each hash covers seq and prev_hash, so equal hashes mean contiguous.
    assert.deepEqual(
      rows.map((r) => r.hash),
      [g, i, p].map((e) => e.hash),
    );
  }),
);

test("a_head_moved_by_an_outside_insert_refuses_the_next_run", { skip }, () =>
  withDb(async ({ owner, app }) => {
    const ledger = await Ledger.open(app);
    const chain = new TestChain();
    const g = chain.add(chain.genesis());
    const i = chain.add(chain.issue());
    const p = chain.add(chain.participant(testKey(0x10)));
    await ledger.appendRun(() => [unhashed(g)]);
    await insertRaw(owner, row(i));
    let built = false;
    await assert.rejects(
      ledger.appendRun(() => {
        built = true;
        return [unhashed(p)];
      }),
      /stored head moved/,
    );
    assert.equal(built, false);
    assert.equal((await readSince(app, 0, 10)).length, 2);
  }),
);
