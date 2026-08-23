// T8's black-box genesis rehearsal. It builds the same deterministic export
// and tamper cases as the T6 CLI, then asks both independent verifiers to judge
// the bytes. Neither verifier is imported: process boundaries preserve the
// independence that gives their agreement value.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SHAPE } from "./build.js";
import { run, type Report } from "./cli.js";
import { TAMPER_CASES } from "./tamper.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

export interface Judge {
  readonly name: string;
  invoke(exportPath: string, head: string): CommandResult;
}

export interface ScenarioResult {
  readonly name: string;
  readonly expected: string;
  readonly verdicts: Readonly<Record<string, string>>;
}

function command(
  executable: string,
  args: readonly string[],
  cwd = REPO_ROOT,
): CommandResult {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/** Reduces advisory reason text to EV-17's conformance surface. */
export function conformanceVerdict(stdout: string): string {
  const line = stdout.trim();
  if (line === "VALID") return line;
  const invalid = /^(INVALID at line [1-9][0-9]*)(?::[^\n]*)?$/.exec(line);
  if (invalid !== null) return invalid[1] as string;
  // "line" and "lines" are both accepted, and both normalize to the plural.
  // EV-17's conformance surface is the verdict token plus the line numbers;
  // whether a verifier pluralizes for a single line is advisory presentation,
  // and the two independent verifiers do in fact differ on it. Matching only
  // the plural made a single-line PARTIAL fall through to the throw below —
  // so the shared judge would ABORT rather than report a mismatch, which is
  // strictly worse: an abort hides whether the verifiers actually agreed.
  // Dormant only because expected() never asks for a PARTIAL today; it goes
  // live the moment a PARTIAL vector reaches the rehearsal.
  const partial = /^PARTIAL at lines? ([1-9][0-9]*(?:, [1-9][0-9]*)*)$/.exec(
    line,
  );
  if (partial !== null) return `PARTIAL at lines ${partial[1] as string}`;
  throw new Error(`not an EV-17 verdict: ${JSON.stringify(line)}`);
}

function expected(report: Report): string {
  return report.tamper === undefined
    ? "VALID"
    : `INVALID at line ${String(report.tamper.line)}`;
}

function expectedExit(verdict: string): number {
  if (verdict === "VALID") return 0;
  if (verdict.startsWith("INVALID at line ")) return 1;
  return 2;
}

function assertJudgement(
  judge: Judge,
  result: CommandResult,
  want: string,
): string {
  if (result.error !== undefined) {
    throw new Error(`${judge.name} failed to start: ${result.error.message}`);
  }
  if (result.status === null || result.status >= 3) {
    throw new Error(
      `${judge.name} tool failure (exit ${String(result.status)}): ${result.stderr.trim() || "no stderr"}`,
    );
  }
  let verdict: string;
  try {
    verdict = conformanceVerdict(result.stdout);
  } catch (error) {
    throw new Error(
      `${judge.name}: ${(error as Error).message}; ${result.stderr.trim() || "no stderr"}`,
    );
  }
  if (verdict !== want) {
    throw new Error(`${judge.name}: wanted ${want}, got ${verdict}`);
  }
  const wantExit = expectedExit(want);
  if (result.status !== wantExit) {
    throw new Error(
      `${judge.name}: ${want} exited ${String(result.status)}, wanted ${String(wantExit)}; ${result.stderr.trim()}`,
    );
  }
  return verdict;
}

function defaultJudges(temp: string): readonly Judge[] {
  const goBinary = join(temp, "odc-verify-go");
  const built = command(
    "go",
    ["build", "-o", goBinary, "."],
    join(REPO_ROOT, "services/verifier"),
  );
  if (built.error !== undefined || built.status !== 0) {
    throw new Error(
      `Go verifier build failed: ${built.error?.message ?? built.stderr.trim()}`,
    );
  }
  const tsCli = join(REPO_ROOT, "tools/verifier-ts/dist/src/cli.js");
  return [
    {
      name: "go",
      invoke: (file, head) => command(goBinary, [file, "--head", head]),
    },
    {
      name: "typescript",
      invoke: (file, head) =>
        command(process.execPath, [tsCli, "verify", file, "--head", head]),
    },
  ];
}

export interface RehearsalDeps {
  readonly judges?: readonly Judge[];
}

/** Runs the clean export and all eight contract tamper cases. */
export function runRehearsal(
  seed = 1,
  deps: RehearsalDeps = {},
): readonly ScenarioResult[] {
  if (!Number.isInteger(seed)) throw new RangeError("seed must be an integer");
  const temp = mkdtempSync(join(tmpdir(), "odc-genesis-rehearsal-"));
  try {
    const judges = deps.judges ?? defaultJudges(temp);
    if (judges.length < 2) {
      throw new Error("the rehearsal requires two independent verifiers");
    }
    const reports: readonly [string, Report][] = [
      [
        "clean",
        run({
          seed,
          shape: { ...DEFAULT_SHAPE },
          case: null,
          tamperSeed: null,
          out: null,
        }),
      ],
      ...TAMPER_CASES.map((kase): [string, Report] => [
        kase,
        run({
          seed,
          shape: { ...DEFAULT_SHAPE },
          case: kase,
          tamperSeed: seed,
          out: null,
        }),
      ]),
    ];

    return reports.map(([name, report], index) => {
      const file = join(
        temp,
        `${String(index).padStart(2, "0")}-${name}.ndjson`,
      );
      writeFileSync(file, report.ndjson);
      const want = expected(report);
      const verdicts: Record<string, string> = {};
      for (const judge of judges) {
        if (verdicts[judge.name] !== undefined) {
          throw new Error(`duplicate verifier name: ${judge.name}`);
        }
        verdicts[judge.name] = assertJudgement(
          judge,
          judge.invoke(file, report.head),
          want,
        );
      }
      return { name, expected: want, verdicts };
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function main(argv: readonly string[]): number {
  if (argv.includes("--help")) {
    process.stdout.write("genesis-rehearsal [--seed N]\n");
    return 0;
  }
  let seed = 1;
  if (argv.length !== 0) {
    if (argv.length !== 2 || argv[0] !== "--seed") {
      process.stderr.write("usage: genesis-rehearsal [--seed N]\n");
      return 2;
    }
    seed = Number(argv[1]);
    if (!Number.isInteger(seed)) {
      process.stderr.write("--seed needs an integer\n");
      return 2;
    }
  }
  try {
    const results = runRehearsal(seed);
    for (const result of results) {
      process.stdout.write(
        `PASS ${result.name.padEnd(18)} ${result.expected}\n`,
      );
    }
    process.stdout.write(
      `PASS ${String(results.length)} scenarios × 2 independent verifiers\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 3;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
