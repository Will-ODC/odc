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
import {
  ed25519Verify,
  isCanonicalKeyEncoding,
  isCanonicalSigEncoding,
  isPrimeOrderKey,
} from "./crypto.js";

export type Verdict =
  | { verdict: "VALID" }
  // `reason` is advisory only (EV-17: conformance is the verdict token and the
  // line number alone, and no fixture asserts reason text). It is populated for
  // the one rejection EV-21 says a bare token actively misleads a reader about.
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

/**
 * EV-21 — the advisory reason for an EV-20 rejection.
 *
 * Guidance, not conformance: "conformance for EV-20 is the token INVALID and
 * the line number 1, and nothing else is asserted by any fixture." It is
 * written out here anyway because EV-21 says the bare token actively misleads:
 * the two situations that produce this one verdict — "this verifier is out of
 * date for this chain" and "this chain's genesis is corrupt or hostile" — are
 * *indistinguishable from the log alone*, "and an honest message says so rather
 * than picking one", naming the version encountered and the `genesis` versions
 * this verifier does register so the reader can go and settle it.
 *
 * This is not a reason-code registry (none exists, EV-17) and nothing keys off
 * this string.
 */
function unregisteredGenesisReason(type: string, version: number): string {
  const known = REGISTERED.get(type);
  const registered =
    known === undefined
      ? `no ${type} version at all`
      : `${type} version ${known}`;
  return (
    `EV-20: this chain's genesis is (${type}, version ${version}), which this ` +
    `verifier does not register — it registers ${registered}. From the log ` +
    `alone this verifier cannot tell whether it is out of date for this chain ` +
    `or this chain's genesis is corrupt or hostile; a reader holding a newer ` +
    `verifier, or the chain's publisher, can settle which. Nothing on this ` +
    `chain could be authenticated, because operator_pk and registrar_pk are ` +
    `declared in a genesis payload this verifier cannot read.`
  );
}

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

/**
 * ES-18 payload key set, with ES-34 optional keys.
 *
 * Every key in `required` MUST be present; a key that is in neither `required`
 * nor `optional` is rejected. ES-34: "OPTIONAL means 'this defined key may be
 * absent', never 'an undefined key may appear', and a verifier still rejects
 * any key not defined for the (type, version)." So widening a key set for an
 * optional key must not turn it into an open set.
 *
 * `have` may be assumed duplicate-free: the line parser rejects a repeated
 * payload key outright (HA-6), so it never reaches here.
 *
 * Exported because it is the one part of this change that can be pinned
 * discriminatingly without inventing a signed chain (see test/rules.test.ts).
 */
export function payloadKeysConform(
  have: readonly string[],
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const present = new Set(have);
  for (const k of required) if (!present.has(k)) return false;
  const defined = new Set<string>();
  for (const k of required) defined.add(k);
  for (const k of optional) defined.add(k);
  for (const k of present) if (!defined.has(k)) return false;
  return true;
}

function keysConform(
  ev: ParsedEvent,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return payloadKeysConform(
    ev.payload.map((e) => e.key),
    required,
    optional,
  );
}

