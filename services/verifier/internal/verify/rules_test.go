package verify

import (
	"crypto/ed25519"
	"crypto/sha256"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Tests for the three rules that no fixture pins yet: EV-20 (an unregistered
// genesis is INVALID at line 1), ET-9d (registrar_pk MUST differ from
// operator_pk) and ET-9e/ES-34 (ancestor_head is OPTIONAL). Conformance is the
// verdict token and line number alone (EV-17), so that is all these assert —
// never the advisory reason text.
//
// The fixture corpus cannot exercise these, so the chains here are built in
// memory: a payload is assembled, the event is signed over its signing preimage
// (HA-15), the hash is computed over the full preimage (HA-11), and the result
// is serialized in the canonical line form (EX-7..EX-10). That means every case
// below is a genuinely well-formed export differing only in the rule under test.

// pval is a payload value: a canonical integer or a UTF-8 string (ES-16).
type pval struct {
	s     string
	i     int64
	isInt bool
}

func pstr(s string) pval { return pval{s: s} }
func pint(i int64) pval  { return pval{i: i, isInt: true} }

const testTS = "2026-07-21T00:00:00.000Z"

// testKeys derives a deterministic Ed25519 keypair from a seed byte. Keys from
// NewKeyFromSeed are canonical and prime-order, so ET-4b/ET-4c pass.
func testKeys(seed byte) (string, ed25519.PrivateKey) {
	s := make([]byte, ed25519.SeedSize)
	for i := range s {
		s[i] = seed + byte(i)
	}
	priv := ed25519.NewKeyFromSeed(s)
	return hexEncode(priv.Public().(ed25519.PublicKey)), priv
}

func chainIDFor(pubHex string) string {
	sum := sha256.Sum256(hexToBytes(pubHex))
	return hexEncode(sum[:])
}

// mkObject builds a jobject with keys in strictly ascending UTF-8 byte order,
// the stored order Stage A requires (EX-8/HA-8).
func mkObject(m map[string]pval) *jobject {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	o := &jobject{}
	for _, k := range keys {
		v := m[k]
		o.keys = append(o.keys, k)
		if v.isInt {
			o.vals = append(o.vals, jvalue{kind: kInt, ival: v.i})
		} else {
			o.vals = append(o.vals, jvalue{kind: kString, str: v.s})
		}
	}
	return o
}

// buildLine assembles one canonical NDJSON line. When priv is non-nil the event
// is signed over its signing preimage and the resulting "sig" is added to the
// payload before the hash is computed (ES-32). Returns the line and its hash.
func buildLine(t *testing.T, seq int64, typ string, version int64, prevHash string, pay map[string]pval, priv ed25519.PrivateKey) (string, string) {
	t.Helper()
	e := &event{seq: seq, typ: typ, version: version, ts: testTS, prevHash: prevHash, payload: mkObject(pay)}
	if priv != nil {
		sig := ed25519.Sign(priv, preimage(e, "sig"))
		signed := make(map[string]pval, len(pay)+1)
		for k, v := range pay {
			signed[k] = v
		}
		signed["sig"] = pstr(hexEncode(sig))
		e.payload = mkObject(signed)
	}
	e.hash = hashHex(preimage(e, ""))
	return serializeEvent(t, e), e.hash
}

func serializeEvent(t *testing.T, e *event) string {
	t.Helper()
	var b strings.Builder
	b.WriteString(`{"seq":`)
	b.WriteString(strconv.FormatInt(e.seq, 10))
	b.WriteString(`,"type":`)
	b.WriteString(jsonStr(t, e.typ))
	b.WriteString(`,"version":`)
	b.WriteString(strconv.FormatInt(e.version, 10))
	b.WriteString(`,"payload":{`)
	for i, k := range e.payload.keys {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(jsonStr(t, k))
		b.WriteString(":")
		if v := e.payload.vals[i]; v.kind == kInt {
			b.WriteString(strconv.FormatInt(v.ival, 10))
		} else {
			b.WriteString(jsonStr(t, v.str))
		}
	}
	b.WriteString(`},"ts":`)
	b.WriteString(jsonStr(t, e.ts))
	b.WriteString(`,"prev_hash":`)
	b.WriteString(jsonStr(t, e.prevHash))
	b.WriteString(`,"hash":`)
	b.WriteString(jsonStr(t, e.hash))
	b.WriteString("}")
	return b.String()
}

// jsonStr quotes a string that needs no escaping. Every value these tests use is
// printable ASCII without `"` or `\`; anything else is a bug in the test, not a
// case the helper should silently mangle.
func jsonStr(t *testing.T, s string) string {
	t.Helper()
	for i := 0; i < len(s); i++ {
		if c := s[i]; c < 0x20 || c > 0x7e || c == '"' || c == '\\' {
			t.Fatalf("test helper cannot serialize %q (byte %d needs escaping)", s, i)
		}
	}
	return `"` + s + `"`
}

// genesisPayload is the conforming v1 genesis payload, minus "sig".
func genesisPayload(opPK, regPK string) map[string]pval {
	return map[string]pval{
		"chain_id":     pstr(chainIDFor(opPK)),
		"contracts":    pstr("contracts-v1"),
		"operator_pk":  pstr(opPK),
		"registrar_pk": pstr(regPK),
	}
}

// genesisChain builds a one-line export from a genesis payload mutated by mut.
func genesisChain(t *testing.T, version int64, mut func(m map[string]pval)) []byte {
	t.Helper()
	opPK, opPriv := testKeys(0x11)
	regPK, _ := testKeys(0x77)
	pay := genesisPayload(opPK, regPK)
	if mut != nil {
		mut(pay)
	}
	line, _ := buildLine(t, 1, "genesis", version, zeros64, pay, opPriv)
	return []byte(line + "\n")
}

func expect(t *testing.T, data []byte, want Verdict, wantLine int, wantLines []int) {
	t.Helper()
	res := Verify(data, nil)
	if res.Verdict != want {
		t.Fatalf("verdict = %s, want %s (reason: %s)", res.Verdict, want, res.Reason)
	}
	if want == INVALID && res.Line != wantLine {
		t.Fatalf("INVALID line = %d, want %d (reason: %s)", res.Line, wantLine, res.Reason)
	}
	if want == PARTIAL && !equalInts(res.Lines, wantLines) {
		t.Fatalf("PARTIAL lines = %v, want %v", res.Lines, wantLines)
	}
}

// TestSyntheticGenesisBaseline proves the builder above produces a chain this
// verifier accepts, so every INVALID below is caused by the mutation under test
// and not by the harness.
func TestSyntheticGenesisBaseline(t *testing.T) {
	expect(t, genesisChain(t, 1, nil), VALID, 0, nil)
}

// TestGenesisAncestorHeadOptional covers ET-9e with ES-34: the key may be absent
// or present with a legal value, must be 64 lowercase hex, and must never be the
// 64-zero anchor.
func TestGenesisAncestorHeadOptional(t *testing.T) {
	const someHead = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

	cases := []struct {
		name string
		mut  func(m map[string]pval)
		want Verdict
	}{
		{"absent", nil, VALID},
		{"present-valid", func(m map[string]pval) { m["ancestor_head"] = pstr(someHead) }, VALID},
		{"zero-anchor", func(m map[string]pval) { m["ancestor_head"] = pstr(zeros64) }, INVALID},
		{"uppercase", func(m map[string]pval) { m["ancestor_head"] = pstr(strings.ToUpper(someHead)) }, INVALID},
		{"too-short", func(m map[string]pval) { m["ancestor_head"] = pstr(someHead[:63]) }, INVALID},
		{"integer", func(m map[string]pval) { m["ancestor_head"] = pint(1) }, INVALID},
		{"empty", func(m map[string]pval) { m["ancestor_head"] = pstr("") }, INVALID},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			expect(t, genesisChain(t, 1, c.mut), c.want, 1, nil)
		})
	}
}

