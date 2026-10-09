// Ballot publication discipline: ET-23 (quantized ballot `ts`) and ET-24
// (minimum batch size, with its line attribution). event-types.md, "Ballot
// publication discipline". ET-25 (order within a batch) is declared
// unverifiable by the contract (ET-25, EV-15) and has no check here, by design.
//
// Both rules are Stage B (EV-15: "every rule of event-types.md (ET-*)"), so
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
 * (see `epochMs`; `intervalMs` is an ES-5 integer ≥ 60000). For a negative
 * multiple `%` yields -0, which `=== 0` accepts.
 */
export function isQuantized(ms: number, intervalMs: number): boolean {
  return ms % intervalMs === 0;
}

/** One ET-24 batch: the ballots of one issue at one batch instant. */
interface Batch {
  /** Members admitted so far (all of them, once the scan ends). */
  count: number;
  /**
   * Line of the first ballot of the same issue appended after this batch's
   * highest-seq member, or null while no such ballot has been seen. Reset to
   * null each time the batch gains a member, so at the end of the scan it
   * names the first same-issue ballot after the batch's LAST member — ET-24's
   * blamed line, if the batch turns out under-size and not last.
   */
  successor: number | null;
}

/** Per-issue ET-24 state. */
interface IssueBatches {
  batchMin: number;
  /** issue's batches keyed by batch instant (epoch ms). Equality only — never compared. */
  byInstant: Map<number, Batch>;
  /** Batch holding the issue's highest-seq ballot so far (ET-24's "last" batch). */
  last: Batch | null;
}

/**
 * ET-24 accumulator. O(1) amortised per ballot and O(batches) at the end, so
 * the whole rule is linear in the export: no ballot is ever revisited and no
 * batch is ever rescanned, whatever order a hostile export interleaves them in.
 *
 * Membership and lastness are by `seq` (ES-8), never by comparing `ts`:
 * ballots are fed in file order (which Stage A has already pinned to `seq`
 * order), a batch is found by EQUALITY of its instant, and "last" is simply the
 * batch the most recent ballot of the issue went into.
 */
export class BallotBatches {
  private readonly issues = new Map<string, IssueBatches>();
  private readonly all: { issue: IssueBatches; batch: Batch }[] = [];

  /** Register an issue (at its `issue_created`) with its ET-14b minimum. */
  openIssue(issueId: string, batchMin: number): void {
    this.issues.set(issueId, { batchMin, byInstant: new Map(), last: null });
  }

  /**
   * Admit one accepted ballot of `issueId` at batch instant `ms`, on `line`.
   * The issue MUST have been opened (ET-18 has already been checked).
   */
  admit(issueId: string, ms: number, line: number): void {
    const issue = this.issues.get(issueId);
    if (issue === undefined) throw new Error("admit: unknown issue");
    let batch = issue.byInstant.get(ms);
    if (batch === undefined) {
      batch = { count: 0, successor: null };
      issue.byInstant.set(ms, batch);
      this.all.push({ issue, batch });
    }
    // The previous ballot of this issue was the last member of `issue.last`,
    // so this ballot is the first one appended after that member. If it joins
    // a DIFFERENT batch, that is the batch's (provisional) successor.
    const prev = issue.last;
    if (prev !== null && prev !== batch) prev.successor = line;
    batch.count++;
    batch.successor = null;
    issue.last = batch;
  }

  /**
   * ET-24 over every ballot admitted: the lowest blamed line among the
   * under-size batches that are not their issue's last, or null if none.
   *
   * A batch that is not its issue's last does not hold the issue's highest-seq
   * ballot, so some ballot of that issue follows its last member and
   * `successor` is set; the null branch is unreachable.
   */
  firstViolation(): number | null {
    let first: number | null = null;
    for (const { issue, batch } of this.all) {
      if (batch === issue.last || batch.count >= issue.batchMin) continue;
      const line = batch.successor;
      if (line === null) continue; // unreachable, see above
      if (first === null || line < first) first = line;
    }
    return first;
  }
}
