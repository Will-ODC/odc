import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  selectTests,
  changedPaths,
  selectImageTests,
} from "./select-tests.mjs";

test("image checks stay present but build only relevant images or conservative fallbacks", () => {
  for (const files of [
    ["apps/pulse/src/main.ts"],
    ["apps/pulse-web/nginx.conf"],
    ["pnpm-lock.yaml"],
    [".dockerignore"],
    ["new-root-input"],
  ])
    assert.equal(selectImageTests(files), true, String(files));
  for (const files of [
    ["apps/pulse/README.md"],
    ["memory/pulse.md"],
    ["services/ledger/src/main.ts"],
    ["tools/verifier-ts/src/cli.ts"],
    ["tests/pulse-integration/test/end-to-end.test.ts"],
    ["contracts/event-schema.md"],
  ])
    assert.equal(selectImageTests(files), false, String(files));
  assert.equal(selectImageTests(null), true);
  assert.equal(selectImageTests(["README.md"], { forceFull: true }), true);
});

const packages = [
  { path: "apps/pulse", name: "@odc/pulse" },
  { path: "apps/pulse-web", name: "@odc/pulse-web" },
  { path: "tests/pulse-integration", name: "@odc/pulse-integration" },
  { path: "services/ledger", name: "@odc/ledger" },
  { path: "tools/fixtures-gen", name: "@odc/fixtures-gen" },
  { path: "tools/rehearsal", name: "@odc/rehearsal" },
  { path: "tools/verifier-ts", name: "@odc/verifier-ts" },
];
const plan = (files, options = {}) => selectTests(files, packages, options);

test("documentation-only changes skip runtime tests, including package guides", () => {
  const result = plan([
    "docs/plans/pulse.md",
    "memory/pulse.md",
    "apps/pulse/README.md",
  ]);
  assert.equal(result.mode, "docs");
  assert.equal(result.core, false);
  assert.deepEqual(result.filters, []);
});

test("either Pulse app selects the Pulse group and its dependents through Turbo", () => {
  for (const file of [
    "apps/pulse/src/http/server.ts",
    "apps/pulse/src/x.ts",
    "apps/pulse-web/test/SignIn.test.tsx",
    // apps/pulse/test/dev-server.test.ts reads this file, but @odc/pulse does
    // not depend on @odc/pulse-web: only the group keeps that seam tested.
    "apps/pulse-web/.env.development",
  ]) {
    const result = plan([file]);
    assert.equal(result.mode, "affected", file);
    assert.deepEqual(
      result.filters,
      ["...@odc/pulse", "...@odc/pulse-web"],
      file,
    );
    assert.equal(result.core, false, file);
  }
  assert.deepEqual(
    plan(["tests/pulse-integration/test/end-to-end.test.ts"]).filters,
    ["...@odc/pulse-integration"],
  );
});

test("Markdown fixtures, SQL, assets and build files inside packages are runtime inputs", () => {
  for (const file of [
    "src/help.md",
    "test/fixture.md",
    "migrations/001.sql",
    "Dockerfile",
    "nginx.conf",
  ])
    assert.equal(plan([`apps/pulse/${file}`]).mode, "affected", file);
});

test("shared configuration, contracts and unknown paths select the full suite", () => {
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "turbo.json",
    "eslint.config.mjs",
    ".github/scripts/select-tests.mjs",
    "contracts/README.md",
    "docs/charter.md",
    "contracts/fixtures/index.json",
    "docs/security/attacks/probe.py",
    "future/package/input.ts",
  ])
    assert.equal(plan([file]).mode, "full", file);
});

test("core changes include all core packages and black-box verifier checks, excluding Pulse", () => {
  for (const file of [
    "services/ledger/src/append.ts",
    "services/verifier/main.go",
    "tools/verifier-ts/test/cli.test.ts",
  ])
    assert.deepEqual(plan([file]), {
      mode: "affected",
      filters: packages
        .filter((p) => /^(services|tools)\//.test(p.path))
        .map((p) => `...${p.name}`)
        .sort(),
      core: true,
      reason: "Changed packages and dependents; core conformance included",
    });
});

test("mixed changes union their owners and documentation never hides source changes", () => {
  assert.deepEqual(
    plan([
      "apps/pulse/README.md",
      "apps/pulse/src/main.ts",
      "apps/pulse-web/src/App.tsx",
    ]).filters,
    ["...@odc/pulse", "...@odc/pulse-web"],
  );
  assert.equal(plan(["docs/plan.md", "unmapped/input"]).mode, "full");
});

test("scheduled/manual full runs bypass documentation selection", () => {
  assert.equal(plan(["README.md"], { forceFull: true }).mode, "full");
  assert.equal(plan(null).mode, "full");
});

test("actual workspace metadata supports a new package and dependent selection", () => {
  assert.deepEqual(
    selectTests(
      ["apps/new/src/index.ts"],
      [...packages, { path: "apps/new", name: "@odc/new" }],
    ).filters,
    ["...@odc/new"],
  );
});

test("git comparison includes both sides of renames and deleted paths, preserving spaces", () => {
  const root = mkdtempSync(path.join(tmpdir(), "odc-select-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "Selector test");
    mkdirSync(path.join(root, "apps/pulse/src"), { recursive: true });
    writeFileSync(
      path.join(root, "apps/pulse/src/old name.ts"),
      "export const x = 1;",
    );
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    git("mv", "apps/pulse/src/old name.ts", "README.md");
    git("commit", "-qm", "move");
    const files = changedPaths(root, base, "HEAD");
    assert.deepEqual(files.sort(), ["README.md", "apps/pulse/src/old name.ts"]);
    assert.equal(plan(files).mode, "affected");
    assert.equal(changedPaths(root, "missing-ref", "HEAD"), null);
    assert.equal(plan(changedPaths(root, "missing-ref", "HEAD")).mode, "full");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
