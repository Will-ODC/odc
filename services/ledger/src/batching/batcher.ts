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
import { AppendRefused, ChainNotValid, type BuildRun } from "../ledger.js";

/**
 * Ballot batching (ET-23 to ET-25, ADR-0043 "How the append is coordinated"):
 * per issue, choose the instant, seal, shuffle, sign at the tail, append whole.
 * Each step is recorded before the call it precedes (src/db/batching.ts), so
 * `recover()` finishes it after a crash. ET-21a: logs name only the issue, the
 * batch id and a reason, never a ballot.
 */
export interface BatcherLedger {
  readonly state: { readonly issues: ReadonlyMap<string, IssueState> };
  appendRun(build: BuildRun): Promise<Event[]>;
}

export interface BatcherOptions {
  readonly ledger: BatcherLedger;
  readonly pool: Pool;
  readonly signer: SignerClient;
  readonly clock?: () => number;
  /** A uniform integer in [0, n). Tests inject it; production uses crypto. */
  readonly random?: (n: number) => number;
  readonly log?: (line: string) => void;
  /** How often `start()` ticks. Default one second. */
  readonly tickMs?: number;
}

export type CloseStatus = "closing" | "closed";

export class UnknownIssue extends Error {
  constructor(readonly issueId: string) {
    super(`no issue_created with id ${issueId}`);
  }
}

/** A step left pending, retried later; `alert` when a retry cannot fix it. */
class Pending extends Error {
  constructor(
    message: string,
    readonly alert = false,
  ) {
    super(message);
  }
}

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

