// Whole-export verifier: framing (export-format.md), two-stage per-event checks
// (evolution.md EV-6/EV-15), and the three-verdict report surface (EV-7/EV-17).
//
// Verdict precedence: INVALID > PARTIAL > VALID. INVALID names the first fatal
// line in file order; PARTIAL enumerates the unregistered-but-well-formed lines.

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

export type Verdict =
  | { verdict: "VALID" }
  | { verdict: "INVALID"; line: number; reason?: string }
  | { verdict: "PARTIAL"; lines: number[] };

const GENESIS_PREV = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const LF = 0x0a;
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

// The `genesis` versions this verifier registers, for EV-21's reason text.
function registeredVersionsOf(type: string): number[] {
  const v = REGISTERED.get(type);
  return v === undefined ? [] : [v];
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
  issues: Map<string, number>; // issue_id (hash) -> choice_count
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
      if (contracts === null || contracts.length === 0) return false; // ET-9
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
      // issue_id is this event's hash (ID-7); track its choice_count for ET-18a.
      state.issues.set(ev.hash, choiceCount);
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
      const cc = state.issues.get(issueId);
      if (cc === undefined) return false;
      if (choice < 0 || choice >= cc) return false; // ET-18a
      const sig = Buffer.from(sigHex, "hex");
      const reg = state.registrarPk;
      if (reg === null) return false;
      if (!isCanonicalSigEncoding(sig)) return false; // ET-4a
      if (!ed25519Verify(signingPreimage(ev), sig, reg)) return false; // ET-17
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

// Split the raw file into content-line buffers (without their LF terminators),
// and surface framing faults with their 1-based line numbers (EX-2..EX-5, EX-20).
interface Framing {
  lines: Buffer[];
  faults: Fault[]; // lines that are framing-INVALID
}

function frame(bytes: Buffer): Framing {
  const faults: Fault[] = [];

  // EX-2: a byte-order mark (or leading garbage) is attributed to line 1.
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    faults.push({
      line: 1,
      reason: "EX-2: export begins with a byte-order mark",
    });
  }

  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === LF) {
      lines.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  const endsWithLF = bytes.length > 0 && bytes[bytes.length - 1] === LF;
  if (!endsWithLF) {
    // Remaining bytes form the last line, which lacks its terminator (EX-4).
    lines.push(bytes.subarray(start));
    faults.push({
      line: lines.length, // attributed to the last line
      reason: "EX-4: final line is not terminated by LF",
    });
  }

  // EX-5: a blank (empty) content line is INVALID at that line.
  // EX-3: a CR anywhere is INVALID at the first line containing one.
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] as Buffer;
    if (ln.length === 0) {
      faults.push({ line: i + 1, reason: "EX-5: blank content line" });
    }
    if (ln.includes(CR)) {
      faults.push({ line: i + 1, reason: "EX-3: carriage return in export" });
      break; // first line with a CR (EX-20)
    }
  }

  return { lines, faults };
}

/**
 * Verify a whole export.
 * @param bytes  raw file bytes (read as bytes, never as decoded text)
 * @param head   optional expected head (64 lowercase hex), EX-15
 */
