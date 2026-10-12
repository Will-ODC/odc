package verify

import (
	"crypto/ed25519"
	"fmt"
	"math/rand"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

// ET-18b and ET-24b (event-types.md v12, ADR-0034): batch checks beside
// ballots the verifier cannot read, and the checks of a registered ballot
// whose issue the verifier cannot read.
//
// HARNESS CAVEAT (as in ballot_test.go): these chains are hashed and signed by
// the code under test, so they are self-consistent by construction and pin no
// preimage shape. What they pin is the verdict and line set ET-24b, ET-18b and
// evolution.md EV-7/EV-17 fix for each chain.

// --- harness -----------------------------------------------------------

type entryKind2 int

const (
	eIssue        entryKind2 = iota // registered (issue_created, 1)
	eOpaqueIssue                    // (issue_created, 1000000)
	eBallot                         // registered (vote_cast, 1) of issue `issue`
	eOpaqueBallot                   // (vote_cast, 1000000); payload names `issue` (or none when -1)
	eRaw                            // a hand-written line, `raw`, used verbatim
)

// entry is one line after the genesis. issue indexes the issues (registered
// or opaque) in creation order.
type entry struct {
	kind     entryKind2
	issue    int
	interval int64
	min      int64
	ts       string
	raw      func(seq int64, prev string) []byte
}

func iss(interval, min int64) entry { return entry{kind: eIssue, interval: interval, min: min} }
func opaqueIssue() entry            { return entry{kind: eOpaqueIssue} }
func bal(issue int, ts string) entry {
	return entry{kind: eBallot, issue: issue, ts: ts}
}
func opq(ts string) entry                  { return entry{kind: eOpaqueBallot, issue: -1, ts: ts} }
func opqNaming(issue int, ts string) entry { return entry{kind: eOpaqueBallot, issue: issue, ts: ts} }

func bals(issue, n int, ts string) []entry {
	out := make([]entry, n)
	for i := range out {
		out[i] = bal(issue, ts)
	}
	return out
}

func ents(parts ...any) []entry {
	var out []entry
	for _, p := range parts {
		switch v := p.(type) {
		case entry:
			out = append(out, v)
		case []entry:
			out = append(out, v...)
		default:
			panic("ents: unsupported part")
		}
	}
	return out
}

// buildEntries renders a chain: genesis at line 1, then one line per entry.
func buildEntries(tt *testing.T, es []entry) []byte {
	tt.Helper()
	opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)
	regPriv := ed25519.NewKeyFromSeed(testRegistrarSeed)
	g := trimLF(genesisExport(tt, 1, nil))
	lines := [][]byte{g}
	prev := parseLineOrFail(tt, g).hash
	seq := int64(1)
	var issueIDs []string
	for _, e := range es {
		seq++
		var l []byte
		switch e.kind {
		case eIssue:
			l = signAndSeal(tt, opPriv, seq, "issue_created", 1, map[string]any{
				"title":                    fmt.Sprintf("issue %d", len(issueIDs)),
				"choice_count":             int64(2),
				"ballot_batch_interval_ms": e.interval,
				"ballot_batch_min":         e.min,
			}, "2026-01-01T00:00:30.123Z", prev)
		case eOpaqueIssue:
			l = seal(tt, seq, "issue_created", 1000000, map[string]any{
				"title":                    fmt.Sprintf("opaque issue %d", len(issueIDs)),
				"choice_count":             int64(2),
				"ballot_batch_interval_ms": int64(60000),
				"ballot_batch_min":         int64(3),
			}, "2026-01-01T00:00:30.123Z", prev)
		case eBallot:
			l = signAndSeal(tt, regPriv, seq, "vote_cast", 1, map[string]any{
				"issue_id": issueIDs[e.issue],
				"choice":   int64(seq % 2),
			}, e.ts, prev)
		case eOpaqueBallot:
			p := map[string]any{"choice": int64(0)}
			if e.issue >= 0 {
				p["issue_id"] = issueIDs[e.issue]
			}
			l = seal(tt, seq, "vote_cast", 1000000, p, e.ts, prev)
		case eRaw:
			l = e.raw(seq, prev)
		}
		if e.kind == eIssue || e.kind == eOpaqueIssue {
			issueIDs = append(issueIDs, parseLineOrFail(tt, l).hash)
		}
		if e.kind != eRaw {
			prev = parseLineOrFail(tt, l).hash
		} else if m := rawHashRE.FindSubmatch(l); m != nil {
			prev = string(m[1])
		}
		lines = append(lines, l)
	}
	return joinLines(lines)
}

