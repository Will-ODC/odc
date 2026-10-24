import type { Pool } from "pg";
import {
  checkLine,
  computeHash,
  initialState,
  serializeLine,
  ZERO_HASH,
  type ChainState,
  type Event,
  type Refusal,
  type UnhashedEvent,
} from "./chain/index.js";
import {
  appendRun,
  exportLines,
  type EventRow,
  type Head,
} from "./db/events.js";

/** The stored log does not verify VALID, so EV-26 bars every append. */
export class ChainNotValid extends Error {
  constructor(
    readonly line: number,
    readonly refusal: Refusal,
  ) {
    super(`stored log is not VALID at line ${line}: ${refusal.reason}`);
  }
}

/** A built event would not leave the export VALID (EV-26, EV-25). */
export class AppendRefused extends Error {
  constructor(
    readonly index: number,
    readonly refusal: Refusal,
  ) {
    super(`event ${index} refused: ${refusal.reason}`);
  }
}

/**
 * Builds the run to append, given the verified state and the stored head. It
 * runs inside the single-writer lock, so the tail cannot move until the run
 * commits or the call fails; it may make async calls (the signer) while the
 * lock is held.
 */
export type BuildRun = (
  state: ChainState,
  head: Head | null,
) => UnhashedEvent[] | Promise<UnhashedEvent[]>;

const decoder = new TextDecoder();

/**
 * The single writer. It holds the EV-26 forward state of the stored log, and
 * every append goes through `appendRun`: hash at insert, canonical line, and a
 * full check of each line before it is stored. The in-memory state advances
 * only after the run commits.
 */
export class Ledger {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly pool: Pool,
    private current: ChainState,
    private invalid: ChainNotValid | null,
  ) {}

  /** Replays the stored log through the checker. Reads work either way. */
  static async open(pool: Pool): Promise<Ledger> {
    let state = initialState();
    let n = 0;
    const encoder = new TextEncoder();
    for await (const chunk of exportLines(pool)) {
      n++;
      const r = checkLine(state, encoder.encode(chunk.slice(0, -1)));
      if (!r.ok)
        return new Ledger(pool, state, new ChainNotValid(n, r.refusal));
      state = r.state;
    }
    return new Ledger(pool, state, null);
  }

  get state(): ChainState {
    return this.current;
  }

  /** Null when the stored log is VALID; otherwise why appends are barred. */
  get notValid(): ChainNotValid | null {
    return this.invalid;
  }

  /** Appends the events `build` returns, as one run, or nothing. */
  appendRun(build: BuildRun): Promise<Event[]> {
    const run = this.queue.then(() => this.appendLocked(build));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async appendLocked(build: BuildRun): Promise<Event[]> {
    if (this.invalid !== null) throw this.invalid;
    let next = this.current;
    const events: Event[] = [];
    await appendRun(this.pool, async (head) => {
      // Single writer: the stored head must be the one the state describes.
      if ((head?.hash ?? ZERO_HASH) !== next.headHash) {
        throw new Error("stored head moved outside this ledger process");
      }
      const built = await build(next, head);
      const rows: EventRow[] = [];
      built.forEach((e, i) => {
        let event: Event;
        let bytes: Uint8Array;
        try {
          event = { ...e, hash: computeHash(e) };
          bytes = serializeLine(event);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new AppendRefused(i, { kind: "invalid", rule: "EX-7", reason });
        }
        const r = checkLine(next, bytes);
        if (!r.ok) throw new AppendRefused(i, r.refusal);
        next = r.state;
        events.push(r.event);
        rows.push({
          seq: event.seq,
          type: event.type,
          version: event.version,
          ts: event.ts,
          prevHash: event.prev_hash,
          hash: event.hash,
          line: decoder.decode(bytes),
        });
      });
      return rows;
    });
    this.current = next;
    return events;
  }
}
