package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"odc/verifier/internal/verify"
)

// evolution.md §7 (EV-23, EV-24) at the CLI: the whole path from file to
// verdict, so an I/O layer with its own line limit — a bufio.Scanner left at
// its 64 KiB default is the classic one, which cannot hold a 65536-byte line
// plus its LF — is caught here even though the verify package has none.
//
// The verdicts asserted are ones the specs fix: line 1 is the committed VALID
// genesis of vector 001, and line 2 is fatal (its stored hash is not its
// recomputed hash, HA-14), so the required verdict is INVALID at line 2. A
// reader that gives up on the long line cannot report it.

// longLine2 renders a seq-2 line exactly n bytes long, LF excluded, whose
// stored hash is wrong.
func longLine2(t *testing.T, prevHash string, n int) string {
	t.Helper()
	build := func(k int) string {
		return fmt.Sprintf(
			`{"seq":2,"type":"x_pad","version":1,"payload":{"blob":"%s"},"ts":"2026-07-21T00:00:01.000Z","prev_hash":"%s","hash":"%s"}`,
			strings.Repeat("a", k), prevHash, strings.Repeat("1", 64))
	}
	l := build(n - len(build(0)))
	if len(l) != n {
		t.Fatalf("test bug: line is %d bytes, want %d", len(l), n)
	}
	return l
}

func TestCLILongLineReachesItsVerdict(t *testing.T) {
	genesis := fixtureVector(t, "001-genesis-only.ndjson")
	gh, _ := firstLastHashes(t, genesis)
	for _, n := range []int{65535, 65536, 65537, 1 << 20} {
		t.Run(fmt.Sprintf("%d_bytes", n), func(t *testing.T) {
			l := longLine2(t, gh, n)
			p := writeExport(t, "long", string(genesis)+l+"\n")
			stdout, stderr, code := runCLIArgs(t, p)
			wantVerdict(t, stdout, code, reInvalid, 1, "2")
			checkReport(t, stderr, gh, strings.Repeat("1", 64))
		})
	}
}

// Past this verifier's one within-line limit (depth 64, the EV-23 minimum) it
// reports INVALID at the line, as EV-24 allows when the limit is above 2 and no
// earlier line is fatal — never a crash, and never a status that reads as a
// verdict it did not print.
func TestCLIDeepLine(t *testing.T) {
	genesis := fixtureVector(t, "001-genesis-only.ndjson")
	gh, _ := firstLastHashes(t, genesis)
	for _, depth := range []int{64, 65, 1_000_000} {
		t.Run(fmt.Sprintf("depth_%d", depth), func(t *testing.T) {
			arrays := depth - 2
			l := fmt.Sprintf(
				`{"seq":2,"type":"x_deep","version":1,"payload":{"a":%s1%s},"ts":"2026-07-21T00:00:01.000Z","prev_hash":"%s","hash":"%s"}`,
				strings.Repeat("[", arrays), strings.Repeat("]", arrays), gh, strings.Repeat("1", 64))
			p := writeExport(t, "deep", string(genesis)+l+"\n")
			stdout, stderr, code := runCLIArgs(t, p)
			wantVerdict(t, stdout, code, reInvalid, 1, "2")
			// The head claim is recovered by a separate JSON decoder with its
			// own depth bound; a limit reached only while recovering a claim
			// makes that claim unavailable, never a tool failure (EV-24).
			wantHead := strings.Repeat("1", 64)
			if depth > 10000 {
				wantHead = verify.Unavailable
			}
			checkReport(t, stderr, gh, wantHead)
		})
	}
}

// EV-24: a verifier MUST NOT end without a report, as a panic would — and a
// Go panic exits 2, which is this CLI's PARTIAL. An internal failure anywhere
// in computing the verdict or the EX-24 report is a tool-level failure: exit
// >= 3, nothing on stdout, no EX-24 lines.
func TestCLIPanicIsToolFailure(t *testing.T) {
	export := filepath.Join(t.TempDir(), "x.ndjson")
	if err := os.WriteFile(export, fixtureVector(t, "001-genesis-only.ndjson"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(){
		"verify_panics": func() {
			verifyWith = func([]byte, verify.Options) verify.Result { panic("boom") }
		},
		"report_panics": func() {
			reportClaims = func([]byte) (string, string, bool) { panic("boom") }
		},
	}
	for name, inject := range cases {
		t.Run(name, func(t *testing.T) {
			origV, origR := verifyWith, reportClaims
			defer func() { verifyWith, reportClaims = origV, origR }()
			inject()

			dir := t.TempDir()
			out, _ := os.Create(filepath.Join(dir, "out"))
			errf, _ := os.Create(filepath.Join(dir, "err"))
			code := run([]string{export}, out, errf)
			out.Close()
			errf.Close()
			stdout, _ := os.ReadFile(filepath.Join(dir, "out"))
			stderr, _ := os.ReadFile(filepath.Join(dir, "err"))

			if code != 4 {
				t.Fatalf("exit %d, want 4 (API.md: an internal failure that reached no verdict, EV-24)", code)
			}
			if len(stdout) != 0 {
				t.Fatalf("stdout must be empty on a tool-level failure, got %q", stdout)
			}
			if !strings.Contains(string(stderr), "internal failure") || !strings.Contains(string(stderr), "boom") {
				t.Fatalf("stderr must name the failure and the recovered panic value, got %q", stderr)
			}
			if hasReport(string(stderr)) {
				t.Fatalf("no EX-24 report on a tool-level failure, got %q", stderr)
			}
		})
	}
}