var rawHashRE = regexp.MustCompile(`"hash":"([0-9a-f]{64})"}$`)

func assertPartial(t *testing.T, res Result, want []int) {
	t.Helper()
	if res.Verdict != PARTIAL || fmt.Sprint(res.Lines) != fmt.Sprint(want) {
		t.Fatalf("got %s (line %d, lines %v; %s), want PARTIAL at lines %v", res.Verdict, res.Line, res.Lines, res.Reason, want)
	}
}

// expectation: line 0 + lines nil means VALID; line > 0 means INVALID at
// line; lines non-nil means PARTIAL at lines.
type opaqueCase struct {
	name   string
	es     []entry
	line   int
	lines  []int
	reason string // for INVALID: rule ids, "|"-separated
}

func runOpaqueCases(t *testing.T, cases []opaqueCase) {
	t.Helper()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Verify(buildEntries(t, c.es), nil)
			switch {
			case c.lines != nil:
				assertPartial(t, res, c.lines)
			default:
				assertResult(t, res, c.line, c.reason)
			}
		})
	}
}

// T1/T2/T3 are legal instants of every 60000 ms issue (ballot_test.go). On a
// 120000 ms issue, T2 (00:03:00) is not legal and T1, T3 are: 2026-01-01T00:00Z
// is 1767225600000 ms = 14726880 * 120000.

// --- ADR-0034's table --------------------------------------------------

// Every case has a genesis and two registered issues A (0) and B (1), so
// ballots start at line 4; ballot_batch_min 3; T1/T2 legal instants of both
// issues; U is (vote_cast, 1000000).
func TestET24bADR0034Table(t *testing.T) {
	ab := ents(iss(60000, 3), iss(60000, 3))
	A := func(n int, ts string) []entry { return bals(0, n, ts) }
	runOpaqueCases(t, []opaqueCase{
		{name: "opaque_member", es: ents(ab, A(2, T1), opq(T1), A(3, T2)), lines: []int{6, 7}},
		{name: "payload_must_stay_opaque", es: ents(ab, A(2, T1), opqNaming(1, T1), A(3, T2)), lines: []int{6, 7}},
		{name: "insufficient_even_optimistically", es: ents(ab, A(1, T1), opq(T1), A(3, T2)), line: 6, reason: "ET-24"},
		{name: "opaque_closure", es: ents(ab, A(3, T1), opq(T2), A(1, T1)), lines: []int{7, 8}},
		{name: "definite_resumed_instant", es: ents(ab, A(3, T1), A(3, T2), opq(T1), A(1, T1)), line: 11, reason: "ET-24a"},
		{name: "already_full_batch", es: ents(ab, A(3, T1), opq(T1), A(3, T2)), lines: []int{7}},
		{name: "known_only_control", es: ents(ab, A(2, T1), A(3, T2)), line: 6, reason: "ET-24"},
		{name: "definite_quantization_error", es: ents(ab, opq(T1), bal(0, "2026-01-01T00:02:00.001Z")), line: 5, reason: "ET-23"},
	})
}

// --- ET-18b ------------------------------------------------------------

