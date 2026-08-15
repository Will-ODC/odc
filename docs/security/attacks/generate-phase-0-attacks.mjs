// generate-phase-0-attacks.mjs — adversarial exports for the T9 Phase 0 audit.
//
// Regenerates every artifact cited in ../audit-phase-0.md. Run:
//
//     node docs/security/attacks/generate-phase-0-attacks.mjs
//
// These are ADVERSARIAL INPUTS FOR RE-AUDIT, NOT CONFORMANCE FIXTURES. They are
// deliberately NOT in contracts/fixtures/ and are covered by no freeze rule; see
// ./README.md.
//
// Part 1 implements contracts/hashing.md (HA-1..HA-17) and the canonical line
// form of contracts/export-format.md (EX-7..EX-9) from the spec prose alone. It
// was written without reading either verifier's encoder; reproducing the
// hashing.md §6 worked-example digest is the check that it is correct, and the
// script asserts that on every run.
//
// Key material is ONLY the published test seeds of hashing.md §6 and
// contracts/fixtures/derivations.json, plus the 0xee wrong-key seed from
// tools/fixtures-gen/src/vectors/shared.ts:41 (IMPOSTOR) — that one is NOT in
// derivations.json, which publishes only 0x01 and 0x02.
// TEST KEYS — never use on a real chain.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Part 1 — hashing.md and export-format.md, implemented from the specs
// ---------------------------------------------------------------------------

/** HA-1: U64(n) — exactly 8 octets, big-endian, unsigned. */
const U64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
/** HA-3: LP(x) = U64(len) || x, lengths in OCTETS. */
const LP = (x) => Buffer.concat([U64(x.length), x]);
/** HA-2 + HA-5: ENC_STR(s) = LP(UTF8(s)); no BOM, no normalization. */
const S = (s) => LP(Buffer.from(s, "utf8"));
/** HA-10: DOMAIN = ASCII "ODC1". */
const DOMAIN = Buffer.from("ODC1", "ascii");
/** HA-8: ascending lexicographic order of the keys' UTF-8 octets. */
const byUtf8 = (a, b) => Buffer.from(a, "utf8").compare(Buffer.from(b, "utf8"));

/** HA-7: ENC_PAYLOAD(P) — generic, per-type-agnostic. */
function encPayload(p) {
  const keys = Object.keys(p).sort(byUtf8);
  const out = [U64(keys.length)];
  for (const k of keys) {
    const v = p[k];
    const isInt = typeof v === "number";
    out.push(Buffer.from([isInt ? 0x69 : 0x73])); // HA-7/HA-9 type tag
    out.push(S(k));
    out.push(isInt ? U64(v) : S(v)); // HA-4 / HA-5
  }
  return Buffer.concat(out);
}

/** HA-11: PRE(E) over the six content fields, in exactly this order. */
function pre(e) {
  return Buffer.concat([
    DOMAIN,
    U64(e.seq),
    S(e.type),
    U64(e.version),
    encPayload(e.payload),
    S(e.ts),
    S(e.prev_hash), // HA-12: hex fields hashed as their lowercase-hex TEXT
  ]);
}

/** HA-13: lowercase-hex SHA-256. */
const sha256hex = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** Ed25519 keypair from a raw 32-octet seed (RFC 8032). */
function keyFromSeed(seedHex) {
  const seed = Buffer.from(seedHex, "hex");
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  const priv = crypto.createPrivateKey({
    key: pkcs8,
    format: "der",
    type: "pkcs8",
  });
  const spki = crypto
    .createPublicKey(priv)
    .export({ format: "der", type: "spki" });
  return { priv, pubHex: spki.subarray(spki.length - 32).toString("hex") };
}

/**
 * HA-15/HA-16 then ES-27: sign SIGN_PRE(E) (the preimage with the "sig" key
 * removed) under `priv`, insert `sig`, then hash the result.
 */
function finish(e, priv) {
  const withoutSig = { ...e.payload };
  delete withoutSig.sig;
  const signPre = pre({ ...e, payload: withoutSig });
  e.payload.sig = crypto.sign(null, signPre, priv).toString("hex");
  e.hash = sha256hex(pre(e));
  return e;
}

