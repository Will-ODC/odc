package verify

import (
	"bytes"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// frame collects every line of data and each line's framing violation, for
// tests that want the whole split at once.
func frame(data []byte) (lines [][]byte, faults map[int]string) {
	faults = map[int]string{}
	r := &lineReader{data: data}
	for {
		seg, ln, fault, ok := r.next()
		if !ok {
			return lines, faults
		}
		lines = append(lines, seg)
		if fault != "" {
			faults[ln] = fault
		}
	}
}

// referenceFrame is the eager framing pass the lazy lineReader replaced
// (#369), kept verbatim as the oracle the reader must reproduce.
func referenceFrame(data []byte) (lines [][]byte, faults map[int]string) {
	faults = map[int]string{}
	if len(data) == 0 {
		return nil, faults
	}
	if len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf {
		faults[1] = "byte-order mark (EX-2)"
	}
	hasFinalLF := data[len(data)-1] == 0x0A
	start := 0
	for i := 0; i < len(data); i++ {
		if data[i] == 0x0A {
			lines = append(lines, data[start:i])
			start = i + 1
		}
	}
	if start < len(data) {
		lines = append(lines, data[start:])
	}
	n := len(lines)
	if !hasFinalLF {
		if _, ok := faults[n]; !ok {
			faults[n] = "missing final LF (EX-4)"
		}
	}
	for idx, seg := range lines {
		ln := idx + 1
		for _, b := range seg {
			if b == 0x0D {
				if _, ok := faults[ln]; !ok {
					faults[ln] = "carriage return (EX-3)"
				}
				break
			}
		}
		if len(seg) == 0 {
			if _, ok := faults[ln]; !ok {
				faults[ln] = "blank line (EX-5)"
			}
		}
	}
	return lines, faults
}

// referenceCandidates is the full EX-24 candidate split endpoints replaced
// (#369), kept verbatim as its oracle.
func referenceCandidates(data []byte) [][]byte {
	if len(data) == 0 {
		return nil
	}
	if data[len(data)-1] == '\n' {
		data = data[:len(data)-1]
	}
	return bytes.Split(data, []byte{'\n'})
}

// allInputs enumerates every string of up to maxLen bytes over an alphabet
// that reaches each framing rule: LF, CR, the three BOM bytes, and a plain
// byte.
func allInputs(maxLen int) [][]byte {
	alphabet := []byte{'a', '\n', '\r', 0xef, 0xbb, 0xbf}
	out := [][]byte{{}}
	level := [][]byte{{}}
	for n := 1; n <= maxLen; n++ {
		var nextLevel [][]byte
		for _, p := range level {
			for _, b := range alphabet {
				s := append(append([]byte{}, p...), b)
				nextLevel = append(nextLevel, s)
			}
		}
		out = append(out, nextLevel...)
		level = nextLevel
	}
	return out
}

// The lazy reader yields exactly the lines and per-line framing violations of
// the eager pass, on every input up to six bytes over the framing alphabet.
// Since the driver stops at the first faulting line, this pins that its
// verdict, line and reason are unchanged.
func TestLineReaderMatchesEagerFrame(t *testing.T) {
	for _, in := range allInputs(6) {
		gotLines, gotFaults := frame(in)
		wantLines, wantFaults := referenceFrame(in)
		if len(gotLines) != len(wantLines) {
			t.Fatalf("%q: %d lines, want %d", in, len(gotLines), len(wantLines))
		}
		for i := range gotLines {
			if !bytes.Equal(gotLines[i], wantLines[i]) {
				t.Fatalf("%q: line %d = %q, want %q", in, i+1, gotLines[i], wantLines[i])
			}
		}
		if !reflect.DeepEqual(gotFaults, wantFaults) {
			t.Fatalf("%q: faults %v, want %v", in, gotFaults, wantFaults)
		}
	}
}

// The first framing fault reaches the verdict exactly as before: the earliest
// faulting line, and on a line with two violations the one the eager pass
// recorded.
func TestFirstFramingFault(t *testing.T) {
	cases := []struct {
		name   string
		in     string
		line   int
		reason string
	}{
		{"empty", "", 1, "EX-18"},
		{"bom then blank", "\xef\xbb\xbf\n\n", 1, "EX-2"},
		{"bom only, no LF", "\xef\xbb\xbf", 1, "EX-2"},
		{"bom on a CR line", "\xef\xbb\xbf\r\n", 1, "EX-2"},
		{"cr then blank", "\r\n\n", 1, "EX-3"},
		{"blank then cr", "\n\r\n", 1, "EX-5"},
		{"blank then missing final LF", "\na", 1, "EX-5"},
		{"missing final LF only", "a", 1, "EX-4"},
		{"missing final LF on a CR line", "a\r", 1, "EX-4"},
		{"single LF", "\n", 1, "EX-5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := VerifyWith([]byte(c.in), Options{})
			if res.Verdict != INVALID || res.Line != c.line {
				t.Fatalf("got %s at line %d (%s), want INVALID at line %d",
					res.Verdict, res.Line, res.Reason, c.line)
			}
			if !strings.Contains(res.Reason, c.reason) {
				t.Fatalf("reason %q does not cite %s", res.Reason, c.reason)
			}
		})
	}
}

// endpoints returns exactly the first and last records of the full EX-24
// candidate split, on every input up to six bytes over the framing alphabet.
func TestEndpointsMatchFullSplit(t *testing.T) {
	for _, in := range allInputs(6) {
		cands := referenceCandidates(in)
		first, last, ok := endpoints(in)
		if ok != (len(cands) > 0) {
			t.Fatalf("%q: ok = %v with %d candidates", in, ok, len(cands))
		}
		if !ok {
			continue
		}
		if !bytes.Equal(first, cands[0]) || !bytes.Equal(last, cands[len(cands)-1]) {
			t.Fatalf("%q: endpoints (%q, %q), want (%q, %q)",
				in, first, last, cands[0], cands[len(cands)-1])
		}
	}
}

// #369: on a hostile export whose verdict is fixed at line 1, verification
// and the EX-24 report allocate a bounded amount, not memory proportional to
// the line count. The eager pass allocated well over 100 MiB for these 8 MiB
// inputs; the bound leaves wide headroom above what the lazy walk needs.
// Not parallel, so no other test in this package allocates meanwhile.
func TestHostileExportAllocationIsBounded(t *testing.T) {
	const size = 8 << 20
	const bound = 1 << 20
	cases := map[string][]byte{
		"blank lines": bytes.Repeat([]byte("\n"), size),
		"short lines": bytes.Repeat([]byte("a\n"), size/2),
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			var before, after runtime.MemStats
			runtime.GC()
			runtime.ReadMemStats(&before)
			res := VerifyWith(in, Options{})
			ReportClaims(in)
			runtime.ReadMemStats(&after)
			if res.Verdict != INVALID || res.Line != 1 {
				t.Fatalf("got %s at line %d, want INVALID at line 1", res.Verdict, res.Line)
			}
			if got := after.TotalAlloc - before.TotalAlloc; got > bound {
				t.Fatalf("allocated %d bytes on a %d-byte input, want at most %d", got, len(in), bound)
			}
		})
	}
}
