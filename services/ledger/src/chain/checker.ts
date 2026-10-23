// Forward-state chain checker: the verify-before-append of evolution.md EV-26.
//
// `checkLine` applies every Stage A and Stage B check (EV-15) the new line
// faces given the lines before it, and returns the state a verifier carries
// to the next line. A line is accepted only if the export ending with it is
// VALID under a verifier registering exactly the v1 pairs, run without
// --head or --chain. An unregistered (type, version) is therefore refused
// (that export would be PARTIAL), so the opaque-ballot rules ET-18b and
// ET-24b never arise on a chain this checker accepts.

import {
  HEX64,
  ZERO_HASH,
  parseLine,
  tsToEpochMs,
  type Event,
  type Payload,
  type Refusal,
} from "./canonical.js";
import {
  decodeVerificationKey,
  verifySignature,
  type VerificationKey,
} from "./ed25519.js";
import { computeHash, sha256Hex, signingPreimage } from "./hashing.js";

/** The v1 registry (event-types.md ET-1, ET-2): `type/version`. */
export const REGISTERED_PAIRS: ReadonlySet<string> = new Set([
  "genesis/1",
  "participant_registered/1",
  "issue_created/1",
  "vote_cast/1",
]);

export function isRegistered(type: string, version: number): boolean {
  return REGISTERED_PAIRS.has(`${type}/${version}`);
}

export interface GenesisKeys {
  readonly genesisHash: string;
  readonly operator: VerificationKey;
  readonly registrar: VerificationKey;
}

export interface Batch {
  /** The batch instant (ET-23): the `ts` its ballots share. */
  readonly ts: string;
  readonly size: number;
}

export interface IssueState {
  readonly issueId: string;
  readonly seq: number;
  readonly choiceCount: number;
  readonly ballotBatchIntervalMs: number;
  readonly ballotBatchMin: number;
  /** Every batch instant the issue has used, the current one included. */
  readonly usedInstants: ReadonlySet<string>;
  /** The issue's latest batch (ET-24), or null before its first ballot. */
  readonly currentBatch: Batch | null;
}

export interface ChainState {
  readonly nextSeq: number;
  /** `hash` of the last accepted line; the 64-zero anchor when empty. */
  readonly headHash: string;
  readonly genesis: GenesisKeys | null;
  readonly issues: ReadonlyMap<string, IssueState>;
}

export type LineResult =
  | { readonly ok: true; readonly event: Event; readonly state: ChainState }
  | { readonly ok: false; readonly refusal: Refusal };

export type ExportResult =
  | {
      readonly ok: true;
      readonly lineCount: number;
      readonly state: ChainState;
    }
  | { readonly ok: false; readonly line: number; readonly refusal: Refusal };

export function initialState(): ChainState {
  return { nextSeq: 1, headHash: ZERO_HASH, genesis: null, issues: new Map() };
}

class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason);
  }
}

function refuse(rule: string, reason: string): never {
  throw new Refused({ kind: "invalid", rule, reason });
}

function keyOrRefuse(hex: string): VerificationKey {
  const r = decodeVerificationKey(hex);
  if (!r.ok) throw new Refused(r.refusal);
  return r.key;
}

function sigOrRefuse(key: VerificationKey, event: Event, rule: string): void {
  const sig = event.payload.sig;
  if (typeof sig !== "string") refuse("ES-30", "sig is not a string");
  const r = verifySignature(key, signingPreimage(event), sig);
  if (!r.ok) {
    throw new Refused({ ...r.refusal, reason: `${rule}: ${r.refusal.reason}` });
  }
}

/** ES-18 and ES-34: exactly the required keys, plus any of the optional. */
function checkKeys(
  p: Payload,
  required: string[],
  optional: string[] = [],
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(p, key)) {
      refuse("ES-18", `payload is missing ${key}`);
    }
  }
  for (const key of Object.keys(p)) {
    if (!required.includes(key) && !optional.includes(key)) {
      refuse("ES-18", `payload key ${key} is not defined for this type`);
    }
  }
}

function str(p: Payload, key: string): string {
  const v = p[key];
  return typeof v === "string" ? v : refuse("ES-18", `${key} must be a string`);
}

function int(p: Payload, key: string): number {
  const v = p[key];
  return typeof v === "number"
    ? v
    : refuse("ES-18", `${key} must be an integer`);
}

// ------------------------------------------------------------ per type

