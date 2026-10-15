package verify

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
)

// Tests for ADR-0038 as written into the specs: ET-9's 64-byte bound on
// `genesis.contracts` (event-types.md v14) and the implementation limits of
// evolution.md §7 (EV-23, EV-24).
//
// The same harness caveat as genesis_ancestry_test.go applies: these chains are
// built by the hashing and signing code under test, so a VALID here pins no
// preimage shape. Each case is a differential across one boundary.

// --- ET-9: `contracts` is 1..64 bytes, counted after unescaping ------------

// genesisWithContracts builds a one-line genesis whose `contracts` value is
// the given already-rendered JSON string token, so a case can put escapes on
// the line.
func genesisWithContracts(t *testing.T, contracts rawJSON) []byte {
	t.Helper()
	opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)
	opPub := []byte(opPriv.Public().(ed25519.PublicKey))
	regPub := []byte(ed25519.NewKeyFromSeed(testRegistrarSeed).Public().(ed25519.PublicKey))
	chainID := sha256.Sum256(opPub)
	payload := map[string]any{
		"chain_id":     hex.EncodeToString(chainID[:]),
		"contracts":    contracts,
		"operator_pk":  hex.EncodeToString(opPub),
		"registrar_pk": hex.EncodeToString(regPub),
	}
	line := signAndSeal(t, opPriv, 1, "genesis", 1, payload, "2026-01-01T00:00:00.000Z", zeros64)
	return append(line, '\n')
}

func quoted(s string) rawJSON { return rawJSON(`"` + s + `"`) }

func TestGenesisContractsByteBound(t *testing.T) {
	const (
		grin = "\U0001F600" // 4 UTF-8 bytes, 1 scalar
		euro = "€"          // 3 UTF-8 bytes, 1 scalar
	)
	cases := []struct {
		name        string
		token       rawJSON
		decodedLen  int // asserted against the parser, so the case means what it says
		lineLen     int // bytes of the token between its quotes, as written on the line
		wantInvalid bool
	}{
		{"ascii_1_byte", quoted("c"), 1, 1, false},
		{"ascii_64_bytes", quoted(strings.Repeat("a", 64)), 64, 64, false},
		{"ascii_65_bytes", quoted(strings.Repeat("a", 65)), 65, 65, true},
		{"empty", quoted(""), 0, 0, true},

		// Bytes, not scalars (ET-9 is not ET-14). 16 four-byte scalars are 64
		// bytes: accepted. 15 of them plus 5 ASCII are only 20 scalars but 65
		// bytes: rejected — a scalar count would accept it.
		{"16_four_byte_scalars_64_bytes", quoted(strings.Repeat(grin, 16)), 64, 64, false},
		{"20_scalars_65_bytes", quoted(strings.Repeat(grin, 15) + "aaaaa"), 65, 65, true},
		{"21_three_byte_scalars_plus_1_64_bytes", quoted(strings.Repeat(euro, 21) + "a"), 64, 64, false},
		{"22_three_byte_scalars_66_bytes", quoted(strings.Repeat(euro, 22)), 66, 66, true},

		// Counted after unescaping, never on the escaped line bytes (EX-9).
		// `\u0001` is six bytes on the line and one decoded byte.
		{"escaped_control_counts_one_64", quoted(`\u0001` + strings.Repeat("a", 63)), 64, 69, false},
		{"short_escape_counts_one_64", quoted(`\n` + strings.Repeat("a", 63)), 64, 65, false},
		{"escaped_quote_counts_one_64", quoted(`\"` + strings.Repeat("a", 63)), 64, 65, false},
		{"all_escaped_64_decoded_384_on_line", quoted(strings.Repeat(`\u001f`, 64)), 64, 384, false},
		{"escaped_control_counts_one_65", quoted(`\u0001` + strings.Repeat("a", 64)), 65, 70, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			export := genesisWithContracts(t, c.token)
			e := parseLineOrFail(t, trimLF(export))
			v, _ := payloadGet(e.payload, "contracts")
			if len(v.str) != c.decodedLen {
				t.Fatalf("test bug: decoded contracts is %d bytes, case says %d", len(v.str), c.decodedLen)
			}
			if got := len(c.token) - 2; got != c.lineLen {
				t.Fatalf("test bug: escaped token is %d bytes on the line, case says %d", got, c.lineLen)
			}
			res := Verify(export, nil)
			if !c.wantInvalid {
				if res.Verdict != VALID {
					t.Fatalf("verdict = %s line %d, want VALID (reason: %s)", res.Verdict, res.Line, res.Reason)
				}
				return
			}
			if res.Verdict != INVALID || res.Line != 1 {
				t.Fatalf("verdict = %s line %d, want INVALID line 1 (reason: %s)", res.Verdict, res.Line, res.Reason)
			}
			assertReason(t, res, "ET-9)")
		})
	}
}

