import { randomBytes, randomInt } from "node:crypto";
import type { Pool } from "pg";
import {
  ZERO_HASH,
  computeHash,
  epochMsToTs,
  parseLine,
  tsToEpochMs,
  type Event,
  type IssueState,
  type UnhashedEvent,
} from "../chain/index.js";
import type { SignRequest, SignerClient } from "../clients/signer.js";
import {
  insertCloseIntent,
  insertCompletion,
  insertSealIntent,
  insertSealRefusal,
  insertSealResult,
  insertSignRequest,
  issueProgress,
  pendingSignRequests,
  type SealIntent,
  type SealedBatch,
} from "../db/batching.js";
import { readSince } from "../db/events.js";
import type { BuildRun } from "../ledger.js";

/**
 * The producer side of ballot batching (ET-23 to ET-25, ADR-0043 "How the
 * append is coordinated"). Per open issue it decides when to seal and at which
 * batch instant, asks the signer to seal, orders the batch by a cryptographic
 * shuffle, asks the signer to sign the run at the tail, and appends it whole
 * through the single writer. Every step is recorded before the call it
 * precedes (src/db/batching.ts), so `recover()` can finish it after a crash.
 *
 * ET-21a: nothing here returns or logs anything that singles out a ballot. Log
 * lines name only the issue, the batch id and a reason code.
 */
export interface BatcherLedger {
  readonly state: { readonly issues: ReadonlyMap<string, IssueState> };
  appendRun(build: BuildRun): Promise<Event[]>;
}

export interface BatcherOptions {
  readonly ledger: BatcherLedger;
  readonly pool: Pool;
  readonly signer: SignerClient;
  /** Milliseconds since the epoch. */
  readonly clock?: () => number;
  /** A uniform integer in [0, n). Tests inject it; production uses crypto. */
  readonly random?: (n: number) => number;
  readonly log?: (line: string) => void;
  /** How often `start()` ticks. */
  readonly tickMs?: number;
}

export type CloseStatus = "closing" | "closed";

export class UnknownIssue extends Error {
  constructor(readonly issueId: string) {
    super(`no issue_created with id ${issueId}`);
  }
}

/** A step that did not complete; its records stay pending and are retried. */
class Pending extends Error {}

/** Fisher-Yates with the given source of uniform integers. ET-25: not arrival order. */
export function shuffle<T>(
  items: readonly T[],
  random: (n: number) => number,
): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

const PAYLOAD_KEYS = "choice,issue_id,sig";

/** Checks a signed run against the request; returns the events to append. */
function checkRun(req: SignRequest, events: readonly Event[]): UnhashedEvent[] {
  if (events.length !== req.payloads.length) {
    throw new Pending("signed run has the wrong length");
  }
  return events.map((e, i) => {
    const sent = req.payloads[i];
    const prev = i === 0 ? req.firstPrevHash : events[i - 1]?.hash;
    const ok =
      sent !== undefined &&
      e.seq === req.firstSeq + i &&
      e.type === "vote_cast" &&
      e.version === 1 &&
      e.ts === req.ts &&
      e.prev_hash === prev &&
      Object.keys(e.payload).sort().join(",") === PAYLOAD_KEYS &&
      e.payload.issue_id === sent.issue_id &&
      e.payload.choice === sent.choice &&
      typeof e.payload.sig === "string";
    if (!ok) throw new Pending(`signed event ${i} differs from the request`);
    const unhashed: UnhashedEvent = {
      seq: e.seq,
      type: e.type,
      version: e.version,
      payload: e.payload,
      ts: e.ts,
      prev_hash: e.prev_hash,
    };
    if (computeHash(unhashed) !== e.hash) {
      throw new Pending(`signed event ${i} hash does not match`);
    }
    return unhashed;
  });
}

export class Batcher {
  private readonly ledger: BatcherLedger;
  private readonly pool: Pool;
  private readonly signer: SignerClient;
  private readonly clock: () => number;
  private readonly random: (n: number) => number;
  private readonly log: (line: string) => void;
  private readonly tickMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(o: BatcherOptions) {
    this.ledger = o.ledger;
    this.pool = o.pool;
    this.signer = o.signer;
    this.clock = o.clock ?? Date.now;
    this.random = o.random ?? ((n) => randomInt(n));
    this.log = o.log ?? ((line) => console.error(line));
    this.tickMs = o.tickMs ?? 1000;
  }

