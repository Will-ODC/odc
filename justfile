# ODC dev entry point. `just` lists commands.

default:
    @just --list

# Start all services + databases
up:
    docker compose up --build -d

down:
    docker compose down

# Run every service's tests (JS via turbo, Go verifier natively)
test:
    pnpm turbo run test
    cd services/verifier && go test ./...

# Build a rehearsal chain and write its canonical NDJSON export (T6d).
# `just rehearsal-build 7` seeds it; add flags after the seed, e.g.
#   just rehearsal-build 7 "--case byte-flip --out tampered.ndjson"
# The export goes to stdout unless --out is given; the summary goes to stderr.
rehearsal-build seed="1" flags="":
    @pnpm turbo run build --filter=@odc/rehearsal >/dev/null
    @node tools/rehearsal/dist/src/cli.js --seed {{ seed }} {{ flags }}

# Phase 0 genesis rehearsal: throwaway chain → export → fresh verifier → tamper matrix
# The chain and tamper halves are `rehearsal-build`; the loop that feeds them to
# the Go verifier and reconciles the verdicts is T8.
rehearsal:
    @echo "TODO(T8): drive rehearsal-build through services/verifier — see .claude/skills/odc-contracts"

# End-to-end smoke: register → issue → vote → tally → export → verify
# (seeded by the rehearsal scripts once Phase 1 lands)
smoke:
    @echo "TODO(Phase 2): scripts/smoke.sh — the MVP acceptance test"

# Export the chain and run the independent Go verifier against it
verify:
    @echo "TODO(Phase 1): curl ledger /export | services/verifier verify"
