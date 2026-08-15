// Tests for the event builders (contracts/event-types.md).
//
// The assertions that matter here are the signature ones: every signed type must
// verify under the key ITS OWN type names (ET-8/ET-10/ET-13/ET-17), and getting
// that wrong is invisible in the output — a chain signed entirely by the operator
// key looks perfectly well-formed until a verifier checks it.

import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { test } from "node:test";

import {
  assertWholeMinute,
  BALLOT_BATCH_INTERVAL_MS_FLOOR,
  BALLOT_BATCH_MIN_FLOOR,
  ChainBuilder,
  GENESIS_PREV_HASH,
  GENESIS_TS,
  newChain,
  OPERATOR,
  REGISTRAR,
  tsAt,
} from "../src/chain.js";
import {
  eventHash,
  keypairFromSeed,
  participantId,
  seedOf,
  signingPreimage,
} from "../src/encode.js";
import type { Event } from "../src/encode.js";

/** Ed25519 SPKI prefix, so a raw 32-byte hex key can be used to verify. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const publicKeyOf = (hex: string): ReturnType<typeof createPublicKey> =>
  createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });

/** ET-4: sig verifies over the signing preimage under the named key. */
function sigVerifies(e: Event, pubkeyHex: string): boolean {
  return verify(
    null,
    signingPreimage(e),
    publicKeyOf(pubkeyHex),
    Buffer.from(String(e.payload["sig"]), "hex"),
  );
}

test("genesis is byte-identical to the hashing.md 6 worked example", () => {
  const g = newChain().all[0] as Event;
  assert.equal(
    g.hash,
    "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a",
  );
  assert.equal(g.seq, 1);
  assert.equal(g.prev_hash, GENESIS_PREV_HASH);
  assert.equal(g.ts, GENESIS_TS);
});

test("genesis self-signs under the operator_pk it declares (ET-8)", () => {
  const g = newChain().all[0] as Event;
  assert.equal(g.payload["operator_pk"], OPERATOR.publicKeyHex);
  assert.ok(sigVerifies(g, String(g.payload["operator_pk"])));
});

test("chain_id is derived from operator_pk, not registrar_pk (ET-7)", () => {
  const g = newChain().all[0] as Event;
  assert.notEqual(g.payload["chain_id"], g.payload["registrar_pk"]);
  assert.match(String(g.payload["chain_id"]), /^[0-9a-f]{64}$/);
});

test("participant_registered self-signs under its own pubkey (ET-10)", () => {
  const c = newChain();
  const p = c.participant(0x03);
  assert.ok(sigVerifies(p, String(p.payload["pubkey"])));
  assert.equal(p.payload["pubkey"], keypairFromSeed(seedOf(0x03)).publicKeyHex);
});

test("issue_created is signed by the operator, not the registrar (ET-13)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  assert.ok(sigVerifies(i, OPERATOR.publicKeyHex));
  assert.ok(!sigVerifies(i, REGISTRAR.publicKeyHex));
});

test("vote_cast is signed by the registrar, not the operator (ET-17)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.ok(sigVerifies(v, REGISTRAR.publicKeyHex));
  assert.ok(!sigVerifies(v, OPERATOR.publicKeyHex));
});

test("a ballot carries no voter field at all (ET-21)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.deepEqual(Object.keys(v.payload).sort(), [
    "choice",
    "issue_id",
    "sig",
  ]);
});

test("issue_created carries exactly the five ET-14/ET-14a/ET-14b payload keys", () => {
  const i = newChain().issue("Adopt the charter", 3);
  assert.deepEqual(Object.keys(i.payload).sort(), [
    "ballot_batch_interval_ms",
    "ballot_batch_min",
    "choice_count",
    "sig",
    "title",
  ]);
});

