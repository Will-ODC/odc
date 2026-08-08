// ET-4a / ET-4b / ET-4c isolation: 078/079/080/081/082 must each fail for exactly
// ONE canonical-encoding / subgroup rule and nothing else.
//
// The canonical-encoding predicates (ET-4a/ET-4b) are reimplemented here directly
// from the spec text rather than imported from the generator, so this asserts the
// COMMITTED bytes against the contract, not against the code that wrote them — the
// same discipline genesis-keys.test.ts uses. ET-4c is exact curve arithmetic, so
// it is computed with @noble/curves here (the generator/test are not the stdlib-
// constrained verifier); the spec permits a verifier ONE audited curve library for
// exactly this check (ADR-0010). An independent verifier (T7/T7b) reads these bytes.
//
// ORDERING (ET-4a/ET-4b gate ET-4c): ET-4c is asserted ONLY on canonically-
// encoded keys. A non-canonical A (078) is rejected by ET-4b first and never
// reaches ET-4c — noble's Point.fromHex itself throws on y >= p — so isPrimeOrder
// is never applied to it. This matters because 078's decoded point is the (small-
// order) identity, so a RAW isPrimeOrder over the reduced value would also be
// false and would spuriously look like an ET-4c fault; gating it behind canonicalA
// keeps 078's sole declared fault ET-4b.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ed25519 } from "@noble/curves/ed25519.js";

import { chainId, eventHash, verifyEvent, type Event } from "../src/encode.js";
import { OPERATOR } from "../src/chain.js";
import { vectors } from "../src/vectors/index.js";

const Point = ed25519.Point;

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

/**
 * ET-4c, straight from the spec, on a key A decoded from a CANONICAL encoding.
 * Prime-order membership is `[L]A == 𝒪 AND A != 𝒪` (equivalently, for a noble-
 * based verifier, `A.isTorsionFree() && !A.is0()`). The `A != 𝒪` clause is
 * load-bearing: `isTorsionFree()` returns true for the identity, which ET-4c must
 * reject — a caveat 081 pins directly.
 *
 * Precondition: ET-4a/ET-4b have passed (canonicalA is true). This is NEVER
 * applied to a non-canonical key — Point.fromHex would throw (078), and that is
 * the point: a non-canonical A is ET-4b's fault, not ET-4c's.
 */
function isPrimeOrder(keyHex: string): boolean {
  const A = Point.fromHex(keyHex);
  const LtimesA = A.multiplyUnsafe(L - 1n).add(A); // [L]A (L == curve order n)
  return LtimesA.is0() && !A.is0();
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
  // ET-4c: a genuine prime-order key passes the subgroup check.
  assert.ok(isPrimeOrder(OPERATOR.publicKeyHex), "operator key is prime-order");
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

  // ET-4b gates ET-4c: a non-canonical A never reaches the subgroup check.
  // noble's Point.fromHex throws on y >= p, so isPrimeOrder is not even evaluable
  // here — 078's sole fault is ET-4b, not ET-4c.
  assert.throws(() => isPrimeOrder(pk(e)), "non-canonical A must not decode");
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

// --- 081: small-order key (identity) — ET-4c, the isTorsionFree caveat ------

test("081-smallorder-key: only ET-4c fails — canonical identity key, sig verifies", () => {
  const e = participantOf("081-smallorder-key");
  assert.equal(e.type, "participant_registered");

  // hash recomputes and the chain links: not a Stage-A failure.
  assert.equal(eventHash(e), e.hash, "hash does not recompute");

  // ET-4a/ET-4b and ID-3 all PASS: key and sig are canonically encoded, and the
  // key is 64 lowercase hex (this is what separates 081 from 078).
  assert.match(pk(e), LOWER_HEX_64, "pubkey is not 64 lowercase hex");
  assert.match(sig(e), LOWER_HEX_128, "sig is not 128 lowercase hex");
  assert.ok(canonicalA(pk(e)), "ET-4b must pass: key A is canonical");
  assert.ok(canonicalS(sig(e)), "ET-4a(i) must pass: S canonical");
  assert.ok(canonicalR(sig(e)), "ET-4a(ii) must pass: R canonical");

  // ET-10 self-signature VERIFIES under the identity key — makes it discriminating.
  assert.ok(verifyEvent(e, pk(e), sig(e)), "degenerate self-sig must verify");
  assert.doesNotThrow(() => chainId(pk(e)), "participant_id must still derive");

  // The SOLE fault is ET-4c: A is the identity (order 1).
  assert.ok(!isPrimeOrder(pk(e)), "ET-4c must fail: key is small-order");

  // The load-bearing caveat: isTorsionFree() ALONE returns true for the identity,
  // so a subgroup check written without the `A != 𝒪` clause would wrongly accept.
  const A = Point.fromHex(pk(e));
  assert.ok(A.is0(), "the key IS the identity point");
  assert.ok(
    A.isTorsionFree(),
    "isTorsionFree() returns true for the identity — why the A != 𝒪 clause is required",
  );
});

// --- 082: mixed-order key — ET-4c, distinguishes a full prime-order check ----

test("082-mixedorder-key: only ET-4c fails — canonical mixed-order key, sig verifies", () => {
  const e = participantOf("082-mixedorder-key");
  assert.equal(e.type, "participant_registered");

  assert.equal(eventHash(e), e.hash, "hash does not recompute");

  // Canonical (ET-4a/ET-4b) and 64 lowercase hex (ID-3) all pass.
  assert.match(pk(e), LOWER_HEX_64, "pubkey is not 64 lowercase hex");
  assert.match(sig(e), LOWER_HEX_128, "sig is not 128 lowercase hex");
  assert.ok(canonicalA(pk(e)), "ET-4b must pass: key A is canonical");
  assert.ok(canonicalS(sig(e)), "ET-4a(i) must pass: S canonical");
  assert.ok(canonicalR(sig(e)), "ET-4a(ii) must pass: R canonical");

  // ET-10 self-sig VERIFIES under the mixed-order A (nonce ground so k ≡ 0 mod 8).
  assert.ok(
    verifyEvent(e, pk(e), sig(e)),
    "honest-under-P self-sig must verify",
  );
  assert.doesNotThrow(() => chainId(pk(e)), "participant_id must still derive");

  // The SOLE fault is ET-4c. And crucially the key is NOT small-order, so this
  // vector discriminates a full prime-order check from a small-order blocklist.
  const A = Point.fromHex(pk(e));
  assert.ok(!isPrimeOrder(pk(e)), "ET-4c must fail: key is mixed-order");
  assert.ok(!A.is0(), "key is not the identity");
  assert.ok(
    !A.isSmallOrder(),
    "key must NOT be small-order — this is what a blocklist misses",
  );
});

// --- declared verdicts ------------------------------------------------------

for (const id of [
  "078-noncanonical-a",
  "079-noncanonical-s",
  "080-noncanonical-r",
  "081-smallorder-key",
  "082-mixedorder-key",
]) {
  test(`${id}: declares INVALID at line 2`, () => {
    const vec = vectors.find((v) => v.id === id);
    assert.ok(vec !== undefined, `${id} is not in the vector table`);
    assert.deepEqual(vec.expect, { verdict: "INVALID", line: 2 });
  });
}
