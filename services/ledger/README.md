# ledger

**Status: Phase 1, in progress — builds now against the contracts RELEASE CANDIDATE (ADR-0007); nothing waits on the freeze.**

The append-only, hash-chained event log. The single writer of truth.

See `docs/implementation-plan.md` §"ledger" for the full spec, and this
directory's `CLAUDE.md` for agent rules.

## Storage

`src/db/` stores and reads events in the ledger's own Postgres; it does not
hash or verify (that is EV-26, above it). `migrations/` holds plain, reviewed,
forward-only SQL, applied by `src/db/migrate.ts` as the owner role. The table
is INSERT-only for every role (grants plus triggers), and the database refuses
a row that breaks the chain or whose columns disagree with its export `line`.

The service connects as `ledger_app` (SELECT and INSERT only). It is a
cluster-wide role: every database on the same Postgres server shares it and
its password, which the runner sets from `LEDGER_APP_PASSWORD` as a SCRAM
verifier, never in plain text.

## Running the DB tests

```sh
docker compose -f services/ledger/docker-compose.yml up -d --wait db
pnpm --filter @odc/ledger build
LEDGER_DATABASE_URL=postgres://ledger:ledger@127.0.0.1:5434/ledger \
  LEDGER_REQUIRE_DATABASE=1 pnpm --filter @odc/ledger test
```

Without `LEDGER_DATABASE_URL` the DB tests skip; `LEDGER_REQUIRE_DATABASE=1`
(set on CI) turns a missing database into a failure. Each test creates and
drops its own throwaway database.
