package verify

import "unicode/utf8"

// This file implements a strict, byte-exact JSON parser used to enforce the
// canonical line form of contracts/export-format.md (EX-7..EX-10) while
// extracting field values. It deliberately does NOT use encoding/json: the
// standard decoder tolerates whitespace, reorders keys, silently accepts
// duplicate keys, and normalizes numbers — every one of which the canonical
// form forbids. The parser rejects any deviation from the compact canonical
// serialization by construction (no whitespace is ever skipped).

type jkind int

const (
	kObject jkind = iota
	kString
	kInt       // canonical non-negative integer in [0, 2^53-1] (ES-5)
	kBadNumber // any numeric token that is NOT a canonical in-range integer
	kBool
	kNull
	kArray
)

type jvalue struct {
	kind jkind
	str  string // decoded string value (kString)
	ival int64  // integer value (kInt)
	obj  *jobject
}

type jobject struct {
	keys   []string // decoded keys, in stored order
	vals   []jvalue
	dupKey bool // set if any key appears more than once (HA-6)
}

type parser struct {
	b   []byte
	pos int
	err bool
}

// parseObjectLine parses exactly one JSON object occupying the whole input,
// with no leading, trailing, or interior whitespace. It returns ok=false for
// any structural or canonical-form violation.
func parseObjectLine(b []byte) (*jobject, bool) {
	if len(b) == 0 || b[0] != '{' {
		return nil, false
	}
	p := &parser{b: b}
	v := p.parseValue()
	if p.err || p.pos != len(b) || v.kind != kObject {
		return nil, false
	}
	return v.obj, true
}

func (p *parser) parseValue() jvalue {
	if p.err || p.pos >= len(p.b) {
		p.err = true
		return jvalue{}
	}
	c := p.b[p.pos]
	switch {
	case c == '{':
		return p.parseObject()
	case c == '[':
		return p.parseArray()
	case c == '"':
		s, ok := p.parseString()
		if !ok {
			p.err = true
			return jvalue{}
		}
		return jvalue{kind: kString, str: s}
	case c == 't':
		return p.parseLit("true", kBool)
	case c == 'f':
		return p.parseLit("false", kBool)
	case c == 'n':
		return p.parseLit("null", kNull)
	case c == '-' || (c >= '0' && c <= '9'):
		return p.parseNumber()
	default:
		p.err = true
		return jvalue{}
	}
}

// dupSetThreshold is the key count at which duplicate detection switches from
// a linear scan of the keys already seen to a set. Below it the scan is
// cheaper than allocating a map, and real ODC events are far below it — the
// widest v1 payload has five keys. Above it the scan is what made a wide
// payload quadratic in key count, so a hostile export of very modest size
// could wedge the verifier: 200k keys took over a minute of pure key
// comparison. "A stranger can write a verifier and check the log in an
// afternoon" (charter §4) does not survive that, so the set takes over.
const dupSetThreshold = 32

func (p *parser) parseObject() jvalue {
	p.pos++ // consume '{'
	obj := &jobject{}
	if p.pos < len(p.b) && p.b[p.pos] == '}' {
		p.pos++
		return jvalue{kind: kObject, obj: obj}
	}
	// seen is nil until the key count crosses dupSetThreshold, at which point
	// it is populated from the keys already stored and used from then on.
	var seen map[string]struct{}
	for {
		if p.pos >= len(p.b) || p.b[p.pos] != '"' {
			p.err = true
			return jvalue{}
		}
		key, ok := p.parseString()
		if !ok {
			p.err = true
			return jvalue{}
		}
		if p.pos >= len(p.b) || p.b[p.pos] != ':' {
			p.err = true
			return jvalue{}
		}
		p.pos++ // consume ':'
		val := p.parseValue()
		if p.err {
			return jvalue{}
		}
		// HA-6 duplicate-key detection. Once dupKey is set the answer cannot
		// change, so we stop looking entirely: dupKey is a single boolean the
		// caller reads, not a list of offending keys, and continuing to search
		// after the first hit buys nothing. This is both the early exit the
		// previous scan lacked and, with the set below, what makes the whole
		// thing sub-quadratic. Parsing itself continues either way, because a
		// duplicate key is not a parse error — it is a Stage A rejection the
		// caller makes after the line is fully parsed, and stopping here would
		// change which check fires (though not, per EV-17, which line).
		if !obj.dupKey {
			switch {
			case seen != nil:
				if _, dup := seen[key]; dup {
					obj.dupKey = true
				} else {
					seen[key] = struct{}{}
				}
			default:
				for _, k := range obj.keys {
					if k == key {
						obj.dupKey = true
						break
					}
				}
				if !obj.dupKey && len(obj.keys)+1 >= dupSetThreshold {
					seen = make(map[string]struct{}, len(obj.keys)+1)
					for _, k := range obj.keys {
						seen[k] = struct{}{}
					}
					seen[key] = struct{}{}
				}
			}
		}
		obj.keys = append(obj.keys, key)
		obj.vals = append(obj.vals, val)
		if p.pos >= len(p.b) {
			p.err = true
			return jvalue{}
		}
		switch p.b[p.pos] {
		case ',':
			p.pos++
			continue
		case '}':
			p.pos++
			return jvalue{kind: kObject, obj: obj}
		default:
			p.err = true
			return jvalue{}
		}
	}
}

