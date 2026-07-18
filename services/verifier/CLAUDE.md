# verifier — service rules

- ONLY the odc-verifier-builder agent works here, in a fresh context.
- Inputs allowed: contracts/, this directory. NEVER ledger source or discussion.
- Go only; zero shared code/runtime/serialization with ledger.
- verify <export.ndjson> [--head <hash>] → VALID | INVALID at line N.
