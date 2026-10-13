# pulse

A community votes on something and sees the result.

You open a question and answer it. A two-answer question is a swipe on a phone
or a click on a computer; any other question shows a list. You can change your answer until the poll
closes. No account is needed to vote. Signing in, with a link sent to your
email, lets pulse know who you are; anyone with a working address can sign in,
and the address's domain only decides which community, if any, you belong to
(ADR-0030).

Pulse is the first product built in the ODC repo. It is **exempt from the ODC
charter** on purpose: no signatures and no hash chain, and votes are a plain
record that can change. It never reads or writes the ODC core (`services/`,
`contracts/`). Read [CLAUDE.md](./CLAUDE.md) before changing anything here.

| What                      | Where                                      |
| ------------------------- | ------------------------------------------ |
| This server               | `apps/pulse`, routes in [API.md](./API.md) |
| The web app (all screens) | `apps/pulse-web`                           |
| Current state, in detail  | `memory/pulse.md`                          |
| Plans and open decisions  | `docs/plans/pulse.md`, GitHub issues       |
| Screen designs            | `docs/mockups/pulse-screens/`              |

## Where it stands

**Built:**

- Voting: one-answer and pick-several polls, results, changing your answer.
- Sign-in by emailed link, sent through Resend (ADR-0027).
- Storage in Postgres, or in memory when no database is set.
- A phone layout, and a desktop layout from 1100px wide.
- Two Docker images that serve the whole thing (ADR-0028). CI builds both.

Migration 005 adds the authored-poll storage foundation (ADR-0037): keyed
communities, private author metadata, publication acknowledgement, replay records
and posting-grant state/audit. Existing identity-label foreign keys and
transactional quota/grant operations follow in the store slice. No creation
endpoint is served yet. Legacy polls keep unknown authors and community; General
is a posting destination and does not replace null account membership.

**Not built:**

- **Creating polls.** Today polls exist only as seed data or database inserts.
  The creation design is ADR-0037 and the explicitly planned interface in
  [API.md](./API.md#planned--not-served-poll-creation-adr-0037); implementation
  follows the merge-gated steps in `docs/plans/pulse.md` P6.
- The explaining screens between questions, and the "what happens next" step
  after a vote.
- Poll photos and summaries (#296), and comments (#297).

**Before a real launch** you also need a host, a domain, and that domain
verified with Resend for sending email.

## Run it on your computer

```bash
pnpm --filter @odc/pulse dev       # API on http://127.0.0.1:8080
pnpm --filter @odc/pulse-web dev   # app on http://localhost:5173
```

No email is sent: sign-in links print in the API's terminal. The API loads
three linked demo polls (edit `src/dev-server.ts` to change them).

- `@example.test` addresses join the community `demo-community`.
- `@both.example.test` addresses are asked to pick between two communities.
- Any other address signs in with no community.

Everything is kept in memory and lost when the API stops. To keep it, start
the database (see [Test](#test)), then set `PULSE_DATABASE_URL` and
`PULSE_SESSION_SECRET` before `dev`. Without the secret, a restart signs
everyone out and lets each browser vote again. With a database, seed polls are
written once and close three days later; for a fresh demo, run
`docker compose -f apps/pulse/docker-compose.yml down`.

`dev` refuses to start unless `NODE_ENV` is unset, `development` or `test`.

| Variable               | Default                                       |
| ---------------------- | --------------------------------------------- |
| `PULSE_PORT`           | `8080`                                        |
| `PULSE_SESSION_SECRET` | new each run, so a restart signs everyone out |
| `PULSE_WEB_ORIGIN`     | `http://localhost:5173`                       |
| `PULSE_DATABASE_URL`   | unset: everything in memory                   |

## Test

```bash
pnpm --filter @odc/pulse build   # tests run against dist/, so build first
pnpm --filter @odc/pulse test
```

Database tests skip unless you give them a Postgres. Pulse's own runs on port
5433, so it never collides with a Postgres already on 5432:

```bash
docker compose -f apps/pulse/docker-compose.yml up -d --wait
export PULSE_DATABASE_URL=postgres://pulse:pulse@127.0.0.1:5433/pulse_test
export PULSE_REQUIRE_DATABASE=1   # fail instead of skip if the database is missing
```

Stop it with `docker compose -f apps/pulse/docker-compose.yml down`. CI runs
the same tests, with a database, on every PR.

## Serve it

```bash
just pulse-up      # opens on http://127.0.0.1:8080; `just pulse-down` stops it
```

This runs `src/main.ts` and two images: `web` serves the page and passes
`/api` to `api`, so the browser sees one website and the sign-in cookie works.
**It sends real email**, so use `dev` to click through the flow.

`src/main.ts` refuses to start without these four, and names every missing one
at once:

| Variable               | Why it has no default                                  |
| ---------------------- | ------------------------------------------------------ |
| `PULSE_SESSION_SECRET` | a generated one signs everyone out on every restart    |
| `PULSE_DATABASE_URL`   | memory would lose every vote on redeploy               |
| `PULSE_RESEND_API_KEY` | without it, sign-in links would be printed in the logs |
| `PULSE_WEB_ORIGIN`     | a guessed one would email everyone a link to localhost |

Also: `PULSE_MAIL_FROM` (required with the key, e.g.
`pulse <sign-in@your-domain.org>`), and optionally `PULSE_MAIL_REPLY_TO`,
`PULSE_PORT` (8080), `PULSE_HOST` (`0.0.0.0`) and `PULSE_DATABASE_SCHEMA`.
Bare `RESEND_API_KEY` and `DATABASE_URL` are never read.

Keep the API port private. The API trusts one forwarded IP hop, and only from a
private network address such as nginx's, so rate limits see the real client.

**Upgrading:** stop every old API instance before starting the new version.
Database migrations run on start, and some (003, 004) change how sign-in and
sign-out work, so an old instance left running would fail sign-ins or ignore
sign-outs.

## Public MCP reads

The API also serves `POST /api/mcp`, with `get_poll` and `get_results` only.
Run `pnpm dev` as above; connect a Streamable HTTP MCP client to
`http://127.0.0.1:8080/api/mcp` and ask for poll id `ads-free`. Closed polls stay
readable. No sign-in, own-answer, voting or listing tools are implemented yet.
The official SDK integration tests use throwaway loopback ports against the dev
API and test current and legacy protocol behavior.

See [API.md](./API.md#mcp-public-reads) for inputs, supported links, errors,
origin configuration and limits. The default link origin is the API's loopback
listener, not the Vite frontend; use poll ids for current `?poll=...` web links.
Configure `createServer({ ..., mcp: { publicOrigin } })` before advertising a
public deployment. Environment wiring and AI voting remain later slices.
