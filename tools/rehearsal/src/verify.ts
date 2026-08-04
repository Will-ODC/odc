// Self-verification of a rehearsal export (Phase 0 T6d): recompute each `hash`,
// walk the `prev_hash` links, verify every signature, and name the LINE a
// failure lands on — the four things `docs/plans/phase-0.md` T6 names as its
// acceptance.
//
// NOT a verifier, and must not grow into one: no VALID/INVALID/PARTIAL verdict,
// no fixture execution, no EV-17 precedence, no unregistered-type handling. T7
// is the first thing that does any of that, from `contracts/` alone in a fresh
// context — one written here would share this package's reading of `encode.ts`
// and agree with it by construction (T6 scope decision, 2026-07-28).
//
// Canonical line form and `seq` contiguity go beyond those four because without
// them two tamper cases are invisible: `reserialized-line` changes no value,
// and deletion/reordering leave every surviving line self-consistent.

import type { Event, EventContent, Payload } from "@odc/fixtures-gen/encode";
import { eventHash, verifyEvent } from "@odc/fixtures-gen/encode";
import { serializeEvent } from "@odc/fixtures-gen/serialize";

import { GENESIS_PREV_HASH as ANCHOR } from "@odc/fixtures-gen/chain";

import { exportLines } from "./tamper.js";

// ES-24's 64-zero anchor. Re-exported, not re-declared: `chain.ts` owns it.
export { GENESIS_PREV_HASH } from "@odc/fixtures-gen/chain";

export interface VerifyFailure {
  readonly ok: false;
  /** 1-based line the failure is attributed to. */
  readonly line: number;
  /** The contract sentence violated. Advisory, exactly as EV-17 has it. */
  readonly rule: string;
  readonly detail: string;
}

export type VerifyResult = { readonly ok: true } | VerifyFailure;

const fail = (line: number, rule: string, detail: string): VerifyFailure => ({
  ok: false,
  line,
  rule,
  detail,
});

/** The two keys a chain's genesis declares (ET-6). */
interface Keys {
  operator: string;
  registrar: string;
}

/** The public key whose signature each v1 type carries, or null if unsigned. */
function signerKey(e: Event, genesis: Keys): string | null {
  switch (e.type) {
    case "genesis":
      return str(e.payload, "operator_pk"); // ET-8: self-signed.
    case "participant_registered":
      return str(e.payload, "pubkey"); // ET-10: self-signed.
    case "issue_created":
      return genesis.operator; // ET-13.
    case "vote_cast":
      return genesis.registrar; // ET-17.
    default:
      return null;
  }
}

function str(p: Payload, key: string): string | null {
  const v = p[key];
  return typeof v === "string" ? v : null;
}

/** ES-5: a non-negative JSON integer. `typeof === "number"` is not enough — a
 * float or a negative reaches `U64` and throws instead of failing here. */
const isEsInt = (v: unknown): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2 ** 53 - 1;

/**
 * Parses one line, rejecting anything that is not a seven-field envelope whose
 * values are legal for v1. The value checks are not decoration: without them a
 * shaped-but-illegal line (`"seq":2.5`, a boolean in `payload`) reaches
 * `serializeEvent`/`eventHash` and THROWS, so the tool crashes on the malformed
 * input it exists to describe instead of naming the line.
 */
function parseLine(line: string): Event | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  const payload = e["payload"];
  const shaped =
    isEsInt(e["seq"]) &&
    typeof e["type"] === "string" &&
    isEsInt(e["version"]) &&
    typeof e["ts"] === "string" &&
    typeof e["prev_hash"] === "string" &&
    typeof e["hash"] === "string" &&
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload);
  if (!shaped) return null;
  // ES-16/ES-17: every payload value is an ES-5 integer or a string. Floats,
  // booleans, null, arrays and nested objects are all rejected here.
  for (const pv of Object.values(payload as Record<string, unknown>)) {
    if (!isEsInt(pv) && typeof pv !== "string") return null;
  }
  return v as Event;
}

/** Pulls a rule id out of an encoder's own message so a caught throw keeps the
 * attribution its thrower knew (`ID-3`, `EX-10`). Advisory, as EV-17 has it. */
function ruleOf(message: string): string {
  return /\b([A-Z]{2}-\d+[a-z]?)\b/.exec(message)?.[1] ?? UNATTRIBUTED;
}

/** The backstop's rule when a thrower named none. Deliberately NOT `ES-1`:
 * sharing `parseLine`'s rule made the paths indistinguishable, so deleting any
 * value guard left the suite green — the defect fell through and came back
 * wearing the same rule. */
export const UNATTRIBUTED = "UNATTRIBUTED";