func TestET18bBallotOfOpaqueIssue(t *testing.T) {
	runOpaqueCases(t, []opaqueCase{
		// Line 2 opaque issue X, line 3 a registered ballot naming it: both
		// listed, never INVALID for the unreadable issue.
		{name: "ballot_names_opaque_issue", es: ents(opaqueIssue(), bal(0, T1)), lines: []int{2, 3}},
		// ET-23 is unresolved too: a ts that no plausible interval divides is
		// not a failure, since the interval cannot be read.
		{name: "unquantized_ts_unresolved", es: ents(opaqueIssue(), bal(0, "2026-01-01T00:02:00.001Z")), lines: []int{2, 3}},
		// ET-24/ET-24a unresolved: one ballot, a different instant, then a
		// return — every line listed, none INVALID.
		{name: "batch_rules_unresolved", es: ents(opaqueIssue(), bal(0, T1), bal(0, T2), bal(0, T1)), lines: []int{2, 3, 4, 5}},
		// Such a ballot is no registered ballot of any registered issue and no
		// candidate: issue A (line 2) at T1 x3, X's ballot at T1, A at T2 —
		// A's checks are resolved, so only X and X's ballot are listed.
		{name: "not_a_candidate_of_a_registered_issue", es: ents(iss(60000, 3), opaqueIssue(), bals(0, 2, T1), bal(1, T2), bal(0, T1), bals(0, 1, T2)), lines: []int{3, 6}},
		// ... nor a member of A's batch: A@T1 x2, X-ballot@T1, A@T2 is a
		// definite ET-24 failure at the A@T2 line.
		{name: "not_a_member_of_a_registered_batch", es: ents(iss(60000, 3), opaqueIssue(), bals(0, 2, T1), bal(1, T1), bal(0, T2)), line: 7, reason: "ET-24"},
	})

	// Every other check on the ballot applies as usual (ET-18b): a bad
	// signature is INVALID at the ballot's line.
	t.Run("signature_still_checked", func(t *testing.T) {
		data := buildEntries(t, ents(opaqueIssue(), bal(0, T1)))
		lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
		// Re-sign line 3 with the OPERATOR key: a well-formed signature under
		// the wrong key, hash recomputed so only ET-17 fails.
		e := parseLineOrFail(t, []byte(lines[2]))
		opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)
		bad := signAndSeal(t, opPriv, e.seq, "vote_cast", 1, map[string]any{
			"issue_id": mustStr(e.payload, "issue_id"),
			"choice":   int64(1),
		}, e.ts, e.prevHash)
		lines[2] = string(bad)
		res := Verify([]byte(strings.Join(lines, "\n")+"\n"), nil)
		assertResult(t, res, 3, "ET-17")
	})
	// An issue_id that names an event of another type is still ET-18.
	t.Run("issue_id_names_opaque_ballot", func(t *testing.T) {
		data := buildEntries(t, ents(iss(60000, 3), opq(T1)))
		lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
		opaqueHash := parseLineOrFail(t, []byte(lines[2])).hash
		regPriv := ed25519.NewKeyFromSeed(testRegistrarSeed)
		l := signAndSeal(t, regPriv, 4, "vote_cast", 1, map[string]any{
			"issue_id": opaqueHash, "choice": int64(0),
		}, T1, opaqueHash)
		res := Verify([]byte(strings.Join(append(lines, string(l)), "\n")+"\n"), nil)
		assertResult(t, res, 4, "ET-18")
	})
}

// --- further ET-24b cases ----------------------------------------------

func TestET24bMoreCases(t *testing.T) {
	one := iss(60000, 3)
	two := ents(iss(60000, 3), iss(60000, 3))
	runOpaqueCases(t, []opaqueCase{
		// Several opaque ballots fill a known under-size batch only together:
		// A@T1 (3), U@T1 (4), U@T1 (5), A@T2 (6): |R|=1, F=2.
		{name: "two_opaque_make_up_the_minimum", es: ents(one, bal(0, T1), opq(T1), opq(T1), bal(0, T2)), lines: []int{4, 5, 6}},
		// One short: F counts only ts = t. A@T1, U@T1, U@T3, A@T2.
		{name: "opaque_at_other_instant_does_not_count_for_F", es: ents(one, bal(0, T1), opq(T1), opq(T3), bal(0, T2)), line: 6, reason: "ET-24"},
		// Opaque ballots only: every opaque line listed, nothing unresolved.
		{name: "opaque_only", es: ents(one, opq(T1), opq(T2), opq(T1)), lines: []int{3, 4, 5}},
		// Before the issue's first registered ballot, an opaque ballot at
		// another instant may have opened a batch that A's first ballot
		// ends: unresolved. At the same instant it changes nothing.
		{name: "opaque_before_first_ballot_other_instant", es: ents(one, opq(T2), bals(0, 3, T1)), lines: []int{3, 4}},
		{name: "opaque_before_first_ballot_same_instant", es: ents(one, opq(T1), bals(0, 3, T1)), lines: []int{3}},
		// A candidate before the run's first ballot counts in F (w = c):
		// U@T1, A@T1 x2, A@T2 is |R| = 2, F = 1, so open, not INVALID.
		{name: "opaque_before_first_ballot_counts_in_F", es: ents(one, opq(T1), bals(0, 2, T1), bal(0, T2)), lines: []int{3, 6}},
		// Created before the issue (seq <= c): not a candidate.
		{name: "opaque_before_issue_not_candidate", es: ents(opq(T2), one, bals(0, 3, T1)), lines: []int{2}},
		{name: "opaque_before_issue_no_F", es: ents(opq(T1), one, bal(0, T1), bal(0, T1), bal(0, T2)), line: 6, reason: "ET-24"},
		// Several issues sharing instants: U at T1 is a candidate of both and
		// counts in each (ET-24b item 1).
		{name: "shared_instant_counts_in_each", es: ents(two, bals(0, 2, T1), bals(1, 2, T1), opq(T1), bal(0, T2), bal(1, T2)), lines: []int{8, 9, 10}},
		// ... while each issue's definite failure is its own: B has only one
		// ballot at T1, so |R|+F = 2 < 3 at B's T2 (line 9), after A's
		// unresolved T2 at line 8.
		{name: "shared_instant_one_issue_definite", es: ents(two, bals(0, 2, T1), bals(1, 1, T1), opq(T1), bal(0, T2), bal(1, T2)), line: 9, reason: "ET-24"},
		// A run start whose instant some candidate already used: unresolved
		// (the candidate might be A's, making L a return). A full T1 batch,
		// U@T3, then A at T2, A at T3. Line 7 is open too: U, if A's, would
		// be a one-ballot batch at T3 that A@T2 ends.
		// Per-run state must restart at each run start: U (line 6) is after
		// the T1 run's first ballot at another instant, so the T2 run start
		// (line 7) is open; it is before the T2 run's first ballot, so the
		// T4 run start (line 10) is resolved.
		{name: "run_state_resets_at_run_start", es: ents(one, bals(0, 3, T1), opq(T3), bals(0, 3, T2), bal(0, T4)), lines: []int{6, 7}},
		{name: "run_start_at_candidate_instant", es: ents(one, bals(0, 3, T1), opq(T3), bals(0, 3, T2), bals(0, 3, T3)), lines: []int{6, 7, 10}},
	})
}

