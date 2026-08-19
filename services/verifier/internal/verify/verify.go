// Package verify implements the standalone ODC export verifier defined by
// contracts/ (event-schema, hashing, event-types, export-format, ids,
// evolution). It reads a hash-chained NDJSON export and returns one of three
// verdicts — VALID, INVALID at a line, or PARTIAL naming lines — per
// evolution.md EV-7/EV-17.
package verify

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
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

// registered reports whether (typ, version) is in the contracts-v1 registry
// (ET-1/ET-2): the four v1 types, each only at version 1.
func registered(typ string, version int64) bool {
	if version != 1 {
		return false
	}
	switch typ {
	case "genesis", "participant_registered", "issue_created", "vote_cast":
		return true
	}
	return false
}

// registeredGenesisVersions lists the genesis versions this verifier registers,
// for the EV-21 reason text below.
var registeredGenesisVersions = []int64{1}

// unregisteredGenesisReason builds the advisory reason for an EV-20 rejection.
// EV-21 is SHOULD-level guidance and never conformance-checked (EV-17): the
// conformance surface here is the token INVALID and the line number 1. It asks
// only that the message not pick one of the two indistinguishable stories — "my
// registry is out of date for this chain" and "this genesis is corrupt or
// hostile" — since the log alone cannot separate them, and that it name the
// version encountered and the genesis versions registered so a reader can go
// and settle it.
func unregisteredGenesisReason(e *event) string {
	var b strings.Builder
	b.WriteString("unregistered genesis (EV-20): this export's line 1 is (")
	b.WriteString(e.typ)
	b.WriteString(", version ")
	b.WriteString(strconv.FormatInt(e.version, 10))
	b.WriteString("); this verifier registers genesis at version")
	if len(registeredGenesisVersions) != 1 {
		b.WriteString("s")
	}
	for i, v := range registeredGenesisVersions {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(" ")
		b.WriteString(strconv.FormatInt(v, 10))
	}
	b.WriteString(". From the log alone this verifier cannot tell whether it is " +
		"out of date for this chain or whether this genesis is corrupt or hostile; " +
		"compare the version above against the chain's published contracts version " +
		"to settle it (EV-21).")
	return b.String()
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
			// EV-20: a chain's genesis MUST carry a (type, version) this
			// verifier registers. At line 1 the ES-9/ES-11 registration check
			// is promoted into Stage A (EV-15) — the sole exception to EV-8 —
			// because an unregistered genesis yields no operator_pk and no
			// registrar_pk (ET-9a), so Stage B could not run anywhere on the
			// chain and a PARTIAL here would announce "integrity confirmed"
			// over a chain on which nothing was ever authenticated. The chain
			// therefore never reaches VALID or PARTIAL.
			if !registered(e.typ, e.version) {
				return invalid(ln, unregisteredGenesisReason(e))
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
		// Stage B and mark the line PARTIAL.
		if !registered(e.typ, e.version) {
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
	// ES-18 payload key set, with the one OPTIONAL key v1 defines (ES-34):
	// ancestor_head (ET-9e). OPTIONAL means "this defined key may be absent",
	// never "an undefined key may appear" — a key outside required ∪ optional is
	// still rejected.
	if !payloadKeySetMatches(e.payload,
		[]string{"chain_id", "contracts", "operator_pk", "registrar_pk", "sig"},
		[]string{"ancestor_head"}) {
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
	// ET-9d: the two declared keys MUST be distinct. One string equality on the
	// two lowercase-hex strings, after ET-9b has passed on both — no decoding
	// and no curve arithmetic. A chain declaring one key twice hands a single
	// holder both the power to mint issues and the power to forge every ballot
	// on them; the check is necessary, not sufficient (two distinct keys can
	// still be held by one party, and the log cannot tell).
	if registrarPK == operatorPK {
		return "registrar_pk is byte-identical to operator_pk (ET-9d)", false
	}
	if !isHex64(chainID) {
		return "chain_id not 64 lowercase hex (ET-6)", false
	}
	if contracts == "" {
		return "contracts must be non-empty (ET-9)", false
	}
	// ET-9e: ancestor_head, when present, is 64 lowercase hex and never the
	// 64-zero anchor (which keeps its single meaning as prev_hash's anchor,
	// ES-24; a chain with no ancestor omits the key entirely, ES-34). It is a
	// recorded claim, not a verified link: the ancestor is a different export
	// this verifier does not hold, so nothing beyond the format is checked and
	// an unresolvable value is never a defect.
	if v, present := payloadGet(e.payload, "ancestor_head"); present {
		if v.kind != kString {
			return "ancestor_head must be a string (ET-9e)", false
		}
		if !isHex64(v.str) {
			return "ancestor_head not 64 lowercase hex (ET-9e)", false
		}
		if v.str == zeros64 {
			return "ancestor_head must not be the 64-zero anchor (ET-9e/ES-24)", false
		}
	}
	if !isHex128(sig) {
		return "sig not 128 lowercase hex (ES-31)", false
	}

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
