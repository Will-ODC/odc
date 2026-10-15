// Command verify is the standalone ODC export verifier.
//
// Usage:
//
//	verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]
//
// It prints one of the three verdicts fixed by contracts/evolution.md
// EV-7/EV-17 — VALID, INVALID at line N, or PARTIAL naming the affected lines —
// and exits 0 / 1 / 2 respectively. Tool-level failures (bad usage, unreadable
// file: 3; an internal failure that reached no verdict, EV-24: 4) exit with
// status >= 3 and are never a chain verdict. Reason text is
// advisory and not part of conformance (EV-17). On every run that yields a
// verdict over non-empty input it also writes the two endpoint STORED CLAIMS of
// EX-24 to stderr, one line each:
//
//	genesis hash (stored claim): <hex|unavailable>
//	head hash (stored claim): <hex|unavailable>
package main

import (
	"fmt"
	"os"
	"strings"

	"odc/verifier/internal/verify"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr *os.File) int {
	var path string
	var head, chain *string
	havePath := false

	// hexFlag validates a 64-lowercase-hex flag value; a malformed value is a
	// tool error (exit 3), never a chain verdict.
	hexFlag := func(name, v string) (*string, bool) {
		if !isHex64Lower(v) {
			fmt.Fprintf(stderr, "error: %s must be 64 lowercase hex characters\n", name)
			return nil, false
		}
		return &v, true
	}

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--head" || a == "--chain":
			if i+1 >= len(args) {
				fmt.Fprintf(stderr, "error: %s requires a value\n", a)
				return 3
			}
			v, ok := hexFlag(a, args[i+1])
			if !ok {
				return 3
			}
			if a == "--head" {
				head = v
			} else {
				chain = v
			}
			i++
		case strings.HasPrefix(a, "--head="):
			v, ok := hexFlag("--head", strings.TrimPrefix(a, "--head="))
			if !ok {
				return 3
			}
			head = v
		case strings.HasPrefix(a, "--chain="):
			v, ok := hexFlag("--chain", strings.TrimPrefix(a, "--chain="))
			if !ok {
				return 3
			}
			chain = v
		case a == "-h" || a == "--help":
			fmt.Fprintln(stdout, usage)
			return 3
		case strings.HasPrefix(a, "-") && a != "-":
			fmt.Fprintf(stderr, "error: unknown flag %q\n", a)
			return 3
		default:
			if havePath {
				fmt.Fprintln(stderr, "error: multiple input files given")
				return 3
			}
			path = a
			havePath = true
		}
	}

	if !havePath {
		fmt.Fprintln(stderr, usage)
		return 3
	}

	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(stderr, "error: cannot read %s: %v\n", path, err)
		return 3
	}

	res, claims, failure := evaluate(data, verify.Options{Head: head, Chain: chain})
	if failure != nil {
		// EV-24: an internal failure is reported as a tool-level failure —
		// never a chain verdict, and never a bare panic, whose Go exit status
		// (2) would read as PARTIAL. Nothing has been written to stdout yet.
		fmt.Fprintf(stderr, "error: internal failure; no verdict was reached (EV-24): %v\n", failure)
		return 4
	}
	var code int
	switch res.Verdict {
	case verify.VALID:
		fmt.Fprintln(stdout, "VALID")
		code = 0
	case verify.INVALID:
		if res.Reason != "" {
			fmt.Fprintf(stdout, "INVALID at line %d: %s\n", res.Line, res.Reason)
		} else {
			fmt.Fprintf(stdout, "INVALID at line %d\n", res.Line)
		}
		code = 1
	case verify.PARTIAL:
		fmt.Fprintf(stdout, "PARTIAL at lines %s\n", joinInts(res.Lines))
		code = 2
	default:
		fmt.Fprintln(stderr, "error: internal: unknown verdict")
		return 3
	}

	// EX-24: on every run that produced a chain verdict over non-empty input,
	// whatever the verdict, report the two endpoint STORED CLAIMS — the `hash`
	// field stored in the first and last candidate records — on STDERR,
	// after the verdict line, so stdout stays exactly the one verdict line.
	// They are labelled as stored claims because they are not recomputed and,
	// on INVALID input, not verified chain anchors. Tool output, not
	// conformance surface (EV-17).
	if claims.ok {
		fmt.Fprintf(stderr, "%s%s\n", reportGenesisLabel, claims.genesis)
		fmt.Fprintf(stderr, "%s%s\n", reportHeadLabel, claims.head)
	}
	return code
}

// endpointClaims carries the EX-24 report computed before anything is printed.
type endpointClaims struct {
	genesis, head string
	ok            bool // false for empty input: nothing to report
}

// Seams for tests that need an internal failure to happen; production code
// never reassigns them.
var (
	verifyWith   = verify.VerifyWith
	reportClaims = verify.ReportClaims
)

// evaluate computes the verdict AND the EX-24 report before either is printed,
// and turns a panic anywhere in them into a non-nil failure (the recovered
// value, for the error message). EV-24 forbids ending
// without a report "as a panic … would"; computing both first means a failure
// can never leave a verdict line on stdout followed by a tool-level exit
// status. (A Go runtime FATAL error — stack overflow, out of memory — is not a
// panic and cannot be recovered; the parser's depth bound is what keeps the
// first from happening, and the second is the host-resource exemption of
// EV-24, reported only as far as the Go runtime lets the process report.)
func evaluate(data []byte, opts verify.Options) (res verify.Result, claims endpointClaims, failure any) {
	defer func() {
		if r := recover(); r != nil {
			failure = r
		}
	}()
	res = verifyWith(data, opts)
	claims.genesis, claims.head, claims.ok = reportClaims(data)
	return res, claims, nil
}

// EX-24 report labels (stderr). "stored claim" is the EX-24 distinction: the
// value is what the file states, not a successful hash recomputation.
const (
	reportGenesisLabel = "genesis hash (stored claim): "
	reportHeadLabel    = "head hash (stored claim): "
)

const usage = "usage: verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]"

func isHex64Lower(s string) bool {
	if len(s) != 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func joinInts(xs []int) string {
	var b strings.Builder
	for i, x := range xs {
		if i > 0 {
			b.WriteString(", ")
		}
		fmt.Fprintf(&b, "%d", x)
	}
	return b.String()
}
