// Ballot publication discipline (event-types.md v11): ET-23 (quantized ballot
// `ts`), ET-24 (minimum batch size, with its line attribution) and ET-24a (a
// batch, once left, is closed), from the section "Ballot publication
// discipline". ET-25 (order within a batch) is declared unverifiable by the
// contract (ET-25, EV-15) and has no check here, by design.
//
// All three are Stage B (EV-15: "every rule of event-types.md (ET-*)"), so
// only REGISTERED `vote_cast` events that have passed every other Stage B check
// are fed to the tracker. A well-formed `vote_cast` at an unregistered version
// is PARTIAL (EV-8): its payload is never read, so it has no issue_id this
// verifier may rely on and joins no batch.

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

/** Which ballot-publication rule a ballot breaks, if any. */
export type BatchFault = "ET-24" | "ET-24a";

/** Per-issue state for ET-24 and ET-24a. */
interface IssueRun {
  batchMin: number;
  /** Batch instant (epoch ms) of the issue's previous ballot; null before its first. */
  current: number | null;
  /** Ballots in the current batch so far. */
  count: number;
  /** Instants of batches this issue has LEFT. Equality lookups only — never ordered. */
  left: Set<number>;
}

/**
 * ET-24 / ET-24a, checked ballot by ballot in file (= `seq`) order.
 *
 * ET-24 (event-types.md v11) defines a batch as "a maximal run" of one issue's
 * registered `(vote_cast, 1)` events, in `seq` order, "that share one `ts`".
 * A run ends at the issue's next registered ballot whose `ts` differs, so both
 * rules are decided AT that ballot's line, with no end-of-scan pass:
 *
 *   - ET-24: a run that ends holding fewer than the issue's `ballot_batch_min`
 *     ballots was not the last, and the fatal line is "the registered
 *     `(vote_cast, 1)` of that issue that ends the under-size batch". A run
 *     that never ends holds the issue's highest-`seq` registered ballot: the
 *     last batch, which may be under-size. This holds "on every chain,
 *     including one that also breaks ET-24a": at T1, T1, T2, T2, T2, T1 with
 *     minimum 3 the fatal line is the first T2, not the returning T1.
 *   - ET-24a: "No two batches of one issue may share a `ts`" — a ballot that
 *     starts a run at an instant its issue has already left is rejected "at
 *     the line of the returning ballot".
 *
 * A ballot can break both at once (it ends an under-size run AND returns);
 * the line is the same and the reason is advisory ("One line, two rules").
 *
 * Both checks are per issue; other events and other issues' ballots between
 * one batch's members change nothing. `ts` values are compared for equality
 * only (ES-21 v5). Cost: one Map lookup, one Set lookup and at most one Set
 * insert per ballot — linear in the export whatever a hostile export does,
 * since no earlier ballot or batch is ever rescanned.
 *
 * Only registered, otherwise-accepted `(vote_cast, 1)` events are fed in: an
 * unregistered version's payload is never read, so it "joins no batch, ends
 * none, and proves none not-last" (ET-24a, "Which ballots count").
 */
export class BallotBatches {
  private readonly issues = new Map<string, IssueRun>();

  /** Register an issue (at its `issue_created`) with its ET-14b minimum. */
  openIssue(issueId: string, batchMin: number): void {
    this.issues.set(issueId, {
      batchMin,
      current: null,
      count: 0,
      left: new Set(),
    });
  }

  /**
   * Admit one ballot of `issueId` at batch instant `ms`. Returns the rule the
   * ballot breaks (the caller reports INVALID at this ballot's line), or null
   * after recording it. The issue MUST have been opened (ET-18 checked first).
   */
  admit(issueId: string, ms: number): BatchFault | null {
    const run = this.issues.get(issueId);
    if (run === undefined) throw new Error("admit: unknown issue");
    if (run.current === null) {
      run.current = ms;
      run.count = 1;
      return null;
    }
    if (ms === run.current) {
      run.count++;
      return null;
    }
    // This ballot ends the current run and starts a new one. Either fault
    // makes THIS the fatal line; which one is named is advisory (ET-24a "One
    // line, two rules"; EV-17).
    if (run.left.has(ms)) return "ET-24a";
    if (run.count < run.batchMin) return "ET-24";
    run.left.add(run.current);
    run.current = ms;
    run.count = 1;
    return null;
  }
}
