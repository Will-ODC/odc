// Ballot publication discipline (event-types.md v12): ET-23 (quantized ballot
// `ts`), ET-24 (minimum batch size, with its line attribution), ET-24a (a
// batch, once left, is closed) and ET-24b (how ET-24 and ET-24a are decided
// beside opaque ballots, ADR-0034). ET-25 (order within a batch) is declared
// unverifiable by the contract (ET-25, EV-15) and has no check here, by design.
//
// All four are Stage B (EV-15). Only REGISTERED `vote_cast` events whose issue
// is registered and that have passed every other Stage B check are admitted.
// An OPAQUE ballot — a `vote_cast` at a version this verifier does not
// register that passed Stage A and ES-15–ES-17 — is recorded by its envelope
// `seq` and `ts` alone; its payload is never read (ET-24a "Which ballots
// count", ET-24b). A registered ballot of an unregistered `issue_created`
// (ET-18b) is neither: it never reaches this module.
//
// Every per-issue, per-interval and per-instant collection is a ShardedMap,
// ShardedSet or ChunkedList (collections.ts): each grows with the number of
// lines, and V8's own Map/Set/array caps would be a fixed line-count limit,
// which evolution.md EV-24 forbids.

import {
  CHUNK_SHIFT,
  ChunkedList,
  SHARD_CAP,
  ShardedMap,
  ShardedSet,
} from "./collections.js";

/**
 * ET-23's offset: milliseconds since `1970-01-01T00:00:00.000Z` on the
 * proleptic Gregorian calendar, exactly 86400000 ms per day, no leap seconds.
 *
 * `ts` MUST already have passed ES-20 (the parser guarantees this). That gate
 * fixes the range: a four-digit year, so `0000-01-01T00:00:00.000Z` through
 * `9999-12-31T23:59:59.999Z`, i.e. -62167219200000 … 253402300799999. Every
 * intermediate below is an integer of magnitude < 2^49, far inside the 2^53
 * range where a JS number is exact, so this is integer arithmetic with no
 * rounding anywhere. `Date.UTC` is deliberately NOT used: it maps years 0–99
 * to 1900–1999, which would misplace every ballot dated in the first century.
 */
export function epochMs(ts: string): number {
  // Fixed positions, guaranteed by ES-20's regex: YYYY-MM-DDTHH:MM:SS.mmmZ
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(5, 7));
  const day = Number(ts.slice(8, 10));
  const hour = Number(ts.slice(11, 13));
  const minute = Number(ts.slice(14, 16));
  const second = Number(ts.slice(17, 19));
  const milli = Number(ts.slice(20, 23));
  return (
    daysFromCivil(year, month, day) * 86400000 +
    hour * 3600000 +
    minute * 60000 +
    second * 1000 +
    milli
  );
}

/**
 * Days from 1970-01-01 to the given proleptic-Gregorian date (negative before
 * it). The standard era-based algorithm: shift the year to start in March so
 * the leap day is the last day of the year, then count whole 400-year eras
 * (146097 days each). `Math.floor` keeps the era correct for year 0, whose
 * January and February fall in shifted year -1.
 */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400; // [0, 399]
  const mp = m > 2 ? m - 3 : m + 9; // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468; // 719468 = days from 0000-03-01 to 1970-01-01
}

/**
 * ET-23: is `ms` an exact multiple of `intervalMs`? Both are exact integers
 * (see `epochMs`; `intervalMs` is an ES-5 integer ≥ 60000). ET-23: "zero and
 * negative multiples count" — for a negative multiple `%` yields -0, which
 * `=== 0` accepts.
 */
export function isQuantized(ms: number, intervalMs: number): boolean {
  return ms % intervalMs === 0;
}

/**
 * The outcome of ET-24/ET-24a at one registered ballot, decided by ET-24b:
 * "ET-24" / "ET-24a" are DEFINITE failures (INVALID at this line); "unresolved"
 * is neither a failure nor a pass (the line is enumerated in PARTIAL, EV-7);
 * "resolved" passes.
 */
export type BatchOutcome = "resolved" | "unresolved" | "ET-24" | "ET-24a";

