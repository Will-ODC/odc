package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

// `--chain` (export-format.md EX-22/EX-23) and the EX-24 genesis/head report.
//
// The verdicts asserted here are those EX-22/EX-23 fix for --chain, on exports
// whose own verdicts contracts/fixtures/index.json already fixes; the EX-24
// lines are tool output (EV-17), asserted here because this tool's API.md
// promises their format, not because they are conformance surface.

// runCLIArgs executes the verifier as a child process with the given args.
func runCLIArgs(t *testing.T, args ...string) (stdout, stderr string, code int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], args...)
	cmd.Env = append(os.Environ(), subprocessEnv+"=1")
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	if ctx.Err() != nil {
		t.Fatalf("verifier timed out\nstderr: %s", truncate(errb.String()))
	}
	if err != nil {
		var ee *exec.ExitError
		if !errors.As(err, &ee) {
			t.Fatalf("could not run the verifier: %v", err)
		}
		code = ee.ExitCode()
	}
	return out.String(), errb.String(), code
}

// fixtureVector returns the bytes of contracts/fixtures/vectors/<name>.
func fixtureVector(t *testing.T, name string) []byte {
	t.Helper()
	dir, _ := os.Getwd()
	for {
		p := filepath.Join(dir, "contracts", "fixtures", "vectors", name)
		if b, err := os.ReadFile(p); err == nil {
			return b
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not locate contracts/fixtures/vectors/%s", name)
		}
		dir = parent
	}
}

// storedHash pulls a line's stored hash by the canonical form's shape (hash is
// the last envelope field) — deliberately not by the code under test.
var reTrailingHash = regexp.MustCompile(`"hash":"([0-9a-f]{64})"\}$`)

func storedHash(t *testing.T, line string) string {
	t.Helper()
	m := reTrailingHash.FindStringSubmatch(line)
	if m == nil {
		t.Fatalf("no trailing hash in %q", truncate(line))
	}
	return m[1]
}

// firstLastHashes returns the stored hash of the first and last lines.
func firstLastHashes(t *testing.T, data []byte) (string, string) {
	t.Helper()
	ls := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	return storedHash(t, ls[0]), storedHash(t, ls[len(ls)-1])
}

// checkReport asserts stderr is EXACTLY the two EX-24 stored-claim lines, in
// order, one per endpoint (no other stderr output on a verdict run).
func checkReport(t *testing.T, stderr, genesis, head string) {
	t.Helper()
	want := reportGenesisLabel + genesis + "\n" + reportHeadLabel + head + "\n"
	if stderr != want {
		t.Fatalf("stderr is not exactly the EX-24 report\nwant:\n%s\ngot:\n%s", want, truncate(stderr))
	}
}

// hasReport says whether any EX-24 report line appears on stderr.
func hasReport(stderr string) bool {
	return strings.Contains(stderr, reportGenesisLabel) || strings.Contains(stderr, reportHeadLabel)
}

func wantVerdict(t *testing.T, stdout string, code int, re *regexp.Regexp, wantCode int, wantLine string) {
	t.Helper()
	body := strings.TrimSuffix(stdout, "\n")
	if strings.Contains(body, "\n") || !strings.HasSuffix(stdout, "\n") {
		t.Fatalf("stdout is not exactly one line: %q", truncate(stdout))
	}
	m := re.FindStringSubmatch(body)
	if m == nil {
		t.Fatalf("stdout = %q, want match for %s", truncate(body), re)
	}
	if wantLine != "" && m[1] != wantLine {
		t.Fatalf("stdout = %q, want line %s", truncate(body), wantLine)
	}
	if code != wantCode {
		t.Fatalf("exit %d, want %d", code, wantCode)
	}
}

const (
	otherHash = "1111111111111111111111111111111111111111111111111111111111111111"
	upperHash = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)

