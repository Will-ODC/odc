package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// Value-level fuzz over the unbounded-value defect class.
//
// WHAT IS BEING TESTED is a failure SHAPE, not a list of inputs: given a
// STRUCTURALLY VALID export carrying an EXTREME VALUE, does the verifier fail
// to return a verdict at all, or return a malformed one? The routes to that
// shape are language-specific — the cases below are Go's routes (unbounded
// recursion, int64 boundaries, byte-vs-rune divergence), reached by reasoning
// about this parser, and are deliberately NOT a translation of any other
// implementation's cases. A case that cannot fail here asserts nothing here.
//
// WHAT IS ASSERTED, and all that is asserted:
//   - the process finishes (not killed, not timed out, no runtime fatal error);
//   - stdout is EXACTLY ONE line, and that line is one of the three well-formed
//     verdict forms of API.md;
//   - the exit status agrees with the verdict token it printed.
//
// WHICH verdict a case produces is NEVER asserted. contracts/fixtures/ is the
// sole oracle for that. Declaring a verdict here would invent conformance in a
// file no reviewer treats as normative, and would freeze behaviour on inputs
// no fixture covers.
//
// WHY A SUBPROCESS. A Go stack overflow is a runtime FATAL error, not a panic:
// recover() cannot convert it back into a verdict, and in-process it would
// take the test binary down with it — reporting neither which case caused it
// nor any case after it. Re-executing the test binary through TestMain gives
// each case its own process, and keeps `go test ./...` working with no extra
// CI step and no prior `go build`.
//
// THE EXIT-STATUS TRAP. Status 2 is both this CLI's PARTIAL and the Go
// runtime's status on a fatal error. A checker that trusts the status alone
// reads a crash as "chain verified, some semantics unchecked". Every case here
// is therefore judged on STDOUT first; the status is only cross-checked
// against what stdout said. checkVerdict names this explicitly.
//
// Generation is deterministic — fixed sizes, fixed fill bytes, no randomness —
// so a failure reproduces byte-for-byte from the case name alone.

const subprocessEnv = "ODC_VERIFY_CLI_SUBPROCESS"

func TestMain(m *testing.M) {
	if os.Getenv(subprocessEnv) == "1" {
		// Re-executed as the CLI under test. run() is the real argument
		// parsing, I/O and exit-code path that main() uses.
		os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
	}
	os.Exit(m.Run())
}

var (
	reValid   = regexp.MustCompile(`^VALID$`)
	reInvalid = regexp.MustCompile(`^INVALID at line ([1-9][0-9]*)(: .*)?$`)
	rePartial = regexp.MustCompile(`^PARTIAL at lines ([1-9][0-9]*)(, [1-9][0-9]*)*$`)
)

// runCLI executes the verifier as a child process over path.
func runCLI(t *testing.T, path string) (stdout, stderr string, code int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, os.Args[0], path)
	cmd.Env = append(os.Environ(), subprocessEnv+"=1")
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb

	err := cmd.Run()
	if ctx.Err() != nil {
		t.Fatalf("verifier did not finish within the timeout — no verdict returned\nstderr: %s", truncate(errb.String()))
	}
	switch {
	case err == nil:
		code = 0
	default:
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			t.Fatalf("could not run the verifier: %v", err)
		}
		code = ee.ExitCode()
		if code < 0 {
			// ExitCode is -1 when the process was terminated by a signal:
			// SIGSEGV, SIGBUS, an OOM kill. Never a verdict.
			t.Fatalf("verifier was killed by a signal (%v) instead of returning a verdict\nstderr: %s",
				ee.ProcessState, truncate(errb.String()))
		}
	}
	return out.String(), errb.String(), code
}

// checkCLI runs one case and applies the whole assertion set to it.
func checkCLI(t *testing.T, path string) {
	t.Helper()
	stdout, stderr, code := runCLI(t, path)
	checkVerdict(t, stdout, stderr, code)
}

