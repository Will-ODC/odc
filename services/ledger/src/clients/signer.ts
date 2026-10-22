import type { Event, Payload } from "../chain/canonical.js";

/**
 * The one client for the signer's public HTTP API (ADR-0043; paths and bodies
 * in API.md, "Calls the ledger makes"). Every call has a timeout and never
 * throws: a refusal (4xx with a code) is a definite answer, and anything else
 * (network error, timeout, 5xx, malformed body) is `unavailable`, which the
 * batcher treats as "no answer yet" and retries with identical inputs.
 */
export type SignerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: "refused"; readonly code: string }
  | {
      readonly ok: false;
      readonly kind: "unavailable";
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
    options: { readonly last: boolean; readonly sealId: string },
  ): Promise<SignerResult<Sealed>>;
  sign(request: SignRequest): Promise<SignerResult<Event[]>>;
}

export interface SignerClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}

const BATCH_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CODE = /^[a-z0-9_]{1,64}$/;

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

export function createSignerClient(options: SignerClientOptions): SignerClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function post<T>(
    path: string,
    body: string,
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
    if (res.status >= 400 && res.status < 500) {
      const code = isRecord(json) ? json.error : undefined;
      return {
        ok: false,
        kind: "refused",
        code:
          typeof code === "string" && CODE.test(code)
            ? code
            : `http_${res.status}`,
      };
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
        JSON.stringify({ seal_id: sealId, last }),
        parseSealed,
      );
    },
    sign(request) {
      return post(
        `/batches/${encodeURIComponent(request.batchId)}/signatures`,
        signRequestBody(request),
        parseEvents,
      );
    },
  };
}
