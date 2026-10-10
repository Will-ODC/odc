// Command verify is the standalone ODC export verifier.
//
// Usage:
//
//	verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]
//
// It prints one of the three verdicts fixed by contracts/evolution.md
// EV-7/EV-17 — VALID, INVALID at line N, or PARTIAL naming the affected lines —
// and exits 0 / 1 / 2 respectively. Tool-level failures (bad usage, unreadable
// file) exit with status >= 3 and are never a chain verdict. Reason text is
// advisory and not part of conformance (EV-17). On every run over a non-empty
// export it also writes `genesis: <hex>` and `head: <hex>` to stderr (EX-24).
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

	res := verify.VerifyWith(data, verify.Options{Head: head, Chain: chain})
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

	// EX-24: on every run over a non-empty export, whatever the verdict,
	// report the genesis hash (EX-21) and the head (EX-14) — on STDERR, after
	// the verdict line, so stdout stays exactly the one verdict line. This is
	// tool output, not conformance surface (EV-17).
	if genesis, headHash, ok := verify.ReportHashes(data); ok {
		fmt.Fprintf(stderr, "genesis: %s\n", genesis)
		fmt.Fprintf(stderr, "head: %s\n", headHash)
	}
	return code
}

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