/** The client matched the run to the request; this checks chain and hashes. */
function checkRun(req: SignRequest, events: readonly Event[]): UnhashedEvent[] {
  return events.map(({ hash, ...e }, i) => {
    const prev = i === 0 ? req.firstPrevHash : events[i - 1]?.hash;
    if (e.prev_hash !== prev || computeHash(e) !== hash) {
      throw new Pending(`signed event ${i} does not chain`, true);
    }
    return e;
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
  /** Per issue: the seal id the signer last refused under_min, and when. */
  private readonly underMin = new Map<string, string>();
  /** When each issue's last-seal refusal was last raised as an ALERT. */
  private readonly lastSealAlert = new Map<string, number>();

  constructor(o: BatcherOptions) {
    // appendRun holds one pool connection (the writer lock) while
    // insertSignRequest commits on another: a pool of one would deadlock.
    if ((o.pool.options.max ?? 10) < 2) {
      throw new Error("the batcher's pool needs max >= 2");
    }
    this.ledger = o.ledger;
    this.pool = o.pool;
    this.signer = o.signer;
    this.clock = o.clock ?? Date.now;
    this.random = o.random ?? ((n) => randomInt(n));
    this.log = o.log ?? ((line) => console.error(line));
    this.tickMs = o.tickMs ?? 1000;
  }

  /**
   * True while a stored sign request has no appended run. Its batch is signed
   * at that one position, so any other append (an operator's included) would
   * strand it: callers refuse to append until this is false (ADR-0043).
   */
  async signPending(): Promise<boolean> {
    return (await pendingSignRequests(this.pool)).length > 0;
  }

  /** Ticks every `tickMs` until `stop()`, which is final; ticks never overlap. */
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

  /** Stops the timer and waits for the step in progress to finish. */
  async stop(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    await this.queue;
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
        if (await this.advance(issue, newSeals)) continue;
        done = false;
        // Only a stored sign request holds a log position; a seal-stage
        // failure of one issue must not starve the others.
        if (await this.signPending()) return false;
      }
      return done;
    } catch (err) {
      this.warn(false, `step failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** ADR-0043: replay fixed-position requests before anything else appends. */
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
        const asked = `${p.intent.sealId}@${this.interval(issue)}`;
        if (!p.closeRequested && this.underMin.get(issue.issueId) === asked) {
          return true;
        }
        const r = await this.seal(issue, p.intent, p.closeRequested);
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
   * ET-23, ET-24a: the issue's quantized now, unless a seal of the issue had it
   * or a later one (clock stepped back, interval tried). Then a tick holds
   * (null) and a last seal, which cannot wait, goes one interval past it.
   */
  private chooseInstant(
    issue: IssueState,
    lastSealMs: number | null,
    force: boolean,
  ): number | null {
    const iv = issue.ballotBatchIntervalMs;
    const now = this.interval(issue) * iv;
    let latest = lastSealMs;
    for (const ts of issue.usedInstants) {
      const ms = tsToEpochMs(ts);
      if (latest === null || ms > latest) latest = ms;
    }
    if (latest === null || now > latest) return now;
    return force ? latest + iv : null;
  }

  private interval(issue: IssueState): number {
    return Math.floor(this.clock() / issue.ballotBatchIntervalMs);
  }

  /**
   * A non-last seal refused under_min sealed nothing: its intent stays live and
   * is re-asked, same seal id (the signer answers it afresh: ledger-proposed),
   * once per interval, so a quiet issue writes no rows. It keeps its instant,
   * which no other seal of the issue can take meanwhile (one live intent) and
   * EV-26 rechecks (ET-24a). Only a close or another code records a refusal.
   */
  private async seal(
    issue: IssueState,
    intent: SealIntent,
    closing: boolean,
  ): Promise<"sealed" | "refused" | "unavailable"> {
    const r = await this.signer.seal(issue.issueId, {
      last: intent.last,
      sealId: intent.sealId,
    });
    if (!r.ok) {
      if (r.kind === "refused" && !intent.last) {
        if (r.code === "under_min" && !closing) {
          const at = `${intent.sealId}@${this.interval(issue)}`;
          this.underMin.set(issue.issueId, at);
        } else {
          await insertSealRefusal(this.pool, intent.sealId, r.code);
        }
        return "refused";
      }
      // A last seal is never abandoned: it is re-asked with the same seal id.
      // A definite refusal of a last seal (seal_conflict, issue_closed,
      // unknown_issue) is answered the same on every retry.
      const why = r.kind === "refused" ? r.code : r.reason;
      // ALERT on the first refusal, then at most once a minute per issue,
      // so a refusal that never changes does not flood the log every tick.
      let alert = r.kind === "refused" || why === "http_400";
      if (alert) {
        const now = this.clock();
        const last = this.lastSealAlert.get(issue.issueId);
        alert = last === undefined || now - last >= 60_000;
        if (alert) this.lastSealAlert.set(issue.issueId, now);
      }
      this.warn(alert, `seal of issue ${issue.issueId} pending: ${why}`);
      return "unavailable";
    }
    const { batchId, counts } = r.value;
    const total = counts.reduce((a, b) => a + b, 0);
    if (
      counts.length !== issue.choiceCount ||
      (!intent.last && total < issue.ballotBatchMin)
    ) {
      // Sealed already, so every retry gets the same answer.
      this.warn(
        true,
        `seal of issue ${issue.issueId} returned bad counts; batch ${batchId} pending`,
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
        throw new Pending("the tail moved past the stored sign request", true);
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
        if (r.ok) return checkRun(req, r.value);
        // Only "no answer" may come right on retry; http_400 is our bug.
        const temporary = r.kind === "unavailable" && r.reason !== "http_400";
        throw new Pending(
          r.kind === "refused" ? `refused ${r.code}` : r.reason,
          !temporary,
        );
      });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      const alert =
        (err instanceof Pending && err.alert) ||
        err instanceof AppendRefused ||
        err instanceof ChainNotValid;
      this.warn(
        alert,
        `batch ${batchId} of issue ${issueId} not appended: ${why}`,
      );
      return false;
    }
    await insertCompletion(this.pool, batchId, true);
    return true;
  }

  /**
   * `alert`: a retry resends the same bytes to a deterministic signer and
   * cannot fix it, so it is logged as ALERT on every attempt.
   */
  private warn(alert: boolean, line: string): void {
    this.log(`${alert ? "ALERT " : ""}batcher: ${line}`);
  }

  /** True when the stored log already holds the request's run (crash after commit). */
  private async alreadyAppended(req: SignRequest): Promise<boolean> {
    const n = req.payloads.length;
    const rows = await readSince(this.pool, req.firstSeq - 1, n);
    if (rows.length !== n) return false;
    return rows.every((row, i) => {
      const parsed = parseLine(new TextEncoder().encode(row.line));
      if (!parsed.ok) return false;
      const e = parsed.event;
      return (
        e.prev_hash === (i === 0 ? req.firstPrevHash : rows[i - 1]?.hash) &&
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
