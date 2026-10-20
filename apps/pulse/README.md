# pulse

The Pulse server. A community votes on a question and sees the result.

Anyone can vote without an account. Signing in uses a link sent by email. The
email's domain decides which community, if any, you belong to (ADR-0030). A
vote made while signed in is **confirmed**. Results show all votes and, beside
them, confirmed votes counted once per person (ADR-0040).

Pulse is **exempt from the ODC charter**: votes are plain records that can
change, with no signatures or hash chain. It never touches `services/` or
`contracts/`. Read [CLAUDE.md](./CLAUDE.md) before changing anything here.

| What                           | Where                                                   |
| ------------------------------ | ------------------------------------------------------- |
| API routes                     | [API.md](./API.md)                                      |
| Web app                        | `apps/pulse-web`                                        |
| What is built and what is next | `memory/pulse.md`                                       |
| Plans                          | `docs/plans/pulse.md`, GitHub issues                    |
| Screen designs                 | [Mockup index](../../docs/mockups/CANDIDATE_CONTEXT.md) |

**Signed-in people can publish polls over HTTP** (`POST /api/polls`,
ADR-0037), five an hour unless the owner grants more. There is no screen for
it yet. The owner is whoever signs in with `PULSE_OWNER_EMAIL`.

For contributors, see the [Pulse agent guide](./CLAUDE.md). The API reference
marks planned interfaces separately from routes that are served today.

## Run it on your computer

```bash
pnpm --filter @odc/pulse dev       # API on http://127.0.0.1:8080
pnpm --filter @odc/pulse-web dev   # app on http://localhost:5173
```

- No email is sent. Sign-in links print in the API's terminal.
- Three demo polls load from `src/dev-server.ts`.
- `@example.test` emails join `demo-community`. `@both.example.test` emails pick
  between two communities. Other emails get no community.
- Data is kept in memory and lost on stop. To keep it, start the test database
  (below) and set `PULSE_DATABASE_URL`, `PULSE_SESSION_SECRET` and
  `PULSE_CONFIRMATION_KEY`.
- `dev` only runs when `NODE_ENV` is unset, `development` or `test`.

| Variable                 | Default                                          |
| ------------------------ | ------------------------------------------------ |
| `PULSE_PORT`             | `8080`                                           |
| `PULSE_SESSION_SECRET`   | new each run, so a restart signs everyone out    |
| `PULSE_CONFIRMATION_KEY` | new each run, so a restart forgets who confirmed |
| `PULSE_WEB_ORIGIN`       | `http://localhost:5173`                          |
| `PULSE_DATABASE_URL`     | unset, so data is kept in memory                 |
| `PULSE_OWNER_EMAIL`      | unset, so nobody is owner                        |

`PULSE_WEB_ORIGIN` is also the only `Origin` that poll creation accepts.

## Test

```bash
pnpm --filter @odc/pulse build   # tests run against dist/, so build first
pnpm --filter @odc/pulse test
pnpm --filter @odc/pulse-integration test  # real-HTTP cross-package suites
```

The integration workspace owns the two suites that exercise Pulse and its
browser client together over real HTTP. Its checks are
`pnpm --filter @odc/pulse-integration typecheck` and
`pnpm --filter @odc/pulse-integration lint`. Root Turbo test commands include
these suites; the Pulse and web builds remain independent. See
[ADR-0041](../../docs/decisions/0041-pulse-integration-test-workspace.md).

Database tests skip unless a Postgres is set. To run them:

```bash
docker compose -f apps/pulse/docker-compose.yml up -d --wait   # Postgres on port 5433
export PULSE_DATABASE_URL=postgres://pulse:pulse@127.0.0.1:5433/pulse_test
export PULSE_REQUIRE_DATABASE=1   # fail instead of skip if the database is missing
```

Stop it with `docker compose -f apps/pulse/docker-compose.yml down`. That also
resets the demo polls. CI runs these tests with a database on every PR.

## Serve it

```bash
just pulse-up      # http://127.0.0.1:8080; `just pulse-down` stops it
```

This runs two Docker images. `web` serves the page and sends `/api` to `api`.
**It sends real email.** Use `dev` to try the sign-in flow.

The server will not start without these:

| Variable                 | Why it has no default                                  |
| ------------------------ | ------------------------------------------------------ |
| `PULSE_SESSION_SECRET`   | a new one each start would sign everyone out           |
| `PULSE_CONFIRMATION_KEY` | a new one each start would forget who confirmed        |
| `PULSE_DATABASE_URL`     | memory would lose every vote on redeploy               |
| `PULSE_RESEND_API_KEY`   | without it, sign-in links would be printed in the logs |
| `PULSE_WEB_ORIGIN`       | a guess would email everyone a link to localhost       |
| `PULSE_MAIL_FROM`        | the sender, e.g. `pulse <sign-in@your-domain.org>`     |

Optional: `PULSE_MAIL_REPLY_TO`, `PULSE_PORT` (8080), `PULSE_HOST` (`0.0.0.0`),
`PULSE_DATABASE_SCHEMA`, `PULSE_OWNER_EMAIL` (the owner, who may grant
unlimited posting; unset means nobody, and a value that is not an address
stops the start). `PULSE_WEB_ORIGIN` is also the only `Origin` poll creation
accepts. Plain `RESEND_API_KEY` and `DATABASE_URL` are ignored.

**`PULSE_CONFIRMATION_KEY` is as secret as the database.** Anyone with both can
work out who voted what. Make it at least 32 characters
(`openssl rand -base64 32`) and different from `PULSE_SESSION_SECRET`; the
server refuses otherwise. Changing it means anyone who confirms again is
counted as a new confirmed voter.

Keep the API port private. The API trusts the client IP only when it comes
from a private address, such as nginx's.

**Upgrading:** stop every old API instance before starting the new one.
Migrations run on start. An old instance left running can break sign-in and
sign-out, fail on new community labels, or record votes without confirmation.

## MCP

`POST /api/mcp` offers two read-only tools: `get_poll` and `get_results`. With
`dev` running, point an MCP client at `http://127.0.0.1:8080/api/mcp` and ask
for poll `ads-free`. Details are in [API.md](./API.md#mcp-public-reads).
