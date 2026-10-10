package verify

import (
	"bytes"
	"encoding/json"
	"unicode/utf8"
)

// Unavailable is printed in place of a stored claim the EX-24 report could not
// recover.
const Unavailable = "unavailable"

// ReportClaims returns the two endpoint STORED CLAIMS of export-format.md
// EX-24: the `hash` field as written in the first candidate record (the
// claimed genesis hash, EX-21) and in the last candidate record (the claimed
// head, EX-14). ok is false for an empty input, which has no endpoints and so
// nothing to report.
//
// These are claims the file makes, never recomputed or verified values. On a
// structurally valid export they coincide with the genesis hash and head; on
// INVALID input they prove nothing (EX-24). This is TOOL OUTPUT, not
// conformance surface (EV-17), so it deliberately runs independently of every
// file check — it applies even when framing fails — and never uses the strict
// canonical parser.
func ReportClaims(data []byte) (genesis, head string, ok bool) {
	cands := candidates(data)
	if len(cands) == 0 {
		return "", "", false
	}
	return claim(cands[0]), claim(cands[len(cands)-1]), true
}

// candidates splits the input into EX-24 candidate records: split at LF; one
// terminal LF ends the last record and does not add an empty candidate, while
// any additional trailing blank record IS a candidate; without a final LF the
// final fragment is the last candidate. An empty input has no candidates.
//
//	"A\n"    -> ["A"]
//	"A"      -> ["A"]
//	"A\n\n"  -> ["A", ""]
//	"\n"     -> [""]
func candidates(data []byte) [][]byte {
	if len(data) == 0 {
		return nil
	}
	if data[len(data)-1] == '\n' {
		data = data[:len(data)-1] // the one terminal framing LF
	}
	return bytes.Split(data, []byte{'\n'})
}

// claim recovers one endpoint's stored claim from its candidate record. The
// claim is available only if the candidate, taken byte-for-byte, decodes as a
// JSON object (RFC 8259: valid UTF-8, one value, insignificant whitespace
// allowed) whose top-level `hash` member is a string of exactly 64 lowercase
// hexadecimal characters. A repeated top-level `hash` key resolves to its LAST
// occurrence (encoding/json's map decoding overwrites earlier members). The
// value is never normalised, lowercased, trimmed or substituted: anything else
// is Unavailable.
func claim(cand []byte) string {
	// encoding/json silently replaces invalid UTF-8 with U+FFFD; such bytes
	// are not JSON text (RFC 8259 §8.1), so they do not decode here.
	if !utf8.Valid(cand) {
		return Unavailable
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(cand, &obj); err != nil || obj == nil {
		return Unavailable // not JSON, or not an object (`null` included)
	}
	raw, present := obj["hash"]
	if !present {
		return Unavailable
	}
	var h string
	if err := json.Unmarshal(raw, &h); err != nil || !isHex64(h) {
		return Unavailable
	}
	return h
}
