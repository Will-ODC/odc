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

# End-to-end smoke: register → issue → vote → tally → export → verify
smoke:
    @echo "TODO(Phase 2): scripts/smoke.sh — the MVP acceptance test"

# Export the chain and run the independent Go verifier against it
verify:
    @echo "TODO(Phase 1): curl ledger /export | services/verifier verify"