// A non-string `contracts` is not a 1..64-byte string.
func TestGenesisContractsMustBeString(t *testing.T) {
	res := Verify(genesisWithContracts(t, rawJSON("12345")), nil)
	if res.Verdict != INVALID || res.Line != 1 {
		t.Fatalf("verdict = %s line %d, want INVALID line 1 (reason: %s)", res.Verdict, res.Line, res.Reason)
	}
	assertReason(t, res, "contracts is not a string (ET-9)")
}

// --- EV-23 / EV-24: line length --------------------------------------------

// ev23Depth is EV-23's nesting depth, transcribed from the rule as a byte scan
// independent of the parser: it is the oracle that says how deep a test line
// is by the spec's own measure.
func ev23Depth(line []byte) int {
	depth, max, inStr := 0, 0, false
	for i := 0; i < len(line); i++ {
		b := line[i]
		if inStr {
			switch b {
			case '\\':
				i++
			case '"':
				inStr = false
			}
			continue
		}
		switch b {
		case '"':
			inStr = true
		case '{', '[':
			depth++
			if depth > max {
				max = depth
			}
		case '}', ']':
			if depth > 0 {
				depth--
			}
		}
	}
	return max
}

// sealedPadLine returns a conforming event line of an UNREGISTERED type
// (EV-18's `x_` prefix) at seq 2 after prevHash, whose single string payload
// value is padded so the line is exactly n bytes, LF excluded. Such a line
// passes Stage A and yields PARTIAL for itself: a required verdict that a
// verifier can reach only by reading the whole line.
func sealedPadLine(t *testing.T, seq int64, prevHash string, n int) []byte {
	t.Helper()
	build := func(k int) []byte {
		return seal(t, seq, "x_pad", 1, map[string]any{"blob": strings.Repeat("a", k)},
			"2026-01-01T00:00:01.000Z", prevHash)
	}
	base := len(build(0))
	if n < base {
		t.Fatalf("test bug: %d bytes is shorter than an empty pad line (%d)", n, base)
	}
	l := build(n - base)
	if len(l) != n {
		t.Fatalf("test bug: pad line is %d bytes, want %d", len(l), n)
	}
	return l
}

// genesisAndHash returns the standard one-line genesis export and its hash.
func genesisAndHash(t *testing.T) ([]byte, string) {
	t.Helper()
	g := genesisExport(t, 1, nil)
	return g, parseLineOrFail(t, trimLF(g)).hash
}

// The line-length minimum is 65536 bytes excluding the LF (EV-23), and a
// verifier must reach the required verdict on every line within it (EV-24).
// This verifier sets no line-length limit at all, so lines past it reach their
// verdict too. A third line with a broken hash shows the scan went on past
// the long line, which a reader that gave up on it could not report.
func TestLineLengthMinimum(t *testing.T) {
	for _, n := range []int{65535, 65536, 65537, 1 << 20, 4 << 20} {
		t.Run(fmt.Sprintf("%d_bytes", n), func(t *testing.T) {
			g, gh := genesisAndHash(t)
			pad := sealedPadLine(t, 2, gh, n)
			if d := ev23Depth(pad); d != 2 {
				t.Fatalf("test bug: pad line depth %d, want 2", d)
			}
			export := append(append(append([]byte{}, g...), pad...), '\n')

			res := Verify(export, nil)
			if res.Verdict != PARTIAL || len(res.Lines) != 1 || res.Lines[0] != 2 {
				t.Fatalf("verdict = %s lines %v line %d, want PARTIAL at lines 2 (reason: %s)",
					res.Verdict, res.Lines, res.Line, res.Reason)
			}

			// Line 3 follows the long line and is fatal: a broken hash.
			ph := parseLineOrFail(t, pad).hash
			bad := seal(t, 3, "x_pad", 1, map[string]any{"blob": "b"}, "2026-01-01T00:00:02.000Z", ph)
			bad = bytes.Replace(bad, []byte(`"blob":"b"`), []byte(`"blob":"c"`), 1)
			export = append(append(export, bad...), '\n')
			res = Verify(export, nil)
			if res.Verdict != INVALID || res.Line != 3 {
				t.Fatalf("verdict = %s line %d, want INVALID at line 3 (reason: %s)", res.Verdict, res.Line, res.Reason)
			}
		})
	}
}

