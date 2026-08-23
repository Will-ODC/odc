package verify

import (
	"crypto/ed25519"
	"strings"
	"testing"
)

// ET-14 title bounds, counted in UNICODE SCALAR VALUES.
//
// WHY THIS FILE EXISTS. The bound is 1–200 SCALARS, while HA-2/HA-3 length-
// prefix the same string in BYTES, so the two measures diverge on any
// multi-byte title and an implementation that reaches for the wrong one is
// wrong only for non-ASCII input. Reaching countScalars at all requires a
// STRUCTURALLY COMPLETE chain: an `issue_created` at line 2 whose hash is
// correct (Stage A) behind a genesis whose keys are usable (Stage B), because
// the title checks sit deep inside stageBIssue. A line that merely LOOKS like
// an issue dies at the hash recomputation with the title never examined.
//
// The same harness caveat as genesis_ancestry_test.go applies: these chains are
// built by the code they are checked against, so a VALID verdict pins no
// preimage shape. What each case pins is differential — one title, one edit.
//
// contracts/fixtures/ is the sole oracle for conformance; no fixture backs
// these, and none of them asserts anything the fixtures also assert.

// issueChainWithTitle builds a two-line export: a valid genesis, then an
// operator-signed `issue_created` carrying `title` and otherwise-legal ballot
// parameters. Everything except the title is held constant and legal, so the
// title is the only thing that can decide the verdict.
func issueChainWithTitle(t *testing.T, title string) []byte {
	t.Helper()
	opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)

	genesis := genesisExport(t, 1, nil) // already newline-terminated
	g := parseLineOrFail(t, trimLF(genesis))

	issue := signAndSeal(t, opPriv, 2, "issue_created", 1, map[string]any{
		"title":                    title,
		"choice_count":             int64(2),
		"ballot_batch_interval_ms": minBallotBatchIntervalMS,
		"ballot_batch_min":         minBallotBatchMin,
	}, "2026-01-01T00:01:00.000Z", g.hash)

	out := make([]byte, 0, len(genesis)+len(issue)+1)
	out = append(out, genesis...)
	out = append(out, issue...)
	return append(out, '\n')
}

// The ET-14 length bound, exercised at the boundary in three encodings whose
// byte length and scalar count diverge by a factor of 1, 3 and 4.
//
// The ACCEPT cases are the load-bearing half. 200 astral scalars are 800 bytes
// and 200 three-byte scalars are 600 bytes, so a bound applied to len(title)
// rejects both — the verdict moves from VALID to INVALID and these cases fail.
// A suite of rejections alone could not tell a scalar count from a byte count,
// because an over-long title is over-long in either measure.
func TestIssueTitleLengthIsCountedInScalars(t *testing.T) {
	cases := []struct {
		name    string
		title   string
		verdict Verdict
	}{
		// ASCII, where the two measures agree — the control.
		{"ascii_1", "a", VALID},
		{"ascii_200", strings.Repeat("a", 200), VALID},
		{"ascii_201", strings.Repeat("a", 201), INVALID},

		// 3 bytes per scalar: 200 scalars = 600 bytes.
		{"three_byte_200", strings.Repeat("あ", 200), VALID},
		{"three_byte_201", strings.Repeat("あ", 201), INVALID},

		// 4 bytes per scalar, and 2 UTF-16 code units: 200 scalars = 800 bytes,
		// which is also where a UTF-16 length would read 400.
		{"astral_200", strings.Repeat("𝄞", 200), VALID},
		{"astral_201", strings.Repeat("𝄞", 201), INVALID},

		// The lower bound. ET-14 is 1–200, so the empty title is out.
		{"empty", "", INVALID},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			export := issueChainWithTitle(t, c.title)

			// Reachability guard on the case itself: the title must have
			// survived into line 2 intact, with the scalar count the case is
			// named for. A harness that mangled or truncated it would leave a
			// case that passes while testing a different string.
			e := parseLineOrFail(t, trimLF(exportLine(t, export, 2)))
			got, ok := payloadGet(e.payload, "title")
			if !ok || got.kind != kString || got.str != c.title {
				t.Fatalf("line 2 does not carry the case's title verbatim")
			}
			if n := countScalarsForTest(c.title); n != countScalars(got.str) {
				t.Fatalf("title scalar count changed in transit: %d then %d", n, countScalars(got.str))
			}

			res := Verify(export, nil)
			if res.Verdict != c.verdict {
				t.Fatalf("verdict = %s, want %s (reason: %s)", res.Verdict, c.verdict, res.Reason)
			}
			if c.verdict == INVALID {
				// Line 2, not line 1: the genesis ahead of it is sound, so a
				// case that failed for a chain-level reason would be caught
				// here rather than counted as ET-14 coverage.
				if res.Line != 2 {
					t.Fatalf("INVALID line = %d, want 2 (reason: %s)", res.Line, res.Reason)
				}
				assertReason(t, res, "ET-14")
			}
		})
	}
}

