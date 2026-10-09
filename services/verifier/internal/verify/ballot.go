package verify

// Ballot publication discipline (event-types.md v10: ET-23, ET-24, ET-24a).
//
// ET-25 (order within a batch) is deliberately absent: the contract declares it
// unverifiable from the log and assigns it to neither verification stage
// (EV-15). A shuffled batch and an arrival-ordered one are indistinguishable,
// so there is nothing here to check.

// issueInfo is what the verifier tracks per accepted issue_created (ID-7):
// choice_count for ET-18a, the two ET-14b batching parameters that
// ET-23/ET-24 are checked against, and the issue's open batch.
type issueInfo struct {
	choiceCount int64 // ET-14a / ET-18a
	intervalMS  int64 // ballot_batch_interval_ms (ET-14b, ET-23)
	batchMin    int64 // ballot_batch_min (ET-14b, ET-24)

	// The open batch: the batch instant of this issue's most recent
	// registered ballot and how many ballots it holds. ET-24 defines a batch
	// as a maximal run, in seq order among the issue's registered
	// (vote_cast, 1) events, sharing one ts, so this is the only batch of the
	// issue that can still grow; every earlier one has ended and was checked
	// when it ended.
	haveOpen  bool
	openTS    int64
	openCount int64
}

// batchKey names one batch instant of one issue. The issue is identified by
// its tracked record, so no separate index is kept. ts is keyed by its
// millisecond offset; ES-20 fixes one textual form per instant, so offset
// equality is ts equality — the only comparison ES-21 permits here.
type batchKey struct {
	issue *issueInfo
	ts    int64
}

// ballotState holds the batch instants each issue has LEFT (ET-24a). Cost is
// one map lookup and at most one insert per ballot, and the map holds at most
// one entry per closed batch: linear in the export, with no pairwise
// comparison of ballots and nothing deferred to the end of the scan.
type ballotState struct {
	left map[batchKey]struct{}
}

func newBallotState() ballotState {
	return ballotState{left: map[batchKey]struct{}{}}
}

// observe applies ET-24 and ET-24a to one registered vote_cast (ET-24a "which
// ballots count": only the registered (vote_cast, 1) is ever passed here) of
// issue iss whose ts offset is tsMS. Both rules, when broken, are broken AT
// THIS BALLOT'S LINE, so it returns (reason, false) for the caller to report
// there.
//
//   - Same ts as the issue's previous registered ballot: the ballot extends
//     the open batch (run).
//   - Different ts: this ballot ends the open batch. If that batch is
//     under-size it was not the issue's last, and this is "the registered
//     (vote_cast, 1) of that issue that ends the under-size batch" (ET-24).
//     This ballot starts a new batch; if its ts equals that of a batch the
//     issue has already ended, it is the returning ballot (ET-24a: "No two
//     batches of one issue may share a ts"). A returning ballot never rejoins
//     the earlier batch. Both faults name this same line, and ET-24a's "One
//     line, two rules" fixes that no precedence is needed (EV-17).
//
// The batch still open at the end of the scan holds the issue's highest-seq
// registered ballot and is exempt from the minimum (ET-24); it is never
// checked.
func (b *ballotState) observe(iss *issueInfo, tsMS int64) (string, bool) {
	if iss.haveOpen && iss.openTS == tsMS {
		iss.openCount++
		return "", true
	}
	if iss.haveOpen {
		if iss.openCount < iss.batchMin {
			return "an earlier batch of this issue is under ballot_batch_min and this ballot proves it was not the issue's last (ET-24)", false
		}
		b.left[batchKey{issue: iss, ts: iss.openTS}] = struct{}{}
	}
	if _, ok := b.left[batchKey{issue: iss, ts: tsMS}]; ok {
		return "ballot returns to a batch instant its issue has already left (ET-24a)", false
	}
	iss.haveOpen, iss.openTS, iss.openCount = true, tsMS, 1
	return "", true
}

// tsMillis converts an ES-20-valid ts to milliseconds since
// 1970-01-01T00:00:00.000Z on the proleptic Gregorian calendar, 86400000 ms per
// day, no leap seconds (ET-23). The caller guarantees validTS(s). Years 0000
// through 9999 are representable by ES-20's four-digit field; dates before 1970
// yield negative offsets; ET-23 v10 states that zero and negative multiples
// count, which the % test below honours.
func tsMillis(s string) int64 {
	y := int64(atoiFixed(s[0:4]))
	m := int64(atoiFixed(s[5:7]))
	d := int64(atoiFixed(s[8:10]))
	hh := int64(atoiFixed(s[11:13]))
	mm := int64(atoiFixed(s[14:16]))
	ss := int64(atoiFixed(s[17:19]))
	ms := int64(atoiFixed(s[20:23]))
	days := daysFromCivil(y, m, d)
	return (((days*24+hh)*60+mm)*60+ss)*1000 + ms
}

// daysFromCivil returns the number of days from 1970-01-01 to y-m-d on the
// proleptic Gregorian calendar (H. Hinnant's days_from_civil).
func daysFromCivil(y, m, d int64) int64 {
	if m <= 2 {
		y--
	}
	era := y
	if era < 0 {
		era -= 399
	}
	era /= 400
	yoe := y - era*400 // [0, 399]
	mp := m + 9        // March-based month: Mar=0 .. Feb=11
	if m > 2 {
		mp = m - 3
	}
	doy := (153*mp+2)/5 + d - 1            // [0, 365]
	doe := yoe*365 + yoe/4 - yoe/100 + doy // [0, 146096]
	return era*146097 + doe - 719468
}
