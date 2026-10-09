package verify

import (
	"bytes"
	"crypto/ed25519"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// ET-23 (quantized ballot ts), ET-24 (minimum batch size, with its line
// attribution) and ET-24a (a batch, once left, is closed), event-types.md v10
// "Ballot publication discipline".
//
// HARNESS CAVEAT (as in genesis_ancestry_test.go): these chains are hashed and
// signed by the code under test, so they are self-consistent by construction
// and pin no preimage shape. contracts/fixtures/ ships no vector whose ballots
// span more than one batch and none citing ET-23, so until vectors land these
// tests are the only thing exercising these rules. Every case is a
// differential: one ts, one extra ballot, one reordering moves the verdict in
// the direction the rule names. Rejections also assert the advisory reason —
// not conformance (EV-17), but "INVALID at line N" alone is satisfied by any
// fault on that line.

// --- harness -----------------------------------------------------------

type issueSpec struct {
	interval int64 // ballot_batch_interval_ms
	min      int64 // ballot_batch_min
}

// vote is one chain entry after the issues. By default it is a registered
// vote_cast of the 0-based issue at ts. kind selects the two other entries the
// ET-24a cases need between one batch's members.
type vote struct {
	issue int
	ts    string
	kind  entryKind
}

type entryKind int

const (
	ballotV1     entryKind = iota // registered (vote_cast, 1)
	participant                   // a participant_registered line (ts any)
	ballotUnregV                  // (vote_cast, 1000000): unregistered, EV-8
)

func participantAt(ts string) vote          { return vote{0, ts, participant} }
func unregBallot(issue int, ts string) vote { return vote{issue, ts, ballotUnregV} }

// defaultIssue is at both ET-14b floors.
var defaultIssue = issueSpec{interval: 60000, min: 3}

// Batch instants on the default 60000 ms interval (whole minutes).
const (
	T1 = "2026-01-01T00:02:00.000Z"
	T2 = "2026-01-01T00:03:00.000Z"
	T3 = "2026-01-01T00:04:00.000Z"
	T4 = "2026-01-01T00:05:00.000Z"
)

// ballotChainLines builds a chain: genesis at line 1, one issue_created per
// spec at lines 2.., then one registrar-signed vote_cast per vote, in order.
// It returns the lines without LFs.
func ballotChainLines(t *testing.T, issues []issueSpec, votes []vote) [][]byte {
	t.Helper()
	opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)
	regPriv := ed25519.NewKeyFromSeed(testRegistrarSeed)

	g := trimLF(genesisExport(t, 1, nil))
	lines := [][]byte{g}
	prev := parseLineOrFail(t, g).hash
	seq := int64(1)

	ids := make([]string, len(issues))
	for i, is := range issues {
		seq++
		l := signAndSeal(t, opPriv, seq, "issue_created", 1, map[string]any{
			"title":                    fmt.Sprintf("issue %d", i),
			"choice_count":             int64(2),
			"ballot_batch_interval_ms": is.interval,
			"ballot_batch_min":         is.min,
		}, "2026-01-01T00:00:30.123Z", prev) // issue ts is unconstrained by ET-23
		prev = parseLineOrFail(t, l).hash
		ids[i] = prev
		lines = append(lines, l)
	}
	for _, v := range votes {
		seq++
		var l []byte
		switch v.kind {
		case ballotV1:
			l = signAndSeal(t, regPriv, seq, "vote_cast", 1, map[string]any{
				"issue_id": ids[v.issue],
				"choice":   int64(seq % 2),
			}, v.ts, prev)
		case participant:
			pp := ed25519.NewKeyFromSeed(bytes32(byte(seq)))
			l = signAndSeal(t, pp, seq, "participant_registered", 1, map[string]any{
				"pubkey": fmt.Sprintf("%x", []byte(pp.Public().(ed25519.PublicKey))),
			}, v.ts, prev)
		case ballotUnregV:
			// Stage B never runs on it, so it needs no valid sig; its payload
			// names a real issue so that a verifier that DID read it would act.
			l = seal(t, seq, "vote_cast", 1000000, map[string]any{
				"issue_id": ids[v.issue],
				"choice":   int64(0),
			}, v.ts, prev)
		}
		prev = parseLineOrFail(t, l).hash
		lines = append(lines, l)
	}
	return lines
}

