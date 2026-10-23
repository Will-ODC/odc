import type { Event, Payload } from "../chain/canonical.js";

/**
 * The one client for the signer's public HTTP API (ADR-0043; paths and bodies
 * in API.md (wave 2), "Calls the ledger makes"). Every call has a timeout and
 * never throws.
 *
 * - `refused` is a definite answer: a 4xx whose body carries one of that
 *   call's documented error codes (SEAL_REFUSALS, SIGN_REFUSALS).
 * - `unavailable` is "no answer yet": a network error, timeout, 5xx, 408, 429,
 *   any 4xx without a documented code (a wrong path, a proxy), or a malformed
 *   200 body. The signer may already have acted, so the batcher keeps its
 *   saved inputs and retries them unchanged.
 * - `mismatch` (sign only): the signer answered, but its run is not the one
 *   asked for (wrong count, or a payload, seq, ts or first prev_hash differs
 *   from the request at that index). It is never appended.
 *
 * An `ok` sign result is only shape-checked and matched to the request here.
 * Its hashes and signatures are not: every line MUST still pass the EV-26
 * checker (ledger.appendRun) before anything is appended.
 */
export type SignerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: "refused"; readonly code: string }
  | {
      readonly ok: false;
      readonly kind: "unavailable" | "mismatch";
      readonly reason: string;
    };

export interface Sealed {
  readonly batchId: string;
  /** Ballots per choice; index = choice. */
  readonly counts: readonly number[];
}

export interface BallotPayload {
  readonly issue_id: string;
  readonly choice: number;
}

/** Exactly the inputs of one sign call; the batcher persists and replays it. */
export interface SignRequest {
  readonly batchId: string;
  readonly issueId: string;
  readonly firstSeq: number;
  readonly ts: string;
  readonly firstPrevHash: string;
  /** In the ledger's append order (ET-25), never arrival order. */
  readonly payloads: readonly BallotPayload[];
}

export interface SignerClient {
  seal(
    issueId: string,
    // `sealId` is ledger-proposed, not yet in ADR-0043: an idempotency key the
    // ledger saves before calling, so the same id returns the same batch and a
    // crash between the seal and saving its result strands nothing.
    options: { readonly last: boolean; readonly sealId: string },
  ): Promise<SignerResult<Sealed>>;
  sign(request: SignRequest): Promise<SignerResult<Event[]>>;
}

export interface SignerClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}

const BATCH_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The definite refusals each call documents (API.md, wave 2). */
export const SEAL_REFUSALS: ReadonlySet<string> = new Set([
  "under_min",
  "unknown_issue",
  "issue_closed",
  "seal_conflict",
]);
export const SIGN_REFUSALS: ReadonlySet<string> = new Set([
  "unknown_batch",
  "position_taken",
  "payload_mismatch",
  "counts_mismatch",
]);

/** The sign call's body, built in one fixed key order so replay is byte-identical. */
export function signRequestBody(r: SignRequest): string {
  return JSON.stringify({
    issue_id: r.issueId,
    first_seq: r.firstSeq,
    ts: r.ts,
    first_prev_hash: r.firstPrevHash,
    payloads: r.payloads.map((p) => ({
      issue_id: p.issue_id,
      choice: p.choice,
    })),
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function parseSealed(body: unknown): Sealed | null {
  if (!isRecord(body)) return null;
  const { batch_id, counts } = body;
  if (typeof batch_id !== "string" || !BATCH_ID.test(batch_id)) return null;
  if (!Array.isArray(counts) || !counts.every(isCount)) return null;
  return { batchId: batch_id, counts };
}

/**
 * Shape only. Envelope keys beyond the seven are dropped deliberately: the
 * event is rebuilt from known fields, re-serialized canonically and checked
 * (EV-26), so nothing unknown can ride through into a stored line.
 */
function parseEvent(v: unknown): Event | null {
  if (!isRecord(v) || !isRecord(v.payload)) return null;
  const { seq, type, version, ts, prev_hash, hash } = v;
  if (!isCount(seq) || !isCount(version)) return null;
  for (const s of [type, ts, prev_hash, hash]) {
    if (typeof s !== "string") return null;
  }
  const payload: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(v.payload)) {
    if (typeof x !== "string" && !isCount(x)) return null;
    payload[k] = x;
  }
  return {
    seq,
    type: type as string,
    version,
    payload: payload as Payload,
    ts: ts as string,
    prev_hash: prev_hash as string,
    hash: hash as string,
  };
}

function parseEvents(body: unknown): Event[] | null {
  if (!isRecord(body) || !Array.isArray(body.events)) return null;
  const out: Event[] = [];
  for (const v of body.events) {
    const e = parseEvent(v);
    if (e === null) return null;
    out.push(e);
  }
  return out;
}

/**
 * Why the returned run is not the one requested, or null. ADR-0043: the same
 * count, and at each index the payload sent (plus its `sig`), at seq
 * `firstSeq + i`, at `ts`, the first chained from `firstPrevHash`.
 */
function runMismatch(request: SignRequest, run: Event[]): string | null {
  if (run.length !== request.payloads.length) return "count";
  for (const [i, e] of run.entries()) {
    const sent = request.payloads[i] as BallotPayload;
    const keys = Object.keys(e.payload).sort().join(",");
    if (
      e.type !== "vote_cast" ||
      e.version !== 1 ||
      keys !== "choice,issue_id,sig" ||
      e.payload.issue_id !== sent.issue_id ||
      e.payload.choice !== sent.choice
    ) {
      return `payload ${i}`;
    }
    if (e.seq !== request.firstSeq + i || e.ts !== request.ts) {
      return `position ${i}`;
    }
  }
  if (run[0]?.prev_hash !== request.firstPrevHash) return "first prev_hash";
  return null;
}

export function createSignerClient(options: SignerClientOptions): SignerClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function post<T>(
    path: string,
    body: string,
    refusals: ReadonlySet<string>,
    parse: (b: unknown) => T | null,
  ): Promise<SignerResult<T>> {
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const name = err instanceof Error ? err.name : "error";
      return {
        ok: false,
        kind: "unavailable",
        reason: name === "TimeoutError" ? "timeout" : "network",
      };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const code = isRecord(json) ? json.error : undefined;
    if (
      res.status >= 400 &&
      res.status < 500 &&
      res.status !== 408 &&
      res.status !== 429 &&
      typeof code === "string" &&
      refusals.has(code)
    ) {
      return { ok: false, kind: "refused", code };
    }
    if (res.status !== 200) {
      return { ok: false, kind: "unavailable", reason: `http_${res.status}` };
    }
    const value = parse(json);
    return value === null
      ? { ok: false, kind: "unavailable", reason: "malformed_body" }
      : { ok: true, value };
  }

  return {
    seal(issueId, { last, sealId }) {
      return post(
        `/issues/${encodeURIComponent(issueId)}/seals`,
        // seal_id: ledger-proposed, not yet in ADR-0043 (see SignerClient).
        JSON.stringify({ seal_id: sealId, last }),
        SEAL_REFUSALS,
        parseSealed,
      );
    },
    async sign(request) {
      const r = await post(
        `/batches/${encodeURIComponent(request.batchId)}/signatures`,
        signRequestBody(request),
        SIGN_REFUSALS,
        parseEvents,
      );
      if (!r.ok) return r;
      const reason = runMismatch(request, r.value);
      return reason === null ? r : { ok: false, kind: "mismatch", reason };
    },
  };
}