// An opaque ts that is a multiple of one issue's interval and not another's is
// a candidate of the first alone (ET-24b item 1).
func TestET24bCandidacyByInterval(t *testing.T) {
	// A: 60000 ms (index 0), B: 120000 ms (index 1). T2 = 00:03:00 is a
	// multiple of 60000 but not 120000; T1 = 00:02:00 and T3 = 00:04:00 are
	// multiples of both.
	ab := ents(iss(60000, 3), iss(120000, 3))
	runOpaqueCases(t, []opaqueCase{
		// B@T1 x3, U@T2, B@T1: U is not B's candidate, so B's fourth ballot
		// is resolved; only U's line is listed.
		{name: "not_a_multiple_of_B", es: ents(ab, bals(1, 3, T1), opq(T2), bal(1, T1)), lines: []int{7}},
		// The same shape on A: U is A's candidate and leaves A's check open.
		{name: "a_multiple_of_A", es: ents(ab, bals(0, 3, T1), opq(T2), bal(0, T1)), lines: []int{7, 8}},
		// B@T1 x2, U@T2, B@T3: U at T2 cannot fill B's T1 batch (wrong
		// instant anyway) and is not B's candidate: definite ET-24 at line 7.
		{name: "B_definite_failure", es: ents(ab, bals(1, 2, T1), opq(T2), bal(1, T3)), line: 7, reason: "ET-24"},
		// U at 00:03:00.001 is a multiple of neither: no candidate at all.
		{name: "multiple_of_neither", es: ents(ab, bals(0, 3, T1), opq("2026-01-01T00:03:00.001Z"), bal(0, T1)), lines: []int{7}},
	})
}

