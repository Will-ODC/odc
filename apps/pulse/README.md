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

Early, and backend-only so far. Built: the voting core (polls, one vote per
voter, results as counts), membership by email domain, the magic-link claim,
and the HTTP API below. Not built: the story UI, real storage (everything is
in memory), a real email provider, and the path to action.

## API

| Route                            | What it does                                            |
| -------------------------------- | ------------------------------------------------------- |
| `POST /api/sign-in`              | `{ email, wantsProofEmails? }` → emails a sign-in link  |
| `GET /api/sign-in/redeem?token=` | Redeems the link and sets the session cookie            |
| `POST /api/sign-out`             | Clears the session cookie on this device                |
| `GET /api/me`                    | The signed-in voter, or 401                             |
| `GET /api/polls/:id`             | The poll, plus your own choice if you have voted        |
| `GET /api/polls/:id/results`     | Counts and shares per choice                            |
| `POST /api/polls/:id/vote`       | `{ choice }` → counts your vote and returns the results |

Errors are `{ error, message }`, where `message` is a plain sentence safe to
show a person as-is.

Sending email is a `Mailer`; development uses `ConsoleMailer`, which prints the
link instead of sending it, so the whole flow works with no provider account.

## Development

```bash
pnpm --filter @odc/pulse build
pnpm --filter @odc/pulse test
```

Lint, typecheck, and tests also run on every PR through the repo-wide CI in
`.github/workflows/repo.yml`, the same checks the rest of the monorepo uses.
