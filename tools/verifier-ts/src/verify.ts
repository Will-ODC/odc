// Whole-export verifier: framing (export-format.md), two-stage per-event checks
// (evolution.md EV-6/EV-15), and the three-verdict report surface (EV-7/EV-17).
//
// Verdict precedence: INVALID > PARTIAL > VALID. INVALID names the first fatal
// line in file order; PARTIAL enumerates the unregistered-but-well-formed lines
// and the registered `vote_cast` lines with a check that event-types.md ET-18b
// or ET-24b leaves unresolved (EV-7, EV-17 v7).

import { createHash } from "node:crypto";
import {
  parseEventLine,
  type ParsedEvent,
  type PayloadEntry,
} from "./parse.js";
import { computeHash, signingPreimage } from "./hashing.js";
import { excerpt } from "./report.js";
import {
  ed25519Verify,
  isCanonicalKeyEncoding,
  isCanonicalSigEncoding,
  isPrimeOrderKey,
} from "./crypto.js";
import { BallotBatches, epochMs, isQuantized } from "./batching.js";
import {
  CHUNK_SHIFT,
  ChunkedList,
  SHARD_CAP,
  ShardedMap,
  ShardedSet,
} from "./collections.js";
import {
  LimitReached,
  MAX_LINE_BYTES,
  recordsOf,
  type InputRecord,
} from "./input.js";

export type Verdict =
  | { verdict: "VALID" }
  | { verdict: "INVALID"; line: number; reason?: string }
  | { verdict: "PARTIAL"; lines: LineNumbers };

/**
 * PARTIAL's affected lines, ascending. A plain array satisfies it, and so does
 * the verifier's ChunkedList, which has no length cap: EV-24 forbids a fixed
 * limit on the number of lines, and an array stops at 2^26 elements.
 */
export interface LineNumbers extends Iterable<number> {
  readonly length: number;
  slice(start: number, end: number): number[];
  join(sep: string): string;
}

const GENESIS_PREV = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const CR = 0x0d;

// The v1 registry: only these (type, version) pairs get Stage B (EV-6).
const REGISTERED = new Map<string, number>([
  ["genesis", 1],
  ["participant_registered", 1],
  ["issue_created", 1],
  ["vote_cast", 1],
]);

function isRegistered(type: string, version: number): boolean {
  return REGISTERED.get(type) === version;
}

// `genesis` payload keys (event-types.md §genesis table, ES-18 / ES-34).
const GENESIS_REQUIRED_KEYS = [
  "chain_id",
  "contracts",
  "operator_pk",
  "registrar_pk",
  "sig",
] as const;
// Both OPTIONAL, and the only two optional keys v1 defines (ES-34, ET-9e).
const GENESIS_OPTIONAL_KEYS = ["ancestor_chain", "ancestor_head"] as const;

// Chain state accumulated across lines for Stage B reference checks.
interface ChainState {
  operatorPk: Buffer | null; // raw 32 bytes, validated at genesis
  registrarPk: Buffer | null; // raw 32 bytes, validated at genesis
  issues: ShardedMap<string, IssueParams>; // issue_id (hash) -> its declared parameters
  // ET-18b: hashes of `issue_created` events at a version this verifier does
  // not register. Still prior issue_created events for ID-8/ET-18; only their
  // envelope (`type`, `version`, `seq`, `hash`) is read, never the payload.
  unregisteredIssues: ShardedSet<string>;
  batches: BallotBatches; // ET-24 / ET-24a / ET-24b per-issue batch runs
  // Set by stageB when the line passed but a check on it is UNRESOLVED
  // (ET-18b, ET-24b): not failed, and the line is enumerated in PARTIAL.
  unresolved: boolean;
  // Advisory reason for the rule a failing Stage B line broke, where it is more
  // specific than the generic one (set for ET-24 / ET-24a only).
  stageBReason: string | null;
}

// What a vote_cast needs from its issue_created (ET-18a, ET-23; ET-24's
// minimum lives in `batches`).
interface IssueParams {
  choiceCount: number;
  batchIntervalMs: number;
}

// Look a payload key up. Returns undefined if absent.
function field(ev: ParsedEvent, key: string): PayloadEntry | undefined {
  return ev.payload.find((e) => e.key === key);
}

