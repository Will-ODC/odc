// Runs both verifiers on every vector in contracts/fixtures/index.json and
// compares each verdict and line set with the expectation and with each other.
//
// Usage: node corpus.mjs <out-dir> <repo-root> <go-binary> <ts-cli.js>
// Writes <out-dir>/corpus-results.json and prints a summary.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [outDir, repoRoot, goBin, tsCli] = process.argv.slice(2);
if (!outDir || !repoRoot || !goBin || !tsCli) {
  console.error(
    "usage: node corpus.mjs <out-dir> <repo-root> <go-binary> <ts-cli.js>",
  );
  process.exit(64);
}

const fixtures = join(resolve(repoRoot), "contracts", "fixtures");
const index = JSON.parse(readFileSync(join(fixtures, "index.json"), "utf8"));

/** Runs one verifier and parses its first output line into a verdict. */
export function run(cmd, args) {
  let out;
  try {
    out = execFileSync(cmd, args, { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    out = `${err.stdout ?? ""}`;
  }
  const first = out.split("\n")[0];
  const m = /^(VALID|INVALID|PARTIAL)(?: at lines? ([0-9, ]+))?/.exec(first);
  if (!m) return { verdict: "TOOL", lines: [], raw: first };
  const lines = m[2]
    ? m[2]
        .split(/[ ,]+/)
        .filter(Boolean)
        .map((n) => Number(n))
    : [];
  return { verdict: m[1], lines };
}

function expected(v) {
  if (v.expect.verdict === "INVALID") return [v.expect.line];
  if (v.expect.verdict === "PARTIAL") return v.expect.lines;
  return [];
}

const same = (a, b) =>
  a.verdict === b.verdict &&
  JSON.stringify(a.lines) === JSON.stringify(b.lines);

const rows = [];
const tally = { VALID: 0, INVALID: 0, PARTIAL: 0 };
let mismatches = 0;
for (const v of index.vectors) {
  const args = [join(fixtures, v.export)];
  if (v.head) args.push("--head", v.head);
  if (v.chain) args.push("--chain", v.chain);
  const go = run(goBin, args);
  const ts = run("node", [tsCli, ...args]);
  const want = { verdict: v.expect.verdict, lines: expected(v) };
  const ok = same(go, want) && same(ts, want);
  if (!ok) mismatches += 1;
  tally[want.verdict] += 1;
  rows.push({ id: v.id, want, go, ts, ok });
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "corpus-results.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);
console.log(
  `vectors=${rows.length} match=${rows.length - mismatches} mismatch=${mismatches}`,
  JSON.stringify(tally),
);
for (const r of rows.filter((x) => !x.ok))
  console.log("MISMATCH", JSON.stringify(r));
process.exit(mismatches === 0 ? 0 : 1);
