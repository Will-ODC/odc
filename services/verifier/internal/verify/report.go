package verify

import "encoding/json"

// Unavailable is printed in place of a hash the EX-24 report could not read.
const Unavailable = "unavailable"

// ReportHashes returns the genesis hash (EX-21) and the head (EX-14) of a
// non-empty export for the EX-24 report: the stored `hash` field of the first
// and of the last line respectively. ok is false for an empty export, for
// which nothing is reported.
//
// This is TOOL OUTPUT, not conformance surface (EX-24, EV-17), and it is
// reported whatever the verdict — including on INVALID exports whose lines are
// not canonical. So it deliberately does NOT use the strict canonical parser:
// it splits lines exactly as the framing does (frame) and plainly JSON-parses
// the chosen line's bytes as-is. If that fails, or the line has no `hash`
// field, or the field is not a 64-lowercase-hex string, the value is
// Unavailable.
func ReportHashes(data []byte) (genesis, head string, ok bool) {
	lines, _ := frame(data)
	if len(lines) == 0 {
		return "", "", false
	}
	return readHash(lines[0]), readHash(lines[len(lines)-1]), true
}

func readHash(line []byte) string {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(line, &obj); err != nil {
		return Unavailable
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