func TestChainFlag(t *testing.T) {
	valid := fixtureVector(t, "002-four-types.ndjson") // VALID, 4 lines
	gen, head := firstLastHashes(t, valid)
	p := writeExport(t, "valid", string(valid))

	partial := fixtureVector(t, "008-unregistered-type.ndjson") // PARTIAL at 5
	pGen, _ := firstLastHashes(t, partial)
	pp := writeExport(t, "partial", string(partial))

	broken := fixtureVector(t, "037-hash-mismatch.ndjson") // INVALID at 2
	bp := writeExport(t, "broken", string(broken))

	// INVALID at 2 by the canonical form (EX-10) alone; its hash still checks.
	noncanon := writeExport(t, "noncanon", string(fixtureVector(t, "048-insignificant-whitespace.ndjson")))
	// INVALID at 3 (its last line) by a registered event's semantic check, ET-17.
	semantic := writeExport(t, "semantic", string(fixtureVector(t, "058-vote-sig-wrong-key.ndjson")))

	cases := []struct {
		name     string
		args     []string
		re       *regexp.Regexp
		wantCode int
		wantLine string
	}{
		{"match", []string{p, "--chain", gen}, reValid, 0, ""},
		{"match-equals-form", []string{p, "--chain=" + gen}, reValid, 0, ""},
		{"mismatch", []string{p, "--chain", otherHash}, reInvalid, 1, "1"},
		{"chain-and-head-both-correct", []string{p, "--chain", gen, "--head", head}, reValid, 0, ""},
		{"chain-correct-head-wrong", []string{p, "--chain", gen, "--head", otherHash}, reInvalid, 1, "4"},
		{"chain-wrong-head-correct", []string{p, "--head", head, "--chain", otherHash}, reInvalid, 1, "1"},
		// Precedence: both mismatch -> the --chain mismatch, line 1, wins
		// over the --head mismatch at the last line (4).
		{"both-wrong-chain-wins", []string{p, "--head", otherHash, "--chain", otherHash}, reInvalid, 1, "1"},
		// Same point as --head: overrides PARTIAL ...
		{"partial-match-stays-partial", []string{pp, "--chain", pGen}, rePartial, 2, ""},
		{"partial-mismatch-invalid", []string{pp, "--chain", otherHash}, reInvalid, 1, "1"},
		// ... but never an earlier INVALID.
		{"earlier-invalid-not-overridden", []string{bp, "--chain", otherHash}, reInvalid, 1, "2"},
		// EX-15/EX-22/EX-23 v5: an INVALID established by ANY file check —
		// structural, canonical form, or a registered event's semantic check —
		// keeps its line even when both anchors are also wrong; the EX-23
		// chain-first ordering applies to anchor comparisons only.
		{"earlier-invalid-both-wrong", []string{bp, "--chain", otherHash, "--head", otherHash}, reInvalid, 1, "2"},
		{"canonical-form-invalid-both-wrong", []string{noncanon, "--chain", otherHash, "--head", otherHash}, reInvalid, 1, "2"},
		{"semantic-invalid-chain-wrong", []string{semantic, "--chain", otherHash}, reInvalid, 1, "3"},
		{"semantic-invalid-both-wrong", []string{semantic, "--head", otherHash, "--chain", otherHash}, reInvalid, 1, "3"},
		// PARTIAL does not block either comparison; both wrong -> line 1.
		{"partial-head-mismatch-last-line", []string{pp, "--head", otherHash}, reInvalid, 1, "5"},
		{"partial-both-wrong-chain-wins", []string{pp, "--head", otherHash, "--chain", otherHash}, reInvalid, 1, "1"},
		{"partial-chain-correct-head-wrong", []string{pp, "--chain", pGen, "--head", otherHash}, reInvalid, 1, "5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stdout, _, code := runCLIArgs(t, c.args...)
			wantVerdict(t, stdout, code, c.re, c.wantCode, c.wantLine)
		})
	}
}

func TestChainFlagMalformedIsToolError(t *testing.T) {
	p := writeExport(t, "valid", string(fixtureVector(t, "002-four-types.ndjson")))
	for _, args := range [][]string{
		{p, "--chain", upperHash},
		{p, "--chain", otherHash[:63]},
		{p, "--chain", otherHash + "1"},
		{p, "--chain=xyz"},
		{p, "--chain="},
		{p, "--chain"},
	} {
		stdout, stderr, code := runCLIArgs(t, args...)
		if code != 3 {
			t.Errorf("%v: exit %d, want 3", args[1:], code)
		}
		if stdout != "" {
			t.Errorf("%v: tool error printed a verdict: %q", args[1:], stdout)
		}
		if hasReport(stderr) {
			t.Errorf("%v: EX-24 report on a tool error: %q", args[1:], stderr)
		}
	}
}

