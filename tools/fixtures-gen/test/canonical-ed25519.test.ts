// ET-4a / ET-4b isolation: 078/079/080 must each fail for exactly ONE canonical-
// encoding rule and nothing else.
//
// The canonical-encoding predicates are reimplemented here directly from the spec
// text (event-types.md ET-4a/ET-4b) rather than imported from the generator, so
// this asserts the COMMITTED bytes against the contract, not against the code that
// wrote them — the same discipline genesis-keys.test.ts uses. An independent
// verifier (T7/T7b) reads exactly these bytes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { chainId, eventHash, verifyEvent, type Event } from "../src/encode.js";
import { OPERATOR } from "../src/chain.js";
import { vectors } from "../src/vectors/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(here, "../../../..", "contracts", "fixtures");
const read = (rel: string): Buffer => readFileSync(join(fixturesDir, rel));

// --- the checks, straight from ET-4a / ET-4b -------------------------------

const L = (1n << 252n) + 27742317777372353535851937790883648493n; // subgroup order
const P = (1n << 255n) - 19n; // field prime

function leToBig(b: Buffer): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i -= 1)
    n = (n << 8n) | BigInt(b[i] as number);
  return n;
}

/** ET-4a(i): trailing 32 bytes, little-endian, MUST be < L. */
function canonicalS(sigHex: string): boolean {
  return leToBig(Buffer.from(sigHex, "hex").subarray(32, 64)) < L;
}

/** ET-4a(ii): leading 32 bytes, bit 255 cleared, little-endian, MUST be < p. */
function canonicalR(sigHex: string): boolean {
  return masked(Buffer.from(sigHex, "hex").subarray(0, 32)) < P;
}

/** ET-4b: the 32 key bytes, bit 255 cleared, little-endian, MUST be < p. */
function canonicalA(keyHex: string): boolean {
  return masked(Buffer.from(keyHex, "hex")) < P;
}

/** Clear bit 255 (the x-sign bit — high bit of byte 31) and read little-endian. */
function masked(b32: Buffer): bigint {
  const b = Buffer.from(b32);
  b[31] = (b[31] as number) & 0x7f;
  return leToBig(b);
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const LOWER_HEX_128 = /^[0-9a-f]{128}$/;

/** Line 2 of a two-line vector (genesis then the offending participant). */
function participantOf(id: string): Event {
  const fileLines = read(`vectors/${id}.ndjson`)
    .toString("utf8")
    .trimEnd()
    .split("\n");
  assert.equal(fileLines.length, 2, `${id}: expected genesis + one event`);
  return JSON.parse(fileLines[1] as string) as Event;
}

function pk(e: Event): string {
  return (e.payload as Record<string, string>)["pubkey"] as string;
}
function sig(e: Event): string {
  return (e.payload as Record<string, string>)["sig"] as string;
}

// --- the checks do not false-positive on canonical inputs ------------------

test("the ET-4a/ET-4b checks accept a genuinely canonical key and signature", () => {
  // The valid genesis on line 1 of every one of these vectors.
  const genesis = JSON.parse(
    read("vectors/078-noncanonical-a.ndjson")
      .toString("utf8")
      .split("\n")[0] as string,
  ) as Event;
  const gsig = (genesis.payload as Record<string, string>)["sig"] as string;
  assert.ok(canonicalA(OPERATOR.publicKeyHex), "operator key is canonical");
  assert.ok(canonicalS(gsig), "genesis sig has canonical S");
  assert.ok(canonicalR(gsig), "genesis sig has canonical R");
});

// --- 078: non-canonical verification key A (DISCRIMINATING) ----------------

test("078-noncanonical-a: only ET-4b fails — key A non-canonical, sig verifies", () => {
  const e = participantOf("078-noncanonical-a");
  assert.equal(e.type, "participant_registered");

  // hash recomputes (HA-14) and the chain links: not a Stage-A failure.
  assert.equal(eventHash(e), e.hash, "hash does not recompute");

  // Format passes: 64 lowercase hex key, 128 lowercase hex sig (ES-31/ID-3).
  assert.match(pk(e), LOWER_HEX_64, "pubkey is not 64 lowercase hex");
  assert.match(sig(e), LOWER_HEX_128, "sig is not 128 lowercase hex");

  // ET-10 self-signature VERIFIES under the (non-canonical) key — this is what
  // makes the vector discriminating: a verifier without ET-4b accepts.
  assert.ok(verifyEvent(e, pk(e), sig(e)), "degenerate self-sig must verify");

  // participant_id still derives from the decoded bytes.
  assert.doesNotThrow(() => chainId(pk(e)), "participant_id must still derive");

  // The sig itself is canonical; the SOLE fault is the key.
  assert.ok(canonicalS(sig(e)), "S must be canonical (isolates ET-4b)");
  assert.ok(canonicalR(sig(e)), "R must be canonical (isolates ET-4b)");
  assert.ok(!canonicalA(pk(e)), "ET-4b must fail: key A is non-canonical");
});

// --- 079: non-canonical S (pin) --------------------------------------------

test("079-noncanonical-s: only ET-4a(i) fails — S >= L, hash relinked", () => {
  const e = participantOf("079-noncanonical-s");
  assert.equal(e.type, "participant_registered");

  assert.equal(
    eventHash(e),
    e.hash,
    "hash must be recomputed over the mutated sig",
  );
  assert.match(sig(e), LOWER_HEX_128, "sig is still 128 lowercase hex (ES-31)");

  // The mutated sig does not verify; both S and the primitive reject it.
  assert.ok(!verifyEvent(e, pk(e), sig(e)), "S+L sig must not verify");

  // Sole fault is S; R and the key are canonical.
  assert.ok(!canonicalS(sig(e)), "ET-4a(i) must fail: S >= L");
  assert.ok(canonicalR(sig(e)), "R must be canonical (isolates ET-4a(i))");
  assert.ok(canonicalA(pk(e)), "key A must be canonical (isolates ET-4a(i))");
});

// --- 080: non-canonical R (pin) --------------------------------------------

test("080-noncanonical-r: only ET-4a(ii) fails — R >= p, hash relinked", () => {
  const e = participantOf("080-noncanonical-r");
  assert.equal(e.type, "participant_registered");

  assert.equal(
    eventHash(e),
    e.hash,
    "hash must be recomputed over the mutated sig",
  );
  assert.match(sig(e), LOWER_HEX_128, "sig is still 128 lowercase hex (ES-31)");

  assert.ok(
    !verifyEvent(e, pk(e), sig(e)),
    "non-canonical R sig must not verify",
  );

  // Sole fault is R; S and the key are canonical.
  assert.ok(!canonicalR(sig(e)), "ET-4a(ii) must fail: masked R >= p");
  assert.ok(canonicalS(sig(e)), "S must be canonical (isolates ET-4a(ii))");
  assert.ok(canonicalA(pk(e)), "key A must be canonical (isolates ET-4a(ii))");
});

// --- declared verdicts ------------------------------------------------------

for (const id of [
  "078-noncanonical-a",
  "079-noncanonical-s",
  "080-noncanonical-r",
]) {
  test(`${id}: declares INVALID at line 2`, () => {
    const vec = vectors.find((v) => v.id === id);
    assert.ok(vec !== undefined, `${id} is not in the vector table`);
    assert.deepEqual(vec.expect, { verdict: "INVALID", line: 2 });
  });
}
