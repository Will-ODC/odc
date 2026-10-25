# ledger

**Status: Phase 1, built.** Storage, the EV-26 checker, the single writer,
the public read API, the operator write path and ballot batching are built
and wired into the server. The signer service (`services/signer/`) does not
exist yet: batching is tested against an HTTP double of its documented API
(`tests/support/fake-signer.ts`). Built against the contracts RELEASE
CANDIDATE (ADR-0007).

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
The ledger's one outbound call is to the signer, on the ballot write path
(`API.md` "Calls the ledger makes"): `src/batching/` seals, orders, signs and
appends ballot batches through `src/clients/signer.ts`.

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
LEDGER_SIGNER_URL=<signer base URL> pnpm --filter @odc/ledger start`. Both are
required. On start, if the stored log verifies `VALID`, it replays any stored
sign request before the internal port listens, then seals ballot batches on a
one-second timer; a log that is not `VALID` serves reads only.
`LEDGER_PUBLIC_PORT` (default 8090), `LEDGER_PUBLIC_HOST` (default `0.0.0.0`),
`LEDGER_INTERNAL_PORT` (default 8091) and `LEDGER_INTERNAL_HOST` (default
`127.0.0.1`) set where it listens (`src/config.ts`).

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

Both independent verifiers also judge the ledger's own exports as black boxes
(`tests/verifiers/export.verify.ts`): a chain of operator events built over
HTTP and a chain of ballot batches built by the batcher must be `VALID` to
both, and byte flips must be `INVALID` at the line the ledger names. It is not
part of `test`; CI runs it as its own step:

```sh
(cd services/verifier && go build -o /tmp/odc-verify .)
pnpm --filter @odc/verifier-ts build
LEDGER_DATABASE_URL=... LEDGER_REQUIRE_DATABASE=1 ODC_VERIFY_GO=/tmp/odc-verify \
  ODC_VERIFY_TS="node $PWD/tools/verifier-ts/dist/src/cli.js verify" \
  pnpm --filter @odc/ledger test:verifiers
```

Without both variables it skips, unless `LEDGER_REQUIRE_DATABASE=1`, where a
missing verifier is a failure.

## Before deployment

- Give the public port a SELECT-only database role and its own pool, so
  read-only is structural, not by code (deferred from the #461 review).
- Build and deploy `services/signer/` (ADR-0043); until then the ledger has
  nothing to seal against and the close call stays `closing`.