// TestGenesisKeySetStillClosed guards that widening the key set for one OPTIONAL
// key did not open it: an undefined key is still rejected (ES-18/ES-34), and a
// missing required key is still missing even when the optional one is present.
func TestGenesisKeySetStillClosed(t *testing.T) {
	const someHead = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

	cases := []struct {
		name string
		mut  func(m map[string]pval)
	}{
		{"unknown-key", func(m map[string]pval) { m["x_extra"] = pstr("nope") }},
		{"unknown-key-alongside-optional", func(m map[string]pval) {
			m["ancestor_head"] = pstr(someHead)
			m["zz_unknown"] = pstr("nope")
		}},
		{"missing-required", func(m map[string]pval) { delete(m, "contracts") }},
		{"missing-required-with-optional", func(m map[string]pval) {
			m["ancestor_head"] = pstr(someHead)
			delete(m, "registrar_pk")
		}},
		// The count of keys matching the required count is not enough: an
		// undefined key must not be able to stand in for a required one.
		{"swap-required-for-unknown", func(m map[string]pval) {
			delete(m, "contracts")
			m["ancestor_head"] = pstr(someHead)
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			expect(t, genesisChain(t, 1, c.mut), INVALID, 1, nil)
		})
	}
}

// TestGenesisRegistrarMustDifferFromOperator covers ET-9d.
func TestGenesisRegistrarMustDifferFromOperator(t *testing.T) {
	opPK, opPriv := testKeys(0x11)
	pay := genesisPayload(opPK, opPK) // one key declared twice
	line, _ := buildLine(t, 1, "genesis", 1, zeros64, pay, opPriv)
	expect(t, []byte(line+"\n"), INVALID, 1, nil)
}