// Exact key-set match for ES-18 (payload key set fixed per (type, version)).
function keysExactly(ev: ParsedEvent, expected: string[]): boolean {
  if (ev.payload.length !== expected.length) return false;
  const have = new Set(ev.payload.map((e) => e.key));
  return expected.every((k) => have.has(k));
}

/**
 * ES-18 + ES-34 key-set check for a type that declares OPTIONAL keys: every
 * required key present, every present key defined for the (type, version), and
 * no key outside that union. ES-34 is explicit that OPTIONAL widens *which
 * defined keys may be absent*, never *which keys may appear* — an undefined key
 * is still rejected. The parser has already ruled out duplicates (HA-6) and
 * `null` values (ES-3), so presence here means "present with a scalar value".
 */
function keysWithin(
  ev: ParsedEvent,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const allowed = new Set<string>([...required, ...optional]);
  for (const e of ev.payload) if (!allowed.has(e.key)) return false;
  const have = new Set(ev.payload.map((e) => e.key));
  return required.every((k) => have.has(k));
}

// ES-24's anchor string. ET-9e bars it as an `ancestor_*` value so the 64-zero
// string keeps its single meaning (one meaning, one representation — D5).
const ZERO64 = "0".repeat(64);

/**
 * ET-9e format gate for one `ancestor_*` value: 64 lowercase hex, and never the
 * 64-zero anchor. Nothing else — ET-9e is emphatic that the verifier does NOT
 * resolve either value (it does not hold the ancestor export and cannot demand
 * it), and MUST NOT report INVALID because a value is unresolvable.
 */
function ancestorValueOk(v: string | null): boolean {
  return v !== null && HEX64.test(v) && v !== ZERO64;
}

function strField(ev: ParsedEvent, key: string): string | null {
  const f = field(ev, key);
  if (!f || f.val.kind !== "str") return null;
  return f.val.value;
}

function intField(ev: ParsedEvent, key: string): number | null {
  const f = field(ev, key);
  if (!f || f.val.kind !== "int") return null;
  return f.val.value;
}

/**
 * ET-9 (event-types.md v14): `contracts` is 1 to 64 BYTES, counted as the
 * UTF-8 encoding of the DECODED value — after JSON unescaping, the value HA-2
 * hashes — never the escaped bytes on the line. So `\u0001` (six line bytes)
 * counts once, and so does `\n`; a four-byte character counts four.
 *
 * `Buffer.byteLength(_, "utf8")`, not `.length`: a JS string is UTF-16, so
 * `.length` counts code units — 2 for a four-byte character, 1 for a
 * three-byte one — and would let a 64-character string of 4-byte characters
 * (256 bytes) through. The value came out of the strict UTF-8 parser, which
 * admits no lone surrogate, so the UTF-8 re-encoding is exact.
 */
const CONTRACTS_MAX_BYTES = 64;
function contractsOk(contracts: string): boolean {
  const n = Buffer.byteLength(contracts, "utf8");
  return n >= 1 && n <= CONTRACTS_MAX_BYTES;
}

function titleOk(title: string): boolean {
  // Iterating a string yields Unicode scalar values (NOT UTF-16 code units), so
  // an astral character counts as one — ET-14 counts scalar values (fixtures
  // 072/073). A `.length`-based check (code units) would fail those.
  const scalars = [...title];
  if (scalars.length < 1 || scalars.length > 200) return false; // ET-14
  for (const ch of scalars) {
    const cp = ch.codePointAt(0) as number;
    if (cp <= 0x1f || cp === 0x7f) return false; // C0 controls + U+007F (ET-14)
  }
  return true;
}

/**
 * Stage B for a registered (type, version). Returns true if the event passes all
 * type-specific semantic checks; false (INVALID) otherwise. Mutates `state` for
 * genesis (keys) and issue_created (issue registry) on success.
 */