/**
 * Candidate summary for every registered issue sharing one interval Δ, which
 * answers ET-24b item 4(b)'s question "is there a candidate with `seq > a`
 * whose `ts` differs from x?" in O(1).
 *
 * Invariant: `lastSeq` is the largest `seq` among the candidates so far and
 * `lastMs` its instant; `prevRunLastSeq` is the largest `seq` among candidates
 * whose instant differs from `lastMs` (0 if none). It is maintained exactly:
 * a new candidate at a DIFFERENT instant makes the old last candidate the
 * largest one not at the new `lastMs` (every later-than-it candidate is the
 * new one), so `prevRunLastSeq` becomes the old `lastSeq`; a new candidate at
 * the SAME instant leaves the set of candidates at other instants unchanged.
 *
 * Hence "some candidate with `seq > a` and `ts ≠ x`" holds iff `lastSeq > a`
 * and (`lastMs ≠ x` — the last candidate itself qualifies — or
 * `prevRunLastSeq > a` — the latest candidate not at `lastMs = x` does). A
 * candidate's `seq` is always below the ballot being admitted, so no upper
 * bound is needed.
 *
 * One summary serves every issue at Δ although their c differ: candidacy
 * (item 1) is the multiple test plus `seq > c`, and every query's lower bound
 * `a` (c, `seq(P(L))` or `seq(f)`) is ≥ that issue's c, so candidates at or
 * before c are excluded by the query itself.
 */
interface IntervalGroup {
  delta: number;
  /** `seq` of the latest candidate; 0 when there is none (seqs start at 1). */
  lastSeq: number;
  /** Its instant (epoch ms). Meaningless while `lastSeq` is 0. */
  lastMs: number;
  /** `seq` of the latest candidate whose instant differs from `lastMs`; 0 if none. */
  prevRunLastSeq: number;
}

/** Per registered issue: its parameters and its KNOWN state (ET-24b item 2). */
interface IssueRun {
  /** `seq` of the issue's `issue_created` (ET-24b's c). */
  c: number;
  batchMin: number;
  group: IntervalGroup;
  /** `seq` of the issue's previous registered ballot, P(L); 0 before its first. */
  prevSeq: number;
  /** Instant (epoch ms) of the current known run; null before the first ballot. */
  current: number | null;
  /** |R|: registered ballots in the current known run. */
  count: number;
  /** `seq` of the current run's first ballot, f. */
  firstSeq: number;
  /** ET-24b's w for the current run: `seq(P(f))`, or c when P(f) does not exist. */
  w: number;
  /** Instants of known runs this issue has LEFT. Equality lookups only. */
  left: ShardedSet<number>;
}

/**
 * ET-24 / ET-24a, decided ballot by ballot in file (= `seq`) order under
 * ET-24b, in one pass.
 *
 * Known terms (ET-24b item 2) are v11's rules over the registered ballots
 * alone: a run ends at the issue's next registered ballot whose `ts` differs
 * (a "run start" L), which has a known ET-24 failure if the run it ends is
 * under-size and a known ET-24a failure if it returns to an instant the issue
 * has left. A known ET-24a failure is always definite; a known ET-24 failure
 * is definite iff |R| + F < m, F counting the candidates at the run's instant
 * t with w < seq < seq(L) (item 3). Otherwise item 4 decides whether the check
 * is unresolved.
 *
 * Every query reads only lines before L, so each line's outcome is final when
 * the scan reaches it (EX-16's prefix property). `ts` values are compared for
 * equality only, plus ET-23's multiple test (ES-21).
 *
 * Cost: a registered ballot is O(log k) (a binary search over the opaque
 * ballots sharing one instant) plus O(1) Map/Set work. An opaque ballot costs
 * one modulus per DISTINCT interval among the registered issues so far, since
 * which issues it is a candidate of depends on each interval; it updates a
 * per-interval O(1) summary, not each issue. Worst case O(opaque × distinct
 * intervals), which ET-24b's own one-pass sketch ("each opaque ballot updates
 * every issue it is a candidate of") shares.
 */
export class BallotBatches {
  private readonly issues: ShardedMap<string, IssueRun>;
  private readonly groups: ShardedMap<number, IntervalGroup>;
  /** Every opaque ballot's `seq`, by instant, ascending (file order). */
  private readonly opaqueAt: ShardedMap<number, ChunkedList>;

  /** `shardCap` and `chunkShift` are parameters for tests only. */
  constructor(
    private readonly shardCap: number = SHARD_CAP,
    private readonly chunkShift: number = CHUNK_SHIFT,
  ) {
    this.issues = new ShardedMap(shardCap);
    this.groups = new ShardedMap(shardCap);
    this.opaqueAt = new ShardedMap(shardCap);
  }

  /**
   * How many built-in Maps/Sets/arrays hold each collection, at most over
   * issues for `left` and over instants for `opaqueAt`'s lists. For tests:
   * it shows the caps are applied, so state past V8's limits stays possible.
   */
  shardCounts(): {
    issues: number;
    groups: number;
    opaqueAt: number;
    left: number;
    opaqueList: number;
  } {
    let left = 0;
    for (const r of this.issues.values())
      left = Math.max(left, r.left.shardCount);
    let opaqueList = 0;
    for (const l of this.opaqueAt.values())
      opaqueList = Math.max(opaqueList, l.chunkCount);
    return {
      issues: this.issues.shardCount,
      groups: this.groups.shardCount,
      opaqueAt: this.opaqueAt.shardCount,
      left,
      opaqueList,
    };
  }

