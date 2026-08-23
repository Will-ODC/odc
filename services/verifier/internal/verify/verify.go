// Package verify implements the standalone ODC export verifier defined by
// contracts/ (event-schema, hashing, event-types, export-format, ids,
// evolution). It reads a hash-chained NDJSON export and returns one of three
// verdicts — VALID, INVALID at a line, or PARTIAL naming lines — per
// evolution.md EV-7/EV-17.
package verify

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// Verdict is the chain verdict token (EV-7/EV-17).
type Verdict int

const (
	VALID Verdict = iota
	INVALID
	PARTIAL
)

func (v Verdict) String() string {
	switch v {
	case VALID:
		return "VALID"
	case INVALID:
		return "INVALID"
	case PARTIAL:
		return "PARTIAL"
	}
	return "UNKNOWN"
}

// Result is the outcome of verifying an export. For INVALID, Line is the
// 1-based fatal line. For PARTIAL, Lines lists the affected lines ascending.
// Reason is advisory only (EV-17) and never conformance-checked.
type Result struct {
	Verdict Verdict
	Line    int
	Lines   []int
	Reason  string
}

func invalid(line int, reason string) Result {
	return Result{Verdict: INVALID, Line: line, Reason: reason}
}

// registry is the contracts-v1 (type, version) registry (ET-1/ET-2): the four
// v1 types, each registered only at version 1.
//
// It is the SINGLE source of truth, and deliberately so. Both the accept/reject
// decision (registered) and the EV-21 advisory text (unregisteredGenesisReason)
// read this one table, so the versions a reader is TOLD this verifier registers
// cannot drift from the versions it actually does. A second hand-maintained list
// would go stale exactly when it matters most — the moment a new genesis version
// is registered — and EV-21's whole purpose is that the list is what lets the
// reader go and settle the question.
var registry = map[string][]int64{
	"genesis":                {1},
	"participant_registered": {1},
	"issue_created":          {1},
	"vote_cast":              {1},
}

// registeredVersions returns the versions registered for typ, ascending, or nil
// for an unregistered type. The returned slice is the registry's own and MUST
// NOT be mutated by callers.
func registeredVersions(typ string) []int64 {
	return registry[typ]
}

// unregisteredGenesisReason builds the advisory reason text for an EV-20
// rejection. Reason text is never conformance-checked (EV-17) — conformance
// here is the token INVALID and the line number 1, and nothing else. EV-21 is
// guidance, and its point is honesty: the log alone CANNOT distinguish
//
//	(a) "this verifier does not register (genesis, N) — it may be out of date
//	    for this chain", from
//	(b) "this chain's genesis is corrupt or hostile",
//
// and the two ask opposite things of the reader. A verifier that picks one
// sends someone hunting for tampering when the remedy may be to fetch a newer
// verifier, and teaches readers to treat a legitimate newer chain as an attack.
// So we name both, name the version encountered, and name the genesis versions
// we do register, which is what lets the reader go and settle it.
func unregisteredGenesisReason(version int64) string {
	var have strings.Builder
	for i, v := range registeredVersions("genesis") {
		if i > 0 {
			have.WriteString(", ")
		}
		fmt.Fprintf(&have, "%d", v)
	}
	return fmt.Sprintf(
		"genesis at unregistered version %d (EV-20); this verifier registers genesis version %s. "+
			"From the log alone these are indistinguishable: this verifier may be out of date for "+
			"this chain, or this chain's genesis may be corrupt or hostile (EV-21)",
		version, have.String())
}

// registered reports whether (typ, version) is in the contracts-v1 registry
// (ET-1/ET-2), answered from `registry` and from nothing else.
func registered(typ string, version int64) bool {
	for _, v := range registry[typ] {
		if v == version {
			return true
		}
	}
	return false
}

// Permanent floors on the issue_created ballot batching parameters (ET-14b).
// The values above the floors are per-issue and votable; that a floor exists is
// permanent (register of ET-22 / EV-13).
const (
	minBallotBatchIntervalMS int64 = 60000
	minBallotBatchMin        int64 = 3
)