// EV-16: an opaque ballot whose payload is not flat is INVALID at its line,
// never PARTIAL, and is never an opaque ballot (ET-24b needs ES-15-ES-17).
//
// Isolating EV-16 from HA-14. HA-7 defines no encoding for a nested or float
// value, so no conforming hash exists for such a line, and a dummy hash would
// let a verifier missing EV-16 still reject the line at HA-14. Instead each
// line carries the hash THIS verifier's preimage code computes when handed
// the non-flat payload (its encoder, reached only if EV-16 were skipped,
// writes such a value as an empty string), and the next line links to that
// hash. So with the EV-16 check removed the line passes HA-14, the chain
// links, and the verdict becomes PARTIAL: only EV-16 makes it INVALID at 5.
// That is implementation-specific by necessity, and says nothing about any
// other verifier's hashing of an un-hashable line.
func TestET24bMalformedOpaquePayload(t *testing.T) {
	mk := func(payload string) func(seq int64, prev string) []byte {
		return func(seq int64, prev string) []byte {
			draft := []byte(fmt.Sprintf(`{"seq":%d,"type":"vote_cast","version":1000000,"payload":%s,"ts":%q,"prev_hash":%q,"hash":%q}`,
				seq, payload, T1, prev, strings.Repeat("0", 64)))
			obj, ok := parseObjectLine(draft)
			if !ok {
				t.Fatalf("draft does not parse: %s", draft)
			}
			payV := obj.vals[3]
			e := &event{seq: seq, typ: "vote_cast", version: 1000000, payload: payV.obj, ts: T1, prevHash: prev}
			h := hashHex(preimage(e, ""))
			return []byte(strings.Replace(string(draft), strings.Repeat("0", 64)+`"}`, h+`"}`, 1))
		}
	}
	for name, payload := range map[string]string{"nested": `{"choice":{"x":1}}`, "float": `{"choice":1.5}`} {
		t.Run(name, func(t *testing.T) {
			es := ents(iss(60000, 3), bals(0, 2, T1), entry{kind: eRaw, raw: mk(payload)}, bal(0, T1))
			res := Verify(buildEntries(t, es), nil)
			if res.Verdict != INVALID || res.Line != 5 {
				t.Fatalf("got %s at %d (%v; %s), want INVALID at line 5", res.Verdict, res.Line, res.Lines, res.Reason)
			}
			if citesRule(res.Reason, "HA-14") {
				t.Fatalf("rejected at HA-14, not EV-16: %s", res.Reason)
			}
		})
	}
}

// --head and --chain still compare on a chain left PARTIAL by ET-24b: an
// unresolved check counts as not failed (EX-15, EX-22; ET-24b item 5).
func TestET24bUnresolvedDoesNotBlockHead(t *testing.T) {
	data := buildEntries(t, ents(iss(60000, 3), bals(0, 2, T1), opq(T1), bal(0, T2)))
	assertPartial(t, Verify(data, nil), []int{5, 6})
	wrong := strings.Repeat("ab", 32)
	res := Verify(data, &wrong)
	assertResult(t, res, 6, "EX-15")
}

// --- brute force -------------------------------------------------------

// A generated line: what the oracle needs to know about each line after the
// genesis (line 1).
type genLine struct {
	kind     entryKind2
	issue    int   // eBallot: issue index
	interval int64 // eIssue
	min      int64 // eIssue
	tsMS     int64
}

const baseMS = int64(1767225600000) // 2026-01-01T00:00:00.000Z, a multiple of 120000

func msToTS(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
}

// oracle decides a generated chain by a direct, deliberately naive and
// quadratic reading of ET-23, ET-24, ET-24a, ET-24b and ET-18b. Every test at
// a line re-scans the whole prefix before it; nothing is carried from line to
// line except "has this line already failed".
//
// Returns (INVALID, line, open), (PARTIAL, 0, lines) or (VALID). On INVALID,
// open lists the lines before it that were opaque or left unresolved.
func oracle(gl []genLine) (Verdict, int, []int) {
	line := func(i int) int { return i + 2 } // gl[0] is line 2
	// issue index -> position in gl of its issue_created
	var issuePos []int
	for i, g := range gl {
		if g.kind == eIssue || g.kind == eOpaqueIssue {
			issuePos = append(issuePos, i)
		}
	}
	var partial []int
	for i, g := range gl {
		switch g.kind {
		case eOpaqueIssue, eOpaqueBallot:
			partial = append(partial, line(i))
			continue
		case eIssue:
			continue
		}
		// a registered ballot L at position i
		ip := issuePos[g.issue]
		is := gl[ip]
		if is.kind == eOpaqueIssue { // ET-18b
			partial = append(partial, line(i))
			continue
		}
		delta, m, c := is.interval, is.min, ip
		if g.tsMS%delta != 0 { // ET-23
			return INVALID, line(i), partial
		}
		isCand := func(j int) bool {
			return gl[j].kind == eOpaqueBallot && j > c && gl[j].tsMS%delta == 0
		}
		// registered ballots of this issue before L, in seq order
		var prior []int
		for j := 0; j < i; j++ {
			if gl[j].kind == eBallot && gl[j].issue == g.issue {
				prior = append(prior, j)
			}
		}
		unresolved := false
		if len(prior) > 0 && gl[prior[len(prior)-1]].tsMS != g.tsMS {
			// run start
			p := prior[len(prior)-1]
			t := gl[p].tsMS
			k := len(prior) - 1
			for k > 0 && gl[prior[k-1]].tsMS == t {
				k--
			}
			f := prior[k]
			rSize := len(prior) - k
			w := c
			if k > 0 {
				w = prior[k-1]
			}
			returns := false
			for _, j := range prior {
				if gl[j].tsMS == g.tsMS {
					returns = true
				}
			}
			if returns {
				return INVALID, line(i), partial
			}
			if int64(rSize) < m {
				F := 0
				for j := w + 1; j < i; j++ {
					if isCand(j) && gl[j].tsMS == t {
						F++
					}
				}
				if int64(rSize+F) < m {
					return INVALID, line(i), partial
				}
				unresolved = true
			} else {
				for j := 0; j < i; j++ {
					if isCand(j) && (gl[j].tsMS == g.tsMS || (j > f && gl[j].tsMS != t)) {
						unresolved = true
					}
				}
			}
		} else {
			lo := c
			if len(prior) > 0 {
				lo = prior[len(prior)-1]
			}
			for j := lo + 1; j < i; j++ {
				if isCand(j) && gl[j].tsMS != g.tsMS {
					unresolved = true
				}
			}
		}
		if unresolved {
			partial = append(partial, line(i))
		}
	}
	if len(partial) > 0 {
		return PARTIAL, 0, partial
	}
	return VALID, 0, nil
}

