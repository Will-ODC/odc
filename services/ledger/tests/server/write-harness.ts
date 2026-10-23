import type { Pool } from "pg";
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
}

export interface WriteOptions {
  closeIssue?: CloseIssue;
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
    const { publicApp, internalApp } = buildServers({
      ledger,
      pool,
      closeIssue: opts.closeIssue,
      clock: opts.clock ?? Date.now,
    });
    await serving([publicApp, internalApp], async ([pub, internal]) => {
      const base = internal as string;
      const submit = (event: Event): Promise<Response> =>
        postJson(`${base}/appends`, { event: unhashed(event) });
      await fn({ db, ledger, pub: pub as string, internal: base, submit });
    });
  });
}