// --- EV-23 / EV-24: nesting depth ------------------------------------------

// deepLine renders a line at seq 2 whose payload holds `arrays` nested arrays,
// so its EV-23 depth is 2 + arrays (the envelope and payload objects). It is
// INVALID under ES-17 at any depth past 2; the hash is a placeholder, since no
// check would reach it before the nesting.
func deepLine(prevHash string, arrays int) []byte {
	return []byte(fmt.Sprintf(
		`{"seq":2,"type":"x_deep","version":1,"payload":{"a":%s1%s},"ts":"2026-01-01T00:00:01.000Z","prev_hash":"%s","hash":"%s"}`,
		strings.Repeat("[", arrays), strings.Repeat("]", arrays), prevHash, strings.Repeat("1", 64)))
}

// The parser is this verifier's one within-line limit. At depth 64 (EV-23's
// minimum) it parses the whole line; the limit is reached only at 65.
func TestParserDepthLimitIsTheEV23Minimum(t *testing.T) {
	for _, c := range []struct {
		depth   int
		tooDeep bool
	}{{2, false}, {3, false}, {63, false}, {64, false}, {65, true}, {66, true}, {100000, true}} {
		t.Run(fmt.Sprintf("depth_%d", c.depth), func(t *testing.T) {
			l := deepLine(zeros64, c.depth-2)
			if d := ev23Depth(l); d != c.depth {
				t.Fatalf("test bug: EV-23 depth %d, want %d", d, c.depth)
			}
			_, ok, tooDeep := parseLine(l)
			if tooDeep != c.tooDeep {
				t.Fatalf("tooDeep = %v, want %v", tooDeep, c.tooDeep)
			}
			if ok == c.tooDeep {
				t.Fatalf("ok = %v at depth %d: a line within the minimum must parse in full, one past the limit must not", ok, c.depth)
			}
		})
	}
}

// Depth is the number of levels open at once, not the number of brackets on
// the line: closing a level must give it back. These lines are WIDE — many
// sibling arrays — so a parser that never decremented would count them as
// deep. Each must parse in full, and the separate EV-23 scan must agree on
// the depth.
func TestParserDepthIsNotBracketCount(t *testing.T) {
	siblings := func(n int) string {
		var b strings.Builder
		for i := 0; i < n; i++ {
			if i > 0 {
				b.WriteByte(',')
			}
			fmt.Fprintf(&b, `"k%04d":[1]`, i)
		}
		return b.String()
	}
	wide := func(payload string) []byte {
		return []byte(fmt.Sprintf(
			`{"seq":2,"type":"x_wide","version":1,"payload":{%s},"ts":"2026-01-01T00:00:01.000Z","prev_hash":"%s","hash":"%s"}`,
			payload, zeros64, strings.Repeat("1", 64)))
	}
	cases := []struct {
		name  string
		line  []byte
		depth int
	}{
		{"63_siblings_at_depth_3", wide(siblings(63)), 3},
		{"100_siblings_at_depth_3", wide(siblings(100)), 3},
		{"100_siblings_then_depth_64_chain", wide(siblings(100) +
			`,"z":` + strings.Repeat("[", 62) + "1" + strings.Repeat("]", 62)), 64},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if d := ev23Depth(c.line); d != c.depth {
				t.Fatalf("EV-23 depth %d, want %d", d, c.depth)
			}
			_, ok, tooDeep := parseLine(c.line)
			if tooDeep || !ok {
				t.Fatalf("ok = %v, tooDeep = %v at EV-23 depth %d: the line is within the minimum and must parse in full",
					ok, tooDeep, c.depth)
			}
		})
	}
}

