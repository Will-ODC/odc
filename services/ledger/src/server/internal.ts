import type { FastifyInstance } from "fastify";
import {
  HEX64,
  HEX128,
  MAX_LINE_BYTES,
  ZERO_HASH,
  isValidTs,
  tsToEpochMs,
  verifySignature,
  type Payload,
  type UnhashedEvent,
} from "../chain/index.js";
import type { Head } from "../db/events.js";
import { UnknownIssue } from "../batching/batcher.js";
import { AppendRefused, ChainNotValid, type Ledger } from "../ledger.js";
import { createApp, type ServerLogger } from "./http.js";

/**
 * Seals an issue's open batch as its last (ET-24, ET-25). Supplied by the
 * batching module; "closing" while the last batch is in flight, "closed" once
 * appended or if the issue was already closed.
 */
export type CloseIssue = (issueId: string) => Promise<"closing" | "closed">;

export interface InternalDeps {
  ledger: Ledger;
  /** Absent in a process with no running batcher: close then answers 503. */
  closeIssue?: CloseIssue | undefined;
  /**
   * True while a stored sign request has no appended run. An operator append
   * would move the tail past the one position that batch is signed for and
   * strand its ballots, so /appends answers 503 until it is appended.
   */
  batchPending?: (() => Promise<boolean>) | undefined;
  /** Milliseconds since the epoch; the close call's `ts` window. */
  clock?: () => number;
  logger?: ServerLogger;
}

/** API.md: a close signature's `ts` must be this close to the clock. */
export const CLOSE_WINDOW_MS = 5 * 60 * 1000;

export const CLOSE_DOMAIN = "ODC-LEDGER-CLOSE-ISSUE-v1";

/** The exact bytes an operator signs to close an issue (API.md). */
export function closeMessage(
  genesisHash: string,
  issueId: string,
  ts: string,
): Uint8Array {
  return Buffer.from(
    `${CLOSE_DOMAIN}\n${genesisHash}\n${issueId}\n${ts}`,
    "utf8",
  );
}

/** Types the internal port refuses outright (API.md, ADR-0043 decision 2). */
const NOT_ACCEPTED = new Set(["vote_cast", "participant_registered"]);

const EVENT_KEYS = ["payload", "prev_hash", "seq", "ts", "type", "version"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sameKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o).sort();
  return own.length === keys.length && own.every((k, i) => k === keys[i]);
}

/**
 * The submitted event, or null when the body is not `{ "event": {...} }` with
 * exactly the six content fields of the right JSON types. Values are checked
 * against the contracts later, by the EV-26 checker, not here.
 */
function parseAppend(body: unknown): UnhashedEvent | null {
  if (!isObject(body) || !sameKeys(body, ["event"])) return null;
  const e = body.event;
  if (!isObject(e) || !sameKeys(e, EVENT_KEYS)) return null;
  const { seq, type, version, payload, ts, prev_hash } = e;
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(version)) {
    return null;
  }
  if (typeof type !== "string" || typeof ts !== "string") return null;
  if (typeof prev_hash !== "string" || !isObject(payload)) return null;
  for (const v of Object.values(payload)) {
    if (typeof v !== "string" && typeof v !== "number") return null;
  }
  return {
    seq: seq as number,
    type,
    version: version as number,
    payload: payload as Payload,
    ts,
    prev_hash,
  };
}

class BatchPending extends Error {}

class StaleTail extends Error {
  constructor(readonly head: Head) {
    super("stale tail");
  }
}

/**
 * The internal port: the operator's conditional append and close call. No
 * session or token: every request carries a signature checked against keys on
 * the log. Bind it to a private network only.
 */
export function buildInternalApp(deps: InternalDeps): FastifyInstance {
  const { ledger, closeIssue, batchPending } = deps;
  const clock = deps.clock ?? Date.now;
  // One event line is at most 65536 bytes (EV-25); its JSON request wrapper
  // may escape a little more, so allow twice that.
  const app = createApp(deps.logger, 2 * MAX_LINE_BYTES);

  app.post("/appends", async (req, reply) => {
    const event = parseAppend(req.body);
    if (event === null) return reply.code(400).send({ error: "bad_request" });
    if (NOT_ACCEPTED.has(event.type)) {
      return reply.code(422).send({ error: "type_not_accepted" });
    }
    try {
      const [stored] = await ledger.appendRun(async (_state, head) => {
        // Under the writer lock, so no sign request can appear in between.
        if (batchPending !== undefined && (await batchPending())) {
          throw new BatchPending();
        }
        // Conditional on the tail, checked inside the writer's lock so the
        // check and the insert cannot be split by another append.
        const tail: Head = head ?? { seq: 0, hash: ZERO_HASH };
        if (event.seq !== tail.seq + 1 || event.prev_hash !== tail.hash) {
          throw new StaleTail(tail);
        }
        return [event];
      });
      return reply.code(201).send({ seq: stored?.seq, hash: stored?.hash });
    } catch (err) {
      if (err instanceof BatchPending) {
        return reply.code(503).send({ error: "batch_pending" });
      }
      if (err instanceof StaleTail) {
        return reply.code(409).send({ error: "stale_tail", head: err.head });
      }
      if (err instanceof ChainNotValid) {
        return reply.code(422).send({ error: "chain_not_valid" });
      }
      if (err instanceof AppendRefused) {
        const { rule, reason } = err.refusal;
        return reply
          .code(422)
          .send({ error: "rejected", reason: `${rule}: ${reason}` });
      }
      throw err;
    }
  });

  app.post<{ Params: { issue_id: string } }>(
    "/issues/:issue_id/close",
    { bodyLimit: 1024 },
    async (req, reply) => {
      const body = req.body;
      if (
        !isObject(body) ||
        !sameKeys(body, ["sig", "ts"]) ||
        typeof body.ts !== "string" ||
        typeof body.sig !== "string"
      ) {
        return reply.code(400).send({ error: "bad_request" });
      }
      const { ts, sig } = body;
      if (
        !isValidTs(ts) ||
        Math.abs(clock() - tsToEpochMs(ts)) > CLOSE_WINDOW_MS
      ) {
        return reply.code(400).send({ error: "bad_ts" });
      }
      const issueId = req.params.issue_id;
      const genesis = ledger.state.genesis;
      if (genesis === null || !HEX64.test(issueId)) {
        return reply.code(404).send({ error: "unknown_issue" });
      }
      const message = closeMessage(genesis.genesisHash, issueId, ts);
      if (
        !HEX128.test(sig) ||
        !verifySignature(genesis.operator, message, sig).ok
      ) {
        return reply.code(401).send({ error: "bad_signature" });
      }
      if (!ledger.state.issues.has(issueId)) {
        return reply.code(404).send({ error: "unknown_issue" });
      }
      if (closeIssue === undefined) {
        return reply.code(503).send({ error: "batching_unavailable" });
      }
      let status: "closing" | "closed";
      try {
        status = await closeIssue(issueId);
      } catch (err) {
        if (err instanceof UnknownIssue) {
          return reply.code(404).send({ error: "unknown_issue" });
        }
        throw err;
      }
      return reply.code(status === "closing" ? 202 : 200).send({ status });
    },
  );

  return app;
}
