import type { Pool } from "pg";
import type { Batcher } from "../../src/batching/batcher.js";
import type { Event } from "../../src/chain/index.js";
import { Ledger } from "../../src/ledger.js";
import { buildServers, type CloseIssue } from "../../src/server/index.js";
import { withDb, type TestDb } from "../db/harness.js";
import { postJson, serving, unhashed } from "./harness.js";

export interface WriteCtx {
  db: TestDb;
  ledger: Ledger;
  /** The public port's base URL. */
  pub: string;
  /** The internal port's base URL. */
  internal: string;
  /** POST /appends with `event`'s six content fields. */
  submit: (event: Event) => Promise<Response>;
  /** The real batcher, wired as main.ts wires it, when one was asked for. */
  batcher: Batcher | null;
}

export interface WriteOptions {
  closeIssue?: CloseIssue;
  batchPending?: () => Promise<boolean>;
  /** Builds a real batcher; it then supplies closeIssue and batchPending. */
  batcher?: (ledger: Ledger, pool: Pool) => Batcher;
  clock?: () => number;
  /** Runs before the ledger opens (e.g. to corrupt the stored log). */
  before?: (db: TestDb) => Promise<void>;
}

/** Both ports on ephemeral loopback ports over a fresh database. */
export function withServers(
  fn: (ctx: WriteCtx) => Promise<void>,
  opts: WriteOptions = {},
): Promise<void> {
  return withDb(async (db) => {
    await opts.before?.(db);
    const pool: Pool = db.app;
    const ledger = await Ledger.open(pool);
    const batcher = opts.batcher?.(ledger, pool) ?? null;
    const { publicApp, internalApp } = buildServers({
      ledger,
      pool,
      closeIssue: batcher ? (id) => batcher.closeIssue(id) : opts.closeIssue,
      batchPending: batcher ? () => batcher.signPending() : opts.batchPending,
      clock: opts.clock ?? Date.now,
    });
    await serving([publicApp, internalApp], async ([pub, internal]) => {
      const base = internal as string;
      const submit = (event: Event): Promise<Response> =>
        postJson(`${base}/appends`, { event: unhashed(event) });
      const ctx = { db, ledger, pub: pub as string, internal: base, submit };
      await fn({ ...ctx, batcher });
    });
  });
}