// On both sides of the boundary the required verdict is INVALID at the line
// (ES-17): at 64 the verifier reaches it by parsing the line in full and
// rejecting its shape, and at 65 by EV-24's rule that a depth limit above 2
// establishes INVALID. The reason text tells the two apart.
func TestDepthVerdicts(t *testing.T) {
	g, gh := genesisAndHash(t)
	for _, c := range []struct {
		depth      int
		limitFired bool
	}{{3, false}, {64, false}, {65, true}, {1000000, true}} {
		t.Run(fmt.Sprintf("depth_%d", c.depth), func(t *testing.T) {
			export := append(append(append([]byte{}, g...), deepLine(gh, c.depth-2)...), '\n')
			res := Verify(export, nil)
			if res.Verdict != INVALID || res.Line != 2 {
				t.Fatalf("verdict = %s line %d, want INVALID at line 2 (reason: %s)", res.Verdict, res.Line, res.Reason)
			}
			if got := strings.Contains(res.Reason, "EV-24"); got != c.limitFired {
				t.Fatalf("depth limit fired = %v, want %v; reason: %s", got, c.limitFired, res.Reason)
			}
		})
	}
}

// The depth limit never displaces an earlier fatal line (EV-24: "a verifier
// that has found no fatal earlier line MAY therefore report INVALID at that
// line").
func TestDepthLimitKeepsEarlierFatalLine(t *testing.T) {
	g, gh := genesisAndHash(t)
	bad := seal(t, 2, "x_pad", 1, map[string]any{"blob": "b"}, "2026-01-01T00:00:01.000Z", gh)
	bad = bytes.Replace(bad, []byte(`"blob":"b"`), []byte(`"blob":"c"`), 1) // hash now wrong
	deep := bytes.Replace(deepLine(gh, 1000), []byte(`"seq":2`), []byte(`"seq":3`), 1)
	export := append(append(append(append(append([]byte{}, g...), bad...), '\n'), deep...), '\n')
	res := Verify(export, nil)
	if res.Verdict != INVALID || res.Line != 2 {
		t.Fatalf("verdict = %s line %d, want INVALID at line 2 (reason: %s)", res.Verdict, res.Line, res.Reason)
	}
}

// EV-23 counts brackets outside strings only; a string full of them is depth 2
// and a conforming line. The parser must not count them either.
func TestBracketsInsideStringsAreNotDepth(t *testing.T) {
	g, gh := genesisAndHash(t)
	blob := rawJSON(`"\"` + strings.Repeat("[{", 5000) + `\\"`)
	l := seal(t, 2, "x_pad", 1, map[string]any{"blob": blob}, "2026-01-01T00:00:01.000Z", gh)
	if d := ev23Depth(l); d != 2 {
		t.Fatalf("test bug: EV-23 depth %d, want 2", d)
	}
	res := Verify(append(append(append([]byte{}, g...), l...), '\n'), nil)
	if res.Verdict != PARTIAL || len(res.Lines) != 1 || res.Lines[0] != 2 {
		t.Fatalf("verdict = %s lines %v line %d, want PARTIAL at lines 2 (reason: %s)",
			res.Verdict, res.Lines, res.Line, res.Reason)
	}
}

// --- EV-24: no fixed limit on the number of lines ----------------------------

func TestManyLines(t *testing.T) {
	if testing.Short() {
		t.Skip("builds a 200000-line export")
	}
	const n = 200000
	g, prev := genesisAndHash(t)
	var buf bytes.Buffer
	buf.Write(g)
	for seq := int64(2); seq <= n; seq++ {
		l := seal(t, seq, "x_pad", 1, map[string]any{"n": seq}, "2026-01-01T00:00:01.000Z", prev)
		buf.Write(l)
		buf.WriteByte('\n')
		prev = parseLineOrFail(t, l).hash
	}
	res := Verify(buf.Bytes(), &prev)
	if res.Verdict != PARTIAL || len(res.Lines) != n-1 || res.Lines[0] != 2 || res.Lines[n-2] != n {
		t.Fatalf("verdict = %s with %d lines, want PARTIAL at lines 2..%d (reason: %s)",
			res.Verdict, len(res.Lines), n, res.Reason)
	}
}