// genChain draws a small random chain: up to three issues (registered at a
// 60000 or 120000 ms interval, min 3 or 4, or opaque), registered ballots that
// tend to stay at their issue's last instant, opaque ballots, and now and
// then an unquantized ts.
//
// Half the chains are "long": up to 30 lines, one or two issues, fewer opaque
// ballots and stickier instants, so that an issue often has two or more full
// runs followed by a further run start — the shape where per-run state that
// is not reset at a run start shows up.
func genChain(r *rand.Rand) []genLine {
	var gl []genLine
	var issues []int // positions
	last := map[int]int64{}
	n, maxIssues, opaquePct, changePct, offOne := 4+r.Intn(14), 3, 30, 35, 40
	if r.Intn(2) == 0 {
		n, maxIssues, opaquePct, changePct, offOne = 12+r.Intn(19), 1+r.Intn(2), 18, 22, 90
	}
	opaqueOK := r.Intn(4) != 0 // a quarter of chains carry no opaque lines
	instant := func() int64 { return baseMS + int64(r.Intn(5))*60000 }
	for len(gl) < n {
		x := r.Intn(100)
		switch {
		case len(issues) == 0 || (x < 10 && len(issues) < maxIssues):
			if opaqueOK && r.Intn(5) == 0 {
				gl = append(gl, genLine{kind: eOpaqueIssue})
			} else {
				gl = append(gl, genLine{kind: eIssue, interval: []int64{60000, 120000}[r.Intn(2)], min: 3 + int64(r.Intn(2))})
			}
			issues = append(issues, len(gl)-1)
		case opaqueOK && x < opaquePct:
			ts := instant()
			if r.Intn(15) == 0 {
				ts++
			}
			gl = append(gl, genLine{kind: eOpaqueBallot, tsMS: ts})
		default:
			k := r.Intn(len(issues))
			ts, ok := last[k]
			if !ok || r.Intn(100) < changePct {
				ts = instant()
				if gl[issues[k]].kind == eIssue {
					// keep most ballots quantized for their issue
					ts -= (ts - baseMS) % gl[issues[k]].interval
				}
			}
			if r.Intn(offOne) == 0 {
				ts++
			}
			last[k] = ts
			gl = append(gl, genLine{kind: eBallot, issue: k, tsMS: ts})
		}
	}
	return gl
}

func genToEntries(gl []genLine) []entry {
	es := make([]entry, len(gl))
	for i, g := range gl {
		es[i] = entry{kind: g.kind, issue: g.issue, interval: g.interval, min: g.min, ts: msToTS(g.tsMS)}
		if g.kind == eOpaqueBallot {
			es[i].issue = -1
		}
	}
	return es
}

