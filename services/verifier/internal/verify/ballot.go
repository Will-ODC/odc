package verify

import "sort"

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

// issueBatches is the per-issue state of ET-24/ET-24a over the issue's
// registered ballots alone: O(1) fields plus the set of instants its
// registered ballots used (which ET-24a needs anyway). Nothing here grows
// with opaque ballots: every ET-24b question about candidates is asked of the
// chain-wide ballotState when a registered ballot of this issue arrives.
//
// ts values are keyed by their millisecond offset; ES-20 fixes one textual
// form per instant, so offset equality is ts equality, and nothing here ever
// orders two ts values (ES-21).
type issueBatches struct {
	have     bool               // a registered ballot of I exists, so P(L) exists for the next L
	lastSeq  int64              // seq(P(L)) for the next registered ballot L
	used     map[int64]struct{} // instants of I's registered ballots (ET-24a)
	runTS    int64              // t: instant of the current known run R
	runSize  int64              // |R|
	runFirst int64              // seq(f), f the first ballot of R
	runW     int64              // w: seq(P(f)), or c when P(f) does not exist
}

// batchOutcome is the result of ET-24/ET-24a/ET-24b at one registered ballot.
type batchOutcome int

const (
	batchPass       batchOutcome = iota // resolved, and it passes
	batchUnresolved                     // ET-24b item 4: list the line in PARTIAL
	batchFail                           // a definite failure: INVALID at this line
)

// observe decides ET-24 and ET-24a, as qualified by ET-24b, for the registered
// ballot L of this issue at seq/tsMS, and then records L. Every test reads
// only what lines before L left behind, so each line's outcome is fixed when
// the scan reaches it (EX-16). The caller has checked ET-23, so Δ | ts(L) and
// Δ | t for every known run.
//
// ET-24 (v12): a batch is a maximal run, in seq order among the issue's
// registered ballots, sharing one ts. L is a run start when P(L) exists and
// ts(P(L)) != ts(L); only a run start can fail. A known ET-24a failure (L
// returns to an instant a registered ballot of I already used) is definite.
// A known ET-24 failure (|R| < m) is definite iff |R| + F < m.
func (iss *issueInfo) observe(s *ballotState, seq, tsMS int64) (batchOutcome, string) {
	b := &iss.b
	c := iss.seq
	view := s.view(iss.intervalMS)
	out, reason := batchPass, ""
	if !b.have || tsMS == b.runTS {
		// Not a run start: no known failure is possible. Item 4(b), first
		// case: a candidate after P(L) (or after c) at another instant.
		after := c
		if b.have {
			after = b.lastSeq
		}
		if view.candidateAfterNotAt(after, tsMS) {
			out = batchUnresolved
		}
	} else {
		// L is a run start; R is the current run, ending at P(L).
		if _, ok := b.used[tsMS]; ok {
			return batchFail, "ballot returns to a batch instant its issue has already left (ET-24a)"
		}
		if b.runSize < iss.batchMin {
			// F: candidates U with w < seq(U) < seq(L) and ts(U) = t. Every
			// opaque ballot recorded so far is before L; ts(U) = t makes U a
			// multiple of Δ, and w >= c makes seq(U) > c.
			f := s.countAtAfter(b.runTS, b.runW)
			if b.runSize+f < iss.batchMin {
				return batchFail, "an earlier batch of this issue is under ballot_batch_min, and no ballot this verifier cannot read could fill it; this ballot proves it was not the issue's last (ET-24, ET-24b)"
			}
			out = batchUnresolved // item 4(a)
		} else if s.latestAt(tsMS) > c || view.candidateAfterNotAt(b.runFirst, b.runTS) {
			// Item 4(b), second case: a candidate at ts(L) (Δ | ts(L), so
			// any opaque ballot there after c is one), or one after f at an
			// instant other than t.
			out = batchUnresolved
		}
	}

	// Record L. A ballot that begins a known run (a run start, or I's first
	// registered ballot) fixes that run's f and w.
	if !b.have || tsMS != b.runTS {
		if b.used == nil {
			b.used = map[int64]struct{}{}
		}
		b.used[tsMS] = struct{}{}
		b.runW = c
		if b.have {
			b.runW = b.lastSeq
		}
		b.runTS, b.runSize, b.runFirst = tsMS, 1, seq
		b.have = true
	} else {
		b.runSize++
	}
	b.lastSeq = seq
	return out, reason
}

