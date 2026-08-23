// ET-9e / ET-9f (the two OPTIONAL `genesis` ancestry keys) and EV-20 (an
// unregistered `genesis` version).
//
// WHAT THIS FILE IS, AND WHAT IT IS NOT. `contracts/fixtures/` carries no
// vector for ET-9e, ET-9f or EV-20 — the corpus is behind `event-types.md` v9
// / `evolution.md` v4 on exactly this area (no vector cites ET-9d, ET-9e,
// ET-9f, ES-34 or EV-20). Until it does, these behaviours have no fixture
// oracle, so this file builds its own chains. Every chain here is SYNTHETIC
// AND SELF-CONSISTENT: it is hashed by `hashing.ts` and signed over a preimage
// that same module produces, i.e. by the functions under test. That makes it
// worthless as evidence about the preimage — a preimage bug would be invisible
// here because both sides of the comparison move together — and it is NOT
// recorded as pinning any fixture-owed shape. When the fixture corpus grows a
// vector for these rules, that vector is the oracle and these assertions are
// subordinate to it.
//
// What a self-consistent chain CAN detect is the regression this change is
// most likely to introduce: an optional key that is silently dropped on the
// floor or rejected outright. Nothing in the hashing path is type-specific, so
// the accept/reject decision on `ancestor_chain` / `ancestor_head` is made in
// `stageB` alone and does not move with the harness. A suite where every new
// case asserted INVALID would still pass if the key were rejected; the
// acceptance cases below are the ones that would fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { verifyExport, type Verdict } from "../src/verify.js";
import { parseEventLine, type ParsedEvent } from "../src/parse.js";
import { computeHash, signingPreimage } from "../src/hashing.js";

const ZERO64 = "0".repeat(64);
const PLACEHOLDER_SIG = "0".repeat(128);
const TS = "2026-01-01T00:00:00.000Z";

interface KeyPair {
  priv: KeyObject;
  rawPub: Buffer;
  hex: string;
}

function keypair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // SPKI DER for Ed25519 is a fixed 12-byte header then the 32 raw octets.
  const der = publicKey.export({ format: "der", type: "spki" });
  const rawPub = Buffer.from(der.subarray(der.length - 32));
  return { priv: privateKey, rawPub, hex: rawPub.toString("hex") };
}

/** Two distinct keypairs — ET-9d requires operator_pk !== registrar_pk. */
function operatorAndRegistrar(): { op: KeyPair; reg: KeyPair } {
  const op = keypair();
  let reg = keypair();
  while (reg.hex === op.hex) reg = keypair();
  return { op, reg };
}

/** Parse a harness-built line, failing loudly if the harness itself is broken. */
function mustParse(line: string): ParsedEvent {
  const parsed = parseEventLine(Buffer.from(line, "utf8"));
  assert.notEqual(parsed, null, `harness built an unparseable line: ${line}`);
  return parsed as ParsedEvent;
}

function jsonString(s: string): string {
  return `"${s}"`;
}

/**
 * Serialize a payload in the canonical line form: compact, keys in ascending
 * UTF-8 byte order (EX-8). Every key used here is lowercase ASCII, so the
 * plain byte sort is the code-unit sort.
 */
function payloadJson(entries: Record<string, string>): string {
  const keys = Object.keys(entries).sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")),
  );
  return (
    "{" +
    keys
      .map((k) => `${jsonString(k)}:${jsonString(entries[k] as string)}`)
      .join(",") +
    "}"
  );
}

function eventLine(
  seq: number,
  type: string,
  version: number,
  payload: string,
  prevHash: string,
  hash: string,
): string {
  return (
    `{"seq":${seq},"type":${jsonString(type)},"version":${version},` +
    `"payload":${payload},"ts":${jsonString(TS)},` +
    `"prev_hash":${jsonString(prevHash)},"hash":${jsonString(hash)}}`
  );
}

/**
 * Build a one-event export whose `genesis` carries `extra` alongside the five
 * required keys. Signed by `operator_pk` (ET-8) and hashed by `hashing.ts`.
 * `sign: false` skips signing (used where Stage B never runs, e.g. EV-20).
 */
function genesisExport(
  extra: Record<string, string>,
  opts: { version?: number; sign?: boolean } = {},
): Buffer {
  const version = opts.version ?? 1;
  const doSign = opts.sign ?? true;
  const { op, reg } = operatorAndRegistrar();
  const base: Record<string, string> = {
    chain_id: createHash("sha256").update(op.rawPub).digest("hex"),
    contracts: "contracts-v1",
    operator_pk: op.hex,
    registrar_pk: reg.hex,
    ...extra,
  };

  // Pass 1: placeholder sig. HA-15/HA-16 drop the `sig` key from the signing
  // preimage entirely, so its placeholder value cannot affect the signature.
  const draft = eventLine(
    1,
    "genesis",
    version,
    payloadJson({ ...base, sig: PLACEHOLDER_SIG }),
    ZERO64,
    ZERO64,
  );
  const parsedDraft = mustParse(draft);
  const sigHex = doSign
    ? sign(null, signingPreimage(parsedDraft), op.priv).toString("hex")
    : PLACEHOLDER_SIG;

  // Pass 2: real sig, then the hash over the completed payload (HA-13).
  const withSig = payloadJson({ ...base, sig: sigHex });
  const hash = computeHash(
    mustParse(eventLine(1, "genesis", version, withSig, ZERO64, ZERO64)),
  );

  return Buffer.from(
    eventLine(1, "genesis", version, withSig, ZERO64, hash) + "\n",
    "utf8",
  );
}