// checkVerdict enforces the whole assertion set: one well-formed verdict line
// on stdout, no runtime death, and an exit status agreeing with the token.
func checkVerdict(t *testing.T, stdout, stderr string, code int) {
	t.Helper()

	// A Go runtime fatal error prints to stderr and exits 2 — the PARTIAL
	// code. Catch it by its stderr signature before anything else, so the
	// failure message says "crashed", not "malformed verdict".
	for _, sig := range []string{"fatal error:", "goroutine stack exceeds", "stack overflow", "out of memory"} {
		if strings.Contains(stderr, sig) {
			t.Fatalf("Go runtime fatal error (%q) — the process died instead of returning a verdict; "+
				"exit status was %d, which collides with PARTIAL\nstderr: %s", sig, code, truncate(stderr))
		}
	}

	if stdout == "" {
		t.Fatalf("no verdict on stdout (exit status %d)\nstderr: %s", code, truncate(stderr))
	}
	if !strings.HasSuffix(stdout, "\n") {
		t.Fatalf("verdict line is not newline-terminated: %q", truncate(stdout))
	}
	// API.md fixes ONE line, with the advisory reason after a colon on that
	// same line. A second line breaks a downstream consumer by throwing rather
	// than mismatching, so the count is asserted, not just the first line.
	body := strings.TrimSuffix(stdout, "\n")
	if strings.Contains(body, "\n") {
		t.Fatalf("expected exactly one verdict line on stdout, got %d:\n%s",
			strings.Count(stdout, "\n"), truncate(stdout))
	}

	var wantCode int
	switch {
	case reValid.MatchString(body):
		wantCode = 0
	case reInvalid.MatchString(body):
		wantCode = 1
		if n, _ := strconv.Atoi(reInvalid.FindStringSubmatch(body)[1]); n < 1 {
			t.Fatalf("INVALID names line %d; line numbers are 1-based", n)
		}
	case rePartial.MatchString(body):
		wantCode = 2
	default:
		t.Fatalf("stdout is not one of the three verdict forms: %q", truncate(body))
	}
	if code != wantCode {
		t.Fatalf("exit status %d disagrees with the verdict printed (%q, which requires %d)",
			code, truncate(body), wantCode)
	}
}

func truncate(s string) string {
	const max = 400
	if len(s) > max {
		return s[:max] + fmt.Sprintf("… (%d bytes total)", len(s))
	}
	return s
}

// --- case construction -------------------------------------------------
//
// Every case is a structurally shaped export line — the seven envelope fields
// in canonical order — with exactly one field or payload value pushed to an
// extreme. Anything not named by the case is held at a benign constant.

const (
	zeroHash = "0000000000000000000000000000000000000000000000000000000000000000"
	goodTS   = "2026-01-01T00:00:00.000Z"
)

// line assembles one envelope. seq and version are raw JSON tokens so a case
// can supply an integer literal Go could not hold.
func line(seq, version, payload string) string {
	return fmt.Sprintf(
		`{"seq":%s,"type":"genesis","version":%s,"payload":%s,"ts":%q,"prev_hash":%q,"hash":%q}`,
		seq, version, payload, goodTS, zeroHash, zeroHash)
}

// writeExport materialises a case and returns its path. Cases are built as
// strings and written once; nothing is retained across cases.
func writeExport(t *testing.T, name, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name+".ndjson")
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatalf("write export: %v", err)
	}
	return p
}

// nestedArrays returns depth open brackets and depth close brackets.
func nestedArrays(depth int) string {
	return strings.Repeat("[", depth) + strings.Repeat("]", depth)
}

// nestedObjects returns depth nested single-key objects around the value 1.
func nestedObjects(depth int) string {
	return strings.Repeat(`{"a":`, depth) + "1" + strings.Repeat("}", depth)
}

// widePayload renders n distinct payload keys in ASCENDING UTF-8 byte order.
// The index is ZERO-PADDED on purpose: an unpadded "k0","k1",…,"k10" sequence
// is NOT ascending ("k10" sorts before "k2"), EX-8 permits rejection at the
// second or third key, and the case would then never exercise a wide payload
// while still appearing to pass.
func widePayload(n int, dupOf int) string {
	var b strings.Builder
	b.Grow(n * 16)
	b.WriteByte('{')
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `"k%09d":"v"`, i)
	}
	if dupOf >= 0 {
		fmt.Fprintf(&b, `,"k%09d":"w"`, dupOf)
	}
	b.WriteByte('}')
	return b.String()
}

// repeatLines builds an export of n copies of one line.
func repeatLines(n int, s string) string {
	var b strings.Builder
	b.Grow(n * (len(s) + 1))
	for i := 0; i < n; i++ {
		b.WriteString(s)
		b.WriteByte('\n')
	}
	return b.String()
}

// --- the cases ---------------------------------------------------------