// ballotState is the chain-wide record of opaque ballots that ET-24b's
// questions are answered from. Its size is linear in the number of opaque
// ballots plus the number of distinct issue intervals; nothing is kept per
// (issue, opaque ballot) pair, and recording an opaque ballot is O(1)
// amortised whatever the number of issues.
//
// The questions, for a registered issue I (created at c, interval Δ):
//   - "how many opaque ballots at instant t after seq a?" (F, with a >= c):
//     atTS[t] holds the seqs at t, ascending, so it is one binary search;
//   - "is there an opaque ballot at instant x after c?": the last seq in
//     atTS[x];
//   - "is there a candidate of I after seq a (a >= c) at an instant other
//     than x?": answered by the interval view of Δ, below.
type ballotState struct {
	opaque []opaqueRec        // every opaque ballot, in seq order
	atTS   map[int64][]int64  // ts -> seqs of the opaque ballots at ts, ascending
	views  map[int64]*ivlView // Δ -> view, created on first use
}

type opaqueRec struct{ seq, ts int64 }

// ivlView summarises the opaque ballots whose ts is a multiple of one
// interval Δ: the latest such ballot, and the latest such ballot at an
// instant other than the latest one's. That is enough to answer "a multiple
// of Δ after seq a at an instant other than x" for any a and x. It folds in
// opaque ballots lazily, from a cursor into ballotState.opaque, so each
// opaque ballot is tested against Δ at most once, and only for intervals a
// registered ballot has asked about.
type ivlView struct {
	cursor    int
	have      bool
	latestTS  int64
	latestSeq int64
	otherSeq  int64 // 0 when no such ballot (every seq is >= 2)
}

func newBallotState() ballotState {
	return ballotState{atTS: map[int64][]int64{}, views: map[int64]*ivlView{}}
}

// opaqueBallot records an opaque ballot. Of it only its envelope seq and ts
// are used; its payload is never consulted ("Which ballots count", ET-24b).
func (s *ballotState) opaqueBallot(seq, tsMS int64) {
	s.opaque = append(s.opaque, opaqueRec{seq, tsMS})
	s.atTS[tsMS] = append(s.atTS[tsMS], seq)
}

// countAtAfter counts the opaque ballots at instant ts with seq > after.
func (s *ballotState) countAtAfter(ts, after int64) int64 {
	seqs := s.atTS[ts]
	i := sort.Search(len(seqs), func(i int) bool { return seqs[i] > after })
	return int64(len(seqs) - i)
}

// latestAt is the highest seq of an opaque ballot at instant ts, or 0.
func (s *ballotState) latestAt(ts int64) int64 {
	seqs := s.atTS[ts]
	if len(seqs) == 0 {
		return 0
	}
	return seqs[len(seqs)-1]
}

// view returns Δ's interval view, brought up to date with every opaque ballot
// recorded so far. The multiple test is ET-23's (ET-24b item 1).
func (s *ballotState) view(d int64) *ivlView {
	v := s.views[d]
	if v == nil {
		v = &ivlView{}
		s.views[d] = v
	}
	for ; v.cursor < len(s.opaque); v.cursor++ {
		o := s.opaque[v.cursor]
		if o.ts%d != 0 {
			continue
		}
		if v.have && o.ts != v.latestTS {
			v.otherSeq = v.latestSeq
		}
		v.have, v.latestTS, v.latestSeq = true, o.ts, o.seq
	}
	return v
}

// candidateAfterNotAt reports whether an opaque ballot with seq > after, ts a
// multiple of Δ, and ts != x has been recorded. With after >= c that is a
// candidate of the issue (ET-24b item 1).
func (v *ivlView) candidateAfterNotAt(after, x int64) bool {
	if !v.have {
		return false
	}
	if v.latestTS != x {
		return v.latestSeq > after
	}
	return v.otherSeq > after
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