// `genesis` v1 payload key set (event-types.md genesis table; ES-18 + ES-34).
// `ancestor_head` is the one OPTIONAL key v1 defines (ET-9e, ES-34) — and,
// per ET-9e, the only key that will ever be added to this payload.
const GENESIS_REQUIRED_KEYS = [
  "chain_id",
  "contracts",
  "operator_pk",
  "registrar_pk",
  "sig",
] as const;
const GENESIS_OPTIONAL_KEYS = ["ancestor_head"] as const;

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
      // ES-18 + ES-34: the five required keys, plus the OPTIONAL `ancestor_head`
      // (ET-9e). Not an exact set any more — but still a closed one: an
      // undefined key is rejected exactly as before.
      if (!keysConform(ev, GENESIS_REQUIRED_KEYS, GENESIS_OPTIONAL_KEYS))
        return false;
      const chainId = strField(ev, "chain_id");
      const contracts = strField(ev, "contracts");
      const opHex = strField(ev, "operator_pk");
      const regHex = strField(ev, "registrar_pk");
      const sigHex = strField(ev, "sig");
      if (chainId === null || !HEX64.test(chainId)) return false;
      if (contracts === null || contracts.length === 0) return false; // ET-9
      if (opHex === null || !HEX64.test(opHex)) return false; // ET-9b
      if (regHex === null || !HEX64.test(regHex)) return false; // ET-9b
      if (sigHex === null || !HEX128.test(sigHex)) return false;

      // ET-9d: the two genesis keys MUST be distinct. "The comparison is on the
      // two 64-character lowercase-hex strings after ET-9b has passed on both,
      // so it is one string equality and needs no key material, no decoding and
      // no curve arithmetic." A chain declaring one key twice hands one holder
      // both the power to mint issues and to forge every ballot on them.
      if (opHex === regHex) return false; // ET-9d

      // ET-9e: `ancestor_head` is OPTIONAL (ES-34) — either absent, or present
      // with a legal value. When present it MUST match ^[0-9a-f]{64}$ and MUST
      // NOT be the 64-zero anchor, "so there is exactly one way to say 'no
      // ancestor'". `field` (not `strField`) so an absent key and a present
      // non-string value stay distinguishable: absence is legal, a non-string
      // is not. The value is a recorded claim, not a verified link — a verifier
      // "checks the format above and nothing else" and MUST NOT report INVALID
      // because it cannot resolve the value.
      const ancestor = field(ev, "ancestor_head");
      if (ancestor !== undefined) {
        if (ancestor.val.kind !== "str") return false; // ET-9e (string-typed)
        if (!HEX64.test(ancestor.val.value)) return false; // ET-9e
        if (ancestor.val.value === GENESIS_PREV) return false; // ET-9e
      }

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
      if (!keysConform(ev, ["pubkey", "sig"])) return false; // ES-18
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
        !keysConform(ev, [
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
      if (!keysConform(ev, ["choice", "issue_id", "sig"])) return false; // ES-18
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

// Split the raw file into content-line buffers (without their LF terminators),
// and surface framing faults with their 1-based line numbers (EX-2..EX-5, EX-20).
interface Framing {
  lines: Buffer[];
  faultLines: number[]; // lines that are framing-INVALID
}

function frame(bytes: Buffer): Framing {
  const faultLines: number[] = [];

  // EX-2: a byte-order mark (or leading garbage) is attributed to line 1.
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    faultLines.push(1);
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
    faultLines.push(lines.length); // attributed to the last line
  }

  // EX-5: a blank (empty) content line is INVALID at that line.
  // EX-3: a CR anywhere is INVALID at the first line containing one.
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] as Buffer;
    if (ln.length === 0) faultLines.push(i + 1);
    if (ln.includes(CR)) {
      faultLines.push(i + 1);
      break; // first line with a CR (EX-20)
    }
  }

  return { lines, faultLines };
}

/**
 * Verify a whole export.
 * @param bytes  raw file bytes (read as bytes, never as decoded text)
 * @param head   optional expected head (64 lowercase hex), EX-15
 */
