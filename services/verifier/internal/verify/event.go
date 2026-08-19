package verify

// event holds the seven envelope fields after Stage A structural validation.
type event struct {
	seq      int64
	typ      string
	version  int64
	payload  *jobject
	ts       string
	prevHash string
	hash     string
}

const zeros64 = "0000000000000000000000000000000000000000000000000000000000000000"

var envelopeOrder = []string{"seq", "type", "version", "payload", "ts", "prev_hash", "hash"}

// envelope performs the per-event, type-agnostic Stage A envelope checks and
// returns the parsed event. ok=false means the line is INVALID. Covered rules:
// ES-1..ES-3 (exact seven fields, no null/absent/extra), ES-5 (seq form/range),
// ES-10 (type charset), ES-12 (version >= 1), ES-15/16/17 + EV-16 (payload is a
// flat object of int/string values), EX-8/HA-6 (payload keys strictly ascending,
// no duplicates), ES-20 (ts syntax + calendar), ES-23/ES-26 (prev_hash/hash are
// 64 lowercase hex). It does NOT apply cross-line linkage, hash recomputation,
// or any per-type (Stage B) rule.
func envelope(obj *jobject) (*event, bool) {
	if obj.dupKey || len(obj.keys) != 7 {
		return nil, false
	}
	for i, want := range envelopeOrder {
		if obj.keys[i] != want {
			return nil, false // wrong field, wrong order, missing, or extra (ES-1/ES-2/EX-7)
		}
	}
	get := func(name string) jvalue {
		for i, k := range obj.keys {
			if k == name {
				return obj.vals[i]
			}
		}
		return jvalue{}
	}

	seqV := get("seq")
	if seqV.kind != kInt {
		return nil, false // ES-5 (also rejects null/string/float/leading-zero/out-of-range)
	}
	verV := get("version")
	if verV.kind != kInt || verV.ival < 1 {
		return nil, false // ES-12
	}
	typV := get("type")
	if typV.kind != kString || !validType(typV.str) {
		return nil, false // ES-10
	}
	payV := get("payload")
	if payV.kind != kObject {
		return nil, false // ES-15 / EV-16
	}
	if !payloadFlatAndSorted(payV.obj) {
		return nil, false // ES-16/ES-17/EV-16, EX-8, HA-6
	}
	tsV := get("ts")
	if tsV.kind != kString || !validTS(tsV.str) {
		return nil, false // ES-20
	}
	prevV := get("prev_hash")
	if prevV.kind != kString || !isHex64(prevV.str) {
		return nil, false // ES-23
	}
	hashV := get("hash")
	if hashV.kind != kString || !isHex64(hashV.str) {
		return nil, false // ES-26
	}

	return &event{
		seq:      seqV.ival,
		typ:      typV.str,
		version:  verV.ival,
		payload:  payV.obj,
		ts:       tsV.str,
		prevHash: prevV.str,
		hash:     hashV.str,
	}, true
}

// validType checks ES-10: ^[a-z][a-z0-9_]*$.
func validType(s string) bool {
	if len(s) == 0 {
		return false
	}
	if s[0] < 'a' || s[0] > 'z' {
		return false
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
			return false
		}
	}
	return true
}

// payloadFlatAndSorted verifies every payload value is a canonical integer or a
// string (ES-16/ES-17, EV-16), and that keys are strictly ascending in UTF-8
// byte order with no duplicates (EX-8, HA-6).
func payloadFlatAndSorted(obj *jobject) bool {
	if obj.dupKey {
		return false // HA-6
	}
	for _, v := range obj.vals {
		if v.kind != kInt && v.kind != kString {
			return false // float, bool, null, nested object, or array
		}
	}
	for i := 1; i < len(obj.keys); i++ {
		if obj.keys[i-1] >= obj.keys[i] { // Go string compare is byte-lexicographic
			return false // not strictly ascending (unsorted or duplicate)
		}
	}
	return true
}

// isHex64 checks ^[0-9a-f]{64}$.
func isHex64(s string) bool {
	if len(s) != 64 {
		return false
	}
	return allLowerHex(s)
}

// isHex128 checks ^[0-9a-f]{128}$.
func isHex128(s string) bool {
	if len(s) != 128 {
		return false
	}
	return allLowerHex(s)
}

