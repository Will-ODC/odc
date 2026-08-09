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
  | { verdict: "INVALID"; line: number }
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
      if (
        !keysExactly(ev, [
          "chain_id",
          "contracts",
          "operator_pk",
          "registrar_pk",
          "sig",
        ])
      )
        return false; // ES-18
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
      if (!keysExactly(ev, ["choice_count", "sig", "title"])) return false; // ES-18
      const title = strField(ev, "title");
      const choiceCount = intField(ev, "choice_count");
      const sigHex = strField(ev, "sig");
      if (title === null || !titleOk(title)) return false; // ET-14
      if (choiceCount === null || choiceCount < 2 || choiceCount > 64)
        return false; // ET-14a
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
    return {
      verdict: "INVALID",
      line: invalidLines.reduce((a, b) => Math.min(a, b)),
    };
  }
  if (partialLines.length > 0) {
    // Ascending by construction (pushed in file order).
    return { verdict: "PARTIAL", lines: partialLines };
  }
  return { verdict: "VALID" };
}