func TestET24bBruteForce(t *testing.T) {
	n := 4000
	if testing.Short() {
		n = 500
	}
	r := rand.New(rand.NewSource(20261011))
	dist := map[string]int{}
	for k := 0; k < n; k++ {
		gl := genChain(r)
		v, line, lines := oracle(gl)
		dist[v.String()]++
		res := Verify(buildEntries(t, genToEntries(gl)), nil)
		ok := res.Verdict == v
		switch v {
		case INVALID:
			ok = ok && res.Line == line
		case PARTIAL:
			ok = ok && fmt.Sprint(res.Lines) == fmt.Sprint(lines)
		case VALID:
			ok = ok && len(res.Lines) == 0
		}
		if !ok {
			t.Fatalf("chain %d %+v:\n oracle %s line %d lines %v\n verifier %s line %d lines %v (%s)",
				k, gl, v, line, lines, res.Verdict, res.Line, res.Lines, res.Reason)
		}
	}
	keys := make([]string, 0, len(dist))
	for k := range dist {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%d", k, dist[k]))
	}
	t.Logf("verdict distribution over %d chains: %s", n, strings.Join(parts, " "))
	for _, want := range []string{"VALID", "INVALID", "PARTIAL"} {
		if dist[want] < n/20 {
			t.Errorf("generator is lopsided: %s occurred %d times in %d", want, dist[want], n)
		}
	}
}

// The oracle against the exact all-assignments reading of ET-24b's guarantee
// (informative paragraph): give each opaque ballot at most one issue among
// those it is a candidate of, evaluate ET-24/ET-24a over registered and
// assigned ballots. Then:
//   - a definite failure at L means every assignment breaks ET-24 or ET-24a
//     at or before L;
//   - a resolved registered ballot's own batch check passes under every
//     assignment.
//
// This checks the oracle (and so the verifier) against the rule's stated
// intent, not just its letter.
func TestET24bOracleIsSoundAgainstAllAssignments(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	checked := 0
	for k := 0; k < 3000; k++ {
		gl := genChain(r)
		var opaque []int
		for i, g := range gl {
			if g.kind == eOpaqueBallot {
				opaque = append(opaque, i)
			}
		}
		if len(opaque) > 5 {
			continue
		}
		v, line, lines := oracle(gl)
		if v == INVALID && !batchFailureAt(gl, line) {
			continue // ET-23: not about assignments
		}
		checked++
		inPartial := map[int]bool{}
		for _, l := range lines {
			inPartial[l] = true
		}
		var issuePos []int
		for i, g := range gl {
			if g.kind == eIssue || g.kind == eOpaqueIssue {
				issuePos = append(issuePos, i)
			}
		}
		cands := make([][]int, len(opaque)) // per opaque: -1 (none) + candidate issues
		for oi, j := range opaque {
			cands[oi] = []int{-1}
			for ii, p := range issuePos {
				if gl[p].kind == eIssue && j > p && gl[j].tsMS%gl[p].interval == 0 {
					cands[oi] = append(cands[oi], ii)
				}
			}
		}
		idx := make([]int, len(opaque))
		for {
			assign := map[int]int{}
			for oi, j := range opaque {
				assign[j] = cands[oi][idx[oi]]
			}
			fails := exactFailures(gl, issuePos, assign)
			if v == INVALID {
				first := -1
				for l := range fails {
					if first == -1 || l < first {
						first = l
					}
				}
				if first == -1 || first > line {
					t.Fatalf("chain %d %+v: definite failure at %d, but assignment %v fails first at %d", k, gl, line, assign, first)
				}
			}
			end := len(gl) + 2
			if v == INVALID {
				end = line
			}
			for i := 0; i < len(gl) && i+2 < end; i++ {
				g := gl[i]
				if g.kind == eBallot && gl[issuePos[g.issue]].kind == eIssue && !inPartial[i+2] && fails[i+2] {
					t.Fatalf("chain %d %+v: line %d reported resolved, but assignment %v fails it", k, gl, i+2, assign)
				}
			}
			// next assignment
			d := 0
			for d < len(idx) {
				idx[d]++
				if idx[d] < len(cands[d]) {
					break
				}
				idx[d] = 0
				d++
			}
			if d == len(idx) {
				break
			}
		}
	}
	if checked < 1000 {
		t.Fatalf("only %d chains checked", checked)
	}
}

// batchFailureAt reports whether line is a registered ballot that passes
// ET-23 (so an INVALID there is a batch failure).
func batchFailureAt(gl []genLine, line int) bool {
	g := gl[line-2]
	if g.kind != eBallot {
		return false
	}
	pos := -1
	n := -1
	for i, x := range gl {
		if x.kind == eIssue || x.kind == eOpaqueIssue {
			n++
			if n == g.issue {
				pos = i
			}
		}
	}
	return g.tsMS%gl[pos].interval == 0
}