// vstate carries chain-wide facts gathered during Stage B.
type vstate struct {
	opPK    []byte           // genesis operator_pk, decoded (ET-8/ET-13)
	regPK   []byte           // genesis registrar_pk, decoded (ET-17)
	haveKey bool             // genesis keys captured
	issues  map[string]int64 // issue_created hash -> choice_count (ID-7/ET-18a)
}

// Verify runs the whole two-stage verification (EV-6). head, when non-nil, is a
// validated 64-lowercase-hex expected chain head (EX-15).
func Verify(data []byte, head *string) Result {
	lines, faults := frame(data)

	// An empty export verified as a chain is INVALID at line 1: it has no
	// genesis (EX-6/EX-18/ES-33).
	if len(lines) == 0 {
		return invalid(1, "empty export: no genesis (EX-18)")
	}

	st := &vstate{issues: map[string]int64{}}
	var prev *event
	var partial []int

	for i := range lines {
		ln := i + 1

		// Framing violations are Stage A, attributed to this line (EX-20).
		if reason, bad := faults[ln]; bad {
			return invalid(ln, "framing: "+reason)
		}

		obj, ok := parseObjectLine(lines[i])
		if !ok {
			return invalid(ln, "non-canonical line form (EX-7..EX-10)")
		}
		e, ok := envelope(obj)
		if !ok {
			return invalid(ln, "envelope/Stage-A structural failure")
		}

		// Cross-line Stage A: seq, prev_hash linkage, genesis position.
		if i == 0 {
			if e.seq != 1 {
				return invalid(ln, "first seq must be 1 (ES-6)")
			}
			if e.prevHash != zeros64 {
				return invalid(ln, "genesis prev_hash must be 64 zeros (ES-24)")
			}
			if e.typ != "genesis" {
				return invalid(ln, "first event must be genesis (ES-33/EX-12)")
			}
		} else {
			if e.seq != prev.seq+1 {
				return invalid(ln, "seq not contiguous (ES-7)")
			}
			if e.prevHash != prev.hash {
				return invalid(ln, "prev_hash breaks chain link (ES-25)")
			}
			if e.typ == "genesis" {
				return invalid(ln, "genesis only at seq 1 (ES-33)")
			}
		}

		// Hash recomputation (HA-14), Stage A, type-agnostic.
		if hashHex(preimage(e, "")) != e.hash {
			return invalid(ln, "hash mismatch (HA-14/ES-28)")
		}

		// Registry check (EV-6/EV-9): unregistered well-formed types defer
		// Stage B and mark the line PARTIAL — with the single exception of
		// `genesis` (EV-20).
		if !registered(e.typ, e.version) {
			if i == 0 {
				// EV-20: a chain's genesis MUST carry a (type, version) the
				// verifier registers; if it does not, the chain is INVALID at
				// line 1 and no VALID or PARTIAL verdict may follow. This is
				// the sole exception to EV-8 and a Stage A promotion for
				// genesis alone: with an unregistered genesis, operator_pk and
				// registrar_pk cannot be extracted at all, so EVERY later
				// signature is uncheckable and PARTIAL ("integrity confirmed,
				// some semantics unchecked") would announce success over a
				// chain on which nothing was ever authenticated.
				return invalid(1, unregisteredGenesisReason(e.version))
			}
			partial = append(partial, ln)
			prev = e
			continue
		}

		if reason, ok := stageB(st, e); !ok {
			return invalid(ln, reason)
		}
		prev = e
	}

	// --head check (EX-15), Stage A, after all link checks. INVALID outranks
	// PARTIAL (EV-17), so it is evaluated first. Attributed to the last line
	// (EX-19).
	if head != nil && *head != prev.hash {
		return invalid(len(lines), "head mismatch (EX-15/EX-19)")
	}

	if len(partial) > 0 {
		return Result{Verdict: PARTIAL, Lines: partial,
			Reason: "unregistered (type, version); Stage B not run"}
	}
	return Result{Verdict: VALID}
}