// TestGenesisUnregisteredVersion covers EV-20: an unregistered genesis is
// INVALID at line 1 and the chain never reaches VALID or PARTIAL, even though
// the event is otherwise structurally perfect and its hash recomputes.
func TestGenesisUnregisteredVersion(t *testing.T) {
	// EV-19 reserves 1000000 for exactly this path.
	expect(t, genesisChain(t, 1000000, nil), INVALID, 1, nil)

	// And with a well-formed later event that would otherwise be PARTIAL: the
	// verdict stays INVALID at line 1, never PARTIAL naming line 2.
	opPK, opPriv := testKeys(0x11)
	regPK, _ := testKeys(0x77)
	g, gHash := buildLine(t, 1, "genesis", 1000000, zeros64, genesisPayload(opPK, regPK), opPriv)
	n, _ := buildLine(t, 2, "x_note", 1, gHash, map[string]pval{"note": pstr("hi")}, nil)
	expect(t, []byte(g+"\n"+n+"\n"), INVALID, 1, nil)
}

// TestUnregisteredNonGenesisStillPartial guards that EV-20 did not over-reach:
// away from line 1 the general forward-compatibility rule (EV-8/EV-9) is
// untouched, and a well-formed unregistered type is still PARTIAL.
func TestUnregisteredNonGenesisStillPartial(t *testing.T) {
	opPK, opPriv := testKeys(0x11)
	regPK, _ := testKeys(0x77)
	g, gHash := buildLine(t, 1, "genesis", 1, zeros64, genesisPayload(opPK, regPK), opPriv)
	n, _ := buildLine(t, 2, "x_note", 1, gHash, map[string]pval{"note": pstr("hi")}, nil)
	expect(t, []byte(g+"\n"+n+"\n"), PARTIAL, 0, []int{2})
}

// TestAncestorHeadChangesTheHash records the ES-34 consequence that presence and
// absence are different events: HA-7's leading key count differs, so the two
// forms cannot be confused for one another.
func TestAncestorHeadChangesTheHash(t *testing.T) {
	const someHead = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
	opPK, opPriv := testKeys(0x11)
	regPK, _ := testKeys(0x77)

	_, without := buildLine(t, 1, "genesis", 1, zeros64, genesisPayload(opPK, regPK), opPriv)
	pay := genesisPayload(opPK, regPK)
	pay["ancestor_head"] = pstr(someHead)
	_, with := buildLine(t, 1, "genesis", 1, zeros64, pay, opPriv)

	if without == with {
		t.Fatalf("genesis hash unchanged by ancestor_head; ES-34/HA-7 require different preimages")
	}
}

func TestPayloadKeySetMatches(t *testing.T) {
	required := []string{"a", "b"}
	optional := []string{"opt"}
	cases := []struct {
		keys []string
		want bool
	}{
		{[]string{"a", "b"}, true},
		{[]string{"a", "b", "opt"}, true},
		{[]string{"a"}, false},                  // missing required
		{[]string{"a", "opt"}, false},           // optional cannot substitute
		{[]string{"a", "b", "c"}, false},        // undefined key
		{[]string{"a", "b", "opt", "c"}, false}, // undefined key alongside optional
		{nil, false},
	}
	for _, c := range cases {
		obj := &jobject{}
		for _, k := range c.keys {
			obj.keys = append(obj.keys, k)
			obj.vals = append(obj.vals, jvalue{kind: kString})
		}
		if got := payloadKeySetMatches(obj, required, optional); got != c.want {
			t.Errorf("payloadKeySetMatches(%v) = %v, want %v", c.keys, got, c.want)
		}
	}
}