/**
 * Verifies an export against a claimed head.
 *
 * Checks run line by line, lowest line first, so the reported line is the
 * earliest defective one. Within a line the order is: canonical bytes, `seq`,
 * `prev_hash`, `hash`, signature — each later check assumes the earlier ones
 * held. The first failure returns; nothing accumulates.
 *
 * Framing (EX-3/EX-4/EX-5) is checked by `exportLines`, which THROWS rather
 * than returning a failure, because a stray CR or a missing final LF belongs to
 * no single line. That is the ONLY throwing path: every per-line defect,
 * including one an encoder signals by throwing, comes back as a failure naming
 * its line.
 */
export function selfVerify(target: {
  readonly ndjson: Buffer;
  readonly head: string;
}): VerifyResult {
  const lines = exportLines(target.ndjson);
  const events: Event[] = [];
  // Boxed so `verifyLine` can publish the keys line 1 declares. Set on the
  // first iteration and non-null for every later one.
  const genesis: { keys: Keys | null } = { keys: null };

  for (let i = 0; i < lines.length; i += 1) {
    const n = i + 1;
    let step: VerifyResult;
    // Backstop: the encoders carry their own MUSTs (EX-10 well-formed UTF-8,
    // ID-3 lowercase key) and signal them by THROWING. A throw would crash on
    // exactly the input this tool exists to describe, so it becomes a failure
    // attributed to the line that caused it.
    try {
      step = verifyLine(i, lines[i] as string, events, genesis);
    } catch (err) {
      const message = (err as Error).message;
      return fail(n, ruleOf(message), message);
    }
    if (!step.ok) return step;
  }

  // EX-15: the claimed head must equal the last line's stored hash. EX-19
  // attributes a head mismatch to the last line present — which is what makes
  // a truncated-but-consistent prefix detectable at all. `exportLines` rejects
  // the empty export before the loop, so there is always a last line.
  const last = events[events.length - 1] as Event;
  if (target.head !== last.hash) {
    return fail(events.length, "EX-15", "head is not the last line's hash");
  }

  return { ok: true };
}

/** One line's checks, in order. Split out so the loop wraps it in one catch. */
function verifyLine(
  i: number,
  line: string,
  events: Event[],
  genesis: { keys: Keys | null },
): VerifyResult {
  const n = i + 1;
  const e = parseLine(line);
  if (e === null) return fail(n, "ES-1", "not a seven-field envelope object");

  // EX-7/EX-10: the bytes must BE the canonical form, not merely parse to the
  // same event. This is the only check that can see a reordered key.
  if (serializeEvent(e) !== line) {
    return fail(n, "EX-7", "line is not the canonical serialization");
  }

  // ES-7: `seq` starts at 1 and increments by exactly 1.
  if (e.seq !== n) {
    return fail(n, "ES-7", `seq is ${String(e.seq)}, expected ${String(n)}`);
  }

  // ES-24 / ES-25: line 1 anchors at 64 zeros; every later line names the hash
  // STORED by the line before it.
  const expectedPrev = i === 0 ? ANCHOR : (events[i - 1] as Event).hash;
  if (e.prev_hash !== expectedPrev) {
    return fail(n, "ES-25", "prev_hash does not name the previous line");
  }

  // HA-13: recompute from the six content fields.
  const content: EventContent = {
    seq: e.seq,
    type: e.type,
    version: e.version,
    payload: e.payload,
    ts: e.ts,
    prev_hash: e.prev_hash,
  };
  if (eventHash(content) !== e.hash) {
    return fail(n, "HA-13", "hash does not match the recomputed preimage");
  }

  if (i === 0) {
    // ES-33 / EX-12: the first event MUST be the genesis event.
    if (e.type !== "genesis") return fail(1, "ES-33", "line 1 is not genesis");
    const operator = str(e.payload, "operator_pk");
    const registrar = str(e.payload, "registrar_pk");
    if (operator === null || registrar === null) {
      // ES-18 governs the payload key set. NOT ET-6 (version/seq/prev_hash),
      // and no `ET-n` names these two keys — that gap IS ticket T5j.
      return fail(1, "ES-18", "genesis declares no operator_pk/registrar_pk");
    }
    genesis.keys = { operator, registrar };
  }

  // HA-16: Ed25519 over the signing preimage, under the key the TYPE names.
  // `keys` is set by the i === 0 branch above, which returns if it cannot be.
  const key = signerKey(e, genesis.keys as Keys);
  if (key === null) {
    // ET-1: the v1 registry is exactly four types. ET-2a/EV-9 refine "reject"
    // to PARTIAL for a well-formed unregistered type — a CONFORMANCE verifier
    // must NOT reject one. This is not that: a rehearsal chain has only the
    // four, so an unknown type is a builder bug. This licenses nothing.
    return fail(n, "ET-1", `unknown type for self-verify: ${e.type}`);
  }
  const sig = str(e.payload, "sig");
  if (sig === null) return fail(n, "ES-30", "payload carries no sig string");
  if (!verifyEvent(content, key, sig)) {
    return fail(n, "HA-16", "signature does not verify under the type's key");
  }

  events.push(e);
  return { ok: true };
}
