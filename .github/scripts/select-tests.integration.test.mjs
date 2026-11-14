import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = path.resolve(".github/scripts/select-tests.mjs");
test("the actual selector discovers installed workspaces and honors forced full runs", () => {
  const env = {
    ...process.env,
    CI_BASE: "HEAD",
    CI_HEAD: "HEAD",
    CI_FULL: "false",
    GITHUB_OUTPUT: "",
    GITHUB_STEP_SUMMARY: "",
  };
  const invoke = (extra) =>
    JSON.parse(
      execFileSync(process.execPath, [script], {
        env: { ...env, ...extra },
        encoding: "utf8",
      }),
    );
  assert.equal(invoke({}).mode, "docs");
  assert.equal(invoke({ CI_FULL: "true" }).mode, "full");
  assert.equal(invoke({ CI_BASE: "missing-ref" }).mode, "full");
});

test("a selected test command failure is propagated to CI", () => {
  const root = mkdtempSync(path.join(tmpdir(), "odc-task-failure-"));
  try {
    mkdirSync(path.join(root, "bin"));
    writeFileSync(path.join(root, "bin/pnpm"), "#!/bin/sh\nexit 37\n", {
      mode: 0o755,
    });
    const result = spawnSync(process.execPath, [script, "--run", "test"], {
      env: {
        ...process.env,
        PATH: `${root}/bin:${process.env.PATH}`,
        CI_TEST_FILTERS: "[]",
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 37, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Exercise the real workspace graph, not a mock that could omit the integration
// dependency and still pass when selection silently stops testing that seam.
for (const name of ["@odc/pulse", "@odc/pulse-web"]) {
  test(`${name} selects Pulse integration but excludes the unrelated ledger`, () => {
    const plan = JSON.parse(
      execFileSync(
        "pnpm",
        ["exec", "turbo", "run", "test", `--filter=...${name}`, "--dry=json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    assert.ok(plan.packages.includes(name));
    assert.ok(plan.packages.includes("@odc/pulse-integration"));
    assert.ok(!plan.packages.includes("@odc/ledger"));
  });
}