/** EX-9: minimal JSON escaping, lowercase \u00xx, literal UTF-8 otherwise. */
function jstr(s) {
  let o = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '"') o += '\\"';
    else if (ch === "\\") o += "\\\\";
    else if (c === 8) o += "\\b";
    else if (c === 9) o += "\\t";
    else if (c === 10) o += "\\n";
    else if (c === 12) o += "\\f";
    else if (c === 13) o += "\\r";
    else if (c < 0x20) o += "\\u" + c.toString(16).padStart(4, "0");
    else o += ch;
  }
  return o + '"';
}

/** EX-7/EX-8: compact, fixed envelope order, payload keys in UTF-8-byte order. */
function line(e) {
  const keys = Object.keys(e.payload).sort(byUtf8);
  const pl =
    "{" +
    keys
      .map(
        (k) =>
          jstr(k) +
          ":" +
          (typeof e.payload[k] === "number"
            ? String(e.payload[k])
            : jstr(e.payload[k])),
      )
      .join(",") +
    "}";
  return (
    `{"seq":${e.seq},"type":${jstr(e.type)},"version":${e.version},` +
    `"payload":${pl},"ts":${jstr(e.ts)},"prev_hash":${jstr(e.prev_hash)},"hash":${jstr(e.hash)}}`
  );
}

/** EX-1/EX-3/EX-4: LF-framed NDJSON with a required final LF. */
const ndjson = (events) => events.map(line).join("\n") + "\n";

// ---------------------------------------------------------------------------
// Part 2 — key material (published test seeds only) and event constructors
// ---------------------------------------------------------------------------

const OP = keyFromSeed("01".repeat(32)); // hashing.md §6 operator seed
const REG = keyFromSeed("02".repeat(32)); // hashing.md §6 registrar seed
const EVIL = keyFromSeed("ee".repeat(32)); // IMPOSTOR, fixtures-gen shared.ts:41
const ZERO = "0".repeat(64); // ES-24 genesis anchor
const CHAIN_ID = sha256hex(Buffer.from(OP.pubHex, "hex")); // ET-7

const genesis = (ts, opts = {}) =>
  finish(
    {
      seq: 1,
      type: "genesis",
      version: opts.version ?? 1,
      payload: {
        chain_id: CHAIN_ID,
        contracts: "contracts-v1",
        operator_pk: OP.pubHex,
        registrar_pk: REG.pubHex,
      },
      ts,
      prev_hash: ZERO,
    },
    opts.signer ?? OP.priv,
  );

const issue = (seq, prev, ts, title, choice_count, signer = OP.priv) =>
  finish(
    {
      seq,
      type: "issue_created",
      version: 1,
      payload: { title, choice_count },
      ts,
      prev_hash: prev,
    },
    signer,
  );

const vote = (seq, prev, ts, issue_id, choice, signer = REG.priv) =>
  finish(
    {
      seq,
      type: "vote_cast",
      version: 1,
      payload: { issue_id, choice },
      ts,
      prev_hash: prev,
    },
    signer,
  );

// ---------------------------------------------------------------------------
// Part 3 — the artifacts
// ---------------------------------------------------------------------------

const OUT = path.dirname(fileURLToPath(import.meta.url));
const write = (name, bytes) => {
  fs.writeFileSync(path.join(OUT, name), bytes);
  console.log(`  wrote ${name}`);
};

// Self-check: the §6 worked example must reproduce, or nothing below is evidence.
const WORKED_EXAMPLE_HASH =
  "78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a";
const gA = genesis("2026-07-21T00:00:00.000Z");
if (gA.hash !== WORKED_EXAMPLE_HASH) {
  throw new Error(`hashing.md §6 self-check FAILED: got ${gA.hash}`);
}
console.log(`hashing.md §6 self-check OK: ${gA.hash}`);
console.log(`operator_pk ${OP.pubHex}`);
console.log(`chain_id    ${CHAIN_ID}`);

