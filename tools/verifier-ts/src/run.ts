// The CLI's work, separated from process wiring (cli.ts) so tests can call it
// in-process with an injected verify. Returns the exit code:
//   0 VALID, 1 INVALID, 2 PARTIAL, >=3 tool-level error (bad args, unreadable
//   file, or an internal error — any throw — inside the verifier itself).
// Per evolution.md EV-17 the exit code and reason text are NOT
// conformance-checked — only the verdict token and line number(s) are — but
// the non-normative CLI note pins this scheme so two verifiers do not diverge.

import { readFileSync } from "node:fs";
import { verifyExport } from "./verify.js";
import { chainIdentityLines, oneLine, verdictLine } from "./report.js";

const HEX64 = /^[0-9a-f]{64}$/;

export interface CliDeps {
  verify: typeof verifyExport;
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultDeps: CliDeps = {
  verify: verifyExport,
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

export function run(argv: string[], deps: CliDeps = defaultDeps): number {
  try {
    return main(argv, deps);
  } catch (e) {
    // A throw must never surface as exit 1, which means INVALID.
    const msg = oneLine(e instanceof Error ? e.message : String(e));
    deps.err(`odc-verify-ts: internal error: ${msg}\n`);
    return 3;
  }
}

function usage(deps: CliDeps): number {
  deps.err(
    "usage: verify <export.ndjson> [--head <64-lowercase-hex>] [--chain <64-lowercase-hex>]\n",
  );
  return 3;
}

function main(argv: string[], deps: CliDeps): number {
  const args = argv.slice(2);
  let file: string | undefined;
  let head: string | undefined;
  let chain: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--head") {
      const v = args[i + 1];
      if (v === undefined) return usage(deps);
      head = v;
      i++;
    } else if (a === "--chain") {
      const v = args[i + 1];
      if (v === undefined) return usage(deps);
      chain = v;
      i++;
    } else if (a === "verify") {
      // Optional leading subcommand word; ignored so `verify verify f` also works.
      continue;
    } else if (a !== undefined && a.startsWith("--")) {
      return usage(deps);
    } else {
      if (file !== undefined) return usage(deps);
      file = a;
    }
  }

  if (file === undefined) return usage(deps);
  if (head !== undefined && !HEX64.test(head)) {
    deps.err("error: --head must be 64 lowercase hex\n");
    return 3;
  }
  if (chain !== undefined && !HEX64.test(chain)) {
    deps.err("error: --chain must be 64 lowercase hex\n");
    return 3;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    deps.err(`error: cannot read file: ${file}\n`);
    return 3;
  }

  const result = deps.verify(bytes, head, chain);
  // Render before writing so a throw while rendering leaves stdout empty.
  const line = verdictLine(result) + "\n";
  // EX-24: genesis hash and head, on STDERR only (stdout stays the one verdict
  // line), after the verdict, for every non-empty export whatever the verdict.
  // Tool output, not conformance surface (EV-17).
  const identity = chainIdentityLines(bytes);
  deps.out(line);
  if (identity !== null) deps.err(identity);
  switch (result.verdict) {
    case "VALID":
      return 0;
    case "INVALID":
      return 1;
    case "PARTIAL":
      return 2;
  }
}