  /**
   * Finishes every incomplete step, in order, and starts nothing new. Call it
   * before anything else appends. True when nothing is left pending.
   */
  recover(): Promise<boolean> {
    return this.serial(() => this.run(false));
  }

  /** Finishes pending steps, then seals every open issue whose instant has come. */
  tick(): Promise<boolean> {
    return this.serial(() => this.run(true));
  }

  /** Seals the issue's open batch as its last and appends it (ET-24, ET-25). */
  async closeIssue(issueId: string): Promise<CloseStatus> {
    const issue = this.ledger.state.issues.get(issueId);
    if (issue === undefined) throw new UnknownIssue(issueId);
    await insertCloseIntent(this.pool, issueId);
    return this.serial(async () => {
      if (!(await this.replayAll())) return "closing";
      return (await this.advance(issue, false)) &&
        (await issueProgress(this.pool, issueId)).closed
        ? "closed"
        : "closing";
    });
  }

  /**
   * True while a stored sign request has no appended run. Its batch is signed
   * at that one position, so any other append (an operator's included) would
   * strand it: callers must refuse to append until this is false (ADR-0043).
   */
  async signPending(): Promise<boolean> {
    return (await pendingSignRequests(this.pool)).length > 0;
  }

  start(): void {
    if (this.timer !== null) return;
    const loop = (): void => {
      this.timer = setTimeout(() => {
        void this.tick().finally(() => {
          if (this.timer !== null) loop();
        });
      }, this.tickMs);
    };
    loop();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.queue;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async run(newSeals: boolean): Promise<boolean> {
    try {
      if (!(await this.replayAll())) return false;
      let done = true;
      for (const issue of this.ledger.state.issues.values()) {
        if (!(await this.advance(issue, newSeals))) done = false;
      }
      return done;
    } catch (err) {
      this.log(
        `batcher: step failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * A stored sign request fixes its batch at one position, so nothing else may
   * be appended until it is (ADR-0043). False while any stays pending.
   */
  private async replayAll(): Promise<boolean> {
    for (const req of await pendingSignRequests(this.pool)) {
      if (!(await this.replay(req))) return false;
    }
    return true;
  }

  /** Moves one issue forward as far as it can go now. False if blocked. */
  private async advance(
    start: IssueState,
    newSeals: boolean,
  ): Promise<boolean> {
    let mayStart = newSeals;
    for (let step = 0; step < 8; step++) {
      // Re-read each step: an append moves the issue's used instants.
      const issue = this.ledger.state.issues.get(start.issueId) ?? start;
      const p = await issueProgress(this.pool, issue.issueId);
      if (p.closed) return true;
      if (p.sealed !== null) {
        const ok =
          p.request !== null
            ? await this.replay(p.request)
            : await this.appendSealed(issue, p.sealed);
        if (!ok) return false;
        continue;
      }
      if (p.intent !== null) {
        const r = await this.seal(issue, p.intent);
        if (r === "unavailable") return false;
        if (r === "refused" && !p.closeRequested) return true;
        continue;
      }
      const instant = this.chooseInstant(
        issue,
        p.lastInstantMs,
        p.closeRequested,
      );
      if (p.closeRequested || (mayStart && instant !== null)) {
        await insertSealIntent(this.pool, {
          sealId: randomBytes(16).toString("hex"),
          issueId: issue.issueId,
          last: p.closeRequested,
          instantMs: instant as number,
        });
        mayStart = false;
        continue;
      }
      return true;
    }
    return false;
  }

  /**
   * ET-23 and ET-24a: the issue's quantized now, unless an earlier seal of the
   * issue already had that instant or a later one (the clock stepped back, or
   * this interval was already tried). Then a tick holds (null), and a last
   * seal, which cannot wait, advances one interval past the latest.
   */
  private chooseInstant(
    issue: IssueState,
    lastSealMs: number | null,
    force: boolean,
  ): number | null {
    const iv = issue.ballotBatchIntervalMs;
    const now = Math.floor(this.clock() / iv) * iv;
    let latest = lastSealMs;
    for (const ts of issue.usedInstants) {
      const ms = tsToEpochMs(ts);
      if (latest === null || ms > latest) latest = ms;
    }
    if (latest === null || now > latest) return now;
    return force ? latest + iv : null;
  }

  private async seal(
    issue: IssueState,
    intent: SealIntent,
  ): Promise<"sealed" | "refused" | "unavailable"> {
    const r = await this.signer.seal(issue.issueId, {
      last: intent.last,
      sealId: intent.sealId,
    });
    if (!r.ok) {
      if (r.kind === "refused" && !intent.last) {
        await insertSealRefusal(this.pool, intent.sealId, r.code);
        return "refused";
      }
      // A last seal is never abandoned: it is re-asked with the same seal id.
      const why = r.kind === "refused" ? r.code : r.reason;
      this.log(`batcher: seal of issue ${issue.issueId} pending: ${why}`);
      this.alertIfMalformed(why);
      return "unavailable";
    }
    const { batchId, counts } = r.value;
    const total = counts.reduce((a, b) => a + b, 0);
    if (
      counts.length !== issue.choiceCount ||
      (!intent.last && total < issue.ballotBatchMin)
    ) {
      this.log(
        `batcher: seal of issue ${issue.issueId} returned bad counts; batch ${batchId} pending`,
      );
      return "unavailable";
    }
    await insertSealResult(this.pool, intent.sealId, batchId, counts);
    return "sealed";
  }

  /** Orders, signs and appends a sealed batch that has no sign request yet. */
  private async appendSealed(
    issue: IssueState,
    b: SealedBatch,
  ): Promise<boolean> {
    const choices = b.counts.flatMap((n, choice) =>
      Array<number>(n).fill(choice),
    );
    if (choices.length === 0) {
      await insertCompletion(this.pool, b.batchId, false); // an empty last batch
      return true;
    }
    const payloads = shuffle(choices, this.random).map((choice) => ({
      issue_id: issue.issueId,
      choice,
    }));
    return this.append(b.batchId, issue.issueId, async (head) => {
      const req: SignRequest = {
        batchId: b.batchId,
        issueId: issue.issueId,
        firstSeq: (head?.seq ?? 0) + 1,
        ts: epochMsToTs(b.instantMs),
        firstPrevHash: head?.hash ?? ZERO_HASH,
        payloads,
      };
      // Committed on its own connection before the call, under the writer lock.
      await insertSignRequest(this.pool, req);
      return req;
    });
  }

  /** Re-sends a stored sign request, unchanged, and appends its run. */
  private async replay(req: SignRequest): Promise<boolean> {
    if (await this.alreadyAppended(req)) {
      await insertCompletion(this.pool, req.batchId, true);
      return true;
    }
    return this.append(req.batchId, req.issueId, async (head) => {
      if (head?.seq !== req.firstSeq - 1 || head.hash !== req.firstPrevHash) {
        throw new Pending("the tail moved past the stored sign request");
      }
      return req;
    });
  }

  private async append(
    batchId: string,
    issueId: string,
    request: (
      head: { seq: number; hash: string } | null,
    ) => Promise<SignRequest>,
  ): Promise<boolean> {
    try {
      await this.ledger.appendRun(async (_state, head) => {
        const req = await request(head);
        const r = await this.signer.sign(req);
        if (!r.ok) {
          throw new Pending(
            r.kind === "refused" ? `refused ${r.code}` : r.reason,
          );
        }
        return checkRun(req, r.value);
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.log(
        `batcher: batch ${batchId} of issue ${issueId} not appended: ${why}`,
      );
      this.alertIfMalformed(why);
      return false;
    }
    await insertCompletion(this.pool, batchId, true);
    return true;
  }

  /**
   * A 400 means the signer found the ledger's own request malformed. The
   * client counts it as "no answer" (undocumented code), so the batch stays
   * pending and is retried, but a retry sends the same bytes and cannot fix a
   * ledger bug: say so loudly for the operator.
   */
  private alertIfMalformed(why: string): void {
    if (why === "http_400") {
      this.log(
        "ALERT batcher: the signer rejected a ledger request as malformed (http_400); retrying sends identical bytes, so an operator must look",
      );
    }
  }

  /** True when the stored log already holds the request's run (crash after commit). */
  private async alreadyAppended(req: SignRequest): Promise<boolean> {
    const rows = await readSince(
      this.pool,
      req.firstSeq - 1,
      req.payloads.length,
    );
    if (rows.length !== req.payloads.length) return false;
    if (rows[0]?.prevHash !== req.firstPrevHash) return false;
    return rows.every((row, i) => {
      const parsed = parseLine(new TextEncoder().encode(row.line));
      if (!parsed.ok) return false;
      const e = parsed.event;
      return (
        e.type === "vote_cast" &&
        e.ts === req.ts &&
        e.payload.issue_id === req.issueId &&
        e.payload.choice === req.payloads[i]?.choice
      );
    });
  }
}

export function createBatcher(options: BatcherOptions): Batcher {
  return new Batcher(options);
}
