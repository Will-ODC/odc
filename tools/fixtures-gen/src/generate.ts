// Writes contracts/fixtures/ from the vector table.
//
// Output is committed as raw bytes and protected by a SHA-256 manifest that CI
// verifies, plus `contracts/fixtures/** -text` in .gitattributes. Detection, not
// encoding, is what closes the silent-corruption hole: a checkout that mangles a
// line ending fails the manifest instead of quietly changing a golden value.

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GENESIS_TS, OPERATOR, REGISTRAR } from "./chain.js";
import { participantId, preimage } from "./encode.js";
import { GENESIS_EVENT, vectors } from "./vectors/index.js";

const here = dirname(fileURLToPath(import.meta.url));
/** dist/src → dist → fixtures-gen → tools → repo root. */
const repoRoot = resolve(here, "../../../..");
const fixturesDir = join(repoRoot, "contracts", "fixtures");
const vectorsDir = join(fixturesDir, "vectors");

/** The pubkey of ids.md §2's worked shape; ID-4 says T5 pins the digest. */
const IDS_WORKED_PUBKEY =
  "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";

const written: string[] = [];

function write(relPath: string, bytes: Buffer | string): void {
  const abs = join(fixturesDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  written.push(relPath);
}

function writeVectors(): void {
  const index = vectors.map((vec) => {
    const file = `vectors/${vec.id}.ndjson`;
    write(file, vec.bytes);
    return {
      id: vec.id,
      export: file,
      ...(vec.head === undefined ? {} : { head: vec.head }),
      expect: vec.expect,
      cites: vec.cites,
      note: vec.note,
    };
  });
  write("index.json", `${JSON.stringify({ vectors: index }, null, 2)}\n`);
}

/**
 * hashing.md §6.2 pins the complete 607-octet hash preimage "as fixture 001".
 * Committing the bytes lets an implementer diff their own preimage against the
 * spec's before they ever reach a digest — the fastest way to localize a
 * byte-layout bug, and the reason this file exists separately from the vector.
 */
function writePreimage(): void {
  write(
    "preimages/001-genesis-only.hex",
    `${preimage(GENESIS_EVENT).toString("hex")}\n`,
  );
}

/**
 * ids.md ID-4/ID-5: sha256 of the 32 DECODED key bytes, never of the hex text.
 * Pinned because hashing the hex string is the obvious wrong implementation and
 * nothing else in the fixture set would catch it.
 */
function writeDerivations(): void {
  const doc = {
    participant_id: [
      {
        cites: ["ID-4", "ID-5"],
        pubkey: IDS_WORKED_PUBKEY,
        participant_id: participantId(IDS_WORKED_PUBKEY),
        note: "The worked shape of ids.md §2, over the 32 decoded key bytes.",
      },
    ],
    chain_id: [
      {
        cites: ["ET-7"],
        operator_pk: OPERATOR.publicKeyHex,
        chain_id: participantId(OPERATOR.publicKeyHex),
        note: "The same derivation applied to operator_pk; matches vector 001.",
      },
    ],
    keys: {
      note: "Ed25519 keypairs of hashing.md §6, from 32-octet seeds of one repeated byte. Reproduce these before trusting any signature vector.",
      operator: { seed_octet: "0x01", public_key: OPERATOR.publicKeyHex },
      registrar: { seed_octet: "0x02", public_key: REGISTRAR.publicKeyHex },
      genesis_ts: GENESIS_TS,
    },
  };
  write("derivations.json", `${JSON.stringify(doc, null, 2)}\n`);
}

/** `sha256sum -c`-compatible, so CI needs no bespoke checker. */
function writeManifest(): void {
  const body = [...written]
    .sort()
    .map((relPath) => {
      const digest = createHash("sha256")
        .update(readFileSync(join(fixturesDir, relPath)))
        .digest("hex");
      return `${digest}  ${relPath}`;
    })
    .join("\n");
  writeFileSync(join(fixturesDir, "MANIFEST.sha256"), `${body}\n`);
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

function report(): void {
  const tally = new Map<string, number>();
  for (const vec of vectors) {
    tally.set(vec.expect.verdict, (tally.get(vec.expect.verdict) ?? 0) + 1);
  }
  const counts = [...tally.entries()]
    .map(([k, n]) => `${k} ${String(n)}`)
    .join(", ");
  process.stdout.write(
    `wrote ${String(vectors.length)} vectors (${counts}); ` +
      `${String(countFiles(fixturesDir))} files under ${relative(repoRoot, fixturesDir)}\n`,
  );
}

// Rebuild vectors/ from scratch so a renamed or deleted vector cannot linger.
rmSync(vectorsDir, { recursive: true, force: true });
mkdirSync(vectorsDir, { recursive: true });
writeVectors();
writePreimage();
writeDerivations();
writeManifest();
report();
