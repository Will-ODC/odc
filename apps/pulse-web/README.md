# Pulse web

The web page people use to sign in, post questions and vote in Pulse.

See the [web contributor guide](./CLAUDE.md) before changing this package and
the [shared Pulse guide](../pulse/CLAUDE.md) for product boundaries and rules.
The [mockup index](../../docs/mockups/CANDIDATE_CONTEXT.md) is the canonical
screen-design reference.

## Run it

```sh
pnpm --filter @odc/pulse-web dev    # local dev; sends /api to the Pulse server on port 8080
pnpm --filter @odc/pulse-web test
```

Browser unit and component tests live in `test/`. The real-HTTP suites
that exercise the server and browser together live in the dedicated
[`@odc/pulse-integration` workspace](../../docs/decisions/0041-pulse-integration-test-workspace.md):
run them with `pnpm --filter @odc/pulse-integration test`. The matching checks
are `pnpm --filter @odc/pulse-integration typecheck` and
`pnpm --filter @odc/pulse-integration lint`. Root Turbo test commands include
the integration suites; the browser app's build remains independent.

In production, nginx serves the page on port 8080 and sends `/api` to the `api`
container, so the page and the API share one address.

## Pages

| Path               | What it shows                                                          |
| ------------------ | ---------------------------------------------------------------------- |
| `/`                | Welcome page, then Start voting.                                       |
| `/start`           | What has been done so far, and what ODC is for.                        |
| `/questions`       | The four starting questions.                                           |
| `/?poll=ID`        | The live vote page for one poll. Old `/conversation` links still work. |
| `/new`             | Post a question after signing in, then open its vote page.             |
| `/trust`           | "How votes count": a short guide to counting and its limits.           |
| `/sign-in?token=…` | Where emailed sign-in links land.                                      |
| `/preview/chat`    | A prototype with sample data only.                                     |

The vote page, sign-in and question creation call the API. On the vote page,
**Show me how** walks through the real controls; it never picks or submits an
answer.

Question creation keeps a draft in this browser for up to an hour after a
sign-in-required posting failure. Only the explicit sign-in recovery path
restores it once; an ordinary visit to `/new` or signing out clears it. The
first-post purpose promise is never saved with the draft.

The client uses the served routes in [`../pulse/API.md`](../pulse/API.md).
Roadmap and planned API sections describe future work, not current client
behavior.

## Settings

The four starting questions need published poll IDs at build time. Pass them as
Docker build arguments:

- `VITE_PULSE_FIRST_POLL_ID`
- `VITE_PULSE_DATA_POLL_ID`
- `VITE_PULSE_FUNDING_POLL_ID`
- `VITE_PULSE_REVOTE_POLL_ID`

A missing ID shows that question as Coming soon. These IDs are public, not
secrets. Changing one needs a rebuild.

## Keep these rules

- **Sign-in tokens must not leak.** Sign-in links carry a secret token in the
  address. The page sets `no-referrer` before it loads anything else, and nginx
  does not log query strings or `Referer` values. Keep both if you change the
  page head or the nginx log format.
- **`/trust` must stay true.** It must not say pulse votes are on a hash chain
  or ledger until they are. Update its plan steps as that work moves.
- **`/start` is written by hand.** It is not a live feed and does not mean the
  work is deployed.