// stageB applies the per-type (registered) semantic checks. It returns
// (reason, false) on the first failure; reason is advisory.
func stageB(st *vstate, e *event) (string, bool) {
	switch e.typ {
	case "genesis":
		return stageBGenesis(st, e)
	case "participant_registered":
		return stageBParticipant(e)
	case "issue_created":
		return stageBIssue(st, e)
	case "vote_cast":
		return stageBVote(st, e)
	}
	return "unreachable", false
}

func stageBGenesis(st *vstate, e *event) (string, bool) {
	// ES-18 payload key set, as refined by ES-34: five required keys plus the
	// two OPTIONAL fork-ancestry keys, each either present with a legal value or
	// entirely absent. ES-18 is otherwise unchanged — any key outside this union
	// is still rejected.
	if !payloadKeySetAllows(e.payload,
		[]string{"chain_id", "contracts", "operator_pk", "registrar_pk", "sig"},
		[]string{"ancestor_chain", "ancestor_head"}) {
		return "genesis payload key set (ES-18/ES-34)", false
	}
	chainID := mustStr(e.payload, "chain_id")
	contracts := mustStr(e.payload, "contracts")
	operatorPK := mustStr(e.payload, "operator_pk")
	registrarPK := mustStr(e.payload, "registrar_pk")
	sig := mustStr(e.payload, "sig")

	// Formats: keys 64 lowercase hex (ET-6/ET-9b), chain_id 64 hex, sig 128 hex.
	if !isHex64(operatorPK) {
		return "operator_pk not 64 lowercase hex (ET-9b)", false
	}
	if !isHex64(registrarPK) {
		return "registrar_pk not 64 lowercase hex (ET-9b)", false
	}

	// ET-9d — the two genesis keys MUST be distinct. A genesis whose
	// `registrar_pk` is byte-identical to its `operator_pk` is INVALID at the
	// genesis line. The rule fixes the comparison precisely: it is on the two
	// 64-character lowercase-hex STRINGS, "after ET-9b has passed on both", so
	// it sits here, immediately after the two checks above and before any
	// decoding — one string equality, no key material, no decoding, no curve
	// arithmetic.
	//
	// The fault it blocks: one holder with the power to mint issues AND forge
	// every ballot on them, collapsing charter P2's two planes and P3's "never
	// selects" into one party — declared in the open, on line 1, where until
	// now the verifier answered VALID with nothing to signal it.
	//
	// NECESSARY, NOT SUFFICIENT, and it must not be read as more. Two distinct
	// keys can still be held by one party and no export can tell: nothing
	// distinguishes a genuinely separated registrar from an operator holding
	// both keypairs. This blocks only the blatant collapse — the declaration
	// visible in the log — and the sufficient version is undecidable from the
	// log. Custody stays policy (ET-9a). So nothing adjacent is checked here:
	// no other key pair, and no inference beyond this one equality.
	if registrarPK == operatorPK {
		return "registrar_pk is identical to operator_pk (ET-9d)", false
	}
	if !isHex64(chainID) {
		return "chain_id not 64 lowercase hex (ET-6)", false
	}
	if contracts == "" {
		return "contracts must be non-empty (ET-9)", false
	}
	if !isHex128(sig) {
		return "sig not 128 lowercase hex (ES-31)", false
	}

	// ET-9e / ET-9f — recorded fork ancestry. A genesis MAY record the chain it
	// was forked from with two OPTIONAL keys (ES-34): a NAME, `ancestor_chain`
	// (the parent's genesis hash, which per ET-7a is the only value that can name
	// a chain), and a POSITION on the chain that name identifies, `ancestor_head`
	// (the parent's head at the moment of the fork, EX-14).
	//
	// ET-9f is a pure key-PRESENCE test over the payload already parsed: no key
	// material, no decoding, no hashing, no curve arithmetic.
	ancChain, haveChain := payloadGet(e.payload, "ancestor_chain")
	ancHead, haveHead := payloadGet(e.payload, "ancestor_head")

	// The asymmetry below is the rule, not an oversight, and MUST NOT be
	// "tidied" into a both-or-neither pair (ET-9f):
	//   - `ancestor_head` alone is barred. It names a position on an UNNAMED
	//     chain — the head-alone anchoring charter §4 rejects (ET-7a) — and no
	//     reader can check it, because nothing in the payload says which export
	//     to open.
	//   - `ancestor_chain` alone is ACCEPTED. It is the weaker but coherent
	//     claim "forked from chain X, fork point unrecorded": a named chain, no
	//     position. Nothing below rejects it.
	//   - Both absent is the ordinary no-recorded-ancestor form (ES-34).
	if haveHead && !haveChain {
		return "ancestor_head present without ancestor_chain (ET-9f)", false
	}
	if haveChain {
		if ancChain.kind != kString || !isHex64(ancChain.str) {
			return "ancestor_chain not 64 lowercase hex (ET-9e)", false
		}
		if ancChain.str == zeros64 {
			return "ancestor_chain is the 64-zero anchor (ET-9e)", false
		}
	}
	if haveHead {
		if ancHead.kind != kString || !isHex64(ancHead.str) {
			return "ancestor_head not 64 lowercase hex (ET-9e)", false
		}
		if ancHead.str == zeros64 {
			return "ancestor_head is the 64-zero anchor (ET-9e)", false
		}
	}
	// Two checks are deliberately ABSENT here, and their absence is normative.
	//
	// 1. No comparison BETWEEN the two values. `ancestor_chain ==
	//    ancestor_head` is legal: on a parent chain holding only its genesis
	//    event, the head IS the genesis hash, so a fork taken at that instant
	//    records the same 64 hex characters twice. It is not a duplicate to
	//    reject, and ET-9e imposes no distinctness requirement.
	// 2. No resolution of either value. Both are a recorded CLAIM, not a
	//    verified link (ET-9e): the ancestor is a different export the verifier
	//    does not hold and cannot demand. It therefore cannot confirm that
	//    `ancestor_chain` is any chain's genesis hash, nor that `ancestor_head`
	//    is any chain's head, and it MUST NOT report INVALID because it cannot
	//    resolve either, nor treat an unresolvable value as a defect. Settling
	//    the claim is the reader's act, with both exports in hand.

	opBytes := hexToBytes(operatorPK)
	regBytes := hexToBytes(registrarPK)

	// ET-7: chain_id == sha256(operator_pk bytes).
	sum := sha256.Sum256(opBytes)
	if chainID != hex.EncodeToString(sum[:]) {
		return "chain_id not sha256(operator_pk) (ET-7)", false
	}

	// ET-9c: the ET-4b canonical-encoding and ET-4c prime-order checks apply to
	// registrar_pk HERE, at its genesis declaration — not deferred to its first
	// use at vote_cast (ET-17). operator_pk gets the same gates via the ET-8
	// self-sig verify below, but registrar_pk signs nothing at genesis, so a
	// declared-but-unused non-canonical or small/mixed-order registrar_pk must be
	// rejected here or a no-vote_cast chain would wrongly verify. ET-4c requires an
	// already-ET-4b-canonical key, so ET-4b runs first.
	if !checkKeyCanonical(regBytes) { // ET-4b
		return "registrar_pk non-canonical encoding (ET-4b/ET-9c)", false
	}
	if !checkKeyPrimeOrder(regBytes) { // ET-4c
		return "registrar_pk not prime-order (ET-4c/ET-9c)", false
	}

	// ET-8: self-signed by operator_pk, with ET-4a/ET-4b/ET-4c gates.
	if !verifyEd25519(opBytes, hexToBytes(sig), preimage(e, "sig")) {
		return "genesis signature invalid under operator_pk (ET-8)", false
	}

	st.opPK = opBytes
	st.regPK = regBytes
	st.haveKey = true
	return "", true
}