  /**
   * Register an issue at its `issue_created` (seq `c`) with its ET-14b
   * interval and minimum, which ET-22a makes final.
   */
  openIssue(
    issueId: string,
    c: number,
    intervalMs: number,
    batchMin: number,
  ): void {
    let group = this.groups.get(intervalMs);
    if (group === undefined) {
      group = { delta: intervalMs, lastSeq: 0, lastMs: 0, prevRunLastSeq: 0 };
      this.groups.set(intervalMs, group);
    }
    this.issues.set(issueId, {
      c,
      batchMin,
      group,
      prevSeq: 0,
      current: null,
      count: 0,
      firstSeq: 0,
      w: c,
      left: new ShardedSet(this.shardCap),
    });
  }

  /**
   * Record one opaque ballot: its envelope `seq` and its `ts` in epoch ms,
   * nothing else (ET-24b). It is a candidate of every issue already opened
   * (so `seq > c`) whose interval its instant is a multiple of (item 1).
   */
  opaque(seq: number, ms: number): void {
    for (const g of this.groups.values()) {
      if (!isQuantized(ms, g.delta)) continue;
      if (g.lastSeq !== 0 && ms !== g.lastMs) g.prevRunLastSeq = g.lastSeq;
      g.lastSeq = seq;
      g.lastMs = ms;
    }
    let at = this.opaqueAt.get(ms);
    if (at === undefined) {
      at = new ChunkedList(this.chunkShift);
      this.opaqueAt.set(ms, at);
    }
    at.push(seq);
  }

  /**
   * Is there a candidate of `g` with `seq` in (a, now) whose instant is not
   * `x`? The latest candidate answers it unless it sits at `x`; then the
   * latest candidate at another instant does.
   */
  private otherInstantSince(g: IntervalGroup, a: number, x: number): boolean {
    if (g.lastSeq <= a) return false;
    return g.lastMs !== x || g.prevRunLastSeq > a;
  }

  /**
   * How many opaque ballots at instant `ms` have `seq > a`? (All recorded ones
   * precede the ballot being admitted.) An opaque ballot at an instant that is
   * a multiple of Δ is a candidate of every issue at Δ opened before it, and
   * `ms` here is always a run instant of an issue at Δ, which passed ET-23.
   */
  private opaqueCountSince(ms: number, a: number): number {
    const at = this.opaqueAt.get(ms);
    if (at === undefined) return 0;
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((at.at(mid) as number) <= a) lo = mid + 1;
      else hi = mid;
    }
    return at.length - lo;
  }

  /**
   * Admit one registered ballot of `issueId` with envelope `seq`, at batch
   * instant `ms` (it has passed ET-23). The issue MUST have been opened.
   * Returns the ET-24b outcome; on a definite failure the caller reports
   * INVALID at this line and the state is not used again.
   */
  admit(issueId: string, seq: number, ms: number): BatchOutcome {
    const run = this.issues.get(issueId);
    if (run === undefined) throw new Error("admit: unknown issue");

    if (run.current === null || ms === run.current) {
      // Not a run start: the issue's first ballot, or one continuing the
      // current run. Item 4(b): unresolved iff a candidate since P(L) (since
      // c when there is no P(L)) sits at another instant.
      const since = run.current === null ? run.c : run.prevSeq;
      const unresolved = this.otherInstantSince(run.group, since, ms);
      if (run.current === null) {
        run.current = ms;
        run.count = 1;
        run.firstSeq = seq;
        run.w = run.c;
      } else {
        run.count++;
      }
      run.prevSeq = seq;
      return unresolved ? "unresolved" : "resolved";
    }

    // A run start: L ends the known run R (at t = run.current) and begins a new
    // one. Either definite failure makes THIS the fatal line; which one is
    // named is advisory (ET-24a "One line, two rules"; EV-17).
    if (run.left.has(ms)) return "ET-24a"; // item 3: always definite
    let outcome: BatchOutcome = "resolved";
    if (run.count < run.batchMin) {
      // Known ET-24 failure; definite iff |R| + F < m (item 3).
      const f = this.opaqueCountSince(run.current, run.w);
      if (run.count + f < run.batchMin) return "ET-24";
      outcome = "unresolved"; // item 4(a)
    } else if (
      // Item 4(b), run start: a candidate at ts(L) (seq > c is implied for a
      // candidate; checked against the global record here), or one after f at
      // an instant other than t.
      this.opaqueCountSince(ms, run.c) > 0 ||
      this.otherInstantSince(run.group, run.firstSeq, run.current)
    ) {
      outcome = "unresolved";
    }
    run.left.add(run.current);
    run.w = run.prevSeq;
    run.current = ms;
    run.count = 1;
    run.firstSeq = seq;
    run.prevSeq = seq;
    return outcome;
  }
}
