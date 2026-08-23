package verify

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"testing"
)

// Tests for the two OPTIONAL genesis fork-ancestry keys (event-types.md
// ET-9e/ET-9f, event-schema.md ES-34) and for the unregistered-genesis rule
// (evolution.md EV-20).
//
// HARNESS CAVEAT, stated once and meant: the chains below are built by the
// same preimage, hashing and signing code the assertions run against, so they
// are self-consistent by construction. A VALID verdict on one therefore pins
// NOTHING about the byte-exact preimage — a compensating bug in
// preimage()/hashHex() would still produce VALID here. That shape is pinned
// only by contracts/fixtures/ (TestFixtures, TestGoldenPreimages).
//
// What these tests DO pin is the one thing the fixture set cannot: contracts/
// ships no vector carrying `ancestor_chain` or `ancestor_head` at all, and
// none carrying a genesis at an unregistered version. Every case below is a
// DIFFERENTIAL over a single edit to one otherwise identical chain — add a
// key, change one character of its value, bump `version` — so what it
// demonstrates is that the presence/format/version decision changes the
// verdict in the direction the rule names, not that the harness can build a
// chain that verifies.

// --- harness -----------------------------------------------------------

// deterministic operator/registrar keypairs: the seeds are fixed so any
// failure reproduces byte-for-byte.
var (
	testOperatorSeed  = bytes32(0x11)
	testRegistrarSeed = bytes32(0x22)
)

func bytes32(fill byte) []byte {
	b := make([]byte, 32)
	for i := range b {
		b[i] = fill + byte(i)
	}
	return b
}

// jsonScalar renders a Go value as canonical JSON. It is test-only and
// deliberately narrow: it panics on any string needing an escape, so a test
// input that would exercise the escaping rules cannot silently be miswritten
// here instead of being expressed as a fixture.
func jsonScalar(v any) string {
	switch t := v.(type) {
	case string:
		for i := 0; i < len(t); i++ {
			if t[i] < 0x20 || t[i] == '"' || t[i] == '\\' || t[i] >= 0x7f {
				panic("test harness: string needs escaping: " + t)
			}
		}
		return `"` + t + `"`
	case int64:
		return fmt.Sprintf("%d", t)
	case int:
		return fmt.Sprintf("%d", t)
	}
	panic("test harness: unsupported scalar")
}

// renderLine emits one canonical event line: the seven envelope fields in
// fixed order (ES-1/EX-7) with the payload keys sorted ascending (EX-8).
func renderLine(seq int64, typ string, version int64, payload map[string]any, ts, prevHash, hash string) []byte {
	keys := make([]string, 0, len(payload))
	for k := range payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var p strings.Builder
	p.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			p.WriteByte(',')
		}
		p.WriteString(jsonScalar(k))
		p.WriteByte(':')
		p.WriteString(jsonScalar(payload[k]))
	}
	p.WriteByte('}')

	return []byte(fmt.Sprintf(
		`{"seq":%d,"type":%s,"version":%d,"payload":%s,"ts":%s,"prev_hash":%s,"hash":%s}`,
		seq, jsonScalar(typ), version, p.String(), jsonScalar(ts), jsonScalar(prevHash), jsonScalar(hash)))
}

// parseLineOrFail re-parses a rendered line back into an *event so the
// production preimage code can be run over it.
func parseLineOrFail(t *testing.T, line []byte) *event {
	t.Helper()
	obj, ok := parseObjectLine(line)
	if !ok {
		t.Fatalf("harness produced an unparseable line: %s", line)
	}
	e, ok := envelope(obj)
	if !ok {
		t.Fatalf("harness produced a line failing envelope checks: %s", line)
	}
	return e
}

// signAndSeal fills in `sig` (over SIGN_PRE, HA-15) and `hash` (over PRE,
// HA-11/HA-13) for one event, returning the finished line.
func signAndSeal(t *testing.T, priv ed25519.PrivateKey, seq int64, typ string, version int64, payload map[string]any, ts, prevHash string) []byte {
	t.Helper()
	withSig := make(map[string]any, len(payload)+1)
	for k, v := range payload {
		withSig[k] = v
	}
	withSig["sig"] = strings.Repeat("0", 128)

	draft := renderLine(seq, typ, version, withSig, ts, prevHash, strings.Repeat("0", 64))
	sig := ed25519.Sign(priv, preimage(parseLineOrFail(t, draft), "sig"))
	withSig["sig"] = hex.EncodeToString(sig)

	sealed := renderLine(seq, typ, version, withSig, ts, prevHash, strings.Repeat("0", 64))
	h := hashHex(preimage(parseLineOrFail(t, sealed), ""))

	return renderLine(seq, typ, version, withSig, ts, prevHash, h)
}

