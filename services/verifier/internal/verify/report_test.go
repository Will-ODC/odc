package verify

import (
	"reflect"
	"testing"
)

// EX-24 candidate extraction, at the unit level. The CLI-level cases, which
// also assert the claim rules and the report's presence, are in
// chain_report_test.go.
func TestEX24Candidates(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},                    // empty input: no endpoints
		{"\n", []string{""}},         // one blank record
		{"A", []string{"A"}},         // no final LF: final fragment
		{"A\n", []string{"A"}},       // one terminal LF adds no candidate
		{"A\n\n", []string{"A", ""}}, // an additional trailing blank record is one
		{"A\n\n\n", []string{"A", "", ""}},
		{"A\nB", []string{"A", "B"}},
		{"A\nB\n", []string{"A", "B"}},
		{"\nA\n", []string{"", "A"}},
		{"A\r\nB\r\n", []string{"A\r", "B\r"}}, // split at LF only
	}
	for _, c := range cases {
		var got []string
		for _, b := range candidates([]byte(c.in)) {
			got = append(got, string(b))
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("candidates(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestEX24ReportClaimsEmpty(t *testing.T) {
	if _, _, ok := ReportClaims(nil); ok {
		t.Fatal("empty input reported endpoints")
	}
	if g, h, ok := ReportClaims([]byte("\n")); !ok || g != Unavailable || h != Unavailable {
		t.Fatalf("single LF: %q %q %v, want both unavailable and reported", g, h, ok)
	}
}
