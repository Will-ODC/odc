# pulse

A community votes on something and sees the result.

Someone claims an identity with an emailed link, watches a short guided story,
votes, and is told what action will follow. Membership in a community is proven
by the email's domain.

Pulse lives in the ODC monorepo but is a separate epic from the charter-governed
services in `services/`. It is intentionally exempt from the charter's
legitimacy machinery — see [CLAUDE.md](./CLAUDE.md) before changing anything
here.

## Status

Early. This package holds the voting core (polls, one vote per voter, results as
counts), the magic-link identity flow, and the HTTP surface in
[API.md](./API.md). The story UI screens and the path to action are not built
yet — `apps/pulse-web` has the API client and the story sequencing, no screens.

## Development

```bash
pnpm --filter @odc/pulse build
pnpm --filter @odc/pulse test
pnpm --filter @odc/pulse dev     # http://127.0.0.1:8080, where the client's dev proxy looks
```

`dev` keeps everything in memory and dies with the process. It seeds one
community, one allowed email domain, and one poll, and prints sign-in links to
the terminal instead of mailing them — paste one into the browser and the flow
is the real one. Every part is overridable by environment variable:

| Variable               | Default                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `PULSE_PORT`           | `8080`                                                                    |
| `PULSE_SESSION_SECRET` | generated per run (development only; required when `NODE_ENV=production`) |
| `PULSE_COMMUNITY`      | `demo-community`                                                          |
| `PULSE_DOMAIN`         | `example.test`                                                            |
| `PULSE_WEB_ORIGIN`     | `http://localhost:5173`                                                   |
| `PULSE_POLL_ID`        | `p1`                                                                      |
| `PULSE_POLL_QUESTION`  | `Where should the next one be?`                                           |
| `PULSE_POLL_CHOICES`   | `Park,Library,Rink`                                                       |
| `PULSE_POLL_METHOD`    | `single`                                                                  |

Lint, typecheck, and tests also run on every PR through the repo-wide CI in
`.github/workflows/repo.yml`, the same checks the rest of the monorepo uses.