// The other half of ET-14: no C0 control and no U+007F, anywhere in the title.
// These are expressed with the parser rather than the harness renderer, which
// refuses to emit either (see jsonScalar) — the export is built with a legal
// title and the control is substituted into the rendered bytes, so the line is
// resealed around it.
func TestIssueTitleForbiddenCharacters(t *testing.T) {
	// A C0 control is written `\u00xx` under EX-9 and a bare 0x7f is literal,
	// so both are reached through the parser's own string decoding.
	// The map values are JSON SOURCE TEXT, spliced into the rendered line: the
	// `\u00xx` form EX-9 mandates for a control with no short escape, the short
	// escape it mandates for U+000A, and a literal 0x7f byte, which EX-9 leaves
	// literal while ET-14 bars it from a title.
	cases := map[string]string{
		"nul_escape":            `\u0000`,
		"bell_escape":           `\u0007`,
		"newline_short_escape":  `\n`,
		"unit_separator_escape": `\u001f`,
		"delete_literal":        "\x7f",
	}
	for name, escaped := range cases {
		t.Run(name, func(t *testing.T) {
			export := issueChainWithTitle(t, "aaa")
			// Substitute the control for the middle character of the title, then
			// re-seal line 2 so the hash is correct and Stage A cannot be what
			// rejects it.
			body := string(exportLine(t, export, 2))
			body = strings.Replace(body, `"title":"aaa"`, `"title":"a`+escaped+`a"`, 1)
			resealed := resealRendered(t, []byte(body))

			out := append(append([]byte{}, exportLine(t, export, 1)...), '\n')
			out = append(out, resealed...)
			out = append(out, '\n')

			res := Verify(out, nil)
			if res.Verdict != INVALID {
				t.Fatalf("verdict = %s, want INVALID (reason: %s)", res.Verdict, res.Reason)
			}
			if res.Line != 2 {
				t.Fatalf("INVALID line = %d, want 2 (reason: %s)", res.Line, res.Reason)
			}
			assertReason(t, res, "ET-14")
		})
	}
}

// exportLine returns line n (1-based) of an export, without its LF.
func exportLine(t *testing.T, export []byte, n int) []byte {
	t.Helper()
	lines, _ := frame(export)
	if len(lines) < n {
		t.Fatalf("export has %d lines, wanted line %d", len(lines), n)
	}
	return lines[n-1]
}

// resealRendered recomputes `hash` over an already-rendered line whose payload
// was edited in place, so the edit is what the verifier judges rather than a
// stale hash. `sig` is left as it was and will not verify — every check this
// file asserts on runs before the signature check, and the reason assertion
// pins that it did.
func resealRendered(t *testing.T, line []byte) []byte {
	t.Helper()
	e := parseLineOrFail(t, line)
	h := hashHex(preimage(e, ""))
	old := `"hash":"` + e.hash + `"`
	out := strings.Replace(string(line), old, `"hash":"`+h+`"`, 1)
	if out == string(line) {
		t.Fatal("could not rewrite the hash field")
	}
	return []byte(out)
}

// countScalarsForTest counts scalar values independently of countScalars, so
// the guard above compares two implementations rather than one against itself.
func countScalarsForTest(s string) int {
	return len([]rune(s))
}
