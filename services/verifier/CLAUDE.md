# verifier — service rules

- ONLY the odc-verifier-builder agent works here, in a fresh context.
- Inputs allowed: `contracts/` (incl. `contracts/fixtures/`), this directory,
  `docs/charter.md` §4. NEVER ledger source, another service's source, or any
  prior discussion (`memory/`, `docs/decisions/`, other plan tickets).
- Go only; zero shared code/runtime/serialization with ledger. Standard library
  only, with ONE exception: `filippo.io/edwards25519`, used **solely** for the
  ET-4c prime-order subgroup check (ADR-0010).
- `verify <export.ndjson> [--head <hash>]` → one of the three chain verdicts of
  `contracts/evolution.md` EV-7/EV-17: `VALID` / `INVALID at line N` /
  `PARTIAL at lines …`. Exit codes 0 / 1 / 2, and ≥3 for tool-level errors.
  Reason text is advisory only; conformance is the verdict token and line
  number(s) alone (EV-17). See `README.md` and `API.md` for the full interface.
