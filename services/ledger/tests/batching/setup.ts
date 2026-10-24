import type { Pool } from "pg";
import {
  tsToEpochMs,
  verifyExport,
  type Event,
  type UnhashedEvent,
} from "../../src/chain/index.js";
import { Batcher, type BatcherOptions } from "../../src/batching/batcher.js";
import {
  createSignerClient,
  type SignerClient,
} from "../../src/clients/signer.js";
import { exportLines, readSince } from "../../src/db/events.js";
import { Ledger } from "../../src/ledger.js";
import {
  GENESIS_TS,
  TestChain,
  type RawPayload,
} from "../chain/support/builders.js";
import { FakeSigner } from "../support/fake-signer.js";

export function unhashed(e: Event): UnhashedEvent {
  return {
    seq: e.seq,
    type: e.type,
    version: e.version,
    payload: e.payload,
    ts: e.ts,
    prev_hash: e.prev_hash,
  };
}

/** Ten and a half minutes after genesis: well past the issues' timestamps. */
export const START_MS = tsToEpochMs(GENESIS_TS) + 10 * 60000 + 30000;

export interface World {
  ledger: Ledger;
  fake: FakeSigner;
  client: SignerClient;
  chain: TestChain;
  issueIds: string[];
  clock: { now: number };
  logs: string[];
  batcher: (over?: Partial<BatcherOptions>) => Batcher;
  /** A new process on the same database: a fresh Ledger and Batcher. */
  restart: () => Promise<Batcher>;
  events: () => Promise<Event[]>;
  exportValid: () => Promise<boolean>;
}

/** Genesis and `issues` issue_created events on a fresh log, plus a fake signer. */
export async function world(
  app: Pool,
  issues: RawPayload[] = [{}],
  fn: (w: World) => Promise<void>,
): Promise<void> {
  const ledger = await Ledger.open(app);
  const chain = new TestChain();
  const built = [chain.add(chain.genesis())];
  for (const over of issues) built.push(chain.add(chain.issue(over)));
  await ledger.appendRun(() => built.map(unhashed));
  const issueIds = built.slice(1).map((e) => e.hash);
  const fake = await FakeSigner.start();
  issueIds.forEach((id, i) =>
    fake.openIssue(
      id,
      Number(issues[i]?.choice_count ?? 3),
      Number(issues[i]?.ballot_batch_min ?? 3),
    ),
  );
  const client = createSignerClient({ baseUrl: fake.url, timeoutMs: 300 });
  const clock = { now: START_MS };
  const logs: string[] = [];
  const w: World = {
    ledger,
    fake,
    client,
    chain,
    issueIds,
    clock,
    logs,
    batcher: (over = {}) =>
      new Batcher({
        ledger,
        pool: app,
        signer: client,
        clock: () => clock.now,
        log: (l) => logs.push(l),
        ...over,
      }),
    restart: async () => w.batcher({ ledger: await Ledger.open(app) }),
    events: async () => {
      const rows = await readSince(app, 0, 1000);
      return rows.map((r) => JSON.parse(r.line) as Event);
    },
    exportValid: async () => {
      let text = "";
      for await (const line of exportLines(app)) text += line;
      return verifyExport(new TextEncoder().encode(text)).ok;
    },
  };
  try {
    await fn(w);
  } finally {
    await fake.close();
  }
}

export function votes(events: Event[], issueId?: string): Event[] {
  return events.filter(
    (e) =>
      e.type === "vote_cast" &&
      (issueId === undefined || e.payload.issue_id === issueId),
  );
}

export function fill(
  fake: FakeSigner,
  issueId: string,
  choices: number[],
): void {
  for (const c of choices) fake.addEntry(issueId, c);
}

export async function count(app: Pool, table: string): Promise<number> {
  const r = await app.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table}`,
  );
  return Number(r.rows[0]?.n);
}
