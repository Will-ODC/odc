// The rehearsal CLI (Phase 0 T6d). Builds a seeded chain, optionally applies
// one tamper case, self-verifies the result, and writes the export.
//
// It emits no conformance verdict and never will: `selfVerify` is a check of
// the chain this tool just built, and T7's Go verifier is the first thing that
// judges an export against `contracts/`. What this prints is an INPUT to that
// judgement — the bytes, the head, and, for a tamper case, the line the
// contract says a verifier must attribute the failure to.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildChain, type ChainShape, DEFAULT_SHAPE } from "./build.js";
import { applyTamper, isTamperCase, TAMPER_CASES } from "./tamper.js";
import { selfVerify } from "./verify.js";

export const USAGE = `rehearsal — build a Phase 0 genesis-rehearsal chain

  --seed N           chain seed (default 1)
  --participants N   participant_registered events (default ${String(DEFAULT_SHAPE.participants)})
  --issues N         issue_created events (default ${String(DEFAULT_SHAPE.issues)})
  --votes N          vote_cast events (default ${String(DEFAULT_SHAPE.votes)})
  --case NAME        apply one tamper case: ${TAMPER_CASES.join(", ")}
  --tamper-seed N    seed for --case (default: the chain seed)
  --out FILE         write the export here (default: stdout)

Exit codes: 0 ok, 2 usage error, 3 self-verify disagreed with the tool.`;

export interface Options {
  seed: number;
  shape: ChainShape;
  case: string | null;
  tamperSeed: number | null;
  out: string | null;
}

export class UsageError extends Error {}

function int(flag: string, raw: string | undefined): number {
  if (raw === undefined) throw new UsageError(`${flag} needs a value`);
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new UsageError(`${flag} needs an integer`);
  return n;
}

/** Parses argv. Unknown flags are an error, never ignored — a silently dropped
 * `--case` would print a clean chain while the caller believed it tampered. */
export function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    seed: 1,
    shape: { ...DEFAULT_SHAPE },
    case: null,
    tamperSeed: null,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string;
    const next = argv[i + 1];
    switch (flag) {
      case "--seed":
        o.seed = int(flag, next);
        i += 1;
        break;
      case "--participants":
        o.shape.participants = int(flag, next);
        i += 1;
        break;
      case "--issues":
        o.shape.issues = int(flag, next);
        i += 1;
        break;
      case "--votes":
        o.shape.votes = int(flag, next);
        i += 1;
        break;
      case "--tamper-seed":
        o.tamperSeed = int(flag, next);
        i += 1;
        break;
      case "--case":
        if (next === undefined) throw new UsageError("--case needs a value");
        if (!isTamperCase(next)) {
          throw new UsageError(`unknown case ${next} (see --help)`);
        }
        o.case = next;
        i += 1;
        break;
      case "--out":
        if (next === undefined) throw new UsageError("--out needs a value");
        o.out = next;
        i += 1;
        break;
      default:
        throw new UsageError(`unknown flag ${flag}`);
    }
  }
  return o;
}

export interface Report {
  seed: number;
  shape: ChainShape;
  lines: number;
  head: string;
  ndjson: Buffer;
  /** Present only with `--case`. */
  tamper?: { case: string; seed: number; line: number };
}

/** The one injectable seam. `run`'s three throws are this tool's safety net —
 * a built chain that will not verify, a tampered one that does, a failure on
 * the wrong line — and none is reachable from real inputs, since all eight
 * cases agree. Injecting the checker is what makes them testable rather than
 * asserted-by-comment. */
export interface RunDeps {
  readonly verify?: typeof selfVerify;
}

/**
 * Builds, optionally tampers, and self-verifies. Throws when self-verify and
 * the tool disagree. That cross-check is the point of running it here: a
 * rehearsal export can never leave this tool carrying a defect nobody named.
 */
export function run(o: Options, deps: RunDeps = {}): Report {
  const verify = deps.verify ?? selfVerify;
  // `assertShape` rejects an out-of-range shape with a RangeError; from the
  // command line that is a usage mistake, not an internal inconsistency, and
  // the two exit codes differ.
  let chain;
  try {
    chain = buildChain(o.seed, o.shape);
  } catch (err) {
    if (err instanceof RangeError) throw new UsageError(err.message);
    throw err;
  }
  const clean = verify(chain);
  if (!clean.ok) {
    throw new Error(
      `built chain does not self-verify: line ${String(clean.line)} ${clean.rule} — ${clean.detail}`,
    );
  }
  const base: Report = {
    seed: o.seed,
    shape: chain.shape,
    lines: chain.events.length,
    head: chain.head,
    ndjson: chain.ndjson,
  };
  if (o.case === null) return base;

  const tamperSeed = o.tamperSeed ?? o.seed;
  if (!isTamperCase(o.case)) throw new UsageError(`unknown case ${o.case}`);
  const t = applyTamper(chain, o.case, tamperSeed);
  const after = verify({ ndjson: t.ndjson, head: t.head });
  if (after.ok) throw new Error(`${o.case} produced an export that verifies`);
  if (after.line !== t.line) {
    throw new Error(
      `${o.case}: declared line ${String(t.line)}, self-verify reports ${String(after.line)}`,
    );
  }
  return {
    ...base,
    lines: t.ndjson.toString("utf8").split("\n").length - 1,
    head: t.head,
    ndjson: t.ndjson,
    tamper: { case: o.case, seed: tamperSeed, line: t.line },
  };
}

/** The human-readable summary. Goes to stderr so `--out -` style piping of the
 * export on stdout stays byte-clean. */
export function summary(r: Report): string {
  const s = r.shape;
  const lines = [
    `seed        ${String(r.seed)}`,
    `shape       ${String(s.participants)} participants, ${String(s.issues)} issues, ${String(s.votes)} votes`,
    `lines       ${String(r.lines)}`,
    `head        ${r.head}`,
  ];
  if (r.tamper) {
    lines.push(
      `tamper      ${r.tamper.case} (seed ${String(r.tamper.seed)})`,
      `defect line ${String(r.tamper.line)}`,
    );
  }
  return lines.join("\n");
}

export function main(argv: readonly string[], deps: RunDeps = {}): number {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  let report: Report;
  let out: string | null;
  try {
    const opts = parseArgs(argv);
    out = opts.out;
    report = run(opts, deps);
  } catch (err) {
    const usage = err instanceof UsageError;
    process.stderr.write(`${(err as Error).message}\n`);
    if (usage) process.stderr.write(`\n${USAGE}\n`);
    return usage ? 2 : 3;
  }
  if (out === null) process.stdout.write(report.ndjson);
  else writeFileSync(out, report.ndjson);
  process.stderr.write(`${summary(report)}\n`);
  return 0;
}

// Runs only when this file IS the entry point. `endsWith("cli.js")` would also
// be true when the tests import it, which would build a chain on every import.
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