function stageB(ev: ParsedEvent, state: ChainState): boolean {
  switch (ev.type) {
    case "genesis": {
      // ES-18 + ES-34: five required keys, two OPTIONAL ancestry keys.
      if (!keysWithin(ev, GENESIS_REQUIRED_KEYS, GENESIS_OPTIONAL_KEYS))
        return false;

      // --- ET-9e / ET-9f: recorded fork ancestry -----------------------------
      // Presence is read from the payload the parser already holds; ET-9f is a
      // pure key-presence test — no key material, no decoding, no hashing.
      const hasAncestorChain = field(ev, "ancestor_chain") !== undefined;
      const hasAncestorHead = field(ev, "ancestor_head") !== undefined;

      // ET-9f: a head without a chain names a position on an UNNAMED chain —
      // the head-alone anchoring charter §4 rejects (ET-7a). The converse is
      // deliberately permitted: `ancestor_chain` alone is the weaker but
      // coherent claim "forked from chain X, fork point unrecorded". This
      // asymmetry is the rule; it MUST NOT be tidied into both-or-neither.
      if (hasAncestorHead && !hasAncestorChain) return false; // ET-9f

      if (hasAncestorChain) {
        if (!ancestorValueOk(strField(ev, "ancestor_chain"))) return false;
      }
      if (hasAncestorHead) {
        if (!ancestorValueOk(strField(ev, "ancestor_head"))) return false;
      }
      // NOTE: `ancestor_chain === ancestor_head` is LEGAL and is deliberately
      // not rejected. A fork taken from a parent that held only its genesis
      // event has a head equal to that genesis hash, so the name and the
      // position coincide. Nothing in ET-9e/ET-9f distinguishes them, and both
      // values are a recorded claim the verifier does not resolve.

      const chainId = strField(ev, "chain_id");
      const contracts = strField(ev, "contracts");
      const opHex = strField(ev, "operator_pk");
      const regHex = strField(ev, "registrar_pk");
      const sigHex = strField(ev, "sig");
      if (chainId === null || !HEX64.test(chainId)) return false;
      if (contracts === null || !contractsOk(contracts)) return false; // ET-9
      if (opHex === null || !HEX64.test(opHex)) return false; // ET-9b
      if (regHex === null || !HEX64.test(regHex)) return false; // ET-9b

      // ET-9d: the two genesis keys MUST be distinct. A genesis whose
      // registrar_pk is byte-identical to its operator_pk is INVALID at the
      // genesis line — one holder would otherwise be able to mint issues AND
      // forge every ballot on them, collapsing charter P2's two planes into one
      // party, with nothing else on the line to signal it.
      //
      // The rule fixes both the operand and the position: the comparison is on
      // the two 64-character lowercase-hex strings AFTER ET-9b has passed on
      // both, so it sits here rather than after Buffer.from(..., "hex") below.
      // One string equality — no key material, no decoding, no curve
      // arithmetic.
      //
      // Necessary, not sufficient, and deliberately not read as more: two
      // distinct keys can still be held by one party and the log cannot tell.
      // ET-9d blocks only the blatant collapse that is visible in the log, so
      // no further distinctness check belongs here.
      if (opHex === regHex) return false; // ET-9d
      if (sigHex === null || !HEX128.test(sigHex)) return false;

      const opRaw = Buffer.from(opHex, "hex");
      const regRaw = Buffer.from(regHex, "hex");
      const sig = Buffer.from(sigHex, "hex");

      // ET-4b/ET-4c apply to BOTH keys at the genesis declaration line (ET-9c),
      // even on a chain with no vote_cast that never uses registrar_pk.
      if (!isCanonicalKeyEncoding(opRaw) || !isPrimeOrderKey(opRaw))
        return false;
      if (!isCanonicalKeyEncoding(regRaw) || !isPrimeOrderKey(regRaw))
        return false;

      // ET-7: chain_id = sha256(operator_pk raw bytes), lowercase hex.
      const derived = computeSha256Hex(opRaw);
      if (chainId !== derived) return false;

      // ET-4a on sig, then ET-8: self-signed by operator_pk.
      if (!isCanonicalSigEncoding(sig)) return false;
      if (!ed25519Verify(signingPreimage(ev), sig, opRaw)) return false;

      state.operatorPk = opRaw;
      state.registrarPk = regRaw;
      return true;
    }

    case "participant_registered": {
      if (!keysExactly(ev, ["pubkey", "sig"])) return false; // ES-18
      const pubHex = strField(ev, "pubkey");
      const sigHex = strField(ev, "sig");
      if (pubHex === null || !HEX64.test(pubHex)) return false; // ID-3
      if (sigHex === null || !HEX128.test(sigHex)) return false;
      const pub = Buffer.from(pubHex, "hex");
      const sig = Buffer.from(sigHex, "hex");
      if (!isCanonicalKeyEncoding(pub) || !isPrimeOrderKey(pub)) return false; // ET-4b/4c
      if (!isCanonicalSigEncoding(sig)) return false; // ET-4a
      if (!ed25519Verify(signingPreimage(ev), sig, pub)) return false; // ET-10
      return true;
    }

    case "issue_created": {
      if (
        !keysExactly(ev, [
          "ballot_batch_interval_ms",
          "ballot_batch_min",
          "choice_count",
          "sig",
          "title",
        ])
      )
        return false; // ES-18
      const title = strField(ev, "title");
      const choiceCount = intField(ev, "choice_count");
      const batchIntervalMs = intField(ev, "ballot_batch_interval_ms");
      const batchMin = intField(ev, "ballot_batch_min");
      const sigHex = strField(ev, "sig");
      if (title === null || !titleOk(title)) return false; // ET-14
      if (choiceCount === null || choiceCount < 2 || choiceCount > 64)
        return false; // ET-14a
      // ET-14b: both keys MUST be integers (ES-5 canonical form, enforced by the
      // parser) at or above their permanent floors. intField yields null for a
      // string-valued key, which is itself a rejection.
      if (batchIntervalMs === null || batchIntervalMs < 60000) return false; // ET-14b
      if (batchMin === null || batchMin < 3) return false; // ET-14b
      if (sigHex === null || !HEX128.test(sigHex)) return false;
      const sig = Buffer.from(sigHex, "hex");
      const op = state.operatorPk;
      if (op === null) return false; // no genesis operator key (unreachable on a valid chain)
      if (!isCanonicalSigEncoding(sig)) return false; // ET-4a
      if (!ed25519Verify(signingPreimage(ev), sig, op)) return false; // ET-13
      // issue_id is this event's hash (ID-7); track choice_count for ET-18a,
      // the interval for ET-23 and the minimum for ET-24. A hash collision is
      // impossible on a chain that passed HA-14 and ES-25, so `set` never
      // overwrites a live issue.
      state.issues.set(ev.hash, { choiceCount, batchIntervalMs });
      state.batches.openIssue(ev.hash, ev.seq, batchIntervalMs, batchMin);
      return true;
    }

    case "vote_cast": {
      if (!keysExactly(ev, ["choice", "issue_id", "sig"])) return false; // ES-18
      const issueId = strField(ev, "issue_id");
      const choice = intField(ev, "choice");
      const sigHex = strField(ev, "sig");
      if (issueId === null || !HEX64.test(issueId)) return false;
      if (choice === null) return false;
      if (sigHex === null || !HEX128.test(sigHex)) return false;
      // ET-18/ID-8: must reference a prior issue_created (strictly lower seq).
      const issue = state.issues.get(issueId);
      if (issue === undefined) {
        // ET-18b: an issue_created at a version this verifier does not
        // register is still a prior issue_created, so this is not an ET-18
        // failure. Its choice_count, interval and minimum are unreadable, so
        // ET-18a, ET-23, ET-24 and ET-24a are UNRESOLVED; every other check
        // (ES-18 above, ET-19's integer above, ET-17 here) applies as usual.
        // The ballot is not a registered ballot of any issue for ET-24b and
        // not a candidate either, so it never reaches `batches`.
        if (!state.unregisteredIssues.has(issueId)) return false; // ET-18
        const sig = Buffer.from(sigHex, "hex");
        const reg = state.registrarPk;
        if (reg === null) return false;
        if (!isCanonicalSigEncoding(sig)) return false; // ET-4a
        if (!ed25519Verify(signingPreimage(ev), sig, reg)) return false; // ET-17
        state.unresolved = true;
        return true;
      }
      if (choice < 0 || choice >= issue.choiceCount) return false; // ET-18a
      // ET-23: ts (already calendar-valid, ES-20) must be an exact multiple of
      // the issue's declared interval, in epoch ms. The value is checked; it
      // orders and selects nothing (ES-21).
      const instant = epochMs(ev.ts);
      if (!isQuantized(instant, issue.batchIntervalMs)) {
        state.stageBReason =
          "ET-23: this ballot's ts is not an exact multiple of its issue's ballot_batch_interval_ms";
        return false;
      }
      const sig = Buffer.from(sigHex, "hex");
      const reg = state.registrarPk;
      if (reg === null) return false;
      if (!isCanonicalSigEncoding(sig)) return false; // ET-4a
      if (!ed25519Verify(signingPreimage(ev), sig, reg)) return false; // ET-17
      // ET-24 / ET-24a, decided under ET-24b (event-types.md v12). A definite
      // failure is decided at THIS ballot: it is either the ballot that ends
      // an under-size batch (ET-24's fatal line) or a ballot returning to an
      // instant its issue has left (ET-24a: "at the line of the returning
      // ballot"). An unresolved check is not a failure; the line goes into
      // PARTIAL. Run last, so a ballot failing any other check never touches
      // the batch state.
      const batchFault = state.batches.admit(issueId, ev.seq, instant);
      if (batchFault === "unresolved") {
        state.unresolved = true;
        return true;
      }
      if (batchFault === "ET-24") {
        state.stageBReason =
          "ET-24: this ballot ends an earlier batch of its issue that holds fewer than the issue's ballot_batch_min ballots";
        return false;
      }
      if (batchFault === "ET-24a") {
        state.stageBReason =
          "ET-24a: this ballot returns to a batch instant its issue has already left";
        return false;
      }
      return true;
    }

    default:
      // Unreachable: only registered types reach stageB.
      return false;
  }
}

