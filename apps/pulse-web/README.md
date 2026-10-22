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

| Path                   | What it shows                                                           |
| ---------------------- | ----------------------------------------------------------------------- |
| `/`                    | Welcome page, then Start voting.                                        |
| `/start`               | What has been done so far, and what ODC is for.                         |
| `/browse?community=ID` | Community questions, newest first; General by default.                  |
| `/questions`           | The four starting questions.                                            |
| `/?poll=ID`            | The live vote page for one poll. Old `/conversation` links still work.  |
| `/new`                 | Post a question after signing in, then open its vote page.              |
| `/trust`               | "How votes count": a short guide to counting and its limits.            |
| `/sign-in?token=…`     | Where emailed sign-in links land; goes straight back to where you were. |
| `/preview/chat`        | A prototype with sample data only.                                      |

For local testing, run both apps with their `dev` commands and open
`http://localhost:5173/sign-in?next=new`. Enter any test email; on Check your email,
choose **Open local mailbox**, then click its actual sign-in link. The same
sign-in and redemption flow runs locally and in production; local mail is
captured instead of delivered. Startup and reset scenarios are documented in
[the API README](../pulse/README.md#run-it-on-your-computer).

The vote page, sign-in and question creation call the API. Each question opens
with its vote card expanded. Choose an answer, then press Submit to save it.
You can close the card and reopen it with Vote. **Show me how** walks through
the real controls; it never picks or submits an answer. Its highlight leaves
space around the controls and stays inside the screen, so the space is smaller
on a side where a control touches the screen edge.

The vote page and `/new` share one bar across the top: the mark, "Post a
question" (just "Post" on a narrow phone; left out on `/new`, where the mark
links home) and one account control. That control is "Sign in", or an
**Account** button that shows who is signed in and "Sign out", or "Sign in" and
"Forget my votes here". After a vote, one "How votes count" link sits under the
counts. Right after posting, the new question shows "Your question is live ·
Copy link" once.

Question creation keeps a draft in this browser for up to an hour after a
sign-in-required posting failure. Only the explicit sign-in recovery path
restores it once; an ordinary visit to `/new` or signing out clears it. The
first-post purpose promise is never saved with the draft.

The client uses the served routes in [`../pulse/API.md`](../pulse/API.md).
Roadmap and planned API sections describe future work, not current client
behavior.

## Browse questions (#260)

Welcome keeps Start voting → /start → /questions and adds Explore questions →
`/browse?community=pulse-general`. Browsing is public, newest first and scoped
by community, not a global or related-question feed. Shared
`/browse?community=ID` links open that community. Signed-in visitors can also
switch to their community. Open and closed questions link to the existing vote
page; opening a question never casts a vote. Load more uses the API cursor and
keeps existing questions on a failed request. The wide list has top navigation
for home, starting questions, posting and communities; email-confirmed membership
supplies the Your community link. Thumbnails/context previews remain future work. Missing communities show an empty
state with links to the starting questions and posting form.

## Settings

The four starting questions need published poll IDs at build time. Pass them as
Docker build arguments:

- `VITE_PULSE_FIRST_POLL_ID`
- `VITE_PULSE_DATA_POLL_ID`
- `VITE_PULSE_FUNDING_POLL_ID`
- `VITE_PULSE_REVOTE_POLL_ID`

A missing ID shows that question as Coming soon. These IDs are public, not
secrets. Changing one needs a rebuild.

## Publishing the starting questions

Locally, `vite` dev reads `.env.development`, which points the four variables
above at the dev server's seeded `launch-*` polls (Vite never loads it for
`vite build`, and the Docker context excludes it). On deploy day the owner
(`PULSE_OWNER_EMAIL`) signs in and posts each question through `/new` with the
text in `docs/plans/pulse-first-story-content-draft.md`, using the form's
"Change when it closes" to set a later close time (a year out, like the dev
seed; the default is 7 days), copies each new poll's
id from its URL, and sets the four `VITE_PULSE_*_POLL_ID` values for the web
build.

## Keep these rules

- **Sign-in tokens must not leak.** Sign-in links carry a secret token in the
  address. The page sets `no-referrer` before it loads anything else, and nginx
  does not log query strings or `Referer` values. Keep both if you change the
  page head or the nginx log format.
- **`/trust` must stay true.** It must not say pulse votes are on a hash chain
  or ledger until they are. Update its plan steps as that work moves.
- **`/start` is written by hand.** It is not a live feed and does not mean the
  work is deployed.