test("the default batch parameters sit at the ET-14b floors, never below", () => {
  const i = newChain().issue("Adopt the charter", 3);
  // Asserted against the floors rather than against the defaults, so lowering a
  // default below a floor fails here instead of quietly agreeing with itself.
  const interval = i.payload["ballot_batch_interval_ms"] as number;
  const min = i.payload["ballot_batch_min"] as number;
  assert.ok(Number.isInteger(interval) && Number.isInteger(min));
  assert.ok(interval >= BALLOT_BATCH_INTERVAL_MS_FLOOR);
  assert.ok(min >= BALLOT_BATCH_MIN_FLOOR);
});

test("a ballot's default ts is an exact multiple of the default batch interval (ET-23)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.equal(Date.parse(v.ts) % BALLOT_BATCH_INTERVAL_MS_FLOOR, 0);
});

test("issue_id is the issue_created event's own hash (ID-7, ET-15)", () => {
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  const v = c.vote(i.hash, 1);
  assert.equal(v.payload["issue_id"], i.hash);
  assert.equal(c.issues.get(i.hash), 3, "choice_count is tracked for ET-18a");
});

test("seq increments by one and prev_hash links to the predecessor (ES-7, ES-25)", () => {
  const c = newChain();
  c.participant(0x03);
  const i = c.issue("Adopt the charter", 3);
  c.vote(i.hash, 1);
  const all = c.all;
  assert.equal(all.length, 4);
  for (let n = 0; n < all.length; n += 1) {
    const e = all[n] as Event;
    assert.equal(e.seq, n + 1);
    assert.equal(
      e.prev_hash,
      n === 0 ? GENESIS_PREV_HASH : (all[n - 1] as Event).hash,
    );
  }
});

test("hash covers the payload INCLUDING sig, sig covers it excluding sig (ES-29, ES-32)", () => {
  const p = newChain().participant(0x03);
  // Recomputing the hash over the stored six content fields reproduces it, and
  // those fields include sig — so tampering with a signature breaks the chain,
  // not merely the signature check.
  assert.equal(eventHash(p), p.hash);
  assert.ok("sig" in p.payload);
});

