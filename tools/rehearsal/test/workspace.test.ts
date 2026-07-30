// This suite exists to exercise `@odc/fixtures-gen`'s `exports` map for real.
//
// `tools/fixtures-gen/package.json` publishes four subpaths (`./encode`,
// `./chain`, `./serialize`, `./tamper`), each backed by a `.d.ts` produced with
// `declaration: true`. Nothing in `fixtures-gen`'s own suite crosses a package
// boundary to import through that map, so a broken subpath, a stale `.d.ts`, or
// a `declaration`/`exports` mismatch is invisible until some OTHER package
// resolves it — which, without this file, would first happen in T6b, as a
// mysterious CI-only red with no test pinning the cause. This file is that
// cross-package import, kept in `rehearsal` because it is the first consumer.
//
// Turbo's `typecheck` task must run after `^build` for this to mean anything:
// typechecking `rehearsal` against these subpaths requires `fixtures-gen`'s
// `dist/**/*.d.ts` to already exist (see `turbo.json`).

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventHash } from "@odc/fixtures-gen/encode";
import { GENESIS_PREV_HASH } from "@odc/fixtures-gen/chain";
import { head } from "@odc/fixtures-gen/serialize";
import { frame } from "@odc/fixtures-gen/tamper";

describe("@odc/fixtures-gen exports map (cross-package boundary)", () => {
  it("./encode exposes eventHash as a function", () => {
    assert.equal(typeof eventHash, "function");
  });

  it("./chain exposes GENESIS_PREV_HASH as 64 zeros", () => {
    assert.equal(GENESIS_PREV_HASH, "0".repeat(64));
    assert.equal(GENESIS_PREV_HASH.length, 64);
  });

  it("./serialize's head([]) is 64 zeros", () => {
    assert.equal(head([]), "0".repeat(64));
  });

  it("./tamper's frame([]) is a zero-length buffer", () => {
    const framed = frame([]);
    assert.ok(Buffer.isBuffer(framed));
    assert.equal(framed.length, 0);
  });
});