func stageBParticipant(e *event) (string, bool) {
	if !payloadKeySetEquals(e.payload, []string{"pubkey", "sig"}) {
		return "participant payload key set (ES-18)", false
	}
	pubkey := mustStr(e.payload, "pubkey")
	sig := mustStr(e.payload, "sig")
	if !isHex64(pubkey) {
		return "pubkey not 64 lowercase hex (ID-3)", false
	}
	if !isHex128(sig) {
		return "sig not 128 lowercase hex (ES-31)", false
	}
	// ET-10: self-signed (proof of possession) under pubkey.
	if !verifyEd25519(hexToBytes(pubkey), hexToBytes(sig), preimage(e, "sig")) {
		return "participant signature invalid under pubkey (ET-10)", false
	}
	return "", true
}

func stageBIssue(st *vstate, e *event) (string, bool) {
	if !st.haveKey {
		return "issue_created before usable genesis keys", false
	}
	if !payloadKeySetEquals(e.payload, []string{"ballot_batch_interval_ms", "ballot_batch_min", "choice_count", "sig", "title"}) {
		return "issue payload key set (ES-18)", false
	}
	titleV, _ := payloadGet(e.payload, "title")
	ccV, _ := payloadGet(e.payload, "choice_count")
	intervalV, _ := payloadGet(e.payload, "ballot_batch_interval_ms")
	minV, _ := payloadGet(e.payload, "ballot_batch_min")
	sig := mustStr(e.payload, "sig")

	if titleV.kind != kString {
		return "title must be a string (ET-14)", false
	}
	n := countScalars(titleV.str)
	if n < 1 || n > 200 {
		return "title length out of 1..200 scalars (ET-14)", false
	}
	if hasForbiddenTitleChar(titleV.str) {
		return "title has a C0 control or U+007F (ET-14)", false
	}
	if ccV.kind != kInt {
		return "choice_count must be an integer (ET-14a)", false
	}
	if ccV.ival < 2 || ccV.ival > 64 {
		return "choice_count out of 2..64 (ET-14a)", false
	}
	// ET-14b: the two ballot batching parameters are declared on the log, each a
	// canonical ES-5 integer at or above its permanent floor. The floors are what
	// stop "governable" meaning 1 and 1, which would satisfy every other sentence
	// while making the ET-23..ET-25 discipline decorative.
	if intervalV.kind != kInt {
		return "ballot_batch_interval_ms must be an integer (ET-14b)", false
	}
	if intervalV.ival < minBallotBatchIntervalMS {
		return "ballot_batch_interval_ms below the 60000 floor (ET-14b)", false
	}
	if minV.kind != kInt {
		return "ballot_batch_min must be an integer (ET-14b)", false
	}
	if minV.ival < minBallotBatchMin {
		return "ballot_batch_min below the 3 floor (ET-14b)", false
	}
	if !isHex128(sig) {
		return "sig not 128 lowercase hex (ES-31)", false
	}
	// ET-13: operator-signed.
	if !verifyEd25519(st.opPK, hexToBytes(sig), preimage(e, "sig")) {
		return "issue signature invalid under operator_pk (ET-13)", false
	}
	// ID-7: issue_id is this event's hash; record with its choice_count (ET-18a).
	st.issues[e.hash] = ccV.ival
	return "", true
}

