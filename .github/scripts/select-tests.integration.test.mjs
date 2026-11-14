import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { groups, workspacePackages } from "./select-tests.mjs";

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

// Hidden-seam guard: code in one workspace package that names a path inside
// another package is a dependency Turbo cannot see, so a change to the target
// alone would skip the reader's tests. Static scan of the patterns this repo
// uses: string literals resolved from the file, with any number of leading
// `../` (`new URL("../../../pulse-web/.env.development", import.meta.url)`,
// `import("../../../apps/pulse-web/src/x.js")`); literal arguments of a
// `resolve(...)`/`join(...)` call joined together
// (`resolve(here, "../../../..", "apps", "x")`); and repo-root-relative
// literals (`"apps/pulse-web/x"`). The climb count is ignored (compiled tests
// run from dist/), so a relative remainder matches from any ancestor directory.
// Paths assembled from variables or computed strings are not seen.
const skipDirs = new Set(["node_modules", "dist", "build", "coverage"]);
function codeFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return skipDirs.has(entry.name) || entry.name.startsWith(".")
        ? []
        : codeFiles(full);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}
const literal = /(["'`])([^"'`\s$\\]*\/[^"'`\s$\\]*)\1/g;
function pathCandidates(source) {
  const found = [...source.matchAll(literal)].map((m) => m[2]);
  for (const call of source.matchAll(/\b(?:resolve|join)\(([^)]*)\)/g)) {
    const parts = [...call[1].matchAll(/(["'`])([^"'`\s$\\]+)\1/g)];
    if (parts.length > 1) found.push(parts.map((m) => m[2]).join("/"));
  }
  return found;
}
function hiddenSeams(root, packages) {
  const ownerOf = (rel) =>
    packages.find((pkg) => rel === pkg.path || rel.startsWith(`${pkg.path}/`));
  const seams = [];
  for (const reader of packages)
    for (const file of codeFiles(path.join(root, reader.path))) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      // Comments may name other packages without reading them.
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1");
      for (const text of pathCandidates(source)) {
        const relative = /^\.\.?\//.test(text);
        const rest = path.posix.normalize(text).replace(/^(?:\.\.\/)+/, "");
        const ancestors = [""];
        if (relative)
          for (let dir = path.posix.dirname(rel); dir !== ".";) {
            ancestors.unshift(dir);
            dir = path.posix.dirname(dir);
          }
        for (const dir of ancestors) {
          const target = ownerOf(path.posix.join(dir, rest));
          if (target && target.name !== reader.name) {
            seams.push({ file: rel, text, reader, target });
            break;
          }
        }
      }
    }
  return seams;
}
function dependsOn(root, packages, from, to, seen = new Set()) {
  if (seen.has(from.name)) return false;
  seen.add(from.name);
  const manifest = JSON.parse(
    readFileSync(path.join(root, from.path, "package.json"), "utf8"),
  );
  return Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })
    .filter(([, spec]) => String(spec).startsWith("workspace:"))
    .map(([name]) => packages.find((pkg) => pkg.name === name))
    .some(
      (dep) =>
        dep &&
        (dep.name === to.name || dependsOn(root, packages, dep, to, seen)),
    );
}

test("every cross-package file read is covered by a selector group or a declared dependency", () => {
  const root = process.cwd();
  const packages = workspacePackages(root);
  const seams = hiddenSeams(root, packages);
  // Non-vacuous: the scan must see the seam that motivated the Pulse group.
  assert.ok(
    seams.some(
      (s) =>
        s.file === "apps/pulse/test/dev-server.test.ts" &&
        s.target.name === "@odc/pulse-web",
    ),
    "scanner no longer sees apps/pulse/test/dev-server.test.ts reading pulse-web",
  );
  const uncovered = seams.filter(
    ({ reader, target }) =>
      !Object.values(groups).some((m) => m(reader.path) && m(target.path)) &&
      !dependsOn(root, packages, reader, target),
  );
  assert.deepEqual(
    uncovered.map(
      ({ file, text, reader, target }) =>
        `${file} (${reader.name}) reads ${target.name} files via "${text}", ` +
        `so a change to ${target.name} alone would skip ${reader.name}'s tests. ` +
        `Add both packages to one entry of \`groups\` in ` +
        `.github/scripts/select-tests.mjs, or declare ${target.name} as a ` +
        `workspace dependency of ${reader.name}.`,
    ),
    [],
  );
});
