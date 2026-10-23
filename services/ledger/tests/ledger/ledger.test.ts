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
import { TestChain } from "../chain/support/builders.js";
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