func TestEX24Report(t *testing.T) {
	valid := fixtureVector(t, "002-four-types.ndjson")
	gen, head := firstLastHashes(t, valid)
	partial := fixtureVector(t, "008-unregistered-type.ndjson")
	pGen, pHead := firstLastHashes(t, partial)
	broken := fixtureVector(t, "037-hash-mismatch.ndjson")
	bGen, bHead := firstLastHashes(t, broken)

	cases := []struct {
		name      string
		content   string
		args      []string
		re        *regexp.Regexp
		wantCode  int
		gen, head string
	}{
		{"valid", string(valid), nil, reValid, 0, gen, head},
		{"valid-with-chain-mismatch", string(valid), []string{"--chain", otherHash}, reInvalid, 1, gen, head},
		{"valid-with-head-mismatch", string(valid), []string{"--head", otherHash}, reInvalid, 1, gen, head},
		{"partial", string(partial), nil, rePartial, 2, pGen, pHead},
		{"invalid", string(broken), nil, reInvalid, 1, bGen, bHead},
		{"line1-not-json", "not json\n" + string(valid), nil, reInvalid, 1, "unavailable", head},
		{"bom-line1", "\xef\xbb\xbf" + string(valid), nil, reInvalid, 1, "unavailable", head},
		{"last-line-no-hash", string(valid) + `{"seq":5}` + "\n", nil, reInvalid, 1, gen, "unavailable"},
		{"last-line-hash-uppercase", string(valid) + `{"hash":"` + upperHash + `"}` + "\n", nil, reInvalid, 1, gen, "unavailable"},
		{"last-line-hash-not-string", string(valid) + `{"hash":5}` + "\n", nil, reInvalid, 1, gen, "unavailable"},
		// Reported even with both anchors given and wrong: the report is the
		// file's stored claims, not the expected anchors.
		{"both-anchors-wrong", string(valid), []string{"--chain", otherHash, "--head", otherHash}, reInvalid, 1, gen, head},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := writeExport(t, c.name, c.content)
			stdout, stderr, code := runCLIArgs(t, append([]string{p}, c.args...)...)
			wantVerdict(t, stdout, code, c.re, c.wantCode, "")
			checkReport(t, stderr, c.gen, c.head)
		})
	}
}

func TestEX24NoReportOnEmptyExport(t *testing.T) {
	p := writeExport(t, "empty", "")
	for _, args := range [][]string{{p}, {p, "--chain", otherHash}} {
		stdout, stderr, code := runCLIArgs(t, args...)
		wantVerdict(t, stdout, code, reInvalid, 1, "1")
		if hasReport(stderr) {
			t.Fatalf("EX-24 report printed for an empty export: %q", stderr)
		}
	}
}

func TestEX24NoReportOnUnreadableFile(t *testing.T) {
	stdout, stderr, code := runCLIArgs(t, filepath.Join(t.TempDir(), "missing.ndjson"))
	if code != 3 || stdout != "" {
		t.Fatalf("exit %d stdout %q, want 3 and empty", code, stdout)
	}
	if hasReport(stderr) {
		t.Fatalf("EX-24 report on an I/O error: %q", stderr)
	}
}

// upperFirstLetter upper-cases the first a-f character of a hex string, so the
// result differs from h by case alone.
func upperFirstLetter(h string) string {
	i := strings.IndexAny(h, "abcdef")
	if i < 0 {
		panic("no hex letter in " + h)
	}
	return h[:i] + strings.ToUpper(h[i:i+1]) + h[i+1:]
}

// reAnyVerdict matches any of the three verdict forms (EV-17).
var reAnyVerdict = regexp.MustCompile(`^(VALID|INVALID at line [1-9][0-9]*(: .*)?|PARTIAL at lines [1-9][0-9]*(, [1-9][0-9]*)*)$`)