function computeSha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// A fatal line, with the advisory reason EV-17 SHOULD accompany INVALID with.
// The reason is NEVER conformance-checked (EV-17); only the token and the line
// number are. It is rendered single-line and length-bounded by `oneLine` in
// report.ts; values read out of the export go through `excerpt` before they are
// interpolated here.
interface Fault {
  line: number;
  reason: string;
}

/**
 * Verifies an export one record at a time, in file order.
 *
 * Every check on line N reads only line N and what earlier lines left in the
 * chain state, so the first line with any failed check is EV-17's fatal line
 * and verification stops there: nothing later can change an established
 * INVALID (the anchors are compared only when no file check failed, EX-15 /
 * EX-22). Nothing about the export is held but that state, and every part of
 * the state that grows with the number of lines — the issue maps, the PARTIAL
 * list and BallotBatches' collections — is a ShardedMap, ShardedSet or
 * ChunkedList (collections.ts), which V8's Map/Set/array caps do not bound.
 * So the number of lines and the size of the input are bounded only by
 * memory and time (EV-24).
 */
export class ExportVerifier {
  private fault: Fault | null = null;
  private lineNo = 0;
  private readonly partialLines: ChunkedList;
  private readonly state: ChainState;
  private prevHash: string | null = null;
  private genesisHash: string | null = null; // EX-21: line 1's hash, once it passed

