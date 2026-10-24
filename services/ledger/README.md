# ledger

**Status: Phase 1, in progress.** Storage, the EV-26 checker, the single
writer, the public read API and the operator write path are built. Ballot
batching lands in #463 plus a wiring PR. Built against the
contracts RELEASE CANDIDATE (ADR-0007).

## What it is

The append-only, hash-chained event log: the single writer of truth. Every
event is checked before it is stored (`evolution.md` EV-26), so the stored
log always exports as a file both independent verifiers call `VALID`. It owns
its Postgres database; no other service reads it. Rules for agents are in
`CLAUDE.md`; the full spec is `docs/implementation-plan.md` §"ledger".

## Interface

Two ports, both documented in `API.md`. The **public** port serves
`GET /events` (`contracts/read-api.md`), `GET /head` and `GET /export`; it is
unauthenticated and read-only. The **internal** port takes the operator's
signed appends (`POST /appends`) and close calls
(`POST /issues/{issue_id}/close`); bind it to a private network only.
The ledger's one outbound call will be to the signer, on the ballot write path
(#463 and the wiring PR).

## Storage

`src/db/` stores and reads events in the ledger's own Postgres; it does not
hash or verify (that is EV-26, above it). `migrations/` holds plain, reviewed,
forward-only SQL, applied by `src/db/migrate.ts` as the owner role. Every
table is INSERT-only for every role (grants plus triggers). The database
refuses a row that breaks the chain or whose columns disagree with its export
`line`: `seq`, `prev_hash` and `hash` are tied to the line byte for byte, and
`type`, `version` and `ts` by value. So a non-canonical line (for example one
with a duplicate key) can pass the database; EV-26 is what refuses it.

The service connects as `ledger_app` (SELECT and INSERT only). It is a
cluster-wide role: every database on the same Postgres server shares it and
its password, which the runner sets from `LEDGER_APP_PASSWORD` as a SCRAM
verifier, never in plain text.

## How to run it

Start the database with `docker compose -f services/ledger/docker-compose.yml
up -d --wait db`, apply the migrations as the owner role (`migrate()` in
`src/db/migrate.ts`; there is no CLI for it yet), build with
`pnpm --filter @odc/ledger build`, then run
`LEDGER_DATABASE_URL=postgres://ledger_app:<password>@127.0.0.1:5434/ledger
pnpm --filter @odc/ledger start`. `LEDGER_PUBLIC_PORT` (default 8090),
`LEDGER_PUBLIC_HOST` (default `0.0.0.0`), `LEDGER_INTERNAL_PORT` (default 8091) and `LEDGER_INTERNAL_HOST` (default `127.0.0.1`) set where it listens
(`src/config.ts`).

## How to test it

```sh
docker compose -f services/ledger/docker-compose.yml up -d --wait db
pnpm --filter @odc/ledger build
LEDGER_DATABASE_URL=postgres://ledger:ledger@127.0.0.1:5434/ledger \
  LEDGER_REQUIRE_DATABASE=1 pnpm --filter @odc/ledger test
```

Without `LEDGER_DATABASE_URL` the DB tests skip; `LEDGER_REQUIRE_DATABASE=1`
(set on CI) turns a missing database into a failure. Each test creates and
drops its own throwaway database.