// TestEX24CandidateExtraction pins EX-24's candidate-record and claim rules,
// end to end through the CLI. Every input here is non-empty and yields a chain
// verdict, so every one MUST carry the report — whatever the framing.
func TestEX24CandidateExtraction(t *testing.T) {
	valid := string(fixtureVector(t, "002-four-types.ndjson"))
	gen, head := firstLastHashes(t, []byte(valid))
	body := strings.TrimSuffix(valid, "\n")
	lines := strings.Split(body, "\n")
	last := lines[len(lines)-1]
	const ua = "unavailable"

	// rehash swaps a canonical line's stored hash for h, textually.
	rehash := func(line, h string) string {
		return strings.Replace(line, `"hash":"`+storedHash(t, line)+`"`, `"hash":"`+h+`"`, 1)
	}

	cases := []struct {
		name      string
		content   string
		gen, head string
	}{
		// Split at LF; one terminal LF ends the last record, no empty candidate.
		{"one-terminal-lf", valid, gen, head},
		// An additional trailing blank record IS the last candidate.
		{"extra-trailing-blank-record", valid + "\n", gen, ua},
		{"two-extra-trailing-blank-records", valid + "\n\n", gen, ua},
		// No final LF: the final fragment is the last candidate (framing fails).
		{"no-final-lf", body, gen, head},
		// Extraction ignores framing: CRLF fails EX-3, but each record still
		// decodes, the trailing CR being JSON whitespace.
		{"crlf", strings.ReplaceAll(valid, "\n", "\r\n"), gen, head},
		// A blank FIRST record: the genesis claim is unavailable.
		{"leading-blank-record", "\n" + valid, ua, head},
		// One LF alone: one blank candidate, which is both endpoints.
		{"single-lf", "\n", ua, ua},
		// A single record with no LF at all: both endpoints are that record.
		{"single-fragment", lines[0], gen, gen},
		// Interior garbage does not move either endpoint.
		{"interior-garbage", lines[0] + "\nnot json\n" + strings.Join(lines[1:], "\n") + "\n", gen, head},
		// Repeated top-level `hash`: the LAST occurrence is the claim, in
		// either direction.
		{"dup-hash-last-valid", valid + `{"hash":5,"hash":"` + otherHash + `"}` + "\n", gen, otherHash},
		{"dup-hash-last-invalid", valid + `{"hash":"` + otherHash + `","hash":5}` + "\n", gen, ua},
		{"dup-hash-on-real-line", body + "\n" + strings.TrimSuffix(last, "}") + `,"hash":"` + otherHash + `"}` + "\n", gen, otherHash},
		// Only a TOP-LEVEL `hash` counts.
		{"nested-hash-only", valid + `{"payload":{"hash":"` + otherHash + `"}}` + "\n", gen, ua},
		// No normalisation: case, padding, length, type.
		{"uppercase", valid + `{"hash":"` + upperHash + `"}` + "\n", gen, ua},
		{"one-uppercase-char", body + "\n" + rehash(last, upperFirstLetter(head)) + "\n", gen, ua},
		{"space-padded-value", valid + `{"hash":" ` + otherHash + `"}` + "\n", gen, ua},
		{"63-hex", valid + `{"hash":"` + otherHash[:63] + `"}` + "\n", gen, ua},
		{"65-hex", valid + `{"hash":"` + otherHash + `1"}` + "\n", gen, ua},
		{"hash-null", valid + `{"hash":null}` + "\n", gen, ua},
		{"key-case", valid + `{"HASH":"` + otherHash + `"}` + "\n", gen, ua},
		// Must decode, as a whole, as a JSON OBJECT.
		{"array-not-object", valid + `[{"hash":"` + otherHash + `"}]` + "\n", gen, ua},
		{"json-null", valid + "null\n", gen, ua},
		{"trailing-garbage", valid + `{"hash":"` + otherHash + `"}x` + "\n", gen, ua},
		{"truncated-object", valid + `{"hash":"` + otherHash + `"` + "\n", gen, ua},
		{"invalid-utf8", valid + `{"x":"` + "\xff" + `","hash":"` + otherHash + `"}` + "\n", gen, ua},
		// Insignificant JSON whitespace around a decodable object still
		// decodes (the line is non-canonical, EX-10, but the claim recovers).
		{"spaced-object", valid + ` { "hash" : "` + otherHash + `" } ` + "\n", gen, otherHash},
		// One missing value never suppresses the other.
		{"both-unavailable", "x\ny\n", ua, ua},
		{"bom-genesis-unavailable", "\xef\xbb\xbf" + valid, ua, head},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := writeExport(t, c.name, c.content)
			stdout, stderr, code := runCLIArgs(t, p)
			if code < 0 || code > 2 {
				t.Fatalf("exit %d: no chain verdict (stderr %q)", code, truncate(stderr))
			}
			wantVerdict(t, stdout, code, reAnyVerdict, code, "")
			checkReport(t, stderr, c.gen, c.head)
		})
	}
}