function checkGenesis(e: Event, state: ChainState): ChainState {
  const p = e.payload;
  checkKeys(
    p,
    ["chain_id", "contracts", "operator_pk", "registrar_pk", "sig"],
    ["ancestor_chain", "ancestor_head"],
  );
  const hasChain = p.ancestor_chain !== undefined;
  if (hasChain !== (p.ancestor_head !== undefined)) {
    refuse("ET-9f", "ancestor_chain and ancestor_head must appear together");
  }
  if (hasChain) {
    for (const key of ["ancestor_chain", "ancestor_head"]) {
      const v = str(p, key);
      if (!HEX64.test(v) || v === ZERO_HASH) {
        refuse("ET-9e", `${key} must be 64 lowercase hex, not the anchor`);
      }
    }
  }
  const operatorPk = str(p, "operator_pk");
  const registrarPk = str(p, "registrar_pk");
  if (!HEX64.test(operatorPk) || !HEX64.test(registrarPk)) {
    refuse("ET-9b", "genesis keys must be 64 lowercase hex");
  }
  if (operatorPk === registrarPk) refuse("ET-9d", "genesis keys are equal");
  const chainId = str(p, "chain_id");
  if (chainId !== sha256Hex(Buffer.from(operatorPk, "hex"))) {
    refuse("ET-7", "chain_id is not sha256(operator_pk bytes)");
  }
  const contractsBytes = Buffer.byteLength(str(p, "contracts"), "utf8");
  if (contractsBytes < 1 || contractsBytes > 64) {
    refuse("ET-9", "contracts must be 1-64 UTF-8 bytes");
  }
  const operator = keyOrRefuse(operatorPk); // ET-4b, ET-4c (ET-9c)
  const registrar = keyOrRefuse(registrarPk); // ET-9c: at declaration
  sigOrRefuse(operator, e, "ET-8");
  return { ...state, genesis: { genesisHash: e.hash, operator, registrar } };
}

function checkParticipant(e: Event, state: ChainState): ChainState {
  checkKeys(e.payload, ["pubkey", "sig"]);
  const key = keyOrRefuse(str(e.payload, "pubkey")); // ID-3, ET-4b, ET-4c
  sigOrRefuse(key, e, "ET-10");
  return state;
}

function checkIssue(e: Event, state: ChainState, g: GenesisKeys): ChainState {
  const p = e.payload;
  checkKeys(p, [
    "ballot_batch_interval_ms",
    "ballot_batch_min",
    "choice_count",
    "sig",
    "title",
  ]);
  const title = str(p, "title");
  const scalars = [...title];
  if (scalars.length < 1 || scalars.length > 200) {
    refuse("ET-14", "title must be 1-200 Unicode scalar values");
  }
  if (scalars.some((c) => c.charCodeAt(0) < 0x20 || c === "\u007f")) {
    refuse("ET-14", "title contains a control character");
  }
  const choiceCount = int(p, "choice_count");
  if (choiceCount < 2 || choiceCount > 64)
    refuse("ET-14a", "choice_count out of range");
  const interval = int(p, "ballot_batch_interval_ms");
  if (interval < 60000)
    refuse("ET-14b", "ballot_batch_interval_ms below 60000");
  const min = int(p, "ballot_batch_min");
  if (min < 3) refuse("ET-14b", "ballot_batch_min below 3");
  sigOrRefuse(g.operator, e, "ET-13");
  const issue: IssueState = {
    issueId: e.hash, // ET-15
    seq: e.seq,
    choiceCount,
    ballotBatchIntervalMs: interval,
    ballotBatchMin: min,
    usedInstants: new Set(),
    currentBatch: null,
  };
  return { ...state, issues: new Map(state.issues).set(e.hash, issue) };
}

function checkVote(e: Event, state: ChainState, g: GenesisKeys): ChainState {
  const p = e.payload;
  checkKeys(p, ["choice", "issue_id", "sig"]);
  const issueId = str(p, "issue_id");
  if (!HEX64.test(issueId)) refuse("ID-1", "issue_id is not 64 lowercase hex");
  const issue = state.issues.get(issueId);
  if (issue === undefined)
    refuse("ET-18", "issue_id names no prior issue_created");
  const choice = int(p, "choice"); // ET-19
  if (choice >= issue.choiceCount) refuse("ET-18a", "choice out of range");
  sigOrRefuse(g.registrar, e, "ET-17");
  if (tsToEpochMs(e.ts) % issue.ballotBatchIntervalMs !== 0) {
    refuse("ET-23", "ts is not a multiple of the issue's batch interval");
  }
  return {
    ...state,
    issues: new Map(state.issues).set(issueId, nextBatch(issue, e.ts)),
  };
}

