package verify

// frame splits a raw export into logical lines and reports NDJSON framing
// violations of export-format.md (EX-1..EX-6), attributed per EX-20.
//
// It returns the line byte-slices (LF-separated, LF excluded) and a map from
// 1-based line number to the framing violation on that line, if any. The driver
// treats any such violation as a Stage A INVALID at that line.
//
// An empty file yields zero lines (EX-6): a well-formed export that the chain
// verifier rejects as having no genesis (EX-18), handled by the caller.
func frame(data []byte) (lines [][]byte, faults map[int]string) {
	faults = map[int]string{}
	if len(data) == 0 {
		return nil, faults
	}

	// EX-2: a UTF-8 byte-order mark before line 1 is leading garbage.
	if len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf {
		faults[1] = "byte-order mark (EX-2)"
	}

	hasFinalLF := data[len(data)-1] == 0x0A

	// Split on LF (0x0A). Each segment is one line; the LF is not included.
	start := 0
	for i := 0; i < len(data); i++ {
		if data[i] == 0x0A {
			lines = append(lines, data[start:i])
			start = i + 1
		}
	}
	if start < len(data) {
		// Trailing bytes after the last LF: a final line with no terminating LF.
		lines = append(lines, data[start:])
	}

	n := len(lines)
	// EX-4: the final LF is required; a non-empty export must end in 0x0A.
	if !hasFinalLF {
		if _, ok := faults[n]; !ok {
			faults[n] = "missing final LF (EX-4)"
		}
	}

	for idx, seg := range lines {
		ln := idx + 1
		// EX-3: a carriage return may not appear. Attribute to the first line
		// containing one. (A '\r' inside a string is the two bytes 0x5c 0x72,
		// not a raw 0x0D, so this only fires on true CRs.)
		for _, b := range seg {
			if b == 0x0D {
				if _, ok := faults[ln]; !ok {
					faults[ln] = "carriage return (EX-3)"
				}
				break
			}
		}
		// EX-5: no blank lines.
		if len(seg) == 0 {
			if _, ok := faults[ln]; !ok {
				faults[ln] = "blank line (EX-5)"
			}
		}
	}

	return lines, faults
}