// Deep nesting, both recursion arms. parse.go is recursive descent, and Go
// answers a blown stack with a runtime FATAL error — not a panic — so
// recover() cannot turn it back into a verdict. Depths run from just inside
// the parser's own bound to far past the depth measured to kill the pre-fix
// binary (objects at ~1.5M, arrays at ~2.5M).
func TestExtremeDeepNesting(t *testing.T) {
	// 3,000,000 is past the measured death point of BOTH arms on the pre-fix
	// binary (objects ~1.5M, arrays ~2.5M, with Go's 1 GB stack limit), so
	// removing the parser's depth bound makes these two cases fail — which is
	// how this suite was confirmed to catch the defect rather than describe it.
	depths := []int{2, 63, 64, 65, 1000, 100_000, 1_000_000, 3_000_000}
	for _, d := range depths {
		for _, arm := range []string{"array", "object"} {
			d, arm := d, arm
			t.Run(fmt.Sprintf("%s_depth_%d", arm, d), func(t *testing.T) {
				t.Parallel()
				var val string
				if arm == "array" {
					val = nestedArrays(d)
				} else {
					val = nestedObjects(d)
				}
				p := writeExport(t, "deep", line("1", "1", `{"p":`+val+`}`)+"\n")
				checkCLI(t, p)
			})
		}
	}
}

// The same recursion reached through the ENVELOPE rather than a payload value:
// `payload` itself deeply nested, and the whole line wrapped in arrays. Both
// are rejected long before any type-specific rule, which is the point — the
// parser must survive input it is about to reject.
func TestExtremeDeepNestingOutsidePayload(t *testing.T) {
	cases := map[string]string{
		"payload_is_deep_object": line("1", "1", nestedObjects(3_000_000)),
		"payload_is_deep_array":  line("1", "1", nestedArrays(3_000_000)),
		"line_wrapped_in_arrays": nestedArrays(3_000_000),
	}
	for name, content := range cases {
		name, content := name, content
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			checkCLI(t, writeExport(t, name, content+"\n"))
		})
	}
}

// Boundary integers at `seq`. Go's interesting magnitudes straddle 2^63
// (int64), which is where a digit-accumulating parser silently wraps —
// JavaScript's 2^53 cliff is a different place entirely, and a case list
// aimed at it would miss every one of these. ES-5's own ceiling (2^53-1) is
// included because it is the value the spec actually pins.
func TestExtremeBoundaryIntegersAtSeq(t *testing.T) {
	cases := map[string]string{
		"zero":                     "0",
		"one":                      "1",
		"es5_ceiling_2p53_minus_1": "9007199254740991",
		"es5_ceiling_plus_one":     "9007199254740992",
		"int64_max":                "9223372036854775807",
		"int64_max_plus_one":       "9223372036854775808",
		"uint64_max":               "18446744073709551615",
		"uint64_max_plus_one":      "18446744073709551616",
		"four_hundred_digits":      strings.Repeat("9", 400),
		"one_million_digits":       strings.Repeat("9", 1_000_000),
		"leading_zeros":            "0000000000000000001",
		"negative_one":             "-1",
		"int64_min":                "-9223372036854775808",
		"float_form":               "1.0",
		"exponent_form":            "1e400",
		"huge_exponent":            "1e999999999",
	}
	for name, seq := range cases {
		name, seq := name, seq
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			checkCLI(t, writeExport(t, name, line(seq, "1", `{"p":"v"}`)+"\n"))
		})
	}
}

// The same magnitudes at `version` and at a payload integer, since each is
// parsed by the same accumulator but consumed by different checks.
func TestExtremeBoundaryIntegersElsewhere(t *testing.T) {
	values := []string{"9007199254740991", "9223372036854775808", "18446744073709551616", strings.Repeat("9", 400)}
	for _, v := range values {
		v := v
		t.Run("version_"+v[:min(12, len(v))], func(t *testing.T) {
			t.Parallel()
			checkCLI(t, writeExport(t, "ver", line("1", v, `{"p":"v"}`)+"\n"))
		})
		t.Run("payload_int_"+v[:min(12, len(v))], func(t *testing.T) {
			t.Parallel()
			checkCLI(t, writeExport(t, "pay", line("1", "1", `{"p":`+v+`}`)+"\n"))
		})
	}
}