/** Token + line only. Reason text is advisory and never asserted (EV-17). */
function tokenAndLine(v: Verdict): string {
  switch (v.verdict) {
    case "VALID":
      return "VALID";
    case "INVALID":
      return `INVALID at line ${v.line}`;
    case "PARTIAL":
      return `PARTIAL at lines ${v.lines.join(",")}`;
  }
}

const A_CHAIN = "a".repeat(64);
const A_HEAD = "b".repeat(64);

// --- the harness itself ------------------------------------------------------

test("harness: a genesis with neither ancestry key verifies (calibration only)", () => {
  // Not evidence about the preimage — see the file header. It exists so that a
  // failure in the cases below is attributable to the ancestry keys rather
  // than to the harness having produced a broken chain.
  assert.equal(tokenAndLine(verifyExport(genesisExport({}))), "VALID");
});

// --- ET-9e / ET-9f: what MUST be accepted ------------------------------------

test("accepts a genesis carrying ancestor_chain alone (ET-9f permits the chain-only form)", () => {
  // The load-bearing acceptance case. ET-9f's asymmetry is deliberate: a named
  // chain with no recorded fork point is the weaker but coherent claim. If the
  // optional key were rejected, or the key-set check still demanded exactly
  // five keys, this is what fails.
  const out = verifyExport(genesisExport({ ancestor_chain: A_CHAIN }));
  assert.equal(tokenAndLine(out), "VALID");
});

test("accepts a genesis carrying both ancestor_chain and ancestor_head", () => {
  const out = verifyExport(
    genesisExport({ ancestor_chain: A_CHAIN, ancestor_head: A_HEAD }),
  );
  assert.equal(tokenAndLine(out), "VALID");
});

test("accepts ancestor_chain equal to ancestor_head (a fork from a genesis-only parent)", () => {
  // A parent holding only its genesis event has a head equal to its genesis
  // hash, so name and position coincide. Nothing in ET-9e/ET-9f makes that a
  // duplicate to reject; a naive "these must differ" check breaks exactly here.
  const out = verifyExport(
    genesisExport({ ancestor_chain: A_CHAIN, ancestor_head: A_CHAIN }),
  );
  assert.equal(tokenAndLine(out), "VALID");
});

test("accepts an unresolvable ancestor_chain — the verifier resolves nothing (ET-9e)", () => {
  // The value names no chain this verifier holds and cannot be checked against
  // anything. ET-9e: a verifier MUST NOT report INVALID because it cannot
  // resolve the value, and MUST NOT treat unresolvability as a defect.
  const out = verifyExport(genesisExport({ ancestor_chain: "f".repeat(64) }));
  assert.equal(tokenAndLine(out), "VALID");
});

// --- ET-9f: the one form that MUST be rejected -------------------------------

test("rejects a genesis carrying ancestor_head without ancestor_chain (ET-9f)", () => {
  // A position on an unnamed chain — the head-alone anchoring charter §4
  // rejects (ET-7a). This is the ONLY presence combination ET-9f bars.
  const out = verifyExport(genesisExport({ ancestor_head: A_HEAD }));
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

// --- ET-9e: the format gate on each present key ------------------------------

test("rejects an uppercase-hex ancestor_chain (ET-9e format gate; never lowercased)", () => {
  const out = verifyExport(genesisExport({ ancestor_chain: "A".repeat(64) }));
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("rejects a short ancestor_chain", () => {
  const out = verifyExport(genesisExport({ ancestor_chain: "a".repeat(63) }));
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("rejects the 64-zero anchor as ancestor_chain (ET-9e bars the placeholder form)", () => {
  // Absence is the one way to say "no ancestor" (ES-34); the 64-zero string
  // keeps its single meaning as prev_hash's anchor (ES-24).
  const out = verifyExport(genesisExport({ ancestor_chain: ZERO64 }));
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("rejects the 64-zero anchor as ancestor_head even with a legal ancestor_chain", () => {
  const out = verifyExport(
    genesisExport({ ancestor_chain: A_CHAIN, ancestor_head: ZERO64 }),
  );
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("rejects a malformed ancestor_head carried without ancestor_chain (two faults, one line)", () => {
  // ET-9f is explicit that no precedence between concurrent genesis faults is
  // needed or defined: both sit on line 1, and conformance is the token and
  // the line number only (EV-17).
  const out = verifyExport(genesisExport({ ancestor_head: "zz" }));
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

// --- ES-34: OPTIONAL widens absence, never the key set -----------------------

test("still rejects a genesis payload key that is not defined for (genesis, 1) (ES-18/ES-34)", () => {
  const out = verifyExport(genesisExport({ ancestor_notes: A_CHAIN }));
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

// --- EV-20: an unregistered genesis version ----------------------------------

test("reports INVALID at line 1 for a genesis at an unregistered version (EV-20)", () => {
  // 1000000 is the exact value EV-19 reserves for the unregistered-version
  // path. EV-20 is the sole exception to EV-8: this must NOT walk to PARTIAL.
  // Stage B never runs on an unregistered pair, so the event is unsigned; the
  // hash is still correct, so only the registration check can be reporting.
  const out = verifyExport(
    genesisExport({}, { version: 1000000, sign: false }),
  );
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("an unregistered genesis version is INVALID even carrying legal ancestry keys", () => {
  const out = verifyExport(
    genesisExport(
      { ancestor_chain: A_CHAIN, ancestor_head: A_HEAD },
      { version: 1000000, sign: false },
    ),
  );
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});