func stageBVote(st *vstate, e *event) (string, bool) {
	if !st.haveKey {
		return "vote_cast before usable genesis keys", false
	}
	if !payloadKeySetEquals(e.payload, []string{"choice", "issue_id", "sig"}) {
		return "vote payload key set (ES-18)", false
	}
	issueID := mustStr(e.payload, "issue_id")
	choiceV, _ := payloadGet(e.payload, "choice")
	sig := mustStr(e.payload, "sig")

	if !isHex64(issueID) {
		return "issue_id not 64 lowercase hex (ID-8)", false
	}
	cc, known := st.issues[issueID]
	if !known {
		return "vote references unknown or forward issue (ET-18/ID-8)", false
	}
	if choiceV.kind != kInt {
		return "choice must be an integer (ET-19)", false
	}
	if choiceV.ival < 0 || choiceV.ival >= cc {
		return "choice out of [0, choice_count) (ET-18a)", false
	}
	if !isHex128(sig) {
		return "sig not 128 lowercase hex (ES-31)", false
	}
	// ET-17: registrar-signed.
	if !verifyEd25519(st.regPK, hexToBytes(sig), preimage(e, "sig")) {
		return "vote signature invalid under registrar_pk (ET-17)", false
	}
	return "", true
}

// mustStr returns a payload string value; callers use it only after the key set
// and value kinds are known good.
func mustStr(obj *jobject, key string) string {
	v, _ := payloadGet(obj, key)
	return v.str
}