func joinLines(lines [][]byte) []byte {
	var b bytes.Buffer
	for _, l := range lines {
		b.Write(l)
		b.WriteByte('\n')
	}
	return b.Bytes()
}

func ballotChain(t *testing.T, issues []issueSpec, votes []vote) []byte {
	t.Helper()
	return joinLines(ballotChainLines(t, issues, votes))
}

// votesAt returns n ballots of one issue, all at ts.
func votesAt(issue, n int, ts string) []vote {
	out := make([]vote, n)
	for i := range out {
		out[i] = vote{issue: issue, ts: ts}
	}
	return out
}

func cat(parts ...[]vote) []vote {
	var out []vote
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

type ballotCase struct {
	name   string
	issues []issueSpec
	votes  []vote
	line   int    // 0 means VALID
	reason string // expected reason substring for INVALID
}

func runBallotCases(t *testing.T, cases []ballotCase) {
	t.Helper()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Verify(ballotChain(t, c.issues, c.votes), nil)
			assertResult(t, res, c.line, c.reason)
		})
	}
}

func assertResult(t *testing.T, res Result, line int, reason string) {
	t.Helper()
	if line == 0 {
		if res.Verdict != VALID {
			t.Fatalf("verdict = %s at line %d, want VALID (reason: %s)", res.Verdict, res.Line, res.Reason)
		}
		return
	}
	if res.Verdict != INVALID || res.Line != line {
		t.Fatalf("got %s at line %d, want INVALID at line %d (reason: %s)", res.Verdict, res.Line, line, res.Reason)
	}
	assertReason(t, res, reason)
}

// --- ET-23 -------------------------------------------------------------

func TestET23QuantizedBallotTS(t *testing.T) {
	one := []issueSpec{defaultIssue}
	i90 := []issueSpec{{interval: 90000, min: 3}}
	day := []issueSpec{{interval: 86400000, min: 3}}
	week := []issueSpec{{interval: 7 * 86400000, min: 3}}
	runBallotCases(t, []ballotCase{
		{"on_the_minute", one, votesAt(0, 3, T1), 0, ""},
		// One millisecond either side of a legal instant; the faulty ballot is
		// the third one, so the line is 5, not the first ballot's.
		{"one_ms_late", one, cat(votesAt(0, 2, T1), votesAt(0, 1, "2026-01-01T00:02:00.001Z")), 5, "ET-23"},
		{"one_ms_early", one, cat(votesAt(0, 2, T1), votesAt(0, 1, "2026-01-01T00:01:59.999Z")), 5, "ET-23"},
		{"one_second_off", one, votesAt(0, 1, "2026-01-01T00:02:01.000Z"), 3, "ET-23"},
		// The interval is the ISSUE's, not the floor. 2026-01-01T00:00:00Z is
		// 1767225600000 ms = 19635840 * 90000, so 00:01:30 and 00:03:00 are
		// multiples of 90000 and 00:02:00 (a multiple of 60000) is not.
		{"interval_90s_on", i90, votesAt(0, 3, "2026-01-01T00:03:00.000Z"), 0, ""},
		{"interval_90s_on_half_minute", i90, votesAt(0, 3, "2026-01-01T00:01:30.000Z"), 0, ""},
		{"interval_90s_whole_minute_off", i90, votesAt(0, 1, "2026-01-01T00:02:00.000Z"), 3, "ET-23"},
		// Day and week intervals exercise the calendar conversion: 1970-01-01
		// was a Thursday, and so was 2026-01-01.
		{"day_leap_day", day, votesAt(0, 3, "2024-02-29T00:00:00.000Z"), 0, ""},
		{"day_noon_off", day, votesAt(0, 1, "2024-02-29T12:00:00.000Z"), 3, "ET-23"},
		{"week_thursday", week, votesAt(0, 3, "2026-01-01T00:00:00.000Z"), 0, ""},
		{"week_friday_off", week, votesAt(0, 1, "2026-01-02T00:00:00.000Z"), 3, "ET-23"},
		// Before the epoch the offset is negative; an exact multiple is still
		// an exact multiple.
		{"pre_epoch_on", one, votesAt(0, 3, "1969-12-31T23:59:00.000Z"), 0, ""},
		{"pre_epoch_off", one, votesAt(0, 1, "1969-12-31T23:59:59.999Z"), 3, "ET-23"},
		{"year_0000_on", one, votesAt(0, 3, "0000-01-01T00:00:00.000Z"), 0, ""},
		{"year_9999_last_ms_off", one, votesAt(0, 1, "9999-12-31T23:59:59.999Z"), 3, "ET-23"},
	})
}

