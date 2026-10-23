// The odc-testing chain property test, through the HTTP write path: append N
// random operator events, export, verify VALID; flip one random byte, and the
// verifier refuses at exactly the line holding it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyExport } from "../../src/chain/index.js";
import { skip } from "../db/harness.js";
import { getBytes } from "./harness.js";
import { flipByte, randomChain, rng } from "./random.js";
import { withServers } from "./write-harness.js";

for (const seed of [1, 2, 3, 42, 2026]) {
  test(
    `chain_property_export_verifies_and_one_flipped_byte_is_located_seed_${seed}`,
    { skip },
    () =>
      withServers(async ({ pub, submit }) => {
        const r = rng(seed);
        const n = 3 + r(25);
        const chain = await randomChain(submit, r, n);
        const exported = await getBytes(`${pub}/export`);
        assert.ok(exported.equals(chain.exportBytes()));
        const ok = verifyExport(exported);
        assert.ok(ok.ok && ok.lineCount === n + 1);
        for (let k = 0; k < 20; k++) {
          const { tampered, line } = flipByte(exported, r);
          const v = verifyExport(tampered);
          assert.ok(!v.ok, `seed ${seed} flip ${k}`);
          assert.equal(v.line, line, `seed ${seed} flip ${k}`);
        }
      }),
  );
}
