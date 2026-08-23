// Shared harness for building synthetic `genesis` exports in tests.
//
// EVERY chain this builds is SYNTHETIC AND SELF-CONSISTENT: it is hashed by
// `hashing.ts` and signed over a preimage that same module produces, i.e. by
// the functions under test. That makes it worthless as evidence about the
// preimage — a preimage bug moves both sides of the comparison together — and
// it is never a substitute for `contracts/fixtures/`, which is the oracle for
// what a given input verifies to. It exists only to reach rules the fixture
// corpus does not yet cover, and it lives in one file so the two suites that
// need it cannot drift into two subtly different signing harnesses.

import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { type Verdict } from "../src/verify.js";
import { parseEventLine, type ParsedEvent } from "../src/parse.js";
import { computeHash, signingPreimage } from "../src/hashing.js";

export const ZERO64 = "0".repeat(64);
const PLACEHOLDER_SIG = "0".repeat(128);
const TS = "2026-01-01T00:00:00.000Z";

export interface KeyPair {
  priv: KeyObject;
  rawPub: Buffer;
  hex: string;
}

export function keypair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // SPKI DER for Ed25519 is a fixed 12-byte header then the 32 raw octets.
  const der = publicKey.export({ format: "der", type: "spki" });
  const rawPub = Buffer.from(der.subarray(der.length - 32));
  return { priv: privateKey, rawPub, hex: rawPub.toString("hex") };
}

/** Two distinct keypairs — ET-9d requires operator_pk !== registrar_pk. */
export function operatorAndRegistrar(): { op: KeyPair; reg: KeyPair } {
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
export function genesisExport(
  extra: Record<string, string>,
  opts: {
    version?: number;
    sign?: boolean;
    registrarPk?: (operatorHex: string) => string;
  } = {},
): Buffer {
  const version = opts.version ?? 1;
  const doSign = opts.sign ?? true;
  const { op, reg } = operatorAndRegistrar();
  const base: Record<string, string> = {
    chain_id: createHash("sha256").update(op.rawPub).digest("hex"),
    contracts: "contracts-v1",
    operator_pk: op.hex,
    // `registrarPk` overrides the freshly generated (and therefore distinct)
    // registrar key. It is a FUNCTION OF the operator hex, not a bare string,
    // because the operator key is generated in here: a caller wanting the
    // ET-9d collapse must be able to say "whatever operator_pk turned out to
    // be", which a bare string cannot express — it would silently produce two
    // distinct keys and a test that passes for the wrong reason. Only ET-9d's
    // suite passes this; every other caller gets two distinct keys.
    registrar_pk: opts.registrarPk ? opts.registrarPk(op.hex) : reg.hex,
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
export function tokenAndLine(v: Verdict): string {
  switch (v.verdict) {
    case "VALID":
      return "VALID";
    case "INVALID":
      return `INVALID at line ${v.line}`;
    case "PARTIAL":
      return `PARTIAL at lines ${v.lines.join(",")}`;
  }
}
