// Writes contracts/fixtures/ from the vector table.
//
// Output is committed as raw bytes and protected by a SHA-256 manifest that CI
// verifies, plus `contracts/fixtures/** -text` in .gitattributes. Detection, not
// encoding, is what closes the silent-corruption hole: a checkout that mangles a
// line ending fails the manifest instead of quietly changing a golden value.

import { createHash } from "node:crypto";
import {
  existsSync,
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
import { GENESIS_EVENT, ISSUE_EVENT, vectors } from "./vectors/index.js";

const here = dirname(fileURLToPath(import.meta.url));
/** dist/src → dist → fixtures-gen → tools → repo root. */
const repoRoot = resolve(here, "../../../..");
// repoRoot is positional, so a tsconfig change that flattened the output would
// resolve one level ABOVE the repo — where the rmSync below would recurse over
// an unrelated directory, force:true swallowing the ENOENT that should have
// exposed it. Fail loudly instead.
if (!existsSync(join(repoRoot, "contracts", "hashing.md"))) {
  throw new Error(
    `resolved repo root ${repoRoot} has no contracts/hashing.md — refusing to write or delete anything`,
  );
}

const fixturesDir = join(repoRoot, "contracts", "fixtures");
const vectorsDir = join(fixturesDir, "vectors");
const preimagesDir = join(fixturesDir, "preimages");

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
function writePreimages(): void {
  write(
    "preimages/001-genesis-only.hex",
    `${preimage(GENESIS_EVENT).toString("hex")}\n`,
  );
  // The 001 preimage is all strings, so every payload entry in it carries the
  // 0x73 tag and ENC_INT appears only in the envelope's seq/version. A wrong
  // ENC_INT, or a swapped 0x69/0x73 (HA-9), is therefore visible in the shipped
  // bytes only as a digest that does not match — with nothing to diff. The
  // issue_created at seq 3 of vector 002 is the smallest artifact that fixes
  // that: its payload is {ballot_batch_interval_ms, ballot_batch_min,
  // choice_count (all integers), sig, title}, so it carries the 0x69 tag, three
  // ENC_INT payload values, and the 0x69/0x73 adjacency in HA-8 key order, all
  // in one preimage an implementer can diff byte for byte.
  write(
    "preimages/002-four-types-seq3.hex",
    `${preimage(ISSUE_EVENT).toString("hex")}\n`,
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
      note: "TEST KEYS — never use on a real chain. These are the Ed25519 keypairs of hashing.md §6, from 32-octet seeds of one repeated byte; the seeds are published spec material, so any holder of this repo can forge signatures under them. Reproduce them before trusting any signature vector.",
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

// Rebuild both generated directories so a renamed or deleted artifact cannot
// linger. A stale preimage still passes sha256sum -c, so only the manifest's
// unlisted-file half would catch it.
for (const dir of [vectorsDir, preimagesDir]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
writeVectors();
writePreimages();
writeDerivations();
writeManifest();
report();
