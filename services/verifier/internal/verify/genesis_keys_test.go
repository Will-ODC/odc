package verify

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// ET-9d — the two genesis keys MUST be distinct.
//
// contracts/fixtures/ NOW ships a vector for this rule — 094-genesis-keys-equal,
// INVALID at line 1 — which it did not when these tests were written, and which
// is the real conformance oracle (EV-17). These stay because they are
// differential rather than golden: they vary one field across otherwise
// identical chains, which a single frozen vector cannot do. They carry the same
// harness caveat stated in genesis_ancestry_test.go: the
// chains are built by the same hashing and signing code they are checked
// against, so a VALID verdict here pins nothing about the preimage. What each
// case shows is differential — one edit to an otherwise identical chain.

// genesisExportWithKeys builds a one-line export whose genesis declares the
// given operator and registrar keys. The operator keypair signs, so the ET-8
// self-signature is valid in every case and cannot be what decides the
// verdict.
func genesisExportWithKeys(t *testing.T, operatorSeed, registrarSeed []byte, mangle func(op, reg string) (string, string)) []byte {
	t.Helper()
	opPriv := ed25519.NewKeyFromSeed(operatorSeed)
	opPub := []byte(opPriv.Public().(ed25519.PublicKey))
	regPub := []byte(ed25519.NewKeyFromSeed(registrarSeed).Public().(ed25519.PublicKey))
	chainID := sha256.Sum256(opPub)

	opHex, regHex := hex.EncodeToString(opPub), hex.EncodeToString(regPub)
	if mangle != nil {
		opHex, regHex = mangle(opHex, regHex)
	}

	payload := map[string]any{
		"chain_id":     hex.EncodeToString(chainID[:]),
		"contracts":    "contracts-v1",
		"operator_pk":  opHex,
		"registrar_pk": regHex,
	}
	line := signAndSeal(t, opPriv, 1, "genesis", 1, payload,
		"2026-01-01T00:00:00.000Z", zeros64)
	return append(line, '\n')
}

// The positive case, and it is not optional: a suite whose only new test
// asserts INVALID still passes if the check accidentally rejects EVERY
// genesis. This pins that two properly distinct keys are still accepted, and
// it uses the same builder as the negative case, so the ONLY difference
// between them is the registrar seed.
func TestGenesisWithDistinctKeysIsAccepted(t *testing.T) {
	res := Verify(genesisExportWithKeys(t, testOperatorSeed, testRegistrarSeed, nil), nil)
	if res.Verdict != VALID {
		t.Fatalf("verdict = %s, want VALID (reason: %s)", res.Verdict, res.Reason)
	}
}

// The negative case: registrar_pk byte-identical to operator_pk. Built by
// handing the builder the OPERATOR's seed for both keys, so the two hex
// strings are equal because the keys genuinely are — not because a string was
// patched into place.
func TestGenesisWithIdenticalKeysIsInvalidAtItsLine(t *testing.T) {
	export := genesisExportWithKeys(t, testOperatorSeed, testOperatorSeed, nil)

	// Guard the construction: if these were not actually equal, the test would
	// pass for the wrong reason.
	op := fieldValue(t, string(export), "operator_pk")
	reg := fieldValue(t, string(export), "registrar_pk")
	if op != reg {
		t.Fatalf("harness built distinct keys (%s vs %s); the negative case would prove nothing", op, reg)
	}

	res := Verify(export, nil)
	if res.Verdict != INVALID {
		t.Fatalf("verdict = %s, want INVALID (reason: %s)", res.Verdict, res.Reason)
	}
	if res.Line != 1 {
		t.Fatalf("INVALID line = %d, want 1", res.Line)
	}
}

// ET-9d fixes the comparison as one equality on the two 64-character
// lowercase-hex strings, "after ET-9b has passed on both". The consequence
// pinned here: two keys that decode to the SAME 32 bytes but differ in case
// are rejected by ET-9b first, so ET-9d never sees them. Case folding is
// therefore not part of this comparison, and adding it would catch nothing
// ET-9b does not already catch.
func TestGenesisKeyCaseIsRejectedBeforeET9d(t *testing.T) {
	// registrar_pk is the operator key in UPPERCASE hex: the same 32 bytes,
	// which ET-9b rejects on format alone (D5 — never lowercased to conform).
	export := genesisExportWithKeys(t, testOperatorSeed, testOperatorSeed,
		func(op, reg string) (string, string) { return op, strings.ToUpper(reg) })

	res := Verify(export, nil)
	if res.Verdict != INVALID || res.Line != 1 {
		t.Fatalf("verdict = %s line %d, want INVALID line 1 (reason: %s)", res.Verdict, res.Line, res.Reason)
	}
	if !strings.Contains(res.Reason, "ET-9b") {
		t.Errorf("expected the ET-9b format check to fire first; reason was: %s", res.Reason)
	}
}

// ET-9d is NECESSARY, NOT SUFFICIENT, and the rule is emphatic that it must
// not be read as more. Two distinct keys held by one party are
// indistinguishable in the log from a genuinely separated registrar, so a
// chain declaring two distinct keys is accepted no matter who holds them —
// there is nothing in an export to tell. This case records that boundary in
// the suite: the verifier is not asked to infer custody, and a future reader
// who expects it to must change the spec, not the code.
func TestGenesisDistinctKeysAcceptedRegardlessOfCustody(t *testing.T) {
	// Two distinct keypairs from adjacent seeds — exactly what a single party
	// holding both would produce. Still VALID: the log cannot tell, and ET-9d
	// does not ask it to.
	res := Verify(genesisExportWithKeys(t, bytes32(0x40), bytes32(0x41), nil), nil)
	if res.Verdict != VALID {
		t.Fatalf("verdict = %s, want VALID (reason: %s)", res.Verdict, res.Reason)
	}
}

// fieldValue extracts a payload string value out of a rendered line. Test-only
// and deliberately crude — it exists to guard the harness, not to parse.
func fieldValue(t *testing.T, line, key string) string {
	t.Helper()
	marker := `"` + key + `":"`
	i := strings.Index(line, marker)
	if i < 0 {
		t.Fatalf("field %s not found in rendered line", key)
	}
	rest := line[i+len(marker):]
	j := strings.Index(rest, `"`)
	if j < 0 {
		t.Fatalf("field %s not terminated", key)
	}
	return rest[:j]
}