// Huge strings, chosen so BYTE LENGTH and RUNE COUNT diverge — 2, 3 and 4
// bytes per scalar against ASCII's 1.
//
// WHAT THESE REACH, stated exactly, because the two are easy to confuse. Every
// case here is rejected in STAGE A, at the hash recomputation: `line` seals each
// one with a placeholder 64-zero hash, so the multi-megabyte payload is framed,
// scanned, UTF-8-decoded and copied in full before the verdict is decided. That
// is the whole point of them — the parser and the string scanner must survive
// input the verifier is about to throw away, at a size where a byte/rune mix-up
// in the SCANNER walks off the end of a buffer.
//
// WHAT THEY DO NOT REACH: ET-14's 1–200 SCALAR bound. countScalars is never
// called on any input in this file, and cannot be: the title checks sit in
// Stage B, behind a correct hash and a usable genesis, and sealing a chain here
// would mean re-implementing the preimage inside a test. The byte-versus-scalar
// divergence ET-14 turns on is pinned where it is genuinely reachable — over a
// real two-line chain, in internal/verify/issue_title_test.go
// (TestIssueTitleLengthIsCountedInScalars).

type hugeStringCase struct {
	name           string
	s              string
	bytesPerScalar int
}

func hugeStringCases() []hugeStringCase {
	return []hugeStringCase{
		// bytes == runes.
		{"ascii_8mib", strings.Repeat("a", 8<<20), 1},
		// 2M runes, 4M bytes.
		{"two_byte_runes_2m", strings.Repeat("\u00e9", 2_000_000), 2},
		// 1M runes, 3M bytes.
		{"three_byte_runes_1m", strings.Repeat("\u3042", 1_000_000), 3},
		// 1M runes, 4M bytes — astral, where a UTF-16 implementation would
		// also count 2M code units. Three different "lengths" for one value.
		{"astral_runes_1m", strings.Repeat("\U0001d11e", 1_000_000), 4},
	}
}

func TestExtremeHugeStrings(t *testing.T) {
	for _, c := range hugeStringCases() {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			payload := `{"title":"` + c.s + `"}`
			checkCLI(t, writeExport(t, c.name, line("1", "1", payload)+"\n"))
		})
	}
}

// A guard on the generator, not on the verifier — the same pattern as
// TestWidePayloadReachesItsKeyCount. If a case's string stopped being
// multi-byte it would still "pass" above while exercising plain ASCII, and the
// divergence these cases exist for would be gone with nothing to say so.
func TestHugeStringCasesDivergeInBytesAndScalars(t *testing.T) {
	for _, c := range hugeStringCases() {
		scalars := utf8.RuneCountInString(c.s)
		if scalars == 0 {
			t.Fatalf("%s: empty case string", c.name)
		}
		if got := len(c.s) / scalars; got != c.bytesPerScalar {
			t.Errorf("%s: %d bytes per scalar, want %d", c.name, got, c.bytesPerScalar)
		}
		if (len(c.s) == scalars) != (c.bytesPerScalar == 1) {
			t.Errorf("%s: byte length %d and scalar count %d do not diverge as intended",
				c.name, len(c.s), scalars)
		}
	}
}

// Escape-heavy strings, including the surrogate-pair decode path. This parser
// permits \u only for C0 controls, so a surrogate pair is a REJECTION path
// here rather than a decode — which is exactly why it must be exercised: the
// half-consumed escape and the lone surrogate are where a scanner walks off
// the end of the buffer.
func TestExtremeEscapeHeavyStrings(t *testing.T) {
	cases := map[string]string{
		"control_escapes_500k":       strings.Repeat(`\u0001`, 500_000),
		"backslash_escapes_500k":     strings.Repeat(`\\`, 500_000),
		"quote_escapes_500k":         strings.Repeat(`\"`, 500_000),
		"short_escapes_mixed_500k":   strings.Repeat(`\n\t\r\b\f`, 100_000),
		"surrogate_pairs_200k":       strings.Repeat(`\ud83d\ude00`, 200_000),
		"lone_high_surrogates_200k":  strings.Repeat(`\ud83d`, 200_000),
		"lone_low_surrogates_200k":   strings.Repeat(`\ude00`, 200_000),
		"truncated_escape_at_end":    strings.Repeat("a", 1000) + `\`,
		"truncated_u_escape_at_end":  strings.Repeat("a", 1000) + `\u00`,
		"unterminated_string":        strings.Repeat("a", 1_000_000),
		"uppercase_hex_escapes_200k": strings.Repeat(`\u00A0`, 200_000),
	}
	for name, s := range cases {
		name, s := name, s
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			var content string
			if name == "unterminated_string" {
				// Deliberately missing the closing quote and brace: the
				// scanner must hit end-of-buffer, not read past it.
				content = `{"seq":1,"type":"genesis","version":1,"payload":{"title":"` + s + "\n"
			} else {
				content = line("1", "1", `{"title":"`+s+`"}`) + "\n"
			}
			checkCLI(t, writeExport(t, name, content))
		})
	}
}