  /** `caps` lowers the collections' shard and chunk sizes, for tests only. */
  constructor(
    private readonly head?: string,
    private readonly chain?: string,
    caps: { shardCap: number; chunkShift: number } = {
      shardCap: SHARD_CAP,
      chunkShift: CHUNK_SHIFT,
    },
  ) {
    this.partialLines = new ChunkedList(caps.chunkShift);
    this.state = {
      operatorPk: null,
      registrarPk: null,
      issues: new ShardedMap(caps.shardCap),
      unregisteredIssues: new ShardedSet(caps.shardCap),
      batches: new BallotBatches(caps.shardCap, caps.chunkShift),
      unresolved: false,
      stageBReason: null,
    };
  }

  /** How many built-ins hold each growing collection; for tests. */
  shardCounts(): {
    issues: number;
    unregisteredIssues: number;
    partialLines: number;
    batches: ReturnType<BallotBatches["shardCounts"]>;
  } {
    return {
      issues: this.state.issues.shardCount,
      unregisteredIssues: this.state.unregisteredIssues.shardCount,
      partialLines: this.partialLines.chunkCount,
      batches: this.state.batches.shardCounts(),
    };
  }

  /** True once a fatal line is found; later records cannot change the verdict. */
  get decided(): boolean {
    return this.fault !== null;
  }

  /**
   * Take the next record. Throws `LimitReached` for a record past this
   * verifier's line limit when no earlier line has decided the verdict: that
   * is EV-24's tool-level failure, never a chain verdict.
   */
  push(rec: InputRecord): void {
    if (this.fault !== null) return;
    this.lineNo++;
    if (rec.overLimit) {
      throw new LimitReached(
        `EV-24: line ${this.lineNo} is longer than this verifier's limit of ${MAX_LINE_BYTES} bytes, ` +
          "and no earlier line decided the verdict",
      );
    }
    const reason = this.check(rec.bytes, rec.terminated);
    if (reason !== null) this.fault = { line: this.lineNo, reason };
  }