test("timestamps satisfy the ts format gate (ES-20)", () => {
  const c = newChain();
  c.participant(0x03);
  for (const e of c.all) {
    assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  assert.equal(tsAt(0), GENESIS_TS);
  assert.equal(tsAt(2), "2026-07-21T00:02:00.000Z");
});

test("tsAt rejects a non-whole-minute offset rather than rounding it (D5)", () => {
  // tsAt used to end `.replace(/\.\d{3}Z$/, ".000Z")`. For every legal offset
  // that replace is a no-op; its only reachable effect was to launder a
  // fractional offset into a canonical-looking timestamp, hiding the caller's
  // bug. Rejecting is the rule this whole codebase is about (D5) — and the
  // laundered value is not merely cosmetic: it is covered by `hash`, so a
  // silently-rounded ts produces a chain whose bytes nobody intended.
  assert.throws(() => tsAt(1.5), /non-negative whole number/);
  assert.throws(() => tsAt(-1), /non-negative whole number/);
  assert.throws(() => tsAt(Number.NaN), /non-negative whole number/);
  assert.throws(
    () => tsAt(Number.POSITIVE_INFINITY),
    /non-negative whole number/,
  );

  // The specific value the old repair silently swallowed: 90 seconds past
  // genesis is not a whole minute, and used to come back as ...T00:01:30.000Z
  // — well-formed, hashable, and not what any caller asked for.
  assert.throws(() => tsAt(1.5), RangeError);

  // Legal offsets are untouched, so no fixture byte moves.
  assert.equal(tsAt(1), "2026-07-21T00:01:00.000Z");
  assert.equal(tsAt(1440), "2026-07-22T00:00:00.000Z");
});

test("assertWholeMinute rejects a non-whole-minute instant instead of trimming it", () => {
  // The branch the old `.replace` used to hide. It is unreachable through
  // tsAt(), whose base is the whole-minute GENESIS_TS — which is exactly why
  // it is a named function: an assertion no test can kill is not coverage.
  assert.throws(
    () => assertWholeMinute("2026-07-21T00:00:30.000Z"),
    /not a whole-minute instant/,
    "non-zero seconds must be rejected, not trimmed to :00",
  );
  assert.throws(
    () => assertWholeMinute("2026-07-21T00:00:00.500Z"),
    /not a whole-minute instant/,
    "a non-zero millisecond field is exactly what the old .replace() rewrote",
  );

  // It is an assertion, not a transform: a legal instant comes back untouched.
  assert.equal(assertWholeMinute(GENESIS_TS), GENESIS_TS);
});

test("a headless builder starts at seq 1 with the genesis anchor", () => {
  // This is what the "first event is not a genesis" vector needs: a well-formed
  // event in position 1 that is not a genesis.
  const c = new ChainBuilder();
  const kp = keypairFromSeed(seedOf(0x03));
  const e = c.custom(
    "participant_registered",
    1,
    { pubkey: kp.publicKeyHex },
    { signer: kp },
  );
  assert.equal(e.seq, 1);
  assert.equal(e.prev_hash, GENESIS_PREV_HASH);
  assert.notEqual(e.type, "genesis");
});

test("custom() builds unregistered types, with or without a signature", () => {
  const c = newChain();
  const unsigned = c.custom("x_experimental", 1, { n: 7 });
  assert.ok(!("sig" in unsigned.payload), "no signer means no sig key");
  assert.equal(
    eventHash(unsigned),
    unsigned.hash,
    "still hashed by the generic rule (HA-7)",
  );
  const v2 = c.custom("participant_registered", 2, {
    pubkey: OPERATOR.publicKeyHex,
  });
  assert.equal(v2.version, 2, "a registered type at an unregistered version");
});

test("custom() actually signs with the signer it is given", () => {
  // Without this, replacing `opts.signer` with `undefined` leaves the whole
  // suite green — and custom() is the ONLY path to the wrong-key signature
  // vectors, where an absent sig is an ES-18 missing-key failure rather than
  // the ET-5 signature failure the vector claims.
  const c = newChain();
  const kp = keypairFromSeed(seedOf(0x03));
  const e = c.custom("x_signed", 1, { n: 7 }, { signer: kp });
  assert.ok("sig" in e.payload, "a signer must produce a sig key");
  assert.ok(sigVerifies(e, kp.publicKeyHex), "sig verifies under the signer");
  assert.ok(
    !sigVerifies(e, OPERATOR.publicKeyHex),
    "and under nothing else — this is what pins the wrong-key vectors",
  );
});

test("custom() signs with a wrong key on demand, which is the ET-5 vector shape", () => {
  const c = newChain();
  const kp = keypairFromSeed(seedOf(0x03));
  const impostor = keypairFromSeed(seedOf(0xee));
  const e = c.custom(
    "participant_registered",
    1,
    { pubkey: kp.publicKeyHex },
    { signer: impostor },
  );
  assert.ok("sig" in e.payload, "the key is present, so ES-18 is satisfied");
  assert.ok(
    !sigVerifies(e, String(e.payload["pubkey"])),
    "and fails at the signature check (ET-5), not at the key-set check",
  );
  assert.ok(sigVerifies(e, impostor.publicKeyHex));
});

test("genesis() honours every declared option (ET-6, ET-7, ET-8)", () => {
  const impostorOp = keypairFromSeed(seedOf(0xee));
  const altReg = keypairFromSeed(seedOf(0xef));
  const c = new ChainBuilder();
  const g = c.genesis({
    operator: impostorOp,
    registrar: altReg,
    contracts: "contracts-v2",
  });
  assert.equal(g.payload["operator_pk"], impostorOp.publicKeyHex);
  assert.equal(g.payload["registrar_pk"], altReg.publicKeyHex);
  assert.equal(g.payload["contracts"], "contracts-v2");
  assert.equal(g.payload["chain_id"], participantId(impostorOp.publicKeyHex));
  assert.ok(sigVerifies(g, impostorOp.publicKeyHex), "self-signed (ET-8)");
});

test("issue_created verifies under the genesis-DECLARED operator_pk (ET-13)", () => {
  // Signing from a module constant instead of the declared key yields a chain
  // that is well-formed and self-consistently hashed but does not verify under
  // its own operator_pk — a wrong-but-plausible vector, which reads at T7 as a
  // mysterious verifier bug rather than a fixture bug.
  const impostorOp = keypairFromSeed(seedOf(0xee));
  const c = new ChainBuilder();
  const g = c.genesis({ operator: impostorOp });
  const i = c.issue("Adopt the charter", 2);
  assert.notEqual(impostorOp.publicKeyHex, OPERATOR.publicKeyHex);
  assert.ok(sigVerifies(i, String(g.payload["operator_pk"])));
  assert.ok(!sigVerifies(i, OPERATOR.publicKeyHex));
});

test("vote_cast verifies under the genesis-DECLARED registrar_pk (ET-17)", () => {
  const altReg = keypairFromSeed(seedOf(0xef));
  const c = new ChainBuilder();
  const g = c.genesis({ registrar: altReg });
  const i = c.issue("Adopt the charter", 2);
  const vote = c.vote(i.hash, 1);
  assert.notEqual(altReg.publicKeyHex, REGISTRAR.publicKeyHex);
  assert.ok(sigVerifies(vote, String(g.payload["registrar_pk"])));
  assert.ok(!sigVerifies(vote, REGISTRAR.publicKeyHex));
});

test("a headless chain still signs from the module defaults", () => {
  // No genesis has declared anything, so the §6 keys remain the fallback —
  // otherwise the headless vectors would lose their signers entirely.
  const c = new ChainBuilder();
  const i = c.issue("Adopt the charter", 2);
  assert.ok(sigVerifies(i, OPERATOR.publicKeyHex));
  assert.ok(sigVerifies(c.vote(i.hash, 1), REGISTRAR.publicKeyHex));
});

test("an empty payload is buildable and hashes (HA-8)", () => {
  const e = newChain().custom("x_empty", 1, {});
  assert.deepEqual(Object.keys(e.payload), []);
  assert.equal(eventHash(e), e.hash);
});

// --- payload legality (ET-14, ET-14a, ET-18, ET-18a) -----------------------
//
// The builders used to accept anything, so an accidentally illegal value was
// indistinguishable from one of the six that are illegal on purpose.

test("the builder rejects an undeclared ET-14 title violation", () => {
  const legal = (): ChainBuilder => newChain();
  assert.throws(() => legal().issue("", 3), /violates ET-14/, "empty title");
  assert.throws(
    () => legal().issue("t".repeat(201), 3),
    /violates ET-14/,
    "201 scalar values",
  );
  assert.throws(
    () => legal().issue("Adopt\u0001the charter", 3),
    /violates ET-14/,
    "a C0 control character",
  );
  assert.throws(
    () => legal().issue("Adopt\u007fthe charter", 3),
    /violates ET-14/,
    "U+007F is banned by ET-14's own sentence, and is NOT a C0 character",
  );
});

test("the builder rejects undeclared ET-14a, ET-18 and ET-18a violations", () => {
  assert.throws(
    () => newChain().issue("Adopt the charter", 1),
    /violates ET-14a/,
  );
  assert.throws(
    () => newChain().issue("Adopt the charter", 65),
    /violates ET-14a/,
  );
  // No prior issue_created has this hash, so ET-18 fails and ET-18a is not
  // merely unviolated but uncheckable — the error names ET-18 alone.
  assert.throws(() => newChain().vote("ab".repeat(32), 0), /violates ET-18\b/);
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  assert.throws(() => c.vote(i.hash, 3), /violates ET-18a/, "choice === count");
  assert.throws(() => c.vote(i.hash, -1), /violates ET-18a/);
});

test("declaring a violation the payload does NOT commit is rejected too", () => {
  // The direction that matters most: this is the shape where a vector ships
  // conforming bytes under an INVALID declaration, so every correct verifier
  // fails it for the right reason on the wrong file.
  assert.throws(
    () => newChain().issue("Adopt the charter", 3, { violates: ["ET-14"] }),
    /the payload is LEGAL/,
  );
  const c = newChain();
  const i = c.issue("Adopt the charter", 3);
  assert.throws(
    () => c.vote(i.hash, 1, { violates: ["ET-18a"] }),
    /the payload is LEGAL/,
  );
});

test("a declaration that names the wrong or an incomplete rule is rejected", () => {
  assert.throws(
    () => newChain().issue("", 3, { violates: ["ET-14a"] }),
    /actually violates ET-14/,
    "wrong rule named",
  );
  assert.throws(
    () => newChain().issue("", 1, { violates: ["ET-14"] }),
    /actually violates ET-14, ET-14a/,
    "an empty title AND an out-of-range choice_count breaks both",
  );
});

test("a correctly declared violation builds, and legal payloads are untouched", () => {
  assert.equal(
    newChain().issue("", 3, { violates: ["ET-14"] }).payload["title"],
    "",
  );
  const c = newChain();
  const i = c.issue("Adopt the charter", 2);
  assert.equal(c.vote(i.hash, 0).payload["choice"], 0);
  assert.equal(c.vote(i.hash, 1).payload["choice"], 1);
});

test("ET-14 counts scalar values, not UTF-16 code units or bytes", () => {
  // 200 astral scalars is 400 UTF-16 code units and 800 UTF-8 octets. A
  // validator using JS `.length` would reject this legal title and take
  // vector 072 down with it; one using byte length would reject it harder.
  const clef = "\u{1d11e}";
  assert.doesNotThrow(() => newChain().issue(clef.repeat(200), 2));
  assert.throws(
    () => newChain().issue(clef.repeat(201), 2),
    /violates ET-14/,
    "and the ceiling still bites at 201 scalar values",
  );
});

test("the ET-14 / ET-14a boundaries are legal on the legal side", () => {
  // Each assertion here exists because mutating the corresponding comparison
  // left the suite green: `scalars < 1` -> `< 2`, and `choiceCount > 64` ->
  // `>= 64` both wrongly reject a LEGAL payload, and nothing noticed. An
  // over-strict builder is not a harmless bug: it would make a legal vector
  // unbuildable and quietly shrink what the fixture set can express.
  assert.doesNotThrow(
    () => newChain().issue("a", 2),
    "1 scalar value and choice_count 2 are both the legal minimum (ET-14, ET-14a)",
  );
  assert.doesNotThrow(
    () => newChain().issue("t".repeat(200), 64),
    "200 scalar values and choice_count 64 are both the legal maximum",
  );
  // And one past each end is not.
  assert.throws(
    () => newChain().issue("t".repeat(201), 64),
    /violates ET-14\b/,
  );
  assert.throws(() => newChain().issue("a", 65), /violates ET-14a/);
});

test("U+001F, the top of the C0 block, is forbidden in a title (ET-14)", () => {
  // `c <= 0x1f` -> `c < 0x1f` survived the suite: U+001F is the last C0
  // character, and every other test used U+0001. The vectors that DO carry
  // \u001f (011, ESC) put it in an x_ custom payload, which never reaches
  // this check.
  assert.throws(
    () => newChain().issue("Adopt\u001fthe charter", 3),
    /violates ET-14/,
  );
  // U+0020 is the first legal character above the block.
  assert.doesNotThrow(() => newChain().issue("Adopt the charter", 3));
});
