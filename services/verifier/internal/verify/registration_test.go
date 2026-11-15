package verify

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Transcribe HA-15a with fixed lengths so the test signer does not depend on
// the verifier's byte encoders. Both arguments are 64-character hex strings.
func registrationV2TestMessage(genesisHash, pubkey string) []byte {
	return []byte("ODC-REG2" +
		"\x00\x00\x00\x00\x00\x00\x00\x16participant_registered" +
		"\x00\x00\x00\x00\x00\x00\x00\x02" +
		"\x00\x00\x00\x00\x00\x00\x00\x40" + genesisHash +
		"\x00\x00\x00\x00\x00\x00\x00\x01s" +
		"\x00\x00\x00\x00\x00\x00\x00\x06pubkey" +
		"\x00\x00\x00\x00\x00\x00\x00\x40" + pubkey)
}

func registrationV2Payload(priv ed25519.PrivateKey, genesisHash string) map[string]any {
	pubkey := hex.EncodeToString(priv.Public().(ed25519.PublicKey))
	sig := ed25519.Sign(priv, registrationV2TestMessage(genesisHash, pubkey))
	return map[string]any{"pubkey": pubkey, "sig": hex.EncodeToString(sig)}
}

func TestRegistrationPreimage(t *testing.T) {
	genesisHash := strings.Repeat("1a", 32)
	pubkey := strings.Repeat("2b", 32)
	line := renderLine(2, "participant_registered", 2, map[string]any{
		"pubkey": pubkey,
		"sig":    strings.Repeat("3c", 64),
	}, T1, strings.Repeat("4d", 32), strings.Repeat("5e", 32))
	e := parseLineOrFail(t, line)
	want := registrationV2TestMessage(genesisHash, pubkey)
	if got := registrationPreimage(e, genesisHash); !bytes.Equal(got, want) {
		t.Fatalf("registration preimage mismatch\n got %x\nwant %x", got, want)
	}
}

func TestParticipantRegistrationV2(t *testing.T) {
	fixtures := filepath.Join(fixturesDir(t), "vectors")
	genesis := func(name string) ([]byte, string) {
		data, err := os.ReadFile(filepath.Join(fixtures, name))
		if err != nil {
			t.Fatal(err)
		}
		line := exportLine(t, data, 1)
		return line, parseLineOrFail(t, line).hash
	}
	genA, hashA := genesis("001-genesis-only.ndjson")
	genB, hashB := genesis("113-chain-b-match.ndjson")
	if hashA == hashB || fieldValue(t, string(genA), "chain_id") != fieldValue(t, string(genB), "chain_id") {
		t.Fatal("expected distinct chains under the same operator")
	}

	const typ = "participant_registered"
	priv := ed25519.NewKeyFromSeed(bytes32(3))
	payload := registrationV2Payload(priv, hashA)
	a2 := seal(t, 2, typ, 2, payload, T1, hashA)
	a3 := seal(t, 3, typ, 2, payload, T2, parseLineOrFail(t, a2).hash)
	b2Wrong := seal(t, 2, typ, 2, payload, T1, hashB)
	b2Right := seal(t, 2, typ, 2, registrationV2Payload(priv, hashB), T1, hashB)
	positionSignedV2 := signAndSeal(t, priv, 2, typ, 2, map[string]any{"pubkey": payload["pubkey"]}, T1, hashA)
	genesisSignedV1 := seal(t, 2, typ, 1, payload, T1, hashA)

	extraField := registrationV2Payload(priv, hashA)
	extraField["participant_id"] = strings.Repeat("0", 64)
	uppercasePubkey := strings.ToUpper(payload["pubkey"].(string))
	uppercaseKey := map[string]any{
		"pubkey": uppercasePubkey,
		"sig":    hex.EncodeToString(ed25519.Sign(priv, registrationV2TestMessage(hashA, uppercasePubkey))),
	}
	uppercaseSig := map[string]any{
		"pubkey": payload["pubkey"],
		"sig":    strings.ToUpper(payload["sig"].(string)),
	}
	identityKey := map[string]any{
		"pubkey": "01" + strings.Repeat("00", 31),
		"sig":    "01" + strings.Repeat("00", 63),
	}
	cases := []struct {
		name  string
		lines [][]byte
		want  Verdict
		line  int
		rule  string
	}{
		{"valid", [][]byte{genA, a2}, VALID, 0, ""},
		{"same signature at another position and timestamp", [][]byte{genA, a2, a3}, VALID, 0, ""},
		{"different genesis under the same operator", [][]byte{genB, b2Wrong}, INVALID, 2, "ET-10a"},
		{"signed for the second genesis", [][]byte{genB, b2Right}, VALID, 0, ""},
		{"version 2 with HA-15 signature", [][]byte{genA, positionSignedV2}, INVALID, 2, "ET-10a"},
		{"version 1 with HA-15a signature", [][]byte{genA, genesisSignedV1}, INVALID, 2, "ET-10"},
		{"extra payload field", [][]byte{genA, seal(t, 2, typ, 2, extraField, T1, hashA)}, INVALID, 2, "ES-18"},
		{"uppercase public key", [][]byte{genA, seal(t, 2, typ, 2, uppercaseKey, T1, hashA)}, INVALID, 2, "ID-3"},
		{"uppercase signature", [][]byte{genA, seal(t, 2, typ, 2, uppercaseSig, T1, hashA)}, INVALID, 2, "ES-31"},
		{"identity-point public key", [][]byte{genA, seal(t, 2, typ, 2, identityKey, T1, hashA)}, INVALID, 2, "ET-10a"},
		{"event digest still verified", [][]byte{genA, corruptHash(a2)}, INVALID, 2, "HA-14"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := Verify(joinLines(tc.lines), nil)
			if result.Verdict != tc.want || result.Line != tc.line {
				t.Fatalf("got %s at line %d (%s), want %s at line %d",
					result.Verdict, result.Line, result.Reason, tc.want, tc.line)
			}
			if tc.rule != "" {
				assertRule(t, result, tc.rule)
			}
		})
	}
}

func TestParticipantRegistrationV2CLI(t *testing.T) {
	genesis, hash := genesisAndHash(t)
	priv := ed25519.NewKeyFromSeed(bytes32(3))
	line := seal(t, 2, "participant_registered", 2, registrationV2Payload(priv, hash), T1, hash)
	path := filepath.Join(t.TempDir(), "export.ndjson")
	if err := os.WriteFile(path, joinLines([][]byte{trimLF(genesis), line}), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(buildCLI(t), path, "--chain", hash)
	stdout, err := cmd.Output()
	if err != nil || string(stdout) != "VALID\n" {
		t.Fatalf("verify stdout = %q, error = %v, want VALID and exit 0", stdout, err)
	}
}