// Very large line counts, well-formed and faulting. frame() walks the whole
// file regardless of where the per-line driver stops, so these size the
// framing pass; the driver's own loop short-circuits at the first fatal line,
// which is stated here rather than pretended away.
func TestExtremeLineCounts(t *testing.T) {
	wellFormed := line("1", "1", `{"p":"v"}`)
	cases := map[string]string{
		"well_formed_lines_200k":  repeatLines(200_000, wellFormed),
		"blank_lines_200k":        strings.Repeat("\n", 200_000),
		"cr_lines_200k":           repeatLines(200_000, wellFormed+"\r"),
		"garbage_lines_200k":      repeatLines(200_000, "not json at all"),
		"empty_objects_200k":      repeatLines(200_000, "{}"),
		"no_final_newline_200k":   strings.TrimSuffix(repeatLines(200_000, wellFormed), "\n"),
		"one_line_no_newline":     wellFormed,
		"single_newline":          "\n",
		"empty_file":              "",
		"nul_bytes_1mib":          strings.Repeat("\x00", 1<<20) + "\n",
		"lone_open_braces_200k":   repeatLines(200_000, "{"),
		"invalid_utf8_lines_200k": repeatLines(200_000, "{\"seq\":1,\"type\":\"\xff\xfe\"}"),
	}
	for name, content := range cases {
		name, content := name, content
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			checkCLI(t, writeExport(t, name, content))
		})
	}
}

// Very wide payload objects. The key sequence is genuinely ascending (see
// widePayload), and TestWidePayloadReachesItsKeyCount below pins that it is,
// so this case cannot pass by being rejected at key two.
func TestExtremeWidePayloads(t *testing.T) {
	cases := []struct {
		name  string
		n     int
		dupOf int
	}{
		{"wide_50k", 50_000, -1},
		{"wide_300k", 300_000, -1},
		{"wide_300k_with_duplicate_first_key", 300_000, 0},
		{"wide_300k_with_duplicate_last_key", 300_000, 299_999},
		{"wide_300k_descending_keys", 300_000, -1}, // reversed below
		{"empty_payload", 0, -1},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			payload := widePayload(c.n, c.dupOf)
			if c.name == "wide_300k_descending_keys" {
				payload = reverseKeys(c.n)
			}
			checkCLI(t, writeExport(t, c.name, line("1", "1", payload)+"\n"))
		})
	}
}

// reverseKeys renders n keys in DESCENDING order — an EX-8 violation, present
// so the ordering check itself is exercised at scale rather than only the
// happy ordering.
func reverseKeys(n int) string {
	var b strings.Builder
	b.Grow(n * 16)
	b.WriteByte('{')
	for i := n - 1; i >= 0; i-- {
		if i < n-1 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `"k%09d":"v"`, i)
	}
	b.WriteByte('}')
	return b.String()
}

// A guard on the generator, not on the verifier. If widePayload ever stopped
// producing ascending keys, every wide case above would still "pass" while
// exercising a two-key payload. This asserts the sequence is ascending and
// that the intended key count is actually present in the bytes.
func TestWidePayloadReachesItsKeyCount(t *testing.T) {
	const n = 1000
	p := widePayload(n, -1)
	if got := strings.Count(p, `":"v"`); got != n {
		t.Fatalf("widePayload(%d) rendered %d keys", n, got)
	}
	keys := regexp.MustCompile(`"(k\d+)":`).FindAllStringSubmatch(p, -1)
	if len(keys) != n {
		t.Fatalf("matched %d keys, want %d", len(keys), n)
	}
	for i := 1; i < len(keys); i++ {
		if keys[i-1][1] >= keys[i][1] {
			t.Fatalf("keys not strictly ascending in UTF-8 byte order at index %d: %q then %q (EX-8)",
				i, keys[i-1][1], keys[i][1])
		}
	}
}
