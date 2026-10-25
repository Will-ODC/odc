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

/** Calls of `isQuantized` in this process so far; read by tests only. */
let quantizedTests = 0;

/**
 * How many times `isQuantized` has run in this process. For tests: an opaque
 * ballot's per-interval work is a multiple test against each interval, so a
 * delta of this count shows that work is absent without timing anything (a
 * timed ratio flaked on a shared CI runner). It never feeds a verdict.
 */
export function quantizedTestCount(): number {
  return quantizedTests;
}

/**
 * ET-23: is `ms` an exact multiple of `intervalMs`? Both are exact integers
 * (see `epochMs`; `intervalMs` is an ES-5 integer ≥ 60000). ET-23: "zero and
 * negative multiples count" — for a negative multiple `%` yields -0, which
 * `=== 0` accepts.
 */
export function isQuantized(ms: number, intervalMs: number): boolean {
  quantizedTests++;
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
 * One distinct instant at which opaque ballots have appeared. `seqs` holds
 * their `seq`s, ascending (file order); `last` is the largest, written T(y)
 * below. Every instant is also a node of ONE recency list, ordered by T,
 * largest first: an opaque ballot moves its instant to the front, which keeps
 * the order because its `seq` exceeds every earlier one. The list is linked
 * through object references, so no built-in collection grows with it.
 */
interface Instant {
  ms: number;
  seqs: ChunkedList;
  /** T(y): `seq` of the latest opaque ballot at this instant. */
  last: number;
  /** Neighbour with the next larger T, or null at the front. */
  newer: Instant | null;
  /** Neighbour with the next smaller T, or null at the back. */
  older: Instant | null;
}

/**
 * Lazy candidate summary for every registered issue sharing one interval Δ,
 * which answers ET-24b item 4(b)'s question "is there a candidate with
 * `seq > a` whose `ts` differs from x?" (`otherInstantSince`).
 *
 * Reduction. An opaque ballot at instant y is a candidate of an issue at Δ iff
 * Δ | y and its `seq` exceeds that issue's c (item 1). Every query's lower
 * bound `a` (c, `seq(P(L))` or `seq(f)`) is ≥ the asking issue's c, and every
 * recorded opaque ballot precedes the ballot being admitted, so the question
 * is: is there an instant y with Δ | y, y ≠ x and T(y) > a? (Some opaque
 * ballot at y has `seq > a` iff the latest one does.) Let y1 and y2 be the two
 * distinct instants with Δ | y and the largest T. If T(y1) ≤ a there is none.
 * If y1 ≠ x, y1 answers yes. If y1 = x, the best instant other than x is y2,
 * so the answer is T(y2) > a. This is the old `lastSeq`/`lastMs`/
 * `prevRunLastSeq` summary exactly — `lastSeq` = T(y1), `lastMs` = y1,
 * `prevRunLastSeq` = T(y2) — computed on demand rather than per opaque ballot.
 *
 * Laziness. The group caches `top1`/`top2` (y1, y2 as of its last refresh)
 * and `seenSeq`, the latest opaque `seq` at that refresh, and reads T live from
 * the instants, never a stored copy. Invariant after every refresh: `top1`,
 * `top2` are the two instants with Δ | y and the largest T among those with
 * T(y) > c0 (c0 = the c of the issue that created the group; the rest can
 * answer no query, since every issue at Δ has c ≥ c0 and every a ≥ c). It is
 * restored at the next refresh as follows. The instants touched since the last
 * refresh are exactly those with T(y) > `seenSeq`, and they sit at the front
 * of the recency list, each with a larger T than every untouched instant.
 * Walk them from the front, keeping those with Δ | y. If two are found, they
 * are the top two outright. If k < 2 are found, the remaining 2 − k come from
 * the untouched instants, whose T has not changed; their order among
 * themselves is the order of the last refresh, so their best 2 − k are the
 * cached instants that were not touched (a cached instant that was touched is
 * among those just walked, so a merge that skips already-collected instants
 * de-duplicates it, and reading T live ranks it correctly). At creation the
 * cache is empty and `seenSeq` = c0, which satisfies the invariant: an
 * instant with T ≤ c0 is outside it, and any instant later reaching T > c0 is
 * touched after creation and so walked.
 *
 * One group serves every issue at Δ although their c differ, as above.
 */
interface IntervalGroup {
  delta: number;
  /** Instant with the largest T among the multiples of Δ, at the last refresh. */
  top1: Instant | null;
  /** The one with the next largest T. */
  top2: Instant | null;
  /** Latest opaque `seq` at the last refresh (c0 before the first). */
  seenSeq: number;
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
 * Cost: an opaque ballot is O(1) plus one Map lookup: it appends its `seq` to
 * its instant and moves that instant to the front of the recency list, and
 * does no per-interval or per-issue work. A registered ballot is O(log k) (a
 * binary search over the opaque ballots sharing one instant) plus O(1)
 * Map/Set work, plus the refresh of its interval group (`IntervalGroup`),
 * which walks only the instants touched since that group last looked. So each
 * group's total walk is bounded by the opaque ballots after it (plus one step
 * per query), never worse than the earlier O(opaque × distinct intervals)
 * bound, and usually far better: a walk stops at the second multiple of Δ.
 *
 * Known limit, not fixed: many opaque ballots at many DISTINCT instants that
 * are multiples of no registered interval, followed by a registered ballot on
 * every interval, still costs O(distinct intervals × distinct opaque
 * instants), since each group must walk past every such instant once to learn
 * that none is its multiple. Removing that would need factoring instants
 * inside the verifier; it is not done.
 */
export class BallotBatches {
  private readonly issues: ShardedMap<string, IssueRun>;
  private readonly groups: ShardedMap<number, IntervalGroup>;
  /** Every distinct opaque instant, by epoch ms. */
  private readonly opaqueAt: ShardedMap<number, Instant>;
  /** Front of the recency list: the instant with the largest T. */
  private newest: Instant | null = null;
  /** `seq` of the latest opaque ballot; 0 before the first. */
  private latestOpaque = 0;
  /** Instants visited by every refresh so far; read by tests (`walkSteps`). */
  private walked = 0;
  /** ET-24a lookups in a `left` set so far; read by tests (`leftProbes`). */
  private probed = 0;

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
   * How many instants every refresh so far has visited, in total. For tests:
   * it shows the walk is amortised (each group visits only instants touched
   * since it last looked) without timing anything, so it cannot flake.
   */
  walkSteps(): number {
    return this.walked;
  }

  /**
   * Operations served so far by the per-interval and per-issue maps
   * (`ShardedMap.ops`). For tests: an opaque ballot must touch neither, so
   * any per-interval or per-issue loop in `opaque` shows up here however it
   * tests a multiple, without timing anything.
   */
  mapOps(): { groups: number; issues: number } {
    return { groups: this.groups.ops, issues: this.issues.ops };
  }

  /**
   * How many ET-24a lookups in an issue's `left` set have run, in total. For
   * tests: it pins one lookup per run start, without timing anything. It
   * counts lookups, not their cost: a slower lookup structure would not show.
   */
  leftProbes(): number {
    return this.probed;
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
    for (const y of this.opaqueAt.values())
      opaqueList = Math.max(opaqueList, y.seqs.chunkCount);
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
      // seenSeq = c: no opaque ballot at or before c is a candidate of any
      // issue at Δ (each has c' ≥ c), so none needs walking (IntervalGroup).
      group = { delta: intervalMs, top1: null, top2: null, seenSeq: c };
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
   * (so `seq > c`) whose interval its instant is a multiple of (item 1); which
   * those are is worked out lazily, per interval, at the next query
   * (`refresh`). O(1) here: no per-interval or per-issue work.
   */
  opaque(seq: number, ms: number): void {
    let y = this.opaqueAt.get(ms);
    if (y === undefined) {
      y = {
        ms,
        seqs: new ChunkedList(this.chunkShift),
        last: seq,
        newer: null,
        older: null,
      };
      this.opaqueAt.set(ms, y);
    } else if (y !== this.newest) {
      // Unlink; it is not the front, so it has a newer neighbour.
      (y.newer as Instant).older = y.older;
      if (y.older !== null) y.older.newer = y.newer;
      y.newer = null;
      y.older = null;
    }
    if (y !== this.newest) {
      y.older = this.newest;
      if (this.newest !== null) this.newest.newer = y;
      this.newest = y;
    }
    y.seqs.push(seq);
    y.last = seq;
    this.latestOpaque = seq;
  }

  /**
   * Bring `g`'s cached top two up to date (the invariant and its proof are on
   * `IntervalGroup`): walk the instants touched since `g.seenSeq`, newest
   * first, keeping multiples of Δ, and stop at the second one found; if fewer
   * are found, fill from the cached instants not already collected, ranked by
   * their live T.
   */
  private refresh(g: IntervalGroup): void {
    if (this.latestOpaque <= g.seenSeq) return;
    let a: Instant | null = null;
    let b: Instant | null = null;
    for (let y = this.newest; y !== null && y.last > g.seenSeq; y = y.older) {
      this.walked++;
      if (!isQuantized(y.ms, g.delta)) continue;
      if (a === null) a = y;
      else {
        b = y;
        break;
      }
    }
    if (b === null) {
      // Merge the untouched cached instants; a touched one is already `a`.
      for (const y of [g.top1, g.top2]) {
        if (y === null || y === a || y === b) continue;
        if (a === null || y.last > a.last) {
          b = a;
          a = y;
        } else if (b === null || y.last > b.last) b = y;
      }
    }
    g.top1 = a;
    g.top2 = b;
    g.seenSeq = this.latestOpaque;
  }

  /**
   * Is there a candidate of `g` with `seq` in (a, now) whose instant is not
   * `x`? With y1, y2 the two multiples of Δ with the largest T: no if
   * T(y1) ≤ a; yes if y1 ≠ x; otherwise iff T(y2) > a (`IntervalGroup`).
   */
  private otherInstantSince(g: IntervalGroup, a: number, x: number): boolean {
    this.refresh(g);
    const y1 = g.top1;
    if (y1 === null || y1.last <= a) return false;
    if (y1.ms !== x) return true;
    return g.top2 !== null && g.top2.last > a;
  }

  /**
   * How many opaque ballots at instant `ms` have `seq > a`? (All recorded ones
   * precede the ballot being admitted.) An opaque ballot at an instant that is
   * a multiple of Δ is a candidate of every issue at Δ opened before it, and
   * `ms` here is always a run instant of an issue at Δ, which passed ET-23.
   */
  private opaqueCountSince(ms: number, a: number): number {
    const at = this.opaqueAt.get(ms)?.seqs;
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
    this.probed++;
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
