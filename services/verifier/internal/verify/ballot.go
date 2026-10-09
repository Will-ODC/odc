package verify

// Ballot publication discipline (event-types.md ET-23, ET-24; ADR-0014).
//
// ET-25 (order within a batch) is deliberately absent: the contract declares it
// unverifiable from the log and assigns it to neither verification stage
// (EV-15). A shuffled batch and an arrival-ordered one are indistinguishable,
// so there is nothing here to check.

// issueInfo is what the verifier tracks per accepted issue_created (ID-7):
// choice_count for ET-18a and the two ET-14b batching parameters that
// ET-23/ET-24 are checked against.
type issueInfo struct {
	idx         int   // dense per-chain index, used as the batch-map key
	choiceCount int64 // ET-14a / ET-18a
	intervalMS  int64 // ballot_batch_interval_ms (ET-14b, ET-23)
	batchMin    int64 // ballot_batch_min (ET-14b, ET-24)
	lastBatch   *batch
}

// batchKey identifies an ET-24 batch: "the set of all vote_cast events on a
// chain sharing both an issue_id and a ts". ts is keyed by its millisecond
// offset; ES-20 fixes ts to one textual form per instant, so offset equality is
// string equality.
type batchKey struct {
	issue int
	ts    int64
}

// batch is one ET-24 batch.
//
// nextAfter is the line of the first ballot of the same issue appended after
// this batch's highest-seq member, or 0 when no such ballot has been seen yet.
// It is maintained incrementally: when a ballot of issue X arrives, the batch
// holding X's previous ballot (X's lastBatch) has that ballot as its latest
// member, so if the new ballot belongs to a different batch it is exactly the
// "first vote_cast of that issue appended after" that batch; and the batch the
// new ballot joins gains a new latest member, so its nextAfter resets. At the
// end of the scan, nextAfter == 0 holds for exactly one batch per issue — the
// one containing the issue's highest-seq ballot, which ET-24 exempts.
type batch struct {
	count     int64
	nextAfter int
}

// ballotState accumulates ET-24 batches across the scan. Cost is O(1) expected
// per ballot (one map operation) and O(batches) at the end, so the whole check
// is linear in the export: no pairwise comparison of ballots ever happens.
type ballotState struct {
	batches map[batchKey]*batch
}

func newBallotState() ballotState {
	return ballotState{batches: map[batchKey]*batch{}}
}

// add records one fully verified vote_cast at line ln, of issue iss, whose
// ts offset is tsMS.
func (b *ballotState) add(iss *issueInfo, tsMS int64, ln int) {
	k := batchKey{issue: iss.idx, ts: tsMS}
	cur := b.batches[k]
	if cur == nil {
		cur = &batch{}
		b.batches[k] = cur
	}
	if prev := iss.lastBatch; prev != nil && prev != cur {
		prev.nextAfter = ln
	}
	cur.count++
	cur.nextAfter = 0
	iss.lastBatch = cur
}

// firstUndersize returns the ET-24 fatal line: over every batch that is
// under-size and is not its issue's last, the first ballot of that issue
// appended after it; the earliest such line wins (EV-17, first fatal line in
// file order). min is looked up per batch from its issue.
func (b *ballotState) firstUndersize(minOf func(issue int) int64) (int, bool) {
	best := 0
	for k, bt := range b.batches {
		if bt.nextAfter == 0 {
			continue // the batch holding the issue's highest-seq ballot: exempt
		}
		if bt.count >= minOf(k.issue) {
			continue
		}
		if best == 0 || bt.nextAfter < best {
			best = bt.nextAfter
		}
	}
	return best, best != 0
}

// tsMillis converts an ES-20-valid ts to milliseconds since
// 1970-01-01T00:00:00.000Z on the proleptic Gregorian calendar, 86400000 ms per
// day, no leap seconds (ET-23). The caller guarantees validTS(s). Years 0000
// through 9999 are representable by ES-20's four-digit field; dates before 1970
// yield negative offsets, which is fine for the multiple test.
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