  /** The chain verdict, once every record has been pushed (or one decided it). */
  finish(): Verdict {
    if (this.fault !== null) {
      return {
        verdict: "INVALID",
        line: this.fault.line,
        reason: this.fault.reason,
      };
    }
    // EX-6/EX-18: an empty export is a well-formed export but NOT a valid
    // chain; the missing genesis is attributed to line 1.
    if (this.lineNo === 0) {
      return {
        verdict: "INVALID",
        line: 1,
        reason: "EX-6/EX-18: empty export — no genesis event",
      };
    }

    // EX-22/EX-23 (--chain) and EX-15/EX-19 (--head), export-format.md v5: the
    // two out-of-band anchors are compared at the SAME point and under the
    // SAME condition — only after every other file-validity check has passed
    // (framing, each event's structural checks and every registered event's
    // semantic checks, EV-6), i.e. only here, with no fault found. Unknown
    // events yielding PARTIAL do not prevent the comparison, so either anchor
    // can turn a VALID or a PARTIAL verdict into INVALID (INVALID outranks
    // PARTIAL, EV-17). Neither can replace an INVALID a file check already
    // established: that verdict keeps its original line (EX-15, EX-22), and
    // returned above.
    //
    // Both mismatch: EX-23 requires the chain mismatch at line 1, not the head
    // mismatch at the last line, so --chain is compared first.
    if (this.chain !== undefined && this.genesisHash !== this.chain) {
      return {
        verdict: "INVALID",
        line: 1,
        reason:
          "EX-22/EX-23: genesis hash does not match the --chain value supplied out of band",
      };
    }
    if (this.head !== undefined && this.prevHash !== this.head) {
      return {
        verdict: "INVALID",
        line: this.lineNo,
        reason:
          "EX-15/EX-19: chain head does not match the --head value supplied out of band",
      };
    }
    if (this.partialLines.length > 0) {
      // Ascending and duplicate-free by construction: pushed in file order, at
      // most once per line (a line is either unregistered or registered).
      return { verdict: "PARTIAL", lines: this.partialLines };
    }
    return { verdict: "VALID" };
  }