// tsMillis against an independent oracle, Go's time package, which also uses
// the proleptic Gregorian calendar with no leap seconds.
func TestTSMillisMatchesTimePackage(t *testing.T) {
	years := []int{0, 1, 4, 99, 100, 399, 400, 1600, 1900, 1969, 1970, 1971, 2000, 2024, 2026, 2100, 9999}
	for _, y := range years {
		for m := 1; m <= 12; m++ {
			for _, d := range []int{1, 28, daysInMonth(y, m)} {
				want := time.Date(y, time.Month(m), d, 13, 37, 59, 999e6, time.UTC).UnixMilli()
				s := fmt.Sprintf("%04d-%02d-%02dT13:37:59.999Z", y, m, d)
				if !validTS(s) {
					t.Fatalf("harness built an invalid ts %s", s)
				}
				if got := tsMillis(s); got != want {
					t.Fatalf("tsMillis(%s) = %d, want %d", s, got, want)
				}
			}
		}
	}
}

// --- ET-24 -------------------------------------------------------------

func TestET24MinimumBatchSize(t *testing.T) {
	one := []issueSpec{defaultIssue}
	two := []issueSpec{defaultIssue, defaultIssue}
	runBallotCases(t, []ballotCase{
		// Accept.
		{"batches_exactly_at_min", one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2)), 0, ""},
		{"only_batch_undersize_is_last", one, votesAt(0, 1, T1), 0, ""},
		{"last_batch_undersize_legal", one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 2, T3)), 0, ""},
		{"no_ballots", one, nil, 0, ""},

		// Reject: the blamed line is the first ballot of the same issue
		// appended after the under-size batch — never the batch itself.
		{"undersize_then_later_ballot", one, cat(votesAt(0, 2, T1), votesAt(0, 1, T2)), 5, "ET-24"},
		{"min_minus_one_mid_chain", one, cat(votesAt(0, 3, T1), votesAt(0, 2, T2), votesAt(0, 3, T3)), 8, "ET-24"},
		// Two under-size batches: the earlier fatal line wins.
		{"two_undersize_first_wins", one, cat(votesAt(0, 1, T1), votesAt(0, 1, T2), votesAt(0, 1, T3)), 4, "ET-24"},
		// The legal under-size batch is only the LAST: an under-size batch
		// followed by a full one is still fatal.
		{"undersize_then_full", one, cat(votesAt(0, 1, T1), votesAt(0, 3, T2)), 4, "ET-24"},

		// Per-issue: ballots of another issue in between do not count as
		// "a later ballot of the same issue".
		{"other_issue_between_then_same_issue", two,
			cat(votesAt(0, 2, T1), votesAt(1, 3, T1), votesAt(0, 1, T2)), 9, "ET-24"},
		{"other_issue_after_undersize_is_fine", two,
			cat(votesAt(0, 2, T1), votesAt(1, 3, T1), votesAt(1, 3, T2)), 0, ""},
	})
}

// Ballots of two issues interleaved line by line.
func TestET24InterleavedIssues(t *testing.T) {
	two := []issueSpec{defaultIssue, defaultIssue}
	alt := func(ts string, n int) []vote {
		var v []vote
		for i := 0; i < n; i++ {
			v = append(v, vote{0, ts, ballotV1}, vote{1, ts, ballotV1})
		}
		return v
	}
	// Each issue: 3 at T1, then 1 at T2 as its last.
	legal := cat(alt(T1, 3), alt(T2, 1))
	// Issue 0 gets only 2 at T1; issue 1 gets 3. Then issue 0 votes at T2.
	// Lines: 4 A,5 B,6 A,7 B,8 B,9 A@T2.
	bad := cat(alt(T1, 2), []vote{{1, T1, ballotV1}}, []vote{{0, T2, ballotV1}})
	// Same, but issue 0 never votes again: its under-size batch is its last.
	badButLast := cat(alt(T1, 2), []vote{{1, T1, ballotV1}}, []vote{{1, T2, ballotV1}})
	runBallotCases(t, []ballotCase{
		{"interleaved_legal", two, legal, 0, ""},
		{"interleaved_undersize_proven", two, bad, 9, "ET-24"},
		{"interleaved_undersize_is_last", two, badButLast, 0, ""},
	})
}