/** ET-24 and ET-24a for one more registered ballot of `issue` at `ts`. */
function nextBatch(issue: IssueState, ts: string): IssueState {
  const current = issue.currentBatch;
  if (current !== null && current.ts === ts) {
    return { ...issue, currentBatch: { ts, size: current.size + 1 } };
  }
  // This ballot starts a batch, and so ends the current one (ET-24).
  if (issue.usedInstants.has(ts)) {
    refuse("ET-24a", "ballot returns to a batch instant its issue has left");
  }
  if (current !== null && current.size < issue.ballotBatchMin) {
    refuse("ET-24", "ballot ends an under-size batch, which was not the last");
  }
  return {
    ...issue,
    usedInstants: new Set(issue.usedInstants).add(ts),
    currentBatch: { ts, size: 1 },
  };
}

// ------------------------------------------------------------ the line

/**
 * Check one line (its bytes without LF) against the state of the lines before
 * it. Pure: the input state is never modified, so a refused line leaves the
 * caller holding the state it had.
 */
export function checkLine(state: ChainState, line: Uint8Array): LineResult {
  const parsed = parseLine(line);
  if (!parsed.ok) return parsed;
  const e = parsed.event;
  try {
    // Stage A (EV-15).
    if (e.seq !== state.nextSeq)
      refuse("ES-7", `seq ${e.seq}, expected ${state.nextSeq}`);
    if (e.prev_hash !== state.headHash)
      refuse("ES-25", "prev_hash does not link");
    if (computeHash(e) !== e.hash)
      refuse("HA-14", "hash does not match the preimage");
    if ((e.seq === 1) !== (e.type === "genesis")) {
      refuse("ES-33", "genesis must be exactly the seq 1 event");
    }
    if (!isRegistered(e.type, e.version)) {
      // EV-20 (line 1, INVALID) or EV-26 (elsewhere, PARTIAL): never appended.
      return {
        ok: false,
        refusal: {
          kind: e.seq === 1 ? "invalid" : "unregistered",
          rule: e.seq === 1 ? "EV-20" : "EV-26",
          reason: `(${e.type}, ${e.version}) is not registered in v1`,
        },
      };
    }
    // Stage B.
    let next: ChainState;
    if (e.type === "genesis") next = checkGenesis(e, state);
    else {
      const g = state.genesis;
      if (g === null) return refuse("ES-33", "no genesis");
      if (e.type === "participant_registered")
        next = checkParticipant(e, state);
      else if (e.type === "issue_created") next = checkIssue(e, state, g);
      else next = checkVote(e, state, g);
    }
    return {
      ok: true,
      event: e,
      state: { ...next, nextSeq: e.seq + 1, headHash: e.hash },
    };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, refusal: err.refusal };
    throw err;
  }
}

// ------------------------------------------------------------ the export

/**
 * Split an export into its LF-terminated records (EX-1, EX-3, EX-4). A final
 * fragment with no terminating LF is returned too, flagged `unterminated`.
 */
export function splitExport(bytes: Uint8Array): {
  records: Uint8Array[];
  unterminated: boolean;
} {
  const records: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      records.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  const unterminated = start < bytes.length;
  if (unterminated) records.push(bytes.subarray(start));
  return { records, unterminated };
}

/**
 * Verify a whole export from the empty state: VALID, or the first line that a
 * VALID verdict cannot get past. Framing faults are attributed per EX-18 and
 * EX-20; a BOM, CR, blank or whitespace line is refused by `checkLine` itself.
 */
export function verifyExport(bytes: Uint8Array): ExportResult {
  if (bytes.length === 0) {
    return {
      ok: false,
      line: 1,
      refusal: { kind: "invalid", rule: "EX-18", reason: "empty export" },
    };
  }
  const { records, unterminated } = splitExport(bytes);
  let state = initialState();
  for (let i = 0; i < records.length; i++) {
    if (unterminated && i === records.length - 1) {
      return {
        ok: false,
        line: i + 1,
        refusal: { kind: "invalid", rule: "EX-4", reason: "no final LF" },
      };
    }
    const r = checkLine(state, records[i] ?? new Uint8Array());
    if (!r.ok) return { ok: false, line: i + 1, refusal: r.refusal };
    state = r.state;
  }
  return { ok: true, lineCount: records.length, state };
}

/** Replay accepted lines into a state (e.g. the stored log at startup). */
export function replay(lines: Iterable<Uint8Array>): ExportResult {
  let state = initialState();
  let n = 0;
  for (const line of lines) {
    n++;
    const r = checkLine(state, line);
    if (!r.ok) return { ok: false, line: n, refusal: r.refusal };
    state = r.state;
  }
  return { ok: true, lineCount: n, state };
}