// parseArray fully consumes a JSON array so parsing can continue; the array
// itself is never valid in a v1 payload (ES-17) but must be recognized.
func (p *parser) parseArray() jvalue {
	p.pos++ // consume '['
	if p.pos < len(p.b) && p.b[p.pos] == ']' {
		p.pos++
		return jvalue{kind: kArray}
	}
	for {
		p.parseValue()
		if p.err {
			return jvalue{}
		}
		if p.pos >= len(p.b) {
			p.err = true
			return jvalue{}
		}
		switch p.b[p.pos] {
		case ',':
			p.pos++
			continue
		case ']':
			p.pos++
			return jvalue{kind: kArray}
		default:
			p.err = true
			return jvalue{}
		}
	}
}

func (p *parser) parseLit(lit string, k jkind) jvalue {
	if p.pos+len(lit) <= len(p.b) && string(p.b[p.pos:p.pos+len(lit)]) == lit {
		p.pos += len(lit)
		return jvalue{kind: k}
	}
	p.err = true
	return jvalue{}
}

func (p *parser) parseNumber() jvalue {
	start := p.pos
	for p.pos < len(p.b) {
		c := p.b[p.pos]
		if (c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' {
			p.pos++
		} else {
			break
		}
	}
	tok := p.b[start:p.pos]
	if v, ok := canonicalInt(tok); ok {
		return jvalue{kind: kInt, ival: v}
	}
	return jvalue{kind: kBadNumber}
}

// maxSafeInteger is 2^53 - 1 (ES-5): integers must round-trip losslessly.
const maxSafeInteger int64 = 9007199254740991

// canonicalInt reports whether tok is the canonical integer form of ES-5
// (^(0|[1-9][0-9]*)$) and lies within [0, 2^53-1], returning its value.
func canonicalInt(tok []byte) (int64, bool) {
	if len(tok) == 0 {
		return 0, false
	}
	if tok[0] == '0' {
		if len(tok) != 1 { // leading zero
			return 0, false
		}
		return 0, true
	}
	var v int64
	for _, c := range tok {
		if c < '0' || c > '9' {
			return 0, false
		}
		v = v*10 + int64(c-'0')
		if v > maxSafeInteger {
			return 0, false
		}
	}
	return v, true
}

// parseString parses a JSON string starting at a '"', enforcing EX-9 minimal
// escaping and HA-2 well-formed-UTF-8, and returns the decoded scalar-value
// string (the value UTF8() hashes over).
func (p *parser) parseString() (string, bool) {
	if p.pos >= len(p.b) || p.b[p.pos] != '"' {
		return "", false
	}
	p.pos++ // consume opening quote
	var out []byte
	for {
		if p.pos >= len(p.b) {
			return "", false // unterminated
		}
		c := p.b[p.pos]
		switch {
		case c == '"':
			p.pos++
			if !utf8.Valid(out) {
				return "", false
			}
			return string(out), true
		case c == '\\':
			if p.pos+1 >= len(p.b) {
				return "", false
			}
			e := p.b[p.pos+1]
			switch e {
			case '"':
				out = append(out, '"')
				p.pos += 2
			case '\\':
				out = append(out, '\\')
				p.pos += 2
			case 'b':
				out = append(out, 0x08)
				p.pos += 2
			case 't':
				out = append(out, 0x09)
				p.pos += 2
			case 'n':
				out = append(out, 0x0a)
				p.pos += 2
			case 'f':
				out = append(out, 0x0c)
				p.pos += 2
			case 'r':
				out = append(out, 0x0d)
				p.pos += 2
			case 'u':
				if p.pos+6 > len(p.b) {
					return "", false
				}
				v, ok := lowerHex4(p.b[p.pos+2 : p.pos+6])
				if !ok {
					return "", false // non-hex or uppercase (EX-9)
				}
				// \u is permitted ONLY for control chars U+0000-U+001F that are
				// not one of the five with mandatory short escapes.
				if v >= 0x20 {
					return "", false // non-ASCII / >=0x20 must be literal (EX-9)
				}
				if v == 0x08 || v == 0x09 || v == 0x0a || v == 0x0c || v == 0x0d {
					return "", false // must use short escape (non-minimal)
				}
				out = append(out, byte(v))
				p.pos += 6
			default:
				return "", false // invalid escape (incl. \/)
			}
		case c < 0x20:
			return "", false // raw control must be escaped
		default:
			out = append(out, c) // literal byte: ASCII >=0x20, 0x7f, or UTF-8 lead/cont
			p.pos++
		}
	}
}

// lowerHex4 decodes exactly four lowercase-hex digits.
func lowerHex4(h []byte) (int, bool) {
	if len(h) != 4 {
		return 0, false
	}
	v := 0
	for _, c := range h {
		var d int
		switch {
		case c >= '0' && c <= '9':
			d = int(c - '0')
		case c >= 'a' && c <= 'f':
			d = int(c-'a') + 10
		default:
			return 0, false // uppercase or non-hex
		}
		v = v*16 + d
	}
	return v, true
}