// Different minima per issue: each batch is judged against its own issue's
// ballot_batch_min, not the floor and not another issue's.
func TestET24PerIssueMinimum(t *testing.T) {
	issues := []issueSpec{defaultIssue, {interval: 60000, min: 5}}
	runBallotCases(t, []ballotCase{
		// Issue 0 (min 3) batch of 4 at lines 4-7: fine. Issue 1 (min 5)
		// batch of 4 at lines 8-11, proven not last by its ballot at line 13.
		{"min5_batch_of_4", issues, cat(votesAt(0, 4, T1), votesAt(1, 4, T1), votesAt(0, 1, T2), votesAt(1, 1, T2)), 13, "ET-24"},
		{"min5_batch_of_5", issues, cat(votesAt(0, 4, T1), votesAt(1, 5, T1), votesAt(0, 1, T2), votesAt(1, 1, T2)), 0, ""},
		{"min3_batch_of_3_with_min5_neighbour", issues, cat(votesAt(0, 3, T1), votesAt(0, 1, T2)), 0, ""},
	})
}

// "Membership and lastness are decided by seq (ES-8), never by comparing ts
// values." ts need not increase along the chain; the exempt batch is the one
// holding the highest-SEQ ballot, not the one with the greatest ts.
func TestET24LastnessIsBySeqNotTS(t *testing.T) {
	one := []issueSpec{defaultIssue}
	runBallotCases(t, []ballotCase{
		// The final ballot carries an EARLIER ts than the full batch before it.
		// Its batch holds the highest-seq ballot, so it is the exempt one.
		{"backwards_ts_last_undersize", one, cat(votesAt(0, 3, T2), votesAt(0, 1, T1)), 0, ""},
		// The greatest ts appears first, under-size; a later-seq batch at an
		// earlier ts proves it was not last.
		{"greatest_ts_first_undersize", one, cat(votesAt(0, 1, T2), votesAt(0, 3, T1)), 4, "ET-24"},
	})
}

// ET-24a: "Taking one issue's vote_cast events in seq order, a ballot whose ts
// differs from the ts of that issue's previous ballot MUST NOT equal the ts of
// any earlier ballot of that issue", rejected "at the line of the returning
// ballot".
func TestET24aReturnToLeftInstant(t *testing.T) {
	one := []issueSpec{defaultIssue}
	runBallotCases(t, []ballotCase{
		// Rejected at the returning line — not at the first member (line 3)
		// of the batch it returns to.
		{"return_at_end_of_chain", one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 1, T1)), 9, "ET-24a"},
		{"return_mid_chain", one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 1, T1), votesAt(0, 3, T3)), 9, "ET-24a"},
		// The left instant is two batches back, not the immediately previous.
		{"return_past_two_batches", one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 3, T3), votesAt(0, 1, T1)), 12, "ET-24a"},
		// The returning ballot also closes an under-size batch: ET-24 and
		// ET-24a both name line 7, and either reason is right.
		{"return_after_undersize_batch", one, cat(votesAt(0, 3, T1), votesAt(0, 1, T2), votesAt(0, 1, T1)), 7, "ET-24"},
		// Returning to an under-size batch cannot rescue it: it was closed,
		// and proven not-last, at line 4.
		{"return_to_undersize_batch", one, cat(votesAt(0, 1, T1), votesAt(0, 3, T2), votesAt(0, 2, T1)), 4, "ET-24"},

		// Accepted: staying at an instant is not a return, and a new instant
		// is not one either, whatever its value relative to the others.
		{"one_long_batch", one, votesAt(0, 7, T1), 0, ""},
		{"new_earlier_instant", one, cat(votesAt(0, 3, T3), votesAt(0, 3, T1), votesAt(0, 3, T2)), 0, ""},
	})
}

