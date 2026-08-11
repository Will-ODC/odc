# ADR-0012: Genesis rehearsal result

- **Status:** accepted
- **Date:** 2026-08-10
- **Phase:** 0

## Context

The draft contracts require an end-to-end rehearsal before they can advance to
release-candidate review. Unit tests and golden fixtures establish conformance
over known cases, but they do not prove that independently implemented
verifiers agree on a larger generated chain or attribute realistic tampering to
the same line.

T6 supplied a deterministic TypeScript chain builder and eight-case tamper
matrix. T7 and T7b supplied independent Go and TypeScript verifiers, each built
in hard isolation from the builder and from the other verifier. T8 connected
those tools only through their command-line interfaces.

## Decision

The Phase 0 genesis rehearsal passed cleanly on seed 1 with the default shape:
12 participants, 5 issues, 40 votes, and 58 total events. Both independent
verifiers returned `VALID` for the unmodified export and agreed on every
EV-17 line attribution in the tamper matrix:

| Case              | Expected verdict     |
| ----------------- | -------------------- |
| byte flip         | `INVALID at line 47` |
| line deletion     | `INVALID at line 28` |
| line reordering   | `INVALID at line 48` |
| truncation        | `INVALID at line 46` |
| duplicated seq    | `INVALID at line 48` |
| wrong prev_hash   | `INVALID at line 47` |
| reserialized line | `INVALID at line 47` |
| wrong head        | `INVALID at line 58` |

No verifier disagreement or contract ambiguity appeared, so the rehearsal
required no contract, fixture, or golden-hash change. `just rehearsal 1`
reproduces the complete pass. Required repository CI now runs the Go fixture
suite and this two-verifier rehearsal on every pull request.

## Consequences

- The T8 rehearsal gate is satisfied; T9 security audit is next.
- The contracts remain **DRAFTING**. T8 does not advance them to RELEASE
  CANDIDATE and does not create a `contracts-v1` tag.
- Any future change that makes either verifier disagree with a committed
  fixture or rehearsal case blocks the required repository check.
- The generated exports are temporary evidence, not new golden fixtures.

### Documents reconciled

`docs/plans/phase-0.md` now names this available ADR number and records that T8
runs both independent verifiers. `tools/rehearsal/README.md` documents the
reproducible command. No other document outside `contracts/` stated a
conflicting T8 procedure.

## Charter check

This decision implements P1 and charter §4: the canonical export is judged from
its raw bytes by independent tools, and tampering is detected without trusting
the operator. It does not touch identity, ballot secrecy, weighting, or access,
so P2–P4 are unchanged.
