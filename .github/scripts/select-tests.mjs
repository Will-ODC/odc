import { appendFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const full = (reason) => ({ mode: "full", filters: [], core: true, reason });
const guide =
  /^(?:apps|services|tools|tests)\/[^/]+\/(?:README|CLAUDE|API|DEPLOY)\.md$/;
function documentation(file) {
  return (
    /^(?:docs|memory|\.claude)\/.*\.md$/.test(file) ||
    /^[^/]+\.md$/.test(file) ||
    guide.test(file)
  );
}

export function selectImageTests(files, { forceFull = false } = {}) {
  if (forceFull || files === null) return true;
  return files.some((file) => {
    if (documentation(file)) return false;
    if (/^apps\/pulse(?:-web)?\//.test(file)) return true;
    // Neither Dockerfile copies core code, contracts or integration tests.
    if (/^(?:services|tools|tests|contracts)\//.test(file)) return false;
    return true; // Shared or unrecognized input: rebuild rather than guess.
  });
}

// Seams not represented by workspace dependencies: a change in any member
// selects every member. Core conformance crosses language/package boundaries
// (the Go verifier); Pulse server tests read pulse-web files (.env.development).
// select-tests.integration.test.mjs fails when a package reads another
// package's files without a group or declared dependency covering the pair.
export const groups = {
  core: (pkgPath) => /^(services|tools)\//.test(pkgPath),
  pulse: (pkgPath) => /^apps\/pulse(?:-web)?$/.test(pkgPath),
};

// Filters include reverse dependencies: e.g. either Pulse app selects its
// real-HTTP integration workspace. Turbo owns the dependency graph.
export function selectTests(files, packages, { forceFull = false } = {}) {
  if (forceFull) return full("Scheduled or manual full-suite run");
  if (files === null) return full("Comparison or workspace discovery failed");
  const names = new Set();
  const hit = new Set();
  for (const file of files) {
    if (file.startsWith("contracts/")) return full(`Contracts input: ${file}`);
    if (file === "docs/charter.md") return full("Charter input");
    if (documentation(file)) continue;
    if (file.startsWith("services/verifier/")) {
      hit.add("core");
      continue;
    }
    const owner = packages.find((pkg) => file.startsWith(`${pkg.path}/`));
    if (!owner) return full(`Shared or unknown input: ${file}`);
    names.add(owner.name);
    for (const [group, member] of Object.entries(groups))
      if (member(owner.path)) hit.add(group);
  }
  for (const group of hit)
    for (const pkg of packages)
      if (groups[group](pkg.path)) names.add(pkg.name);
  const core = hit.has("core");
  return {
    mode: names.size || core ? "affected" : "docs",
    filters: [...names].sort().map((name) => `...${name}`),
    core,
    reason: core
      ? "Changed packages and dependents; core conformance included"
      : names.size
        ? "Changed packages and dependents"
        : "No runtime inputs changed",
  };
}

export function changedPaths(root, base, head) {
  try {
    const resolve = (ref) =>
      execFileSync(
        "git",
        ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    // Disable rename detection so moving a source file into docs cannot hide
    // the deleted runtime input. NUL delimiters preserve arbitrary filenames.
    return execFileSync(
      "git",
      [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        resolve(base),
        resolve(head),
        "--",
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function workspacePackages(root) {
  const list = JSON.parse(
    execFileSync("pnpm", ["list", "-r", "--depth", "-1", "--json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  return list
    .filter((pkg) => pkg.path !== root)
    .map((pkg) => {
      const relative = path.relative(root, pkg.path).split(path.sep).join("/");
      if (
        relative.startsWith("..") ||
        !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(pkg.name)
      )
        throw new Error("Invalid workspace metadata");
      return { path: relative, name: pkg.name };
    });
}

function main() {
  const task = process.argv[2] === "--run" && process.argv[3];
  if (task) {
    if (!["lint", "typecheck", "test"].includes(task))
      throw new Error("Unknown CI task");
    const filters = JSON.parse(process.env.CI_TEST_FILTERS);
    if (
      !Array.isArray(filters) ||
      filters.some(
        (f) =>
          typeof f !== "string" ||
          !/^\.\.\.(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(f),
      )
    )
      throw new Error("Invalid CI filters");
    const result = spawnSync(
      "pnpm",
      ["exec", "turbo", "run", task, ...filters.map((f) => `--filter=${f}`)],
      { stdio: "inherit" },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  const root = process.cwd();
  const files = changedPaths(root, process.env.CI_BASE, process.env.CI_HEAD);
  const forceFull = process.env.CI_FULL === "true";
  if (process.argv[2] === "--images") {
    const images = selectImageTests(files, { forceFull });
    console.log(
      images
        ? "Pulse image inputs changed or full run requested"
        : "No Pulse image inputs changed",
    );
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `images=${images}\n`);
    return;
  }
  let plan;
  try {
    plan = selectTests(files, workspacePackages(root), { forceFull });
  } catch {
    plan = full("Comparison or workspace discovery failed");
  }
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=${plan.mode}\ncore=${plan.core}\nfilters=${JSON.stringify(plan.filters)}\n`,
    );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Test selection\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