// ET-24a binds each issue separately: "other events, including other issues'
// ballots, MAY fall between the ballots of one batch".
func TestET24aPerIssueRuns(t *testing.T) {
	one := []issueSpec{defaultIssue}
	two := []issueSpec{defaultIssue, defaultIssue}
	// A = issue 0, B = issue 1; ballots start at line 4.
	shared := cat(votesAt(0, 2, T1), votesAt(1, 3, T1), votesAt(0, 1, T1), votesAt(1, 3, T2))
	runBallotCases(t, []ballotCase{
		// A's T1 batch {4, 5, 9} has B's ballots in between: one run of A's.
		{"other_issue_between_members", two, shared, 0, ""},
		// B left T1 at line 10, so its ballot at line 13 returns.
		{"other_issue_returns", two, cat(shared, votesAt(1, 1, T1)), 13, "ET-24a"},
		// A left T1; B's FIRST ballot at T1 is no return — instants are per
		// issue, not per chain.
		{"same_instant_other_issue_after_leaving", two, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(1, 3, T1)), 0, ""},
		// Non-ballot events between one batch's members, carrying a ts the
		// issue has never used.
		{"participants_between_members", one, []vote{
			{0, T1, ballotV1}, participantAt(T2), {0, T1, ballotV1}, participantAt(T3),
			{0, T1, ballotV1}, {0, T2, ballotV1},
		}, 0, ""},
	})
}

// "Which ballots count": a vote_cast at an unregistered version "joins no
// batch, closes none, and proves none not-last". The chains below are PARTIAL
// at the unregistered line and nothing else.
func TestET24UnregisteredVoteVersionCountsForNothing(t *testing.T) {
	one := []issueSpec{defaultIssue}
	cases := []struct {
		name  string
		votes []vote
		line  int
	}{
		// Does not prove A's under-size T1 batch not-last.
		{"proves_none_not_last", cat(votesAt(0, 2, T1), []vote{unregBallot(0, T2)}), 5},
		// Does not close T1: the v1 ballot at line 6 rejoins the same run,
		// making T1 = {3, 4, 6} — neither a return nor an under-size close.
		{"closes_none", cat(votesAt(0, 2, T1), []vote{unregBallot(0, T2)}, votesAt(0, 1, T1), votesAt(0, 1, T2)), 5},
		// Does not join a batch: at an instant A has left, it is no return,
		// and it does not interrupt A's open T2 run.
		{"joins_none", cat(votesAt(0, 3, T1), votesAt(0, 2, T2), []vote{unregBallot(0, T1)}, votesAt(0, 1, T2), votesAt(0, 1, T3)), 8},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Verify(ballotChain(t, one, c.votes), nil)
			if res.Verdict != PARTIAL || len(res.Lines) != 1 || res.Lines[0] != c.line {
				t.Fatalf("got %s %v (line %d, %s), want PARTIAL at lines %d", res.Verdict, res.Lines, res.Line, res.Reason, c.line)
			}
		})
	}
}

// ET-24/ET-24a against every other rule: the reported line is the first fatal
// line in file order (EV-17).
func TestET24FirstFatalLineAcrossRules(t *testing.T) {
	one := []issueSpec{defaultIssue}

	t.Run("et24_before_later_hash_fault", func(t *testing.T) {
		// Under-size T1 (3,4), proven at 5, then a corrupted line 7.
		lines := ballotChainLines(t, one, cat(votesAt(0, 2, T1), votesAt(0, 3, T2)))
		lines[6] = corruptHash(lines[6])
		assertResult(t, Verify(joinLines(lines), nil), 5, "ET-24")
	})
	t.Run("hash_fault_before_et24", func(t *testing.T) {
		lines := ballotChainLines(t, one, cat(votesAt(0, 2, T1), votesAt(0, 3, T2)))
		lines[3] = corruptHash(lines[3]) // line 4, inside the under-size batch
		assertResult(t, Verify(joinLines(lines), nil), 4, "HA-14")
	})
	t.Run("et23_fault_before_et24", func(t *testing.T) {
		res := Verify(ballotChain(t, one, cat(votesAt(0, 2, T1), votesAt(0, 1, "2026-01-01T00:03:00.007Z"))), nil)
		assertResult(t, res, 5, "ET-23")
	})
	t.Run("et24a_before_later_hash_fault", func(t *testing.T) {
		lines := ballotChainLines(t, one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 1, T1), votesAt(0, 3, T3)))
		lines[10] = corruptHash(lines[10]) // line 11
		assertResult(t, Verify(joinLines(lines), nil), 9, "ET-24a")
	})
	t.Run("hash_fault_before_et24a", func(t *testing.T) {
		lines := ballotChainLines(t, one, cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 1, T1)))
		lines[7] = corruptHash(lines[7]) // line 8
		assertResult(t, Verify(joinLines(lines), nil), 8, "HA-14")
	})
}

