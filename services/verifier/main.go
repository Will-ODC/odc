// Command verify is the standalone ODC export verifier.
//
// Usage:
//
//	verify <export.ndjson> [--head <hash>]
//
// It prints one of the three verdicts fixed by contracts/evolution.md
// EV-7/EV-17 — VALID, INVALID at line N, or PARTIAL naming the affected lines —
// and exits 0 / 1 / 2 respectively. Tool-level failures (bad usage, unreadable
// file) exit with status >= 3 and are never a chain verdict. Reason text is
// advisory and not part of conformance (EV-17).
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
	var head *string
	havePath := false

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--head":
			if i+1 >= len(args) {
				fmt.Fprintln(stderr, "error: --head requires a value")
				return 3
			}
			h := args[i+1]
			if !isHex64Lower(h) {
				fmt.Fprintln(stderr, "error: --head must be 64 lowercase hex characters")
				return 3
			}
			head = &h
			i++
		case strings.HasPrefix(a, "--head="):
			h := strings.TrimPrefix(a, "--head=")
			if !isHex64Lower(h) {
				fmt.Fprintln(stderr, "error: --head must be 64 lowercase hex characters")
				return 3
			}
			head = &h
		case a == "-h" || a == "--help":
			fmt.Fprintln(stdout, "usage: verify <export.ndjson> [--head <hash>]")
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
		fmt.Fprintln(stderr, "usage: verify <export.ndjson> [--head <hash>]")
		return 3
	}

	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(stderr, "error: cannot read %s: %v\n", path, err)
		return 3
	}

	res := verify.Verify(data, head)
	switch res.Verdict {
	case verify.VALID:
		fmt.Fprintln(stdout, "VALID")
		return 0
	case verify.INVALID:
		if res.Reason != "" {
			fmt.Fprintf(stdout, "INVALID at line %d: %s\n", res.Line, res.Reason)
		} else {
			fmt.Fprintf(stdout, "INVALID at line %d\n", res.Line)
		}
		return 1
	case verify.PARTIAL:
		fmt.Fprintf(stdout, "PARTIAL at lines %s\n", joinInts(res.Lines))
		return 2
	}
	fmt.Fprintln(stderr, "error: internal: unknown verdict")
	return 3
}

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
