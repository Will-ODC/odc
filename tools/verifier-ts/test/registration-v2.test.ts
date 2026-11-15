import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { computeHash, registrationSigningPreimage } from "../src/hashing.js";
import { parseEventLine } from "../src/parse.js";
import { verifyExport } from "../src/verify.js";
import {
  ZERO64,
  distinctKeypair,
  keypair,
  signedEventLine,
  tokenAndLine,
} from "./genesis-builder.js";

const TYPE = "participant_registered";
const GENESIS_TS = "2026-01-01T00:00:00.000Z";
const FIRST_TS = "2026-01-01T00:00:01.000Z";
const LATER_TS = "2026-01-01T00:00:02.000Z";

// HA-15a laid out independently in hex, one field per line.
function expectedPreimage(genesisHash: string, pubkey: string): Buffer {
  return Buffer.from(
    [
      "4f44432d52454732", // REG_DOMAIN
      "0000000000000016" + Buffer.from(TYPE, "ascii").toString("hex"),
      "0000000000000002", // version
      "0000000000000040" + Buffer.from(genesisHash, "ascii").toString("hex"),
      "0000000000000001", // payload entry count
      "73" + "0000000000000006" + "7075626b6579", // string key pubkey
      "0000000000000040" + Buffer.from(pubkey, "ascii").toString("hex"),
    ].join(""),
    "hex",
  );
}

function genesis(ts = GENESIS_TS) {
  return signedEventLine({
    seq: 1,
    type: "genesis",
    strings: {
      chain_id: createHash("sha256").update(operator.rawPub).digest("hex"),
      contracts: "contracts-v1",
      operator_pk: operator.hex,
      registrar_pk: registrar.hex,
    },
    ints: {},
    ts,
    prevHash: ZERO64,
    signer: operator,
  });
}

function registration(
  seq: number,
  prevHash: string,
  ts: string,
  payload: Record<string, string>,
) {
  const event = {
    seq,
    type: TYPE,
    version: 2,
    payload,
    ts,
    prev_hash: prevHash,
    hash: ZERO64,
  };
  const parsed = parseEventLine(Buffer.from(JSON.stringify(event)));
  assert.ok(parsed);
  event.hash = computeHash(parsed);
  return { line: JSON.stringify(event), hash: event.hash };
}

function exportBytes(...events: { line: string }[]): Buffer {
  return Buffer.from(events.map((ev) => ev.line + "\n").join(""));
}

const operator = keypair();
const registrar = distinctKeypair(operator.hex);
const participant = keypair();
const originalGenesis = genesis();
const pubkey = participant.hex;
const sig = sign(
  null,
  expectedPreimage(originalGenesis.hash, pubkey),
  participant.priv,
).toString("hex");

test("the registration signing preimage matches the HA-15a bytes", () => {
  const ev = registration(2, originalGenesis.hash, FIRST_TS, { pubkey, sig });
  const parsed = parseEventLine(Buffer.from(ev.line));
  assert.ok(parsed);
  assert.deepEqual(
    registrationSigningPreimage(parsed, originalGenesis.hash),
    expectedPreimage(originalGenesis.hash, pubkey),
  );
});

test("a v2 signature verifies at different positions and timestamps on its chain", () => {
  const first = registration(2, originalGenesis.hash, FIRST_TS, {
    pubkey,
    sig,
  });
  const later = registration(3, first.hash, LATER_TS, { pubkey, sig });
  assert.notEqual(first.hash, later.hash);
  assert.equal(
    tokenAndLine(verifyExport(exportBytes(originalGenesis, first, later))),
    "VALID",
  );
});

test("the CLI reports VALID with the v2 registration and both anchors", (t) => {
  const first = registration(2, originalGenesis.hash, FIRST_TS, {
    pubkey,
    sig,
  });
  const dir = mkdtempSync(
    fileURLToPath(new URL("./registration-v2-", import.meta.url)),
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "export.ndjson");
  writeFileSync(path, exportBytes(originalGenesis, first));
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "verify",
      path,
      "--chain",
      originalGenesis.hash,
      "--head",
      first.hash,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "VALID\n");
});

test("a v2 signature fails on a different genesis with the same declared keys", () => {
  const otherGenesis = genesis("2026-01-01T00:00:00.001Z");
  assert.notEqual(otherGenesis.hash, originalGenesis.hash);
  const copied = registration(2, otherGenesis.hash, FIRST_TS, { pubkey, sig });
  const bytes = exportBytes(otherGenesis, copied);
  assert.equal(tokenAndLine(verifyExport(bytes)), "INVALID at line 2");
  assert.equal(
    tokenAndLine(verifyExport(bytes, undefined, originalGenesis.hash)),
    "INVALID at line 2",
  );
});

test("a v2 registration rejects a signature over the HA-15 preimage", () => {
  const ev = signedEventLine({
    seq: 2,
    type: TYPE,
    version: 2,
    strings: { pubkey },
    ints: {},
    ts: FIRST_TS,
    prevHash: originalGenesis.hash,
    signer: participant,
  });
  assert.equal(
    tokenAndLine(verifyExport(exportBytes(originalGenesis, ev))),
    "INVALID at line 2",
  );
});

for (const [name, payload] of [
  ["an undefined participant_id key", { participant_id: ZERO64, pubkey, sig }],
  ["a missing signature", { pubkey }],
  ["uppercase key text", { pubkey: pubkey.toUpperCase(), sig }],
  ["uppercase signature text", { pubkey, sig: sig.toUpperCase() }],
  [
    "an identity-point key and signature",
    { pubkey: "01" + "00".repeat(31), sig: "01" + "00".repeat(63) },
  ],
  [
    "a non-canonical R encoding",
    { pubkey, sig: "ee" + "ff".repeat(30) + "7f" + sig.slice(64) },
  ],
] as const) {
  test(`a v2 registration rejects ${name}`, () => {
    const ev = registration(2, originalGenesis.hash, FIRST_TS, payload);
    assert.equal(
      tokenAndLine(verifyExport(exportBytes(originalGenesis, ev))),
      "INVALID at line 2",
    );
  });
}
