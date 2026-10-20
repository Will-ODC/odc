package verify

import "bytes"

// lineReader walks a raw export one logical line at a time and reports the
// NDJSON framing violation of export-format.md (EX-1..EX-6) on each line, if
// any, attributed per EX-20. The driver treats any such violation as a Stage A
// INVALID at that line.
//
// It holds no per-line state: the driver stops at the first fatal line, so a
// hostile export of millions of blank lines costs no more memory than its own
// bytes (#369). Lines are LF-separated, the LF excluded; trailing bytes after
// the last LF are a final line with no terminating LF.
//
// An empty file yields zero lines (EX-6): a well-formed export that the chain
// verifier rejects as having no genesis (EX-18), handled by the caller.
type lineReader struct {
	data []byte
	pos  int // offset of the next line's first byte
	ln   int // 1-based number of the line last returned
}

// next returns the next line, its 1-based number and its framing violation
// ("" if none). ok is false once every line has been returned.
//
// When one line has several violations, one is reported, in this order: a
// byte-order mark, a missing final LF, a carriage return, a blank line.
func (r *lineReader) next() (seg []byte, ln int, fault string, ok bool) {
	if r.pos >= len(r.data) {
		return nil, r.ln, "", false
	}
	rest := r.data[r.pos:]
	end := bytes.IndexByte(rest, 0x0A)
	terminated := end >= 0
	if terminated {
		seg = rest[:end]
		r.pos += end + 1
	} else {
		seg = rest
		r.pos = len(r.data)
	}
	r.ln++

	switch {
	// EX-2: a UTF-8 byte-order mark before line 1 is leading garbage.
	case r.ln == 1 && bytes.HasPrefix(seg, []byte{0xef, 0xbb, 0xbf}):
		fault = "byte-order mark (EX-2)"
	// EX-4: the final LF is required; a non-empty export must end in 0x0A.
	case !terminated:
		fault = "missing final LF (EX-4)"
	// EX-3: a carriage return may not appear. (A '\r' inside a string is the
	// two bytes 0x5c 0x72, not a raw 0x0D, so this only fires on true CRs.)
	case bytes.IndexByte(seg, 0x0D) >= 0:
		fault = "carriage return (EX-3)"
	// EX-5: no blank lines.
	case len(seg) == 0:
		fault = "blank line (EX-5)"
	}
	return seg, r.ln, fault, true
}
