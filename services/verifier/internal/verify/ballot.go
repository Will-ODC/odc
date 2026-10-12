package verify

// Ballot publication discipline (event-types.md v12: ET-23, ET-24, ET-24a,
// and ET-24b beside ballots the verifier cannot read).
//
// ET-25 (order within a batch) is deliberately absent: the contract declares it
// unverifiable from the log and assigns it to neither verification stage
// (EV-15). A shuffled batch and an arrival-ordered one are indistinguishable,
// so there is nothing here to check.
//
// Vocabulary (ET-24b). For a REGISTERED issue I, created at seq c, with
// interval Δ and minimum m:
//   - a registered ballot of I is a vote_cast at a registered version whose
//     issue_id names I (ET-24, ET-22a);
//   - an opaque ballot is a vote_cast at an unregistered version that passed
//     Stage A and ES-15..ES-17; only its envelope seq and ts are used, never
//     its payload ("Which ballots count");
//   - an opaque ballot U is a candidate of I iff seq(U) > c and ts(U) is a
//     multiple of Δ (ET-24b item 1).

// issueInfo is what the verifier tracks per accepted (registered)
// issue_created (ID-7): choice_count for ET-18a, the two ET-14b batching
// parameters ET-23/ET-24 are checked against, its seq (c), and its batch state.
type issueInfo struct {
	choiceCount int64 // ET-14a / ET-18a
	intervalMS  int64 // Δ: ballot_batch_interval_ms (ET-14b, ET-23)
	batchMin    int64 // m: ballot_batch_min (ET-14b, ET-24)
	seq         int64 // c: the issue_created's seq (ET-24b)

	b issueBatches
}

// issueBatches is the one-pass state of ET-24b's informative "One pass"
// paragraph, per registered issue. Every field is decided from lines already
// scanned, so each line's outcome is fixed when the scan reaches it (EX-16).
//
// ts values are keyed by their millisecond offset; ES-20 fixes one textual
// form per instant, so offset equality is ts equality, and nothing here ever
// orders two ts values (ES-21).
type issueBatches struct {
	// Registered ballots.
	have    bool               // a registered ballot of I exists (so P(L) exists for the next L)
	used    map[int64]struct{} // instants of I's registered ballots (ET-24a)
	runTS   int64              // t: instant of the current known run
	runSize int64              // |R| of the current known run

	// Candidates.
	runF    int64              // F for the current run: candidates with w < seq(U), ts(U) = runTS
	runDiff bool               // a candidate with seq(U) > seq(f) and ts(U) != runTS has been seen
	sinceP  map[int64]int64    // candidate ts -> count, since I's last registered ballot (or c)
	candTS  map[int64]struct{} // every candidate instant of I since c
}

// candidate records an opaque ballot at tsMS that is a candidate of this issue
// (the caller has checked seq(U) > c and Δ | tsMS). One opaque ballot may be a
// candidate of several issues and counts in each (ET-24b item 1).
func (b *issueBatches) candidate(tsMS int64) {
	if b.sinceP == nil {
		b.sinceP = map[int64]int64{}
	}
	b.sinceP[tsMS]++
	if b.candTS == nil {
		b.candTS = map[int64]struct{}{}
	}
	b.candTS[tsMS] = struct{}{}
	if b.have {
		// seq(U) > seq(f) > w, since the current run's first ballot is
		// already scanned.
		if tsMS == b.runTS {
			b.runF++
		} else {
			b.runDiff = true
		}
	}
}

// candidateSincePOtherThan reports whether a candidate with ts != tsMS has
// been seen since P(L) (or since c when P(L) does not exist): ET-24b item
// 4(b), first case.
func (b *issueBatches) candidateSincePOtherThan(tsMS int64) bool {
	for ts := range b.sinceP {
		if ts != tsMS {
			return true
		}
	}
	return false
}

// batchOutcome is the result of ET-24/ET-24a/ET-24b at one registered ballot.
type batchOutcome int

const (
	batchPass       batchOutcome = iota // resolved, and it passes
	batchUnresolved                     // ET-24b item 4: list the line in PARTIAL
	batchFail                           // a definite failure: INVALID at this line
)