// genesisExport builds a one-line export whose genesis carries the required
// five payload keys plus whatever `extra` adds, at the given version.
func genesisExport(t *testing.T, version int64, extra map[string]any) []byte {
	t.Helper()
	opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)
	opPub := []byte(opPriv.Public().(ed25519.PublicKey))
	regPub := []byte(ed25519.NewKeyFromSeed(testRegistrarSeed).Public().(ed25519.PublicKey))
	chainID := sha256.Sum256(opPub)

	payload := map[string]any{
		"chain_id":     hex.EncodeToString(chainID[:]),
		"contracts":    "contracts-v1",
		"operator_pk":  hex.EncodeToString(opPub),
		"registrar_pk": hex.EncodeToString(regPub),
	}
	for k, v := range extra {
		payload[k] = v
	}
	line := signAndSeal(t, opPriv, 1, "genesis", version, payload,
		"2026-01-01T00:00:00.000Z", zeros64)
	return append(line, '\n')
}

// someHash and otherHash are two well-formed, non-zero 64-hex values standing
// in for a parent chain's genesis hash and head. Nothing about them is
// resolvable, which is the point (ET-9e).
const (
	someHash  = "1111111111111111111111111111111111111111111111111111111111111111"
	otherHash = "2222222222222222222222222222222222222222222222222222222222222222"
)

// --- ET-9e / ET-9f -----------------------------------------------------

func TestGenesisAncestryPresenceCombinations(t *testing.T) {
	cases := []struct {
		name    string
		extra   map[string]any
		verdict Verdict
	}{
		{
			// The control: the ordinary no-recorded-ancestor form. Both keys
			// entirely absent is how a chain says "no ancestor" (ES-34).
			name:    "neither_key_is_accepted",
			extra:   nil,
			verdict: VALID,
		},
		{
			// The half of ET-9f's asymmetry that is deliberately PERMITTED:
			// "forked from chain X, fork point unrecorded". A suite that only
			// asserted rejections would still pass with this key dropped on
			// the floor, so this case is the one that proves it is not.
			name:    "ancestor_chain_alone_is_accepted",
			extra:   map[string]any{"ancestor_chain": someHash},
			verdict: VALID,
		},
		{
			// Charter §4's pair: a name and a position, published together.
			name: "ancestor_chain_with_ancestor_head_is_accepted",
			extra: map[string]any{
				"ancestor_chain": someHash,
				"ancestor_head":  otherHash,
			},
			verdict: VALID,
		},
		{
			// The one form ET-9f bars: a position on an UNNAMED chain.
			name:    "ancestor_head_alone_is_rejected",
			extra:   map[string]any{"ancestor_head": otherHash},
			verdict: INVALID,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Verify(genesisExport(t, 1, c.extra), nil)
			if res.Verdict != c.verdict {
				t.Fatalf("verdict = %s, want %s (reason: %s)", res.Verdict, c.verdict, res.Reason)
			}
			if c.verdict == INVALID && res.Line != 1 {
				t.Fatalf("INVALID line = %d, want 1", res.Line)
			}
		})
	}
}

// The trap this pins: `ancestor_chain == ancestor_head` is LEGAL, not a
// duplicate to reject. A fork taken from a parent that holds only its genesis
// event records exactly this, because at that instant the parent's head IS its
// genesis hash. ET-9e imposes no distinctness requirement between the two, and
// a verifier that "helpfully" adds one rejects a conforming fork.
func TestGenesisAncestryAcceptsIdenticalChainAndHead(t *testing.T) {
	res := Verify(genesisExport(t, 1, map[string]any{
		"ancestor_chain": someHash,
		"ancestor_head":  someHash,
	}), nil)
	if res.Verdict != VALID {
		t.Fatalf("verdict = %s, want VALID (reason: %s)", res.Verdict, res.Reason)
	}
}

