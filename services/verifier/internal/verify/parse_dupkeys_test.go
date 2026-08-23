package verify

import (
	"fmt"
	"strings"
	"testing"
)

// Duplicate-key detection (HA-6) is the one parser check whose cost grew with
// the square of the key count. It is now a linear scan below dupSetThreshold
// and a set above it, with an early exit once a duplicate is found. The switch
// between the two strategies is the part that can silently lose a duplicate,
// so these cases straddle the threshold deliberately: below it, exactly at it,
// and far above it, with the duplicate placed both before and after the
// crossing.

// wideObject renders a JSON object of n distinct keys, optionally repeating
// the key at index dupOf as an extra final key. Keys are fixed-width so the
// rendered order is also ascending byte order.
func wideObject(n, dupOf int) []byte {
	var b strings.Builder
	b.WriteByte('{')
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `"k%08d":"v"`, i)
	}
	if dupOf >= 0 {
		fmt.Fprintf(&b, `,"k%08d":"w"`, dupOf)
	}
	b.WriteByte('}')
	return []byte(b.String())
}

func TestDuplicateKeyDetectionAcrossThreshold(t *testing.T) {
	cases := []struct {
		name   string
		n      int
		dupOf  int
		wantDp bool
	}{
		{"no_duplicate_below_threshold", 5, -1, false},
		{"duplicate_below_threshold", 5, 2, true},
		{"no_duplicate_just_below_threshold", dupSetThreshold - 1, -1, false},
		{"duplicate_just_below_threshold", dupSetThreshold - 1, 0, true},
		{"no_duplicate_at_threshold", dupSetThreshold, -1, false},
		{"duplicate_at_threshold", dupSetThreshold, dupSetThreshold - 1, true},
		{"no_duplicate_just_above_threshold", dupSetThreshold + 1, -1, false},
		// The duplicate was first seen while the linear scan was still in
		// charge, but is met again after the set has taken over — the one
		// crossing a naive switchover drops.
		{"duplicate_of_pre_threshold_key_found_after_switchover", dupSetThreshold * 4, 0, true},
		{"duplicate_of_post_threshold_key", dupSetThreshold * 4, dupSetThreshold * 3, true},
		{"no_duplicate_wide", 50000, -1, false},
		{"duplicate_wide_first_key", 50000, 0, true},
		{"duplicate_wide_last_key", 50000, 49999, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			obj, ok := parseObjectLine(wideObject(c.n, c.dupOf))
			if !ok {
				t.Fatal("object failed to parse")
			}
			if obj.dupKey != c.wantDp {
				t.Fatalf("dupKey = %v, want %v", obj.dupKey, c.wantDp)
			}
			want := c.n
			if c.dupOf >= 0 {
				want++
			}
			if len(obj.keys) != want {
				t.Fatalf("stored %d keys, want %d — parsing must not stop at the duplicate", len(obj.keys), want)
			}
		})
	}
}

// A duplicate key in a wide payload is still the same Stage A rejection at the
// same line as the narrow case contracts/fixtures/ pins (vector 029). The
// cost fix must not turn a fatal line into a passing one.
func TestWidePayloadDuplicateKeyIsInvalidAtItsLine(t *testing.T) {
	for _, dupOf := range []int{-1, 0, 999} {
		name := "no_duplicate"
		if dupOf >= 0 {
			name = fmt.Sprintf("duplicate_of_key_%d", dupOf)
		}
		t.Run(name, func(t *testing.T) {
			line := fmt.Sprintf(
				`{"seq":1,"type":"genesis","version":1,"payload":%s,"ts":"2026-01-01T00:00:00.000Z","prev_hash":"%s","hash":"%s"}`,
				wideObject(1000, dupOf), zeros64, zeros64)
			res := Verify([]byte(line+"\n"), nil)
			// Both forms are INVALID at line 1 (the hash cannot match a
			// payload this test never sealed), so the verdict alone proves
			// nothing. What is asserted is the reason: with a duplicate the
			// line must die in the envelope check, never reach hashing.
			if res.Verdict != INVALID || res.Line != 1 {
				t.Fatalf("verdict = %s line %d, want INVALID line 1", res.Verdict, res.Line)
			}
			gotStructural := strings.Contains(res.Reason, "Stage-A structural")
			if wantStructural := dupOf >= 0; gotStructural != wantStructural {
				t.Fatalf("structural rejection = %v, want %v (reason: %s)",
					gotStructural, wantStructural, res.Reason)
			}
		})
	}
}
