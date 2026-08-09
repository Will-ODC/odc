package verify

import (
	"crypto/sha256"
	"encoding/hex"
)

// Byte-exact preimage construction of contracts/hashing.md (HA-1..HA-16).
// Generic over any flat integer/string payload (HA-7): it never consults the
// event's type.

// domain is the 4-octet DOMAIN prefix "ODC1" (HA-10).
var domain = []byte{0x4f, 0x44, 0x43, 0x31}

// u64 encodes n as 8 octets, big-endian, unsigned (HA-1).
func u64(n int64) []byte {
	un := uint64(n)
	return []byte{
		byte(un >> 56), byte(un >> 48), byte(un >> 40), byte(un >> 32),
		byte(un >> 24), byte(un >> 16), byte(un >> 8), byte(un),
	}
}

// encStr encodes a string field value as LP(UTF8(s)) (HA-2, HA-3, HA-5).
// The Go string already holds the decoded scalar values as UTF-8 bytes.
func encStr(s string) []byte {
	b := []byte(s)
	out := u64(int64(len(b)))
	return append(out, b...)
}

// encInt encodes an integer field value as U64(n) (HA-4).
func encInt(n int64) []byte {
	return u64(n)
}

// encPayload encodes a payload object per HA-7. If skipKey is non-empty, that
// single key is omitted (the signing preimage, HA-15). Keys are emitted in
// stored order, which Stage A has already confirmed is ascending UTF-8-byte
// order (HA-8 / EX-8), so no re-sort is needed here.
func encPayload(obj *jobject, skipKey string) []byte {
	count := 0
	for _, k := range obj.keys {
		if skipKey != "" && k == skipKey {
			continue
		}
		count++
	}
	out := u64(int64(count))
	for i, k := range obj.keys {
		if skipKey != "" && k == skipKey {
			continue
		}
		v := obj.vals[i]
		if v.kind == kInt {
			out = append(out, 0x69) // tag 'i'
			out = append(out, encStr(k)...)
			out = append(out, encInt(v.ival)...)
		} else { // kString (payload flatness guaranteed by Stage A)
			out = append(out, 0x73) // tag 's'
			out = append(out, encStr(k)...)
			out = append(out, encStr(v.str)...)
		}
	}
	return out
}

// preimage builds PRE(E) (HA-11), or the signing preimage SIGN_PRE(E) when
// skipKey == "sig" (HA-15).
func preimage(e *event, skipKey string) []byte {
	out := append([]byte{}, domain...)
	out = append(out, encInt(e.seq)...)
	out = append(out, encStr(e.typ)...)
	out = append(out, encInt(e.version)...)
	out = append(out, encPayload(e.payload, skipKey)...)
	out = append(out, encStr(e.ts)...)
	out = append(out, encStr(e.prevHash)...) // hex text, not decoded bytes (HA-12)
	return out
}

// hashHex returns the lowercase-hex SHA-256 digest of pre (HA-13).
func hashHex(pre []byte) string {
	sum := sha256.Sum256(pre)
	return hex.EncodeToString(sum[:])
}