// --- F1(a): two chains, identical chain_id, opposite outcomes ---------------
// The genesis events differ ONLY in `ts`, by one millisecond. Both are correctly
// self-signed under operator_pk (ET-8) and both derive the same chain_id (ET-7),
// because ET-7's derivation has "no free parameter" — it is a function of
// operator_pk alone, and so is constant across every chain this operator starts.
const gB = genesis("2026-07-21T00:00:00.001Z");
const QUESTION = "Shall the treasury fund plan Y?";

function outcome(g, choices) {
  const iss = issue(2, g.hash, "2026-08-01T10:00:00.000Z", QUESTION, 2);
  const ev = [g, iss];
  let prev = iss.hash;
  choices.forEach((c, i) => {
    const seq = 3 + i;
    const v = vote(
      seq,
      prev,
      `2026-08-01T10:0${seq % 10}:00.000Z`,
      iss.hash,
      c,
    );
    ev.push(v);
    prev = v.hash;
  });
  return ev;
}
const chainA = outcome(gA, [1, 1, 1, 0]); // plan Y wins 3–1
const chainB = outcome(gB, [0, 0, 0, 1]); // plan Y loses 1–3
write("chainA.ndjson", ndjson(chainA));
write("chainB.ndjson", ndjson(chainB));
console.log(`  chainA head ${chainA.at(-1).hash}`);
console.log(`  chainB head ${chainB.at(-1).hash}`);

// --- F1(b): common-prefix fork ----------------------------------------------
// Same genesis, same issue, same first ballot; the second ballot differs. Both
// branches verify. Nothing in contracts/ lets a verifier detect a sibling.
const fIss = issue(2, gA.hash, "2026-08-01T10:00:00.000Z", QUESTION, 2);
const fV1 = vote(3, fIss.hash, "2026-08-01T10:03:00.000Z", fIss.hash, 1);
write(
  "fork1.ndjson",
  ndjson([
    gA,
    fIss,
    fV1,
    vote(4, fV1.hash, "2026-08-01T10:04:00.000Z", fIss.hash, 1),
  ]),
);
write(
  "fork2.ndjson",
  ndjson([
    gA,
    fIss,
    fV1,
    vote(4, fV1.hash, "2026-08-01T10:04:00.000Z", fIss.hash, 0),
  ]),
);

// --- F3: unregistered genesis version ---------------------------------------
// genesis at version 1000000 (the value EV-19 reserves) so Stage B never runs on
// it and operator_pk/registrar_pk are never extracted; the later events are at
// the REGISTERED version 1 and are signed by a key nobody authorised.
const gU = genesis("2026-07-21T00:00:00.000Z", {
  version: 1000000,
  signer: EVIL.priv,
});
const uIss = issue(
  2,
  gU.hash,
  "2026-08-01T10:00:00.000Z",
  "Forged issue nobody authorised",
  2,
  EVIL.priv,
);
write(
  "downgrade.ndjson",
  ndjson([
    gU,
    uIss,
    vote(3, uIss.hash, "2026-08-01T10:01:00.000Z", uIss.hash, 1, EVIL.priv),
  ]),
);

// --- S4: raw ill-formed UTF-8 in a title ------------------------------------
// Models a producer that let a lenient JSON decoder substitute U+FFFD: the hash
// is computed over "A�B", while the STORED octets are the ill-formed
// ED A0 80 (an unpaired surrogate). HA-2's closing MUST covers this; no fixture
// exercises it.
const badIss = finish(
  {
    seq: 2,
    type: "issue_created",
    version: 1,
    payload: { title: "A�B", choice_count: 2 },
    ts: "2026-08-01T10:00:00.000Z",
    prev_hash: gA.hash,
  },
  OP.priv,
);
let b2 = Buffer.from(line(badIss), "utf8");
const at = b2.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
b2 = Buffer.concat([
  b2.subarray(0, at),
  Buffer.from([0xed, 0xa0, 0x80]),
  b2.subarray(at + 3),
]);
write(
  "illutf8.ndjson",
  Buffer.concat([Buffer.from(line(gA) + "\n"), b2, Buffer.from("\n")]),
);

console.log("\nExpected verdicts (both verifiers):");
console.log("  chainA VALID · chainB VALID · fork1 VALID · fork2 VALID");
console.log("  downgrade INVALID line 2 · illutf8 INVALID line 2");
