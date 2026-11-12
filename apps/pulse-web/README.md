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
| `/profile`             | Create, update, hide or share the signed-in member's public profile.    |
| `/u/<publicId>`        | A public member profile, or unavailable if it is absent or hidden.      |
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
with its voting popout expanded at the bottom right, on phone and desktop.
The popout stays aligned to a prominent, accent-filled floating button and fits within the
viewport; it does not reserve a full-width row. The closing-time note stays on
the main page when the popout opens or closes. Button and popout share the same
bottom-right reveal and are inset from the screen edges; reduced-motion settings
disable the animation. Choose an answer,
then press Submit to save it. Results appear in the upper main content directly
below your saved answer, which has a softly tinted accent and spacing beneath
the question, with confirmation, Change my answer and Next when available. The
bottom drawer is reserved for voting; after submitting, its Change my answer
handle opens the choices again without casting. Closing the drawer during a
change keeps the saved answer and its results. Closing an unsent ballot keeps
its selection and leaves the Vote handle available; on a closed question the
handle reads Show question. The drawer uses a downward chevron to close, with
the accessible button name Close. The page and popout scroll independently. Closed to its
one button, the drawer takes its own row under the page instead of floating over it, so it
never covers Next or the page's last content. Closed-question results also open in the main content. The small
circular info link beside Change my answer opens How votes count in a new tab.
Results omit the repeated answer summary, extra privacy reminder and nested
card framing. The live page has no tutorial button.

That popout is the phone's (under 700px). On desktop (#490, ADR-0044) there is
no popout: the choices sit in the page directly under the question, without
repeating it, and Copy link sits at the end of the closing-date line. After a
vote they fold into the "You picked" line, whose Change my answer reopens them
in place with a visible Close; the saved answer's results stay below while you
choose.

At both widths, moving on is a small text button, "Next question ›", at the
right end of the results card's footer beside the info link (#554). On a touch
screen, a left swipe of about 60px over an answered question does the same;
vertical scrolling, short or diagonal drags and mouse drags do nothing. Each
question's page slides in briefly from the right, with no animation under
reduced-motion settings.

Every product page uses the same browse-style top banner at desktop and phone
widths: the Pulse home link, Home, About, a Your communities dropdown listing
the account’s currently known community when available, Post and one account
control. Starting questions remain available in the guided introduction and are
seeded into General in local development. Multiple memberships remain
follow-up #440. The communities dropdown uses a bordered trigger with a chevron
and highlighted menu links. The current destination is marked without removing
its link. Account state also appears on About,
introduction, trust and sign-in pages; these headers read the session and the
same server-backed My votes state as the question rail. A browser with saved
votes gets Account and Forget my votes here on every page; forgetting clears
that state and returns to Sign in. During the first saved-vote read, the account
area stays neutral until the result is known. A failed read offers Account with
Try again and the safe Forget action; Account stays available during its retry.
Retry moves focus to Account, then to Sign in if no saved votes remain. On My
votes, the header error uses a polite status instead of an alert. Static page
content does not load poll data.
Sign-in pages omit a redundant
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

## Saved answers (#484)

