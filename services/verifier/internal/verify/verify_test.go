package verify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The tests are driven entirely by contracts/fixtures/ (EV-17): each vector
// asserts a verdict token and, for INVALID/PARTIAL, the line number(s). Nothing
// else — not reason text, not exit code — is conformance-bearing, so the tests
// assert only those.

type indexFile struct {
	Vectors []vector `json:"vectors"`
}

type vector struct {
	ID     string  `json:"id"`
	Export string  `json:"export"`
	Head   *string `json:"head"`
	Expect struct {
		Verdict string `json:"verdict"`
		Line    int    `json:"line"`
		Lines   []int  `json:"lines"`
	} `json:"expect"`
}

// fixturesDir walks upward from the working directory to locate
// contracts/fixtures, so the tests run from wherever `go test` is invoked.
func fixturesDir(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		cand := filepath.Join(dir, "contracts", "fixtures")
		if fi, err := os.Stat(filepath.Join(cand, "index.json")); err == nil && !fi.IsDir() {
			return cand
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate contracts/fixtures/index.json by walking up from " + mustWd(t))
		}
		dir = parent
	}
}

func mustWd(t *testing.T) string {
	wd, _ := os.Getwd()
	return wd
}

func TestFixtures(t *testing.T) {
	fdir := fixturesDir(t)
	raw, err := os.ReadFile(filepath.Join(fdir, "index.json"))
	if err != nil {
		t.Fatalf("read index.json: %v", err)
	}
	var idx indexFile
	if err := json.Unmarshal(raw, &idx); err != nil {
		t.Fatalf("parse index.json: %v", err)
	}
	if len(idx.Vectors) == 0 {
		t.Fatal("no vectors in index.json")
	}

	for _, v := range idx.Vectors {
		v := v
		t.Run(v.ID, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fdir, v.Export))
			if err != nil {
				t.Fatalf("read export %s: %v", v.Export, err)
			}
			res := Verify(data, v.Head)

			if res.Verdict.String() != v.Expect.Verdict {
				t.Fatalf("verdict = %s, want %s (reason: %s)",
					res.Verdict, v.Expect.Verdict, res.Reason)
			}
			switch v.Expect.Verdict {
			case "INVALID":
				if res.Line != v.Expect.Line {
					t.Fatalf("INVALID line = %d, want %d (reason: %s)",
						res.Line, v.Expect.Line, res.Reason)
				}
			case "PARTIAL":
				if !equalInts(res.Lines, v.Expect.Lines) {
					t.Fatalf("PARTIAL lines = %v, want %v", res.Lines, v.Expect.Lines)
				}
			}
		})
	}
	t.Logf("ran %d fixtures", len(idx.Vectors))
}

// TestGoldenPreimages checks the byte-exact preimage construction (hashing.md
// HA-11) against the two golden preimage files, so a compensating bug that
// still lands on the right digest cannot hide. These are fixture data.
func TestGoldenPreimages(t *testing.T) {
	fdir := fixturesDir(t)
	cases := []struct {
		vector string // export file
		line   int    // 1-based line whose preimage is pinned
		preHex string // golden preimage file
	}{
		{"vectors/001-genesis-only.ndjson", 1, "preimages/001-genesis-only.hex"},
		{"vectors/002-four-types.ndjson", 3, "preimages/002-four-types-seq3.hex"},
	}
	for _, c := range cases {
		t.Run(c.preHex, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(fdir, c.vector))
			if err != nil {
				t.Fatalf("read %s: %v", c.vector, err)
			}
			lines, _ := frame(data)
			obj, ok := parseObjectLine(lines[c.line-1])
			if !ok {
				t.Fatalf("parse line %d failed", c.line)
			}
			e, ok := envelope(obj)
			if !ok {
				t.Fatalf("envelope line %d failed", c.line)
			}
			got := hexEncode(preimage(e, ""))
			want, err := os.ReadFile(filepath.Join(fdir, c.preHex))
			if err != nil {
				t.Fatalf("read %s: %v", c.preHex, err)
			}
			wantStr := trimNL(string(want))
			if got != wantStr {
				t.Fatalf("preimage mismatch\n got  %s\n want %s", got, wantStr)
			}
		})
	}
}

func hexEncode(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[2*i] = hexdigits[v>>4]
		out[2*i+1] = hexdigits[v&0x0f]
	}
	return string(out)
}

func trimNL(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
