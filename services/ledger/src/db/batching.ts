import type { Pool } from "pg";
import type { SignRequest } from "../clients/signer.js";

/**
 * The batcher's records (migrations/002_batching.sql), as the runtime role.
 * Insert and select only: where a batch stands is derived from which rows
 * exist. Every insert autocommits on its own pool connection, so a row is
 * durable before the call it precedes, even while the writer lock is held.
 */
export interface SealIntent {
  readonly sealId: string;
  readonly issueId: string;
  readonly last: boolean;
  readonly instantMs: number;
}

export interface SealedBatch extends SealIntent {
  readonly batchId: string;
  readonly counts: readonly number[];
}

/** Where one issue's batching stands. */
export interface IssueProgress {
  /** A seal asked for with no answer recorded yet (at most one is live). */
  readonly intent: SealIntent | null;
  /** The earliest sealed batch not yet complete, in seal (instant) order. */
  readonly sealed: SealedBatch | null;
  /** Its stored sign request, if one was made. */
  readonly request: SignRequest | null;
  /** The latest instant any seal of this issue has had, or null. */
  readonly lastInstantMs: number | null;
  readonly closeRequested: boolean;
  /** The issue's last batch is complete: it is never sealed again. */
  readonly closed: boolean;
}

export async function insertSealIntent(
  pool: Pool,
  i: SealIntent,
): Promise<void> {
  await pool.query(
    "INSERT INTO batch_seal_intents (seal_id, issue_id, last, instant_ms) VALUES ($1, $2, $3, $4)",
    [i.sealId, i.issueId, i.last, i.instantMs],
  );
}

export async function insertSealResult(
  pool: Pool,
  sealId: string,
  batchId: string,
  counts: readonly number[],
): Promise<void> {
  await pool.query(
    "INSERT INTO batch_seal_results (seal_id, batch_id, counts) VALUES ($1, $2, $3)",
    [sealId, batchId, counts],
  );
}

export async function insertSealRefusal(
  pool: Pool,
  sealId: string,
  code: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO batch_seal_refusals (seal_id, code) VALUES ($1, $2)",
    [sealId, code],
  );
}

export async function insertSignRequest(
  pool: Pool,
  r: SignRequest,
): Promise<void> {
  // Only each choice is stored; issue_id is rebuilt from the request on read.
  if (r.payloads.some((p) => p.issue_id !== r.issueId)) {
    throw new Error(
      "every payload's issue_id must equal the request's issueId",
    );
  }
  await pool.query(
    `INSERT INTO batch_sign_requests (batch_id, issue_id, first_seq, ts, first_prev_hash, choices)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      r.batchId,
      r.issueId,
      r.firstSeq,
      r.ts,
      r.firstPrevHash,
      r.payloads.map((p) => p.choice),
    ],
  );
}

/**
 * Commits on its own, after the run's transaction, by design: a crash between
 * the two leaves the request pending, and recovery checks the log for the run
 * first (the batcher's `alreadyAppended`), then records only this row.
 */
export async function insertCompletion(
  pool: Pool,
  batchId: string,
  appended: boolean,
): Promise<void> {
  await pool.query(
    "INSERT INTO batch_completions (batch_id, appended) VALUES ($1, $2)",
    [batchId, appended],
  );
}

/** Idempotent: a second close of the same issue records nothing new. */
export async function insertCloseIntent(
  pool: Pool,
  issueId: string,
): Promise<void> {
  await pool.query(
    "INSERT INTO batch_issue_closes (issue_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [issueId],
  );
}

interface RequestRow {
  batch_id: string;
  issue_id: string;
  first_seq: string;
  ts: string;
  first_prev_hash: string;
  choices: number[];
}

function toRequest(r: RequestRow): SignRequest {
  return {
    batchId: r.batch_id,
    issueId: r.issue_id,
    firstSeq: Number(r.first_seq),
    ts: r.ts,
    firstPrevHash: r.first_prev_hash,
    payloads: r.choices.map((choice) => ({ issue_id: r.issue_id, choice })),
  };
}

const NOT_COMPLETE =
  "NOT EXISTS (SELECT 1 FROM batch_completions c WHERE c.batch_id = s.batch_id)";

/** Every sign request without a completion, in log position order. */
export async function pendingSignRequests(pool: Pool): Promise<SignRequest[]> {
  const { rows } = await pool.query<RequestRow>(
    `SELECT s.* FROM batch_sign_requests s WHERE ${NOT_COMPLETE} ORDER BY s.first_seq`,
  );
  return rows.map(toRequest);
}

interface IntentRow {
  seal_id: string;
  issue_id: string;
  last: boolean;
  instant_ms: string;
}

function toIntent(r: IntentRow): SealIntent {
  return {
    sealId: r.seal_id,
    issueId: r.issue_id,
    last: r.last,
    instantMs: Number(r.instant_ms),
  };
}

export async function issueProgress(
  pool: Pool,
  issueId: string,
): Promise<IssueProgress> {
  const intents = await pool.query<IntentRow>(
    `SELECT i.* FROM batch_seal_intents i
      WHERE i.issue_id = $1
        AND NOT EXISTS (SELECT 1 FROM batch_seal_results r WHERE r.seal_id = i.seal_id)
        AND NOT EXISTS (SELECT 1 FROM batch_seal_refusals f WHERE f.seal_id = i.seal_id)
      ORDER BY i.instant_ms LIMIT 1`,
    [issueId],
  );
  const sealed = await pool.query<
    IntentRow & { batch_id: string; counts: number[] }
  >(
    `SELECT i.*, s.batch_id, s.counts FROM batch_seal_results s
       JOIN batch_seal_intents i USING (seal_id)
      WHERE i.issue_id = $1 AND ${NOT_COMPLETE}
      ORDER BY i.instant_ms LIMIT 1`,
    [issueId],
  );
  const facts = await pool.query<{
    last_instant: string | null;
    close_requested: boolean;
    closed: boolean;
  }>(
    `SELECT
       (SELECT max(instant_ms) FROM batch_seal_intents WHERE issue_id = $1) AS last_instant,
       EXISTS (SELECT 1 FROM batch_issue_closes WHERE issue_id = $1) AS close_requested,
       EXISTS (SELECT 1 FROM batch_seal_intents i
                 JOIN batch_seal_results s USING (seal_id)
                 JOIN batch_completions c USING (batch_id)
                WHERE i.issue_id = $1 AND i.last) AS closed`,
    [issueId],
  );
  const s = sealed.rows[0];
  let request: SignRequest | null = null;
  if (s !== undefined) {
    const r = await pool.query<RequestRow>(
      "SELECT * FROM batch_sign_requests WHERE batch_id = $1",
      [s.batch_id],
    );
    request = r.rows[0] === undefined ? null : toRequest(r.rows[0]);
  }
  const f = facts.rows[0];
  const intent = intents.rows[0];
  return {
    intent: intent === undefined ? null : toIntent(intent),
    sealed:
      s === undefined
        ? null
        : { ...toIntent(s), batchId: s.batch_id, counts: s.counts },
    request,
    lastInstantMs:
      f?.last_instant === null || f === undefined
        ? null
        : Number(f.last_instant),
    closeRequested: f?.close_requested ?? false,
    closed: f?.closed ?? false,
  };
}
