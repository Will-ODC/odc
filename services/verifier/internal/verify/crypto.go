package verify

import (
	"crypto/ed25519"
	"math/big"

	"filippo.io/edwards25519"
)

// Ed25519 canonical-encoding and prime-order checks of event-types.md
// (ET-4a/ET-4b/ET-4c), run on the raw decoded bytes BEFORE the verification
// primitive (ET-5). Only ET-4c uses the edwards25519 curve library; every
// other check here is stdlib arithmetic, and ET-5 uses crypto/ed25519.

// L is the order of the Ed25519 prime-order subgroup:
// 2^252 + 27742317777372353535851937790883648493.
var edL = func() *big.Int {
	l := new(big.Int).Lsh(big.NewInt(1), 252)
	c, _ := new(big.Int).SetString("27742317777372353535851937790883648493", 10)
	return l.Add(l, c)
}()

// P is the field prime 2^255 - 19.
var edP = func() *big.Int {
	p := new(big.Int).Lsh(big.NewInt(1), 255)
	return p.Sub(p, big.NewInt(19))
}()

// scalarLminus1 is (L-1) as a canonical Ed25519 scalar; multiplying a point by
// it and adding the point back yields [L]A (see checkKeyPrimeOrder).
var scalarLminus1 = func() *edwards25519.Scalar {
	lm1 := new(big.Int).Sub(edL, big.NewInt(1))
	le := bigToLE32(lm1)
	s, err := edwards25519.NewScalar().SetCanonicalBytes(le)
	if err != nil {
		panic("verify: L-1 is not a canonical scalar: " + err.Error())
	}
	return s
}()

// bigToLE32 renders x as exactly 32 octets, little-endian.
func bigToLE32(x *big.Int) []byte {
	be := x.Bytes()
	le := make([]byte, 32)
	for i := 0; i < len(be); i++ {
		le[i] = be[len(be)-1-i]
	}
	return le
}

// leToBig interprets b as an unsigned little-endian integer.
func leToBig(b []byte) *big.Int {
	be := make([]byte, len(b))
	for i := 0; i < len(b); i++ {
		be[i] = b[len(b)-1-i]
	}
	return new(big.Int).SetBytes(be)
}

// checkSigCanonical implements ET-4a on the 64 decoded octets of sig:
// (i) S = sig[32:64] as LE integer is strictly < L; and
// (ii) R = sig[0:32] with bit 255 cleared, as LE integer, is strictly < p.
func checkSigCanonical(sig []byte) bool {
	if len(sig) != 64 {
		return false
	}
	s := leToBig(sig[32:64])
	if s.Cmp(edL) >= 0 {
		return false
	}
	r := make([]byte, 32)
	copy(r, sig[0:32])
	r[31] &= 0x7f // clear encoded sign bit (bit 255)
	if leToBig(r).Cmp(edP) >= 0 {
		return false
	}
	return true
}

// checkKeyCanonical implements ET-4b: the 32 decoded octets of A, with bit 255
// cleared, interpreted as an unsigned LE integer, are strictly < p.
func checkKeyCanonical(a []byte) bool {
	if len(a) != 32 {
		return false
	}
	y := make([]byte, 32)
	copy(y, a)
	y[31] &= 0x7f
	return leToBig(y).Cmp(edP) < 0
}

// checkKeyPrimeOrder implements ET-4c on an already-ET-4b-canonical key: A must
// lie in the prime-order subgroup, i.e. [L]A == identity AND A != identity.
//
// A Scalar in edwards25519 is reduced modulo L, so [L] cannot be applied
// directly. Instead [L]A is computed as [L-1]A + A, both representable.
func checkKeyPrimeOrder(a []byte) bool {
	A, err := new(edwards25519.Point).SetBytes(a)
	if err != nil {
		return false // not a decodable curve point
	}
	identity := edwards25519.NewIdentityPoint()
	if A.Equal(identity) == 1 {
		return false // A == O fails the non-identity clause (load-bearing, fixture 081)
	}
	la := new(edwards25519.Point).ScalarMult(scalarLminus1, A) // [L-1]A
	la.Add(la, A)                                              // [L]A
	return la.Equal(identity) == 1
}

// verifyEd25519 checks a signature under the given public key over msg, after
// the canonical (ET-4a/ET-4b) and prime-order (ET-4c) gates have passed. It
// returns false unless every gate and the ET-5 primitive succeed.
func verifyEd25519(pub, sig, msg []byte) bool {
	if len(pub) != 32 || len(sig) != 64 {
		return false
	}
	if !checkSigCanonical(sig) { // ET-4a
		return false
	}
	if !checkKeyCanonical(pub) { // ET-4b
		return false
	}
	if !checkKeyPrimeOrder(pub) { // ET-4c
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pub), msg, sig) // ET-5
}