export function verifyExport(bytes: Buffer, head?: string): Verdict {
  // EX-6/EX-18: an empty export is a well-formed export but NOT a valid chain;
  // the missing genesis is attributed to line 1.
  if (bytes.length === 0)
    return {
      verdict: "INVALID",
      line: 1,
      reason: "EX-6/EX-18: empty export — no genesis event",
    };

  const { lines, faults } = frame(bytes);

  const invalid: Fault[] = [...faults];
  const partialLines: number[] = [];
  const state: ChainState = {
    operatorPk: null,
    registrarPk: null,
    issues: new Map(),
  };

  let prevHash: string | null = null;
  let expectedSeq = 1;
  let lastHash: string | null = null;
  let contentFault: Fault | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const ev = parseEventLine(lines[i] as Buffer);
    if (ev === null) {
      // Stage A single-line failure (canonical byte form, envelope, ts, ...).
      contentFault = {
        line: lineNo,
        reason: "ES-1..ES-26/EX-7..EX-10: line is not a canonical ODC event",
      };
      break;
    }

    // Stage A cross-line checks (type-agnostic).
    if (ev.seq !== expectedSeq) {
      contentFault = {
        line: lineNo,
        reason: `ES-6/ES-7: seq ${ev.seq} breaks contiguity (expected ${expectedSeq})`,
      };
      break;
    }
    const isFirst = lineNo === 1;
    // ES-33: genesis exactly at seq 1, and seq 1 is always genesis.
    if (isFirst && ev.type !== "genesis") {
      contentFault = {
        line: lineNo,
        // `excerpt`: ES-10 constrains the charset of `type` but NOT its
        // length, so this value is attacker-controlled and unbounded.
        reason: `ES-33: first event is "${excerpt(ev.type)}", not "genesis"`,
      };
      break;
    }
    if (!isFirst && ev.type === "genesis") {
      contentFault = {
        line: lineNo,
        reason: "ES-33: a second genesis event after line 1",
      };
      break;
    }
    if (isFirst) {
      if (ev.prevHash !== GENESIS_PREV) {
        contentFault = {
          line: lineNo,
          reason: "ES-24: genesis prev_hash is not the 64-zero anchor",
        };
        break;
      }
    } else if (ev.prevHash !== prevHash) {
      contentFault = {
        line: lineNo,
        reason: "ES-25: prev_hash does not match the previous event's hash",
      };
      break;
    }
    if (computeHash(ev) !== ev.hash) {
      contentFault = {
        line: lineNo,
        reason: "HA-14: recomputed hash does not match the stored hash",
      };
      break;
    }

    // Stage B — only for registered (type, version) pairs (EV-6).
    if (isRegistered(ev.type, ev.version)) {
      if (!stageB(ev, state)) {
        contentFault = {
          line: lineNo,
          // `ev.type` is one of the four registered names on this branch, so
          // `excerpt` cannot bite here; it is applied anyway so that no
          // interpolation of a value read out of the export goes unclipped.
          reason: `Stage B: ${excerpt(ev.type)} v${ev.version} fails a type-specific check (event-types.md)`,
        };
        break;
      }
    } else if (isFirst) {
      // EV-20, the SOLE exception to EV-8: the chain's genesis MUST carry a
      // (type, version) this verifier registers, or the chain is INVALID at
      // line 1 and we do not proceed to a chain-level VALID or PARTIAL. With an
      // unregistered genesis, operator_pk and registrar_pk cannot be read at
      // all (reading them is Stage B, EV-15), so every later signature is
      // uncheckable — PARTIAL here would announce "integrity confirmed, some
      // semantics unchecked" over a chain on which nothing was authenticated.
      // ES-33 above has already fixed ev.type === "genesis" on line 1, so the
      // unregistered half of the key is always the version.
      contentFault = { line: lineNo, reason: unregisteredGenesisReason(ev) };
      break;
    } else {
      // Well-formed but unregistered: Stage A passed, semantics unchecked.
      // (A malformed payload would already have failed parse — EV-16.)
      partialLines.push(lineNo);
    }

    prevHash = ev.hash;
    lastHash = ev.hash;
    expectedSeq++;
  }

  if (contentFault !== null) invalid.push(contentFault);

  // EX-15/EX-19: a --head mismatch is INVALID at the last line. Only meaningful
  // once every line has passed (link checks complete); if the chain already has
  // a fatal line, that lower-or-equal line number wins by the fold below anyway.
  if (invalid.length === 0 && head !== undefined) {
    if (lastHash === null || lastHash !== head) {
      invalid.push({
        line: lines.length,
        reason:
          "EX-15/EX-19: chain head does not match the --head value supplied out of band",
      });
    }
  }

  if (invalid.length > 0) {
    // Fold instead of Math.min(...invalid.map(...)): `invalid` gets one entry
    // per framing fault (e.g. every blank line, EX-5), so a large export can
    // push far more entries than the ~130k argument-spread limit, which would
    // throw an uncaught RangeError instead of returning a verdict (EV-17).
    const first = invalid.reduce((a, b) => (b.line < a.line ? b : a));
    return { verdict: "INVALID", line: first.line, reason: first.reason };
  }
  if (partialLines.length > 0) {
    // Ascending by construction (pushed in file order).
    return { verdict: "PARTIAL", lines: partialLines };
  }
  return { verdict: "VALID" };
}

/**
 * EV-21's advisory reason for an EV-20 rejection. Conformance for EV-20 is the
 * token INVALID and the line number 1 and nothing else, but the bare token
 * sends a reader hunting for tampering when the remedy may be to fetch a newer
 * verifier. EV-21 asks for a message that names the version encountered and the
 * genesis versions this verifier registers, and that says plainly that the two
 * situations it could be are indistinguishable from the log alone.
 *
 * Single-line by construction: every interpolated value is a number.
 */
function unregisteredGenesisReason(ev: ParsedEvent): string {
  const known = registeredVersionsOf("genesis");
  // The empty branch is UNREACHABLE while `genesis` sits in REGISTERED, which
  // ES-33 requires of every chain. It is kept as a total case rather than a
  // non-null assertion: a registry edit that dropped `genesis` would otherwise
  // render "it registers genesis v" here.
  const knownText =
    known.length === 0
      ? "no genesis version at all"
      : `genesis v${known.join(", v")}`;
  return (
    `EV-20: this verifier does not register (genesis, ${ev.version}) — it registers ${knownText}. ` +
    "From the log alone this verifier cannot distinguish a chain newer than itself " +
    "(fetch a newer verifier) from a corrupt or hostile genesis (EV-21)."
  );
}
