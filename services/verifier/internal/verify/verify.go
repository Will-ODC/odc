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
// v1 types, each registered only at version 1. It is the single source of
// truth for the accept/reject decision (registered).
var registry = map[string][]int64{
	"genesis":                {1},
	"participant_registered": {1},
	"issue_created":          {1},
	"vote_cast":              {1},
}

// unregisteredGenesisReason builds the advisory reason text for an EV-20
// rejection. Reason text is never conformance-checked (EV-17) — conformance
// here is the token INVALID and the line number 1, and nothing else.
//
// EV-21 (evolution.md v8) is the guidance followed here. `genesis` has no
// version but 1, in this contracts version and every later one (ET-6 pins it;
// ET-9e records that nothing reopens the genesis payload). So a genesis at any
// other version is never a legitimate chain newer than this verifier, and a
// newer verifier would reject it the same way. The text therefore names the
// version found, says the chain is corrupt, hostile or not an ODC chain, and
// deliberately does NOT suggest fetching a newer verifier: no newer verifier
// registers another genesis version, so that advice would send the reader
// looking for a remedy that does not exist.
func unregisteredGenesisReason(version int64) string {
	return fmt.Sprintf(
		"genesis at version %d (EV-20); genesis has no version but 1 (ET-6), "+
			"so this chain is corrupt, hostile, or not an ODC chain (EV-21)",
		version)
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

// maxContractsBytes is ET-9's bound on `genesis.contracts`, in bytes of the
// decoded string's UTF-8 encoding (event-types.md v14).
const maxContractsBytes = 64

// Permanent floors on the issue_created ballot batching parameters (ET-14b).
// The values above the floors are per-issue and votable; that a floor exists is
// permanent (register of ET-22 / EV-13).
const (
	minBallotBatchIntervalMS int64 = 60000
	minBallotBatchMin        int64 = 3
)

// vstate carries chain-wide facts gathered during Stage B.
type vstate struct {
	opPK    []byte                // genesis operator_pk, decoded (ET-8/ET-13)
	regPK   []byte                // genesis registrar_pk, decoded (ET-17)
	haveKey bool                  // genesis keys captured
	issues  map[string]*issueInfo // issue_created hash -> tracked facts (ID-7/ET-18a/ET-14b)
	ballots ballotState           // opaque ballots, for ET-24b

	// opaqueIssues holds the hash of every issue_created at an unregistered
	// version: still a prior issue_created for ID-8/ET-18 (ET-18b). Only its
	// envelope is read, never its payload (EV-15).
	opaqueIssues map[string]struct{}

	// unresolved is set by Stage B on a registered vote_cast with a check
	// ET-18b or ET-24b leaves unresolved: not failed, but the line is
	// enumerated in PARTIAL (EV-7, EV-17).
	unresolved bool
}

// Options carries the optional out-of-band expectations a run may be given.
// Each, when non-nil, is an already-validated 64-lowercase-hex string.
type Options struct {
	Head  *string // expected head, `--head` (EX-15)
	Chain *string // expected genesis hash / chain identity, `--chain` (EX-22)
}

// Verify runs the whole two-stage verification (EV-6). head, when non-nil, is a
// validated 64-lowercase-hex expected chain head (EX-15).
func Verify(data []byte, head *string) Result {
	return VerifyWith(data, Options{Head: head})
}

// VerifyWith runs the whole two-stage verification (EV-6) with the optional
// `--head` (EX-15) and `--chain` (EX-22) expectations.
func VerifyWith(data []byte, opts Options) Result {
	head, chain := opts.Head, opts.Chain
	st := &vstate{issues: map[string]*issueInfo{}, ballots: newBallotState(),
		opaqueIssues: map[string]struct{}{}}
	lines, faults := frame(data)

	// An empty export verified as a chain is INVALID at line 1: it has no
	// genesis (EX-6/EX-18/ES-33).
	if len(lines) == 0 {
		return invalid(1, "empty export: no genesis (EX-18)")
	}

	var prev *event
	var genesisHash string // line 1's stored hash (EX-21), once line 1 parses
	var partial []int

	for i := range lines {
		ln := i + 1

		// Framing violations are Stage A, attributed to this line (EX-20).
		if reason, bad := faults[ln]; bad {
			return invalid(ln, "framing: "+reason)
		}

		obj, ok, tooDeep := parseLine(lines[i])
		if tooDeep {
			// EV-24: this verifier's depth limit (64, the EV-23 minimum) was
			// reached. A limit above 2 establishes INVALID at this line, and
			// no earlier line was fatal or we would have returned already.
			return invalid(ln, fmt.Sprintf(
				"nesting deeper than %d, this verifier's limit (EV-23/EV-24); "+
					"any line deeper than 2 is INVALID (ES-15/ES-17, EV-16)", maxParseDepth))
		}
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

		if i == 0 {
			genesisHash = e.hash
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
			// Envelope-only facts later registered checks depend on (EV-15:
			// ET-18b and ET-24b read the envelope of an unregistered event,
			// never its payload, and never make it INVALID).
			switch e.typ {
			case "issue_created":
				st.opaqueIssues[e.hash] = struct{}{} // ET-18b
			case "vote_cast":
				st.ballots.opaqueBallot(e.seq, tsMillis(e.ts)) // ET-24b item 1
			}
			partial = append(partial, ln)
			prev = e
			continue
		}

		st.unresolved = false
		if reason, ok := stageB(st, e); !ok {
			return invalid(ln, reason)
		}
		if st.unresolved {
			// EV-17: every registered vote_cast line with a check ET-18b or
			// ET-24b leaves unresolved. Lines are visited once, in order, so
			// the list stays ascending without duplicates.
			partial = append(partial, ln)
		}
		prev = e
	}

	// --chain (EX-22) and --head (EX-15) checks, Stage A, run at the same
	// point: after every other file-validity check has passed — framing, each
	// event's structural checks and every registered event's semantic checks
	// (EX-15/EX-22 v5) — i.e. only when the export would otherwise be VALID or
	// PARTIAL. An INVALID already established by a file check has returned
	// above with its own line and is never replaced by either anchor. Unknown
	// events yielding PARTIAL do not prevent the comparison, and INVALID
	// outranks PARTIAL (EV-17), so both run before the PARTIAL verdict.
	//
	// Precedence when BOTH mismatch on an eligible file: the --chain mismatch
	// at line 1 (EX-23) is reported, not the --head mismatch at the last line
	// (EX-19) — EX-23 v5 says so explicitly. (On a one-line export both name
	// line 1 anyway.)
	if chain != nil && *chain != genesisHash {
		return invalid(1, "chain mismatch: genesis hash differs from --chain (EX-22/EX-23)")
	}

	// --head: attributed to the last line (EX-19).
	if head != nil && *head != prev.hash {
		return invalid(len(lines), "head mismatch (EX-15/EX-19)")
	}

	if len(partial) > 0 {
		return Result{Verdict: PARTIAL, Lines: partial,
			Reason: "these lines could not be fully checked: each is an event at a (type, version) this verifier does not register, or a ballot whose checks depend on such an event (EV-7, ET-18b, ET-24b)"}
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
	// ET-9 — `contracts` is a non-empty string of at most 64 bytes, counted
	// on the UTF-8 encoding of the DECODED value: the string after JSON
	// unescaping, the same value HA-2 hashes, never the escaped bytes on the
	// line (EX-9). The parser has already unescaped it and checked it is valid
	// UTF-8, so len() of the decoded Go string is exactly that count — an
	// escaped control character such as `\u0001` (six bytes on the line) counts
	// as one, and a four-byte scalar counts as four (bytes, not scalars: ET-9
	// is not ET-14). The bound exists to bound the line (EV-25).
	if v, _ := payloadGet(e.payload, "contracts"); v.kind != kString {
		return "contracts is not a string (ET-9)", false
	} else if len(v.str) == 0 {
		return "contracts must be non-empty (ET-9)", false
	} else if len(v.str) > maxContractsBytes {
		return fmt.Sprintf("contracts is %d bytes decoded; at most %d allowed (ET-9)",
			len(v.str), maxContractsBytes), false
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
	// ID-7: issue_id is this event's hash; record with its choice_count
	// (ET-18a) and the ET-14b batching parameters ET-23/ET-24 read.
	st.issues[e.hash] = &issueInfo{choiceCount: ccV.ival,
		intervalMS: intervalV.ival, batchMin: minV.ival, seq: e.seq}
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
	iss, known := st.issues[issueID]
	_, opaqueIssue := st.opaqueIssues[issueID]
	if !known && !opaqueIssue {
		return "vote references unknown or forward issue (ET-18/ID-8)", false
	}
	if choiceV.kind != kInt {
		return "choice must be an integer (ET-19)", false
	}
	if opaqueIssue {
		// ET-18b: the issue_created is at a version this verifier does not
		// register. It is still a prior issue_created, so ET-18 passes;
		// choice_count and both batching parameters are unreadable, so
		// ET-18a, ET-23, ET-24 and ET-24a are unresolved — never INVALID on
		// that ground. Every other check (ES-18 above, ET-19 above, ET-17
		// below) applies as usual. The ballot is no registered ballot of any
		// issue for ET-24b, and no candidate either: it is not opaque.
		if !isHex128(sig) {
			return "sig not 128 lowercase hex (ES-31)", false
		}
		if !verifyEd25519(st.regPK, hexToBytes(sig), preimage(e, "sig")) {
			return "vote signature invalid under registrar_pk (ET-17)", false
		}
		st.unresolved = true
		return "", true
	}
	if choiceV.ival < 0 || choiceV.ival >= iss.choiceCount {
		return "choice out of [0, choice_count) (ET-18a)", false
	}
	if !isHex128(sig) {
		return "sig not 128 lowercase hex (ES-31)", false
	}
	// ET-17: registrar-signed.
	if !verifyEd25519(st.regPK, hexToBytes(sig), preimage(e, "sig")) {
		return "vote signature invalid under registrar_pk (ET-17)", false
	}
	// ET-23: the ballot's ts, as a millisecond offset from the epoch, MUST be
	// an exact multiple of its issue's declared interval. This is a test of the
	// VALUE of ts only; nothing is ordered or selected by it (ES-21).
	tsMS := tsMillis(e.ts)
	if tsMS%iss.intervalMS != 0 {
		return "ts is not a multiple of the issue's ballot_batch_interval_ms (ET-23)", false
	}
	// ET-24 / ET-24a, as ET-24b qualifies them beside opaque ballots: both
	// rules are decided at this ballot's own line. A change of ts closes the
	// previous run for good (ET-24a), so an under-size run is proven not-last
	// exactly here (ET-24) unless candidates could have filled it, and a ts
	// equal to an instant this issue already used is a return (ET-24a).
	switch out, reason := iss.observe(&st.ballots, e.seq, tsMS); out {
	case batchFail:
		return reason, false
	case batchUnresolved:
		st.unresolved = true
	}
	return "", true
}

// mustStr returns a payload string value; callers use it only after the key set
// and value kinds are known good.
func mustStr(obj *jobject, key string) string {
	v, _ := payloadGet(obj, key)
	return v.str
}
