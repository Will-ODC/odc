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
| `/`                    | Home: public poll browser, newest first.                                |
| `/about`               | About: the former welcome content and Start voting.                     |
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
with its bottom voting drawer expanded, on phone and desktop. Choose an answer,
then press Submit to save it. Results appear in the upper main content directly
below your saved answer, which has a softly tinted accent and spacing beneath
the question, with confirmation, Change my answer and Next when
available. The bottom drawer is reserved for voting; after submitting, its
Change my answer handle opens the choices again without casting. Closing an
unsent ballot keeps its selection and leaves the Vote handle available. Upper content scrolls
independently of the drawer. Closed-question results also open in the main content. The small circular info link beside Change my answer
opens How votes count in a new tab. Results omit the repeated answer summary,
extra privacy reminder and nested card framing. The live page has no tutorial
button.

Every product page uses the same browse-style top banner at desktop and phone
widths: the Pulse home link, Home, About, a Your communities dropdown listing the account’s
currently known community when available, Post and one account control. Starting
questions remain available in the guided introduction and are seeded into General
in local development. Multiple memberships remain follow-up #440. The communities dropdown uses a bordered trigger with a chevron and highlighted
menu links. The current destination
is marked without removing its link. Account state also appears on About,
introduction, trust and sign-in pages; these headers read the session, while
static page content does not load poll data. Sign-in pages omit a redundant
Sign in link. Shared `TopBanner`, `SiteNavigation` and `AccountMenu` components
own the navigation layout and styles; colors and spacing use `styles/tokens.css`.
The form's Sign in link retains its return to `/new`. The first-post discussion
promise remains visible; its existing explanation opens from an information icon
in a native dialog with Close, Escape and focus return.

Question creation keeps a draft in this browser for up to an hour after a
sign-in-required posting failure. Only the explicit sign-in recovery path
restores it once; an ordinary visit to `/new` or signing out clears it. The
first-post purpose promise is never saved with the draft.

The client uses the served routes in [`../pulse/API.md`](../pulse/API.md).
Roadmap and planned API sections describe future work, not current client
behavior.

## Browse questions (#260)

Home (`/`) opens the public poll browser. About (`/about`) keeps the former
welcome content and Start voting → /start → /questions, plus Explore questions →
Home. The shared navigation uses Home and About; General has no separate nav
link. Browsing is public, newest first and scoped
by community, not a global or related-question feed. Shared
`/browse?community=ID` links open that community. Signed-in visitors can also
switch to their community. Open and closed questions link to the existing vote
page; opening a question never casts a vote. Load more uses the API cursor and
keeps existing questions on a failed request. The wide list shares the Home, About, posting and community navigation;
email-confirmed membership supplies the Your communities menu. Thumbnails/context previews remain future work. Missing communities show an empty
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