// observe decides ET-24 and ET-24a, as qualified by ET-24b, for the registered
// ballot L of this issue at tsMS, and then records L. Every test reads only
// what lines before L left behind.
//
// ET-24 (v12): a batch is a maximal run, in seq order among the issue's
// registered ballots, sharing one ts. L is a run start when P(L) exists and
// ts(P(L)) != ts(L); only a run start can fail. A known ET-24a failure (L
// returns to an instant a registered ballot of I already used) is definite.
// A known ET-24 failure (|R| < m) is definite iff |R| + F < m.
func (iss *issueInfo) observe(tsMS int64) (batchOutcome, string) {
	b := &iss.b
	out, reason := batchPass, ""
	switch {
	case !b.have || tsMS == b.runTS:
		// Not a run start: no known failure is possible. Item 4(b), first
		// case: a candidate since P(L) (or since c) at another instant
		// could have ended the run L extends, or opened a batch L's first
		// ballot ends.
		if b.candidateSincePOtherThan(tsMS) {
			out = batchUnresolved
		}
	default:
		// L is a run start; R is the current run, ending at P(L).
		if _, ok := b.used[tsMS]; ok {
			return batchFail, "ballot returns to a batch instant its issue has already left (ET-24a)"
		}
		if b.runSize < iss.batchMin {
			if b.runSize+b.runF < iss.batchMin {
				return batchFail, "an earlier batch of this issue is under ballot_batch_min, and no ballot this verifier cannot read could fill it; this ballot proves it was not the issue's last (ET-24, ET-24b)"
			}
			out = batchUnresolved // item 4(a)
		} else {
			// Item 4(b), second case.
			_, atL := b.candTS[tsMS]
			if atL || b.runDiff {
				out = batchUnresolved
			}
		}
	}

	// Record L. If it begins a known run (a run start, or I's first
	// registered ballot), F for that run starts at the candidates at ts(L)
	// seen since P(L), or since c.
	if !b.have || tsMS != b.runTS {
		if b.used == nil {
			b.used = map[int64]struct{}{}
		}
		b.used[tsMS] = struct{}{}
		b.runTS, b.runSize = tsMS, 1
		b.runF = b.sinceP[tsMS]
		b.runDiff = false
		b.have = true
	} else {
		b.runSize++
	}
	if len(b.sinceP) > 0 {
		b.sinceP = nil
	}
	return out, reason
}

// ballotState tracks the registered issues for ET-24b's candidacy test,
// grouped by interval so that an opaque ballot's multiple test (ET-23's
// computation) runs once per distinct interval, then updates every issue
// sharing it. Cost per opaque ballot is one multiple test per distinct
// interval plus one update per issue it is a candidate of — the update
// ET-24b's "One pass" paragraph describes. A registered ballot costs a
// constant number of map operations plus one pass over the candidate
// instants seen since its issue's previous registered ballot.
type ballotState struct {
	byInterval map[int64][]*issueInfo
	intervals  []int64 // distinct intervals, in first-seen order
}

func newBallotState() ballotState {
	return ballotState{byInterval: map[int64][]*issueInfo{}}
}

// addIssue registers an accepted issue_created for candidacy.
func (s *ballotState) addIssue(iss *issueInfo) {
	if _, ok := s.byInterval[iss.intervalMS]; !ok {
		s.intervals = append(s.intervals, iss.intervalMS)
	}
	s.byInterval[iss.intervalMS] = append(s.byInterval[iss.intervalMS], iss)
}

// opaqueBallot records an opaque ballot at seq with ts offset tsMS as a
// candidate of every registered issue it is one of (ET-24b item 1). Its
// payload is never consulted.
func (s *ballotState) opaqueBallot(seq, tsMS int64) {
	for _, d := range s.intervals {
		if tsMS%d != 0 {
			continue
		}
		for _, iss := range s.byInterval[d] {
			if seq > iss.seq {
				iss.b.candidate(tsMS)
			}
		}
	}
}

// tsMillis converts an ES-20-valid ts to milliseconds since
// 1970-01-01T00:00:00.000Z on the proleptic Gregorian calendar, 86400000 ms per
// day, no leap seconds (ET-23). The caller guarantees validTS(s). Years 0000
// through 9999 are representable by ES-20's four-digit field; dates before 1970
// yield negative offsets; ET-23 states that zero and negative multiples
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