export function verifyExport(bytes: Buffer, head?: string): Verdict {
  // EX-6/EX-18: an empty export is a well-formed export but NOT a valid chain;
  // the missing genesis is attributed to line 1.
  if (bytes.length === 0) return { verdict: "INVALID", line: 1 };

  const { lines, faultLines } = frame(bytes);

  const invalidLines: number[] = [...faultLines];
  const partialLines: number[] = [];
  const state: ChainState = {
    operatorPk: null,
    registrarPk: null,
    issues: new Map(),
  };

  let prevHash: string | null = null;
  let expectedSeq = 1;
  let lastHash: string | null = null;
  let contentInvalid: number | null = null;
  // Advisory only (EV-17). Surfaced solely when the fatal line reported below
  // is the very line this reason was recorded for.
  let contentInvalidReason: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const ev = parseEventLine(lines[i] as Buffer);
    if (ev === null) {
      contentInvalid = lineNo; // Stage A single-line failure
      break;
    }

    // Stage A cross-line checks (type-agnostic).
    if (ev.seq !== expectedSeq) {
      contentInvalid = lineNo; // ES-6 / ES-7
      break;
    }
    const isFirst = lineNo === 1;
    // ES-33: genesis exactly at seq 1, and seq 1 is always genesis.
    if (isFirst && ev.type !== "genesis") {
      contentInvalid = lineNo;
      break;
    }
    if (!isFirst && ev.type === "genesis") {
      contentInvalid = lineNo;
      break;
    }
    // EV-20: a chain's `genesis` MUST carry a (type, version) this verifier
    // registers; if it does not, the chain is INVALID at line 1 and MUST NOT
    // reach a chain-level VALID or PARTIAL. This is the sole exception to EV-8,
    // and a Stage A promotion for `genesis` alone: EV-15 assigns the ES-9/ES-11
    // registration check to Stage B everywhere else, but "at line 1, ES-9/ES-11
    // registration is Stage A, because a `genesis` the verifier does not
    // register leaves it no keys to run Stage B with anywhere on the chain".
    // Without it, `operator_pk`/`registrar_pk` are never extracted and every
    // later signature goes unchecked, yet the chain would still walk to
    // PARTIAL — announcing "integrity confirmed, some semantics unchecked"
    // over a chain on which nothing was ever authenticated.
    if (isFirst && !isRegistered(ev.type, ev.version)) {
      contentInvalid = lineNo;
      contentInvalidReason = unregisteredGenesisReason(ev.type, ev.version);
      break;
    }
    if (isFirst) {
      if (ev.prevHash !== GENESIS_PREV) {
        contentInvalid = lineNo; // ES-24
        break;
      }
    } else if (ev.prevHash !== prevHash) {
      contentInvalid = lineNo; // ES-25
      break;
    }
    if (computeHash(ev) !== ev.hash) {
      contentInvalid = lineNo; // HA-14
      break;
    }

    // Stage B — only for registered (type, version) pairs (EV-6).
    if (isRegistered(ev.type, ev.version)) {
      if (!stageB(ev, state)) {
        contentInvalid = lineNo;
        break;
      }
    } else {
      // Well-formed but unregistered: Stage A passed, semantics unchecked.
      // (A malformed payload would already have failed parse — EV-16.)
      partialLines.push(lineNo);
    }

    prevHash = ev.hash;
    lastHash = ev.hash;
    expectedSeq++;
  }

  if (contentInvalid !== null) invalidLines.push(contentInvalid);

  // EX-15/EX-19: a --head mismatch is INVALID at the last line. Only meaningful
  // once every line has passed (link checks complete); if the chain already has
  // a fatal line, that lower-or-equal line number wins by min() below anyway.
  if (invalidLines.length === 0 && head !== undefined) {
    if (lastHash === null || lastHash !== head) {
      invalidLines.push(lines.length);
    }
  }

  if (invalidLines.length > 0) {
    // Fold instead of Math.min(...invalidLines): invalidLines gets one entry
    // per framing fault (e.g. every blank line, EX-5), so a large export can
    // push far more entries than the ~130k argument-spread limit, which would
    // throw an uncaught RangeError instead of returning a verdict (EV-17).
    const line = invalidLines.reduce((a, b) => Math.min(a, b));
    return contentInvalidReason !== null && line === contentInvalid
      ? { verdict: "INVALID", line, reason: contentInvalidReason }
      : { verdict: "INVALID", line };
  }
  if (partialLines.length > 0) {
    // Ascending by construction (pushed in file order).
    return { verdict: "PARTIAL", lines: partialLines };
  }
  return { verdict: "VALID" };
}
