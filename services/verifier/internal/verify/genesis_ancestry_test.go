package verify

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"testing"
	"unicode/utf8"
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
//
// Non-ASCII is NOT such an input. EX-9 fixes minimal escaping: `"` and `\`
// escaped, every C0 control as `\u00xx`, and "every other character … literal
// UTF-8 bytes, never a `\u` escape". A multi-byte scalar is therefore rendered
// by writing its UTF-8 bytes, which is what the harness does — and what lets a
// test express a title whose byte length and scalar count diverge (ET-14).
// U+007F stays refused: it is literal under EX-9 but barred from titles by
// ET-14, so a case wanting it is testing something this harness should not
// quietly produce.
func jsonScalar(v any) string {
	switch t := v.(type) {
	case string:
		if !utf8.ValidString(t) {
			panic("test harness: string is not valid UTF-8 and has no canonical rendering")
		}
		for i := 0; i < len(t); i++ {
			if t[i] < 0x20 || t[i] == '"' || t[i] == '\\' || t[i] == 0x7f {
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

// seal fills in `hash` (over PRE, HA-11/HA-13) for one event whose payload is
// already final, returning the finished line. It does not sign — a payload with
// no `sig` key at all goes through here.
func seal(t *testing.T, seq int64, typ string, version int64, payload map[string]any, ts, prevHash string) []byte {
	t.Helper()
	draft := renderLine(seq, typ, version, payload, ts, prevHash, strings.Repeat("0", 64))
	h := hashHex(preimage(parseLineOrFail(t, draft), ""))
	return renderLine(seq, typ, version, payload, ts, prevHash, h)
}

// signAndSeal fills in `sig` (over SIGN_PRE, HA-15) and then `hash` (over PRE,
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

	return seal(t, seq, typ, version, withSig, ts, prevHash)
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

// Every rejection case below asserts the advisory REASON as well as the
// verdict and line. Reason text is never conformance (EV-17) and this suite is
// not normative, so the assertion costs nothing — but "INVALID at line 1" is
// satisfied by ANY genesis fault, so without it a case rejected for a reason
// that has nothing to do with the rule it is named for still passes and is
// counted as coverage of that rule. The reason substring is what pins that the
// case reaches the check it claims to exercise.
func TestGenesisAncestryPresenceCombinations(t *testing.T) {
	cases := []struct {
		name       string
		extra      map[string]any
		verdict    Verdict
		wantReason string // asserted for INVALID cases only
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
			name:       "ancestor_head_alone_is_rejected",
			extra:      map[string]any{"ancestor_head": otherHash},
			verdict:    INVALID,
			wantReason: "ET-9f",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := Verify(genesisExport(t, 1, c.extra), nil)
			if res.Verdict != c.verdict {
				t.Fatalf("verdict = %s, want %s (reason: %s)", res.Verdict, c.verdict, res.Reason)
			}
			if c.verdict == INVALID {
				if res.Line != 1 {
					t.Fatalf("INVALID line = %d, want 1", res.Line)
				}
				assertReason(t, res, c.wantReason)
			}
		})
	}
}

// assertReason pins that a rejection reached the rule the case is named for.
// It is not a conformance assertion (EV-17) and is written as an Errorf, not a
// Fatalf, so a reason-text edit reports as "the case no longer reaches its
// rule" without masking the verdict assertions around it.
func assertReason(t *testing.T, res Result, want string) {
	t.Helper()
	if want == "" {
		t.Fatal("test bug: an INVALID case with no expected reason asserts only that SOMETHING was rejected")
	}
	if !strings.Contains(res.Reason, want) {
		t.Errorf("reason does not mention %q, so this case is not reaching the rule it is named for; reason was: %s",
			want, res.Reason)
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
	// The expected reason distinguishes WHICH key was faulted and WHICH of the
	// two ET-9e clauses fired — a format rejection or the 64-zero anchor. A
	// bare "INVALID at line 1" would not: an `ancestor_head` case that was in
	// fact rejected on `ancestor_chain` would pass identically.
	const (
		chainFormat = "ancestor_chain not 64 lowercase hex (ET-9e)"
		chainAnchor = "ancestor_chain is the 64-zero anchor (ET-9e)"
		headFormat  = "ancestor_head not 64 lowercase hex (ET-9e)"
		headAnchor  = "ancestor_head is the 64-zero anchor (ET-9e)"
	)
	cases := []struct {
		name       string
		extra      map[string]any
		wantReason string
	}{
		{"ancestor_chain_uppercase_hex", map[string]any{"ancestor_chain": upper}, chainFormat},
		{"ancestor_chain_too_short", map[string]any{"ancestor_chain": someHash[:63]}, chainFormat},
		{"ancestor_chain_too_long", map[string]any{"ancestor_chain": someHash + "a"}, chainFormat},
		{"ancestor_chain_non_hex", map[string]any{"ancestor_chain": strings.Repeat("z", 64)}, chainFormat},
		{"ancestor_chain_integer_value", map[string]any{"ancestor_chain": int64(1)}, chainFormat},
		{"ancestor_chain_zero_anchor", map[string]any{"ancestor_chain": zeros64}, chainAnchor},

		{"ancestor_head_uppercase_hex", map[string]any{"ancestor_chain": someHash, "ancestor_head": upper}, headFormat},
		{"ancestor_head_too_short", map[string]any{"ancestor_chain": someHash, "ancestor_head": otherHash[:63]}, headFormat},
		{"ancestor_head_too_long", map[string]any{"ancestor_chain": someHash, "ancestor_head": otherHash + "a"}, headFormat},
		{"ancestor_head_non_hex", map[string]any{"ancestor_chain": someHash, "ancestor_head": strings.Repeat("z", 64)}, headFormat},
		{"ancestor_head_integer_value", map[string]any{"ancestor_chain": someHash, "ancestor_head": int64(1)}, headFormat},
		{"ancestor_head_zero_anchor", map[string]any{"ancestor_chain": someHash, "ancestor_head": zeros64}, headAnchor},
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
			assertReason(t, res, c.wantReason)
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
	assertReason(t, res, "ES-18")
}

// --- ES-18/ES-34: the REQUIRED half of the key set -----------------------
//
// ES-34 splits the genesis key set into five REQUIRED keys and two OPTIONAL
// ones, and payloadKeySetAllows enforces three separate things: a key count
// inside 5..7, no key outside required ∪ optional, and every required key
// PRESENT. The third of those is the one nothing else can stand in for, and it
// is only reachable by a payload that satisfies the first two — a genesis where
// an OPTIONAL key substitutes for a missing REQUIRED one. Without such a case
// the required-key loop can be deleted outright and every other test in this
// repository still passes: the count stays in range, every key is allowed, and
// the verdict survives only by luck downstream, where a missing string reads
// back as "" and fails a format check that is named for a different rule.
//
// Hence the reason assertion below. Asserting INVALID at line 1 is exactly the
// assertion that luck already satisfies; asserting the ES-18 key-set reason is
// what makes the loop load-bearing.

// genesisExportOmitting builds a one-line genesis with `omit` (a required key)
// dropped, and the OPTIONAL `ancestor_chain` added to hold the key COUNT inside
// the 5..7 the length guard permits. omit == "" builds the unmangled control.
// Everything else — hash, signature, key formats — is correct, so the key set
// is the only thing wrong with the result.
func genesisExportOmitting(t *testing.T, omit string) []byte {
	t.Helper()
	opPriv := ed25519.NewKeyFromSeed(testOperatorSeed)
	opPub := []byte(opPriv.Public().(ed25519.PublicKey))
	regPub := []byte(ed25519.NewKeyFromSeed(testRegistrarSeed).Public().(ed25519.PublicKey))
	chainID := sha256.Sum256(opPub)

	payload := map[string]any{
		"chain_id":       hex.EncodeToString(chainID[:]),
		"contracts":      "contracts-v1",
		"operator_pk":    hex.EncodeToString(opPub),
		"registrar_pk":   hex.EncodeToString(regPub),
		"ancestor_chain": someHash,
	}
	const ts = "2026-01-01T00:00:00.000Z"

	if omit == "sig" {
		// signAndSeal would put `sig` straight back, so this one is sealed
		// without it: no `sig` key in the payload at all, and the hash computed
		// over the payload exactly as rendered.
		return append(seal(t, 1, "genesis", 1, payload, ts, zeros64), '\n')
	}
	delete(payload, omit) // omit == "" deletes nothing
	return append(signAndSeal(t, opPriv, 1, "genesis", 1, payload, ts, zeros64), '\n')
}

func TestGenesisMissingRequiredPayloadKey(t *testing.T) {
	required := []string{"chain_id", "contracts", "operator_pk", "registrar_pk", "sig"}

	// The control: the same builder with nothing omitted. Six keys, all legal,
	// and VALID — so a failure in the cases below is the missing key and not
	// the builder.
	t.Run("control_nothing_omitted", func(t *testing.T) {
		res := Verify(genesisExportOmitting(t, ""), nil)
		if res.Verdict != VALID {
			t.Fatalf("verdict = %s, want VALID (reason: %s)", res.Verdict, res.Reason)
		}
	})

	for _, key := range required {
		t.Run("missing_"+key, func(t *testing.T) {
			export := genesisExportOmitting(t, key)

			// Reachability guard on the case itself. If the payload fell
			// outside 5..7 keys the length guard would reject it and the
			// required-key loop would never run — the case would pass while
			// exercising nothing.
			e := parseLineOrFail(t, trimLF(export))
			if _, present := payloadGet(e.payload, key); present {
				t.Fatalf("harness did not drop %s; the case proves nothing", key)
			}
			if n := len(e.payload.keys); n < 5 || n > 7 {
				t.Fatalf("payload has %d keys, outside the 5..7 the length guard permits; "+
					"this case would be caught by the count and never reach the required-key check", n)
			}

			res := Verify(export, nil)
			if res.Verdict != INVALID {
				t.Fatalf("verdict = %s, want INVALID (reason: %s)", res.Verdict, res.Reason)
			}
			if res.Line != 1 {
				t.Fatalf("INVALID line = %d, want 1", res.Line)
			}
			// The load-bearing assertion: rejected ON THE KEY SET, not by a
			// downstream format check reading back an empty string.
			assertReason(t, res, "ES-18")
		})
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
			assertReason(t, res, "EV-20")
		})
	}
}

// The EV-21 message names the genesis versions this verifier registers, and
// that list is the whole point of the message: it is what lets a reader decide
// between "my verifier is out of date" and "this chain is corrupt". A list
// maintained separately from the registry that decides the verdict would go
// stale exactly when a new version is registered — the moment the message
// matters — and would then send readers to settle the question against a
// falsehood. These assertions pin the two directions of that agreement.
func TestEV21VersionListAgreesWithTheRegistry(t *testing.T) {
	list := registeredVersions("genesis")
	if len(list) == 0 {
		t.Fatal("no registered genesis versions; the EV-21 message would name none")
	}

	// Direction 1: everything the message names is genuinely registered.
	named := map[int64]bool{}
	for _, v := range list {
		if !registered("genesis", v) {
			t.Errorf("EV-21 names genesis version %d, which registered() rejects", v)
		}
		named[v] = true
	}

	// Direction 2: nothing registered is missing from the message. Probed
	// rather than proved — the version space is int64 — over the range a
	// registration would plausibly land in, plus the values the specs single
	// out (EV-19's reserved 1000000, ES-5's 2^53-1 ceiling) and the edges.
	probes := []int64{-1, 0, math.MinInt64, math.MaxInt64, 1 << 53, (1 << 53) - 1, 1_000_000}
	for v := int64(1); v <= 2000; v++ {
		probes = append(probes, v)
	}
	for _, v := range probes {
		if registered("genesis", v) && !named[v] {
			t.Errorf("genesis version %d is registered but the EV-21 message does not name it", v)
		}
	}

	// And the message actually renders every one of them.
	reason := unregisteredGenesisReason(1_000_000)
	for _, v := range list {
		if !strings.Contains(reason, fmt.Sprintf("%d", v)) {
			t.Errorf("EV-21 message omits registered genesis version %d: %s", v, reason)
		}
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