My votes (`/my-votes`) lists answers saved in this browser, newest first. The
vote page's My votes rail uses the same saved answers and updates after a
successful cast or change; reopening an older answer keeps its position.
Opening a rail question updates its URL, and Back returns to the previous
question. Reloading restores the saved answer from the server; if that read
takes more than 5 seconds, the question is asked unanswered rather than taking
the rail's row as the answer. Leaving a question while its answer is being sent
keeps its rail row in place until the send settles, then shows the outcome:
a counted answer moves to the top; after a lost connection the page reads the
saved answer from the server again. Coming back before the send settles shows
Loading… for up to 5 seconds, then the question with "Your answer is still
being sent." and no way to answer it again, until the send settles and the
question is drawn with its outcome. Only a 4xx refusal counts as storing
nothing; a lost connection, a reply cut off part way or a 5xx may have stored
the answer, so Close after one asks the server which answer it holds, on a
phone and on desktop (#527). While it asks, Close stays in place but does
nothing, the card says "Checking your answer…", and Try again waits. The
answer the server holds is then shown; if the server cannot be reached
either, or does not answer within 5 seconds, the card stays open, says the
connection is still down, and focus returns to Close.
Home and community browsing reuse the same rail beside Explore at 700px and
wider. The question page keeps it beside voting and results at those widths,
including after Submit. Below 700px, saved answers remain behind My votes;
the rail is hidden and its links are outside the keyboard order. Both rails
reuse `AnsweredRail` and the screen’s existing `useMyVotes` read, including
loading, empty, retry and See all my votes states.
The rail keeps one status line for screen readers, which reads out Loading…,
an error, or "Your votes are loaded." after Try again. Signing out or
forgetting votes here clears the browser's saved-answer list.
When the open question was already a saved answer when it was opened (its row
has been read from My votes (the rail's first page, or a later page read for
the pager), its saved ballot was read back, or it was answered
on this page and then opened again), Previous and Next follow the newest-first
My votes list (#528), with disabled controls at its ends, on open and closed
questions. Their accessible names include the question they open, and a left
swipe on a phone opens the same Next from the results or a closed question,
never while the choices are open for a change. When that row, or the row below
the last one read, is on a later page, the question page reads further pages
for the pager alone: the rail still draws its first page and See all my votes.
Until the neighbours are known no Next is offered; if a page cannot be read the
question falls back to the answer-selected Next, and opening another question
tries that page once more. A row added to the rail without its server row is
never offered as another row's neighbour. A question answered for the
first time keeps its answer-selected Next, and an unanswered one reads no more
pages. Changing a saved answer moves it to the top before its neighbours are
chosen.

## Browse questions (#260)

Home (`/`) opens the public poll browser. About (`/about`) keeps the former
welcome content and Start voting → /start → /questions, plus Explore questions →
Home. The shared navigation uses Home and About; General has no separate nav
link. Browsing is public, newest first and scoped by community, not a global or
related-question feed. Shared `/browse?community=ID` links open that community.
Signed-in visitors can also switch to their community. Open and closed
questions link to the existing vote page; opening a question never casts a
vote. Load more uses the API cursor and keeps existing questions on a failed
request. The wide list shares the Home, About, posting and community
navigation; email-confirmed membership supplies the Your communities menu.
Thumbnails/context previews remain future work. Missing communities show an
empty state with links to the starting questions and posting form.

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

## Production security

Inter weights 400, 500, 600, 700 and 800 are bundled from `@fontsource/inter`;
fonts load from the app's own origin. nginx's `security-headers.conf` supplies
the policy for pages, assets, API responses and errors. Keep its include in
every location: local `add_header` directives otherwise suppress inherited
headers. CSP permits same-origin scripts and fonts and the inline styles used
by results and charts. The nginx policy and font imports are checked by
`test/security-headers.test.ts`. See [the deployment runbook](../pulse/DEPLOY.md)
for HTTPS and HSTS at the TLS terminator.

## Keep these rules

- **Sign-in tokens must not leak.** Sign-in links carry a secret token in the
  address. The page sets `no-referrer` before it loads anything else, and nginx
  does not log query strings or `Referer` values. Keep both if you change the
  page head or the nginx log format.
- **`/trust` must stay true.** It must not say pulse votes are on a hash chain
  or ledger until they are. Update its plan steps as that work moves.
- **`/start` is written by hand.** It is not a live feed and does not mean the
  work is deployed.

## Desktop sidebars

Home, poll details and contribution details share My votes on the left from
700px. From 1100px, Suggested votes appears on the right. It lists up to five
unanswered General questions from the newest open candidates. It skips the
question on screen and any question already voted on in this browser. The sidebar opens a question without casting a vote. See #529
for suggested votes and #331 for desktop layout.

## Contributions

Home lists questions and the four newest contributions together, newest first.
Each contribution has a tag naming its type. The Contributions only filter
on Home lists projects, fundraisers, group buys and offers. Old directory
links open the filtered view. After sign-in, `/contributions/new`
asks for a type, title, description and public organizer name before
confirming publication. Detail pages show the description, participation and
organizer updates, along with any extra details already on the record.

Choose Message the organizer on a detail page to send a private message.
The organizer reads messages there and can publish progress updates.
Completion is labeled as reported.
Sign-in links return to the contribution page or creation form. Failed submissions
keep entered fields and reuse their request key for an unchanged retry.

A contribution organizer name links to the owning member profile only while
that profile is visible. Public profiles list that account's contributions,
newest first. On their own visible profile, the owner can start a contribution
and use an owner-only list to open each contribution's progress-update form or
private organizer inbox. Matching display names do not grant those controls.
