# pulse

A community votes on something and sees the result.

People vote by swiping and can change their answer until the poll closes. They
sign in with a link sent to their email, and the email's domain proves which
community they belong to.

Pulse is exempt from the ODC charter. Read [CLAUDE.md](./CLAUDE.md) before
changing anything here.

## Status

- **Built:** sign-in by emailed link, voting (single-choice and approval), and
  results. Routes are in [API.md](./API.md); screens are in `apps/pulse-web`.
- **Database:** the schema and migration runner exist (`migrations/`,
  `src/db/`), but nothing uses them yet. All data is kept in memory.
- **Not built:** real email, creating polls, and the path to action.

## Run it

```bash
pnpm --filter @odc/pulse dev       # API on http://127.0.0.1:8080
pnpm --filter @odc/pulse-web dev   # app on http://localhost:5173
```

Sign-in links print to the API's terminal instead of being emailed. The API
seeds three linked polls and the community `demo-community`, which admits
`@example.test` addresses. To change the demo, edit `src/dev-server.ts`.
Everything is lost when the API stops.

`dev` refuses to start unless `NODE_ENV` is unset, `development`, or `test`. It
is not a production server.

| Variable               | Default                                       |
| ---------------------- | --------------------------------------------- |
| `PULSE_PORT`           | `8080`                                        |
| `PULSE_SESSION_SECRET` | new each run, so a restart signs everyone out |
| `PULSE_WEB_ORIGIN`     | `http://localhost:5173`                       |

## Test

```bash
pnpm --filter @odc/pulse build   # tests run against dist/, so build first
pnpm --filter @odc/pulse test
```

The database tests skip unless you give them a Postgres. Start pulse's own, on
port 5433 (see [docker-compose.yml](./docker-compose.yml) for why not 5432):

```bash
docker compose -f apps/pulse/docker-compose.yml up -d --wait
export PULSE_DATABASE_URL=postgres://pulse:pulse@127.0.0.1:5433/pulse_test
export PULSE_REQUIRE_DATABASE=1   # fail instead of skip if the database is missing
```

Stop it with `docker compose -f apps/pulse/docker-compose.yml down`.

CI runs the same checks, with a database, on every PR.