// Format checks apply to each key that is present, independently (ET-9e).
func TestGenesisAncestryValueFormats(t *testing.T) {
	upper := "AAAA111111111111111111111111111111111111111111111111111111111111"
	cases := []struct {
		name  string
		extra map[string]any
	}{
		{"ancestor_chain_uppercase_hex", map[string]any{"ancestor_chain": upper}},
		{"ancestor_chain_too_short", map[string]any{"ancestor_chain": someHash[:63]}},
		{"ancestor_chain_too_long", map[string]any{"ancestor_chain": someHash + "a"}},
		{"ancestor_chain_non_hex", map[string]any{"ancestor_chain": strings.Repeat("z", 64)}},
		{"ancestor_chain_integer_value", map[string]any{"ancestor_chain": int64(1)}},
		{"ancestor_chain_zero_anchor", map[string]any{"ancestor_chain": zeros64}},

		{"ancestor_head_uppercase_hex", map[string]any{"ancestor_chain": someHash, "ancestor_head": upper}},
		{"ancestor_head_too_short", map[string]any{"ancestor_chain": someHash, "ancestor_head": otherHash[:63]}},
		{"ancestor_head_too_long", map[string]any{"ancestor_chain": someHash, "ancestor_head": otherHash + "a"}},
		{"ancestor_head_non_hex", map[string]any{"ancestor_chain": someHash, "ancestor_head": strings.Repeat("z", 64)}},
		{"ancestor_head_integer_value", map[string]any{"ancestor_chain": someHash, "ancestor_head": int64(1)}},
		{"ancestor_head_zero_anchor", map[string]any{"ancestor_chain": someHash, "ancestor_head": zeros64}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Verify(genesisExport(t, 1, c.extra), nil)
			if res.Verdict != INVALID {
				t.Fatalf("verdict = %s, want INVALID (reason: %s)", res.Verdict, res.Reason)
			}
			if res.Line != 1 {
				t.Fatalf("INVALID line = %d, want 1", res.Line)
			}
		})
	}
}

// ES-18 is unchanged by ES-34: OPTIONAL means "this defined key may be
// absent", never "an undefined key may appear".
func TestGenesisRejectsUndefinedPayloadKey(t *testing.T) {
	res := Verify(genesisExport(t, 1, map[string]any{"ancestor_tree": someHash}), nil)
	if res.Verdict != INVALID || res.Line != 1 {
		t.Fatalf("verdict = %s line %d, want INVALID line 1 (reason: %s)", res.Verdict, res.Line, res.Reason)
	}
}

// Presence and absence produce DIFFERENT events (ES-34): HA-7's leading key
// count U64(k) differs, so the two forms have different preimages and
// different hashes. This asserts the hashes actually differ rather than the
// optional key being ignored by the preimage.
func TestGenesisOptionalKeyChangesTheHash(t *testing.T) {
	without := parseLineOrFail(t, trimLF(genesisExport(t, 1, nil)))
	with := parseLineOrFail(t, trimLF(genesisExport(t, 1, map[string]any{"ancestor_chain": someHash})))
	if without.hash == with.hash {
		t.Fatal("genesis hash unchanged by the presence of ancestor_chain; HA-7 key count is not being encoded")
	}
}

func trimLF(b []byte) []byte {
	if len(b) > 0 && b[len(b)-1] == '\n' {
		return b[:len(b)-1]
	}
	return b
}

// --- EV-20 -------------------------------------------------------------

// A genesis at a (type, version) the verifier does not register is INVALID at
// line 1 — the sole exception to EV-8. Without this the chain would walk to
// PARTIAL, which claims "integrity confirmed, some semantics unchecked" over a
// chain on which nothing was ever authenticated.
func TestUnregisteredGenesisVersionIsInvalidAtLineOne(t *testing.T) {
	// EV-19 reserves 1000000 and up, and names 1000000 exactly as the value a
	// fixture exercising this path must use.
	for _, version := range []int64{2, 1000000} {
		t.Run(fmt.Sprintf("version_%d", version), func(t *testing.T) {
			res := Verify(genesisExport(t, version, nil), nil)
			if res.Verdict != INVALID {
				t.Fatalf("verdict = %s, want INVALID (reason: %s)", res.Verdict, res.Reason)
			}
			if res.Line != 1 {
				t.Fatalf("INVALID line = %d, want 1", res.Line)
			}
		})
	}
}

// EV-21 is advisory guidance, never conformance (EV-17), so this asserts only
// that the guidance was followed at all — that the message names the version
// seen, the versions registered, and BOTH readings. It is not a conformance
// assertion and no fixture backs it.
func TestUnregisteredGenesisReasonFollowsEV21Guidance(t *testing.T) {
	res := Verify(genesisExport(t, 1000000, nil), nil)
	for _, want := range []string{"1000000", "out of date", "hostile"} {
		if !strings.Contains(res.Reason, want) {
			t.Errorf("EV-21 reason text missing %q; got: %s", want, res.Reason)
		}
	}
}
