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
- **Storage:** Postgres when `PULSE_DATABASE_URL` is set, migrated on every
  start; memory otherwise. The tests run every store against both.
- **Not built:** real email, creating polls, and the path to action.

## Run it

```bash
pnpm --filter @odc/pulse dev       # API on http://127.0.0.1:8080
pnpm --filter @odc/pulse-web dev   # app on http://localhost:5173
```

Sign-in links print to the API's terminal instead of being emailed. The API
seeds three linked polls and the community `demo-community`, which admits
`@example.test` addresses. To change the demo, edit `src/dev-server.ts`.

Without a database, everything is lost when the API stops. To keep it, start
pulse's database (see [Test](#test)) and set `PULSE_DATABASE_URL` before `dev`.
Set `PULSE_SESSION_SECRET` too: the ballot cookie is signed with it, so without
it a restart signs everyone out and lets each browser vote again.

With a database, the seed writes only polls that are not stored yet. Editing
`src/dev-server.ts` does not change polls already there, and the seeded polls
close three days after the start that first wrote them. For a fresh demo, empty
the database with `docker compose -f apps/pulse/docker-compose.yml down`.

`dev` refuses to start unless `NODE_ENV` is unset, `development`, or `test`. It
is not a production server.

| Variable               | Default                                       |
| ---------------------- | --------------------------------------------- |
| `PULSE_PORT`           | `8080`                                        |
| `PULSE_SESSION_SECRET` | new each run, so a restart signs everyone out |
| `PULSE_WEB_ORIGIN`     | `http://localhost:5173`                       |
| `PULSE_DATABASE_URL`   | unset: everything in memory                   |

### Sending real email

`dev` always prints the sign-in link to the terminal and never sends anything,
which is what keeps the flow demonstrable with no provider account at all. A
served pulse sends through Resend (ADR-0027), configured with:

| Variable               | Meaning                                                  |
| ---------------------- | -------------------------------------------------------- |
| `PULSE_RESEND_API_KEY` | unset means no provider, so `ConsoleMailer` is used      |
| `PULSE_MAIL_FROM`      | the From header, e.g. `pulse <sign-in@your-domain.org>`  |
| `PULSE_MAIL_REPLY_TO`  | optional, when replies should not go to the From address |

A key set without `PULSE_MAIL_FROM` refuses to start rather than failing at the
first sign-in. Nothing is read from a bare `RESEND_API_KEY`, for the same reason
a bare `DATABASE_URL` is not read.

**Before any of this works you need a sending domain** verified with the
provider, with its SPF and DKIM records published to DNS. That is the expensive
half, and it is the same work whichever provider is used.

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

Stop it with `docker compose -f apps/pulse/docker-compose.yml down`. That command
starts the database only — the served images are behind a profile, so testing
does not build two images to get a Postgres.

CI runs the same checks, with a database, on every PR.

## Serve it

`pnpm dev` is for a laptop and refuses to run anywhere else. Serving pulse is a
second entry point, `src/main.ts`, and two images (ADR-0028):

```bash
just pulse-up      # or the docker compose line it wraps
```

**Two processes, one origin.** `web` serves the page and forwards `/api` to
`api`, so the browser sees one website — which is what keeps the `SameSite=Lax`
session cookie working without weakening it. It is the same shape `pnpm dev`
already has, where vite proxies `/api` to port 8080.

`src/main.ts` **refuses to start** without the four values below, rather than
inventing them the way `dev-server.ts` may. Everything missing is named in one
message, so configuring a deployment is not a sequence of failed boots:

| Variable               | Why it has no default                                   |
| ---------------------- | ------------------------------------------------------- |
| `PULSE_SESSION_SECRET` | a generated one signs everyone out on every restart     |
| `PULSE_DATABASE_URL`   | the in-memory fallback would lose every vote on deploy  |
| `PULSE_RESEND_API_KEY` | `ConsoleMailer` would print sign-in links into the logs |
| `PULSE_WEB_ORIGIN`     | a guessed default mails everyone a link to localhost    |

Optional: `PULSE_PORT` (8080), `PULSE_HOST` (`0.0.0.0`, because loopback is
unreachable from outside a container), `PULSE_MAIL_REPLY_TO`, and
`PULSE_DATABASE_SCHEMA` for deploying pulse beside something else in one
database.

**A served pulse sends real email.** There is no console mailer in this path, so
`just pulse-up` with a live Resend key mails whoever signs in. Use `pnpm dev`
to click through the flow.

**Two things this does not give you yet:** nobody can sign in unless a row in
`allowed_domain` admits their email's domain, and there are no polls, because
poll authoring is not built (`docs/plans/pulse.md` P6). Both are inserts today.
