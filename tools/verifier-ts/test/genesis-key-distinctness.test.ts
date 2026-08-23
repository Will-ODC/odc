// ET-9d — the two genesis keys MUST be distinct.
//
// THE RULE, as implemented: "A `genesis` whose `registrar_pk` is byte-identical
// to its `operator_pk` MUST be rejected — `INVALID` at the `genesis` line. The
// comparison is on the two 64-character lowercase-hex strings after ET-9b has
// passed on both, so it is one string equality and needs no key material, no
// decoding and no curve arithmetic."
//
// WHAT THIS FILE IS. `contracts/fixtures/` carries no vector citing ET-9d, so
// this rule has no fixture oracle and these chains are built here. They are
// SYNTHETIC AND SELF-CONSISTENT (see `genesis-builder.ts`) — worthless as
// evidence about the preimage, and superseded by a fixture the day one lands.
// What a self-consistent chain CAN decide is whether a payload the verifier
// must reject is rejected, and whether one it must accept is accepted; the
// ET-9d decision is made in `stageB` on two strings and does not move with the
// harness.
//
// THE POSITIVE CASES ARE LOAD-BEARING. A suite whose only new test asserts
// INVALID still passes if the check is written so that it rejects EVERY
// genesis. The accept cases below are what fail in that scenario, and they are
// the reason this file is not just the one negative case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExport } from "../src/verify.js";
import { genesisExport, keypair, tokenAndLine } from "./genesis-builder.js";

// --- what ET-9d rejects ------------------------------------------------------

test("rejects a genesis whose registrar_pk is byte-identical to its operator_pk (ET-9d)", () => {
  // Everything else about this chain is impeccable: chain_id derives correctly
  // (ET-7), the self-signature verifies under operator_pk (ET-8), both keys are
  // real prime-order Ed25519 points in lowercase hex (ET-9b/ET-9c). The single
  // fault is the collapse ET-9d names — one holder able to mint issues AND
  // forge every ballot on them. Before this rule, exactly this chain verified
  // VALID with nothing on the line to signal it.
  const out = verifyExport(
    genesisExport({}, { registrarPk: (operatorHex) => operatorHex }),
  );
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

test("rejects the collapsed-key genesis even when it also records legal fork ancestry (ET-9d)", () => {
  // ET-9d is not conditioned on anything else in the payload.
  const out = verifyExport(
    genesisExport(
      { ancestor_chain: "a".repeat(64), ancestor_head: "b".repeat(64) },
      { registrarPk: (operatorHex) => operatorHex },
    ),
  );
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});

// --- what ET-9d must NOT reject ----------------------------------------------

test("accepts a genesis with two properly distinct keys (ET-9d rejects only the collapse)", () => {
  // The guard against an over-broad check. `genesisExport` generates a fresh
  // registrar keypair and loops until it differs from the operator's, so this
  // is the ordinary, conforming shape every existing chain has.
  assert.equal(tokenAndLine(verifyExport(genesisExport({}))), "VALID");
});

test("accepts two independently generated distinct keys (equality is full-string, not a prefix)", () => {
  // Pins that the comparison is full-string equality, not a prefix or
  // truncated-length compare. Both keys must still be real prime-order points
  // (ET-9c), so this substitutes a whole second generated key rather than
  // editing a character of the first — an edited key would be rejected by
  // ET-9c and would prove nothing about ET-9d.
  //
  // Generating until two keys share a 63-hex-character prefix is
  // computationally impossible, so the assertion this can actually make is the
  // one below: two independently generated keys, which differ in many
  // characters, are accepted, and the negative case above shows that becoming
  // INVALID at full equality. The boundary between them is exercised by the
  // pair of tests together, not by either alone.
  const a = keypair();
  let b = keypair();
  while (b.hex === a.hex) b = keypair();
  assert.notEqual(a.hex, b.hex);
  const out = verifyExport(genesisExport({}, { registrarPk: () => b.hex }));
  assert.equal(tokenAndLine(out), "VALID");
});

test("accepts distinct keys on a genesis that also records fork ancestry", () => {
  const out = verifyExport(genesisExport({ ancestor_chain: "a".repeat(64) }));
  assert.equal(tokenAndLine(out), "VALID");
});

// --- the boundary between "byte-identical" and "hex string equality" ---------

test("an uppercase registrar_pk equal to the operator_pk is INVALID at line 1 (ET-9b, not ET-9d)", () => {
  // ET-9d's first sentence says "byte-identical" (about the keys) while its
  // second fixes the comparison as string equality on the hex AFTER ET-9b has
  // passed on both. Those two readings can only diverge for a case variant,
  // which hex-decodes to the same 32 bytes but is not the same string — and
  // ET-9b has already rejected it before ET-9d is reached, so the divergence
  // is unreachable and the verdict is the same either way. Asserted here so
  // that the reasoning is pinned rather than merely written down: the token and
  // line are what conformance is judged on (EV-17), and they do not depend on
  // which of the two rules notices.
  const out = verifyExport(
    genesisExport(
      {},
      {
        registrarPk: (operatorHex) => operatorHex.toUpperCase(),
      },
    ),
  );
  assert.equal(tokenAndLine(out), "INVALID at line 1");
});
