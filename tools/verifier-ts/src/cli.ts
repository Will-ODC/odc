#!/usr/bin/env node
// CLI: verify <export.ndjson> [--head <hash>]
//
// Prints one of VALID / INVALID at line N / PARTIAL at lines ... and exits:
//   0 VALID, 1 INVALID, 2 PARTIAL, >=3 tool-level error (bad args, unreadable
//   file). Per evolution.md EV-17 the exit code and reason text are NOT
//   conformance-checked — only the verdict token and line number(s) are — but
//   the non-normative CLI note pins this scheme so two verifiers do not diverge.

import { readFileSync } from "node:fs";
import { verifyExport } from "./verify.js";
import { verdictLine } from "./report.js";

const HEX64 = /^[0-9a-f]{64}$/;

function usage(): never {
  process.stderr.write(
    "usage: verify <export.ndjson> [--head <64-lowercase-hex>]\n",
  );
  process.exit(3);
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  let file: string | undefined;
  let head: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--head") {
      const v = args[i + 1];
      if (v === undefined) usage();
      head = v;
      i++;
    } else if (a === "verify") {
      // Optional leading subcommand word; ignored so `verify verify f` also works.
      continue;
    } else if (a !== undefined && a.startsWith("--")) {
      usage();
    } else {
      if (file !== undefined) usage();
      file = a;
    }
  }

  if (file === undefined) usage();
  if (head !== undefined && !HEX64.test(head)) {
    process.stderr.write("error: --head must be 64 lowercase hex\n");
    return 3;
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    process.stderr.write(`error: cannot read file: ${file}\n`);
    return 3;
  }

  const result = verifyExport(bytes, head);
  process.stdout.write(verdictLine(result) + "\n");
  switch (result.verdict) {
    case "VALID":
      return 0;
    case "INVALID":
      return 1;
    case "PARTIAL":
      return 2;
  }
}

process.exit(main(process.argv));
