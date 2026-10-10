#!/usr/bin/env node
// CLI: verify <export.ndjson> [--head <hash>]
//
// Prints one of VALID / INVALID at line N / PARTIAL at lines ... and exits:
//   0 VALID, 1 INVALID, 2 PARTIAL, >=3 tool-level error (bad args, unreadable
//   file, internal error). The work and the exit-code scheme live in run.ts.

import { run } from "./run.js";

// Set the exit code and let the process end on its own rather than calling
// process.exit() straight after verification: an immediate process.exit() was
// OBSERVED (not proven) to die with SIGSEGV on one machine. The measured
// numbers are in the README, in one place. Every path — usage errors included
// — returns its code through run() so none of them calls process.exit().
process.exitCode = run(process.argv);