// The EX-16 residual ET-24 names: end-truncation can hide a violation by
// making a mid-chain under-size batch the last one; --head is the remedy.
func TestET24TruncationResidualAndHead(t *testing.T) {
	lines := ballotChainLines(t, []issueSpec{defaultIssue}, cat(votesAt(0, 2, T1), votesAt(0, 1, T2)))
	full := joinLines(lines)
	assertResult(t, Verify(full, nil), 5, "ET-24")

	truncated := joinLines(lines[:4])
	assertResult(t, Verify(truncated, nil), 0, "")

	head := parseLineOrFail(t, lines[4]).hash
	assertResult(t, Verify(truncated, &head), 4, "EX-15")
	// With the true head on the full chain, ET-24 still names line 5.
	assertResult(t, Verify(full, &head), 5, "ET-24")
}

// Scale: thousands of closed batches, then one ballot returning to the very
// first instant. An implementation that compares a new instant against every
// earlier batch is quadratic here; the map lookup is not.
func TestET24aLargeChain(t *testing.T) {
	if testing.Short() {
		t.Skip("large chain")
	}
	const batches = 5000
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	at := func(k int) string { return base.Add(time.Duration(k) * time.Minute).Format("2006-01-02T15:04:05.000Z") }
	votes := make([]vote, 0, 3*batches+1)
	for k := 0; k < batches; k++ {
		votes = append(votes, votesAt(0, 3, at(k))...)
	}
	votes = append(votes, vote{0, at(0), ballotV1})
	start := time.Now()
	lines := ballotChainLines(t, []issueSpec{defaultIssue}, votes)
	built := time.Since(start)
	assertResult(t, Verify(joinLines(lines[:len(lines)-1]), nil), 0, "")
	assertResult(t, Verify(joinLines(lines), nil), len(lines), "ET-24a")
	t.Logf("%d ballots built in %s, verified twice in %s", len(votes), built, time.Since(start)-built)
}

// corruptHash flips one hex digit of the line's hash field (HA-14 fault).
func corruptHash(line []byte) []byte {
	s := string(line)
	i := strings.Index(s, `"hash":"`) + len(`"hash":"`)
	c := byte('0')
	if s[i] == '0' {
		c = '1'
	}
	return []byte(s[:i] + string(c) + s[i+1:])
}

// --- CLI surface -------------------------------------------------------

// buildCLI compiles the real command into a test-scoped directory, so the exit
// status and the one-line output shape (API.md) are asserted on the shipped
// binary and nothing outlives the test.
func buildCLI(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "verify")
	out, err := exec.Command("go", "build", "-o", p, "odc/verifier").CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return p
}

func TestBallotRulesCLISurface(t *testing.T) {
	bin := buildCLI(t)
	one := []issueSpec{defaultIssue}
	cases := []struct {
		name  string
		votes []vote
		out   *regexp.Regexp
		code  int
	}{
		{"valid", cat(votesAt(0, 3, T1), votesAt(0, 1, T2)), regexp.MustCompile(`^VALID\n$`), 0},
		{"et24", cat(votesAt(0, 2, T1), votesAt(0, 1, T2)), regexp.MustCompile(`^INVALID at line 5: [^\n]*\n$`), 1},
		{"et23", votesAt(0, 1, "2026-01-01T00:02:00.001Z"), regexp.MustCompile(`^INVALID at line 3: [^\n]*\n$`), 1},
		{"et24a", cat(votesAt(0, 3, T1), votesAt(0, 3, T2), votesAt(0, 1, T1)), regexp.MustCompile(`^INVALID at line 9: [^\n]*\n$`), 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "export.ndjson")
			if err := os.WriteFile(p, ballotChain(t, one, c.votes), 0o600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(bin, p)
			var out, errb bytes.Buffer
			cmd.Stdout, cmd.Stderr = &out, &errb
			err := cmd.Run()
			code := 0
			if ee, ok := err.(*exec.ExitError); ok {
				code = ee.ExitCode()
			} else if err != nil {
				t.Fatal(err)
			}
			if !c.out.MatchString(out.String()) {
				t.Fatalf("stdout %q does not match %s", out.String(), c.out)
			}
			if code != c.code {
				t.Fatalf("exit status %d, want %d", code, c.code)
			}
			if errb.Len() != 0 {
				t.Fatalf("unexpected stderr: %s", errb.String())
			}
		})
	}
}