  /** Every check on one line; the reason for the first failure, or null. */
  private check(line: Buffer, terminated: boolean): string | null {
    const lineNo = this.lineNo;
    const isFirst = lineNo === 1;
    const state = this.state;

    // Framing (EX-2..EX-5, EX-20).
    if (
      isFirst &&
      line.length >= 3 &&
      line[0] === 0xef &&
      line[1] === 0xbb &&
      line[2] === 0xbf
    ) {
      return "EX-2: export begins with a byte-order mark";
    }
    if (!terminated) return "EX-4: final line is not terminated by LF";
    if (line.length === 0) return "EX-5: blank content line";
    if (line.includes(CR)) return "EX-3: carriage return in export";

    const ev = parseEventLine(line);
    // Stage A single-line failure (canonical byte form, envelope, ts, ...).
    if (ev === null) {
      return "ES-1..ES-26/EX-7..EX-10: line is not a canonical ODC event";
    }

    // Stage A cross-line checks (type-agnostic).
    if (ev.seq !== lineNo) {
      return `ES-6/ES-7: seq ${ev.seq} breaks contiguity (expected ${lineNo})`;
    }
    // ES-33: genesis exactly at seq 1, and seq 1 is always genesis.
    if (isFirst && ev.type !== "genesis") {
      // `excerpt`: ES-10 constrains the charset of `type` but NOT its length,
      // so this value is attacker-controlled and unbounded.
      return `ES-33: first event is "${excerpt(ev.type)}", not "genesis"`;
    }
    if (!isFirst && ev.type === "genesis") {
      return "ES-33: a second genesis event after line 1";
    }
    if (isFirst) {
      if (ev.prevHash !== GENESIS_PREV) {
        return "ES-24: genesis prev_hash is not the 64-zero anchor";
      }
    } else if (ev.prevHash !== this.prevHash) {
      return "ES-25: prev_hash does not match the previous event's hash";
    }
    if (computeHash(ev) !== ev.hash) {
      return "HA-14: recomputed hash does not match the stored hash";
    }

    // Stage B — only for registered (type, version) pairs (EV-6).
    if (isRegistered(ev.type, ev.version)) {
      state.unresolved = false;
      state.stageBReason = null;
      if (!stageB(ev, state)) {
        // `ev.type` is one of the four registered names on this branch, so
        // `excerpt` cannot bite here; it is applied anyway so that no
        // interpolation of a value read out of the export goes unclipped.
        return (
          state.stageBReason ??
          `Stage B: ${excerpt(ev.type)} v${ev.version} fails a type-specific check (event-types.md)`
        );
      }
      // ET-18b / ET-24b: passed, but with a check left unresolved (EV-7).
      if (state.unresolved) this.partialLines.push(lineNo);
    } else if (isFirst) {
      // EV-20, the SOLE exception to EV-8: the chain's genesis MUST carry a
      // (type, version) this verifier registers, or the chain is INVALID at
      // line 1 and we do not proceed to a chain-level VALID or PARTIAL. With
      // an unregistered genesis, operator_pk and registrar_pk cannot be read
      // at all (reading them is Stage B, EV-15), so every later signature is
      // uncheckable. ES-33 above has already fixed ev.type === "genesis" on
      // line 1, so the unregistered half of the key is always the version.
      return unregisteredGenesisReason(ev);
    } else {
      // Well-formed but unregistered: Stage A passed, semantics unchecked.
      // (A malformed payload would already have failed parse — EV-16.)
      // Two unregistered types still matter to registered checks, by their
      // ENVELOPE only, never their payload:
      if (ev.type === "issue_created") {
        // ET-18b: a ballot may name it; its hash is its issue_id (ID-7).
        state.unregisteredIssues.add(ev.hash);
      } else if (ev.type === "vote_cast") {
        // ET-24b: an opaque ballot — its `seq` and `ts`, nothing else.
        state.batches.opaque(ev.seq, epochMs(ev.ts));
      }
      this.partialLines.push(lineNo);
    }

    if (isFirst) this.genesisHash = ev.hash;
    this.prevHash = ev.hash;
    return null;
  }
}

/**
 * Verify a stream of records. Stops pulling records once the verdict is
 * decided, WITHOUT closing the iterator (a `for…of` with `break` would), so a
 * caller can still read the rest of the input for EX-24's last candidate.
 * Throws `LimitReached` under EV-24 (see `ExportVerifier.push`).
 */
export function verifyRecords(
  records: Iterable<InputRecord>,
  head?: string,
  chain?: string,
): Verdict {
  const v = new ExportVerifier(head, chain);
  const it = records[Symbol.iterator]();
  while (!v.decided) {
    const r = it.next();
    if (r.done === true) break;
    v.push(r.value);
  }
  return v.finish();
}

/**
 * Verify a whole export held in memory.
 * @param bytes  raw file bytes (read as bytes, never as decoded text)
 * @param head   optional expected head (64 lowercase hex), EX-15
 * @param chain  optional expected genesis hash (64 lowercase hex), EX-22
 * @param maxLine this verifier's line limit; a parameter for tests only
 */
export function verifyExport(
  bytes: Buffer,
  head?: string,
  chain?: string,
  maxLine: number = MAX_LINE_BYTES,
): Verdict {
  return verifyRecords(recordsOf(bytes, maxLine), head, chain);
}

/**
 * EV-21's advisory reason for an EV-20 rejection. Conformance for EV-20 is the
 * token INVALID and the line number 1 and nothing else (no fixture asserts
 * this text). EV-21 (evolution.md v8) asks the text to name the version found,
 * to say that a `genesis` at any version other than 1 means the chain is
 * corrupt, hostile or not an ODC chain (ET-6), and NOT to advise fetching a
 * newer verifier: ET-6 pins `genesis.version` at 1 in every contracts version,
 * so no newer verifier registers another one.
 *
 * Single-line by construction: the one interpolated value is a number.
 */
function unregisteredGenesisReason(ev: ParsedEvent): string {
  return (
    `EV-20: genesis at version ${ev.version}; ET-6 pins genesis.version at 1 in every contracts version, ` +
    "so this chain is corrupt, hostile, or not an ODC chain (EV-21)"
  );
}