func allLowerHex(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// validTS enforces ES-20: the exact syntactic form
// ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$ AND a real UTC calendar instant,
// with leap seconds (second 60) rejected.
func validTS(s string) bool {
	if len(s) != 24 {
		return false
	}
	// Fixed-position syntactic gate.
	for i, c := range []byte(s) {
		switch i {
		case 4, 7:
			if c != '-' {
				return false
			}
		case 10:
			if c != 'T' {
				return false
			}
		case 13, 16:
			if c != ':' {
				return false
			}
		case 19:
			if c != '.' {
				return false
			}
		case 23:
			if c != 'Z' {
				return false
			}
		default:
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	year := atoiFixed(s[0:4])
	month := atoiFixed(s[5:7])
	day := atoiFixed(s[8:10])
	hour := atoiFixed(s[11:13])
	minute := atoiFixed(s[14:16])
	second := atoiFixed(s[17:19])
	// milliseconds s[20:23] need no range check: any 000-999 is valid.

	if month < 1 || month > 12 {
		return false
	}
	if hour > 23 || minute > 59 || second > 59 { // 60 (leap second) rejected
		return false
	}
	if day < 1 || day > daysInMonth(year, month) {
		return false
	}
	return true
}

func atoiFixed(s string) int {
	n := 0
	for i := 0; i < len(s); i++ {
		n = n*10 + int(s[i]-'0')
	}
	return n
}

func daysInMonth(year, month int) int {
	switch month {
	case 1, 3, 5, 7, 8, 10, 12:
		return 31
	case 4, 6, 9, 11:
		return 30
	case 2:
		if isLeap(year) {
			return 29
		}
		return 28
	}
	return 0
}

func isLeap(y int) bool {
	return (y%4 == 0 && y%100 != 0) || y%400 == 0
}

// payloadGet returns the value for a payload key and whether it exists.
func payloadGet(obj *jobject, key string) (jvalue, bool) {
	for i, k := range obj.keys {
		if k == key {
			return obj.vals[i], true
		}
	}
	return jvalue{}, false
}

// payloadKeySetEquals reports whether obj's keys are exactly want (order-free;
// stored order is already validated as sorted). For a type with no OPTIONAL
// keys, ES-18's key set is exact.
func payloadKeySetEquals(obj *jobject, want []string) bool {
	return payloadKeySetMatches(obj, want, nil)
}

// payloadKeySetMatches enforces ES-18 as amended by ES-34: obj MUST carry every
// key in required, MAY carry any subset of optional, and MUST NOT carry any
// other key. OPTIONAL widens the key set; it does not open it — an undefined key
// is still rejected, so this is not a hole. Duplicate keys cannot reach here
// (payloadFlatAndSorted has already rejected them, HA-6), which is what lets the
// required-key tally below be a plain count.
func payloadKeySetMatches(obj *jobject, required, optional []string) bool {
	req := make(map[string]bool, len(required))
	for _, k := range required {
		req[k] = true
	}
	opt := make(map[string]bool, len(optional))
	for _, k := range optional {
		opt[k] = true
	}
	seen := 0
	for _, k := range obj.keys {
		switch {
		case req[k]:
			seen++
		case opt[k]:
			// present with a legal value, or absent — both conform (ES-34).
		default:
			return false // key not defined for this (type, version) (ES-18)
		}
	}
	return seen == len(req) // every required key present
}

// countScalars returns the number of Unicode scalar values in s (runes).
func countScalars(s string) int {
	n := 0
	for range s {
		n++
	}
	return n
}

// hasForbiddenTitleChar reports whether s contains any C0 control (U+0000-U+001F)
// or U+007F (ET-14). C1 controls (U+0080-U+009F) are permitted.
func hasForbiddenTitleChar(s string) bool {
	for _, r := range s {
		if r <= 0x1f || r == 0x7f {
			return true
		}
	}
	return false
}

// hexDecode32/64 decode a validated lowercase-hex string to raw bytes.
func hexToBytes(s string) []byte {
	b := make([]byte, len(s)/2)
	for i := 0; i < len(b); i++ {
		b[i] = hexNibble(s[2*i])<<4 | hexNibble(s[2*i+1])
	}
	return b
}

func hexNibble(c byte) byte {
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	}
	return 0
}