// exactFailures evaluates ET-24 and ET-24a, v11 style, over each registered
// issue's registered ballots plus the opaque ballots assign gives it, and
// returns the set of failing lines (ET-23 failures excluded: those are not
// assignment-dependent and the callers stop before them).
func exactFailures(gl []genLine, issuePos []int, assign map[int]int) map[int]bool {
	out := map[int]bool{}
	for ii, p := range issuePos {
		if gl[p].kind != eIssue {
			continue
		}
		m := gl[p].min
		var seqTS []int64
		var seqLine []int
		for i, g := range gl {
			if (g.kind == eBallot && g.issue == ii) || (g.kind == eOpaqueBallot && assign[i] == ii) {
				seqTS = append(seqTS, g.tsMS)
				seqLine = append(seqLine, i+2)
			}
		}
		used := map[int64]bool{}
		run := int64(0)
		for k, ts := range seqTS {
			if k > 0 && seqTS[k-1] != ts {
				if run < m {
					out[seqLine[k]] = true
				}
				if used[ts] {
					out[seqLine[k]] = true
				}
				run = 0
			}
			used[ts] = true
			run++
		}
	}
	return out
}

// Cost: a hostile chain of n registered issues and n opaque ballots at
// distinct instants, then one ballot per issue so every issue asks its ET-24b
// questions. Memory must stay roughly linear in the export. The v12
// implementation first shipped kept a candidate set per issue and was
// measured at about 877 MB allocated (about 240x the export) for n = 3000.
//
// Two shapes. "one_interval": every issue at 60000 ms, so every opaque ballot
// is a candidate of every issue. "distinct_intervals": issue i at
// 60000*(i+1) ms with its ballot at the epoch, opaque ballot j at
// 60000*(j+1) ms, so each interval summary tests every opaque ballot once —
// the one-remainder-per-(opaque ballot, interval) path. In both, issue i has
// a candidate (opaque ballot i at least) at an instant other than its
// ballot's, so every ballot line is listed.
func TestET24bHostileCost(t *testing.T) {
	if testing.Short() {
		t.Skip("large chain")
	}
	const n = 3000
	shapes := []struct {
		name     string
		interval func(i int) int64
		opaqueTS func(j int) string
		ballotTS string
	}{
		{"one_interval", func(int) int64 { return 60000 },
			func(j int) string { return msToTS(baseMS + int64(j+10)*60000) }, T1},
		{"distinct_intervals", func(i int) int64 { return 60000 * int64(i+1) },
			func(j int) string { return msToTS(60000 * int64(j+1)) }, "1970-01-01T00:00:00.000Z"},
	}
	for _, sh := range shapes {
		t.Run(sh.name, func(t *testing.T) {
			var es []entry
			for i := 0; i < n; i++ {
				es = append(es, iss(sh.interval(i), 3))
			}
			for j := 0; j < n; j++ {
				es = append(es, opq(sh.opaqueTS(j)))
			}
			for i := 0; i < n; i++ {
				es = append(es, bal(i, sh.ballotTS))
			}
			data := buildEntries(t, es)

			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			start := time.Now()
			res := Verify(data, nil)
			elapsed := time.Since(start)
			runtime.ReadMemStats(&after)
			alloc := after.TotalAlloc - before.TotalAlloc

			// Lines: issues 2..n+1, opaque n+2..2n+1, ballots 2n+2..3n+1.
			if res.Verdict != PARTIAL || len(res.Lines) != 2*n || res.Lines[0] != n+2 || res.Lines[len(res.Lines)-1] != 3*n+1 {
				t.Fatalf("got %s with %d lines", res.Verdict, len(res.Lines))
			}
			t.Logf("n=%d: export %d bytes, verified in %s, %d MB allocated", n, len(data), elapsed, alloc>>20)
			// About 14-15x the export today, almost all of it parsing and
			// signature checks; 32x leaves room for toolchain drift and is
			// still far below the old structure's ~240x.
			if alloc > 32*uint64(len(data)) {
				t.Errorf("allocated %d MB verifying a %d-byte export; want under 32x the export", alloc>>20, len(data))
			}
			if elapsed > 20*time.Second {
				t.Errorf("took %s", elapsed)
			}
		})
	}
}
