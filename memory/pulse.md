# Pulse — Build State

> Session-to-session truth for the `apps/pulse` + `apps/pulse-web` workstream.
> Read `memory/INDEX.md` first. Agent rules live in `apps/pulse/CLAUDE.md`;
> the served API is `apps/pulse/API.md`. Keep this short — history is in git.

## What pulse is

A community votes on something and sees the result. Someone claims an identity
with an emailed link, watches a short guided story, votes, and is told what
action follows. Membership in a community is proven by the **email's domain**.

Three MVP pillars, in build order: **magic-link identity** → **one-screen story
UI** → **path to action**.

## Charter exemption — do not "fix" this

**Pulse is exempt from `docs/charter.md`**, by a deliberate operator decision
recorded in `apps/pulse/CLAUDE.md`. No keypairs, no signatures, no linkage-map
privacy model, no hash chain, no independent verifier. Votes are a plain,
**mutable** record. A session that flags this as a charter violation is wrong;
a session that quietly imports charter machinery into `apps/**` is worse.

Two boundaries survive the exemption and are absolute:

- **No reads or writes across into `services/` or `contracts/`.** Pulse owns its
  own storage and stands alone. If it ever publishes to the ODC ledger it does so
  through the ledger's public HTTP API — a future option, not a dependency.
- **The counting is never the subject.** No UI copy about hashes, chains,
  verification, or how a tally is computed.

Repo-level working discipline still applies: tests ship with the change
(`odc-testing`), one small branch per change (`pulse/<n>-<short-description>`),
and the same repo-wide CI as everything else.

## Built (PRs #79–#97 on master; detail in the squash commits)

**`apps/pulse` — the server.**

- Voting core (#79): polls, ballots, results as counts (`src/voting/`).
- Membership by email domain **as data, not code** (#80) — allowed domains are
  rows in a table; adding a community is an insert, not a deploy
  (`src/identity/allowlist.ts`).
- Magic-link claim (#81), sessions that expire and sign out for real (#85),
  sign-in routes with **a link that survives being scanned** (#86) —
  `GET /api/sign-in/redeem` reports without consuming, because mail scanners
  follow every URL and a spent link would strand the person. `whoami` + real
  sign-out (#87); testable session guards (#91).
- The voting contract the client speaks (#94): a ballot is an **array of choice
  indices** for both `single` and `approval`; a vote is **changeable until
  close** (`changed` is a normal outcome, not an error); an **empty ballot is
  refused**, never read as a retraction.
- `API.md` written down, including where it disagrees with the client (#92) —
  **that disagreement is now closed** (see below), and the table is gone.
- **Sign-in contract closed and wired end to end** (#116, `8efdff7`).
  The client moved to the server's `/api/sign-in*` shape; `proofEmailsOptIn`
  is the wire name on both sides; `Me.id` matches the server's field; the
  `devLink` variant no implementation could produce is gone. `src/dev-server.ts`
  is the first thing in pulse that actually **listens** (port 8080, matching
  the vite proxy) — before it, `createServer` was only ever reached through
  in-process injection. `apps/pulse-web/test/end-to-end.test.ts` boots the real
  server on a real socket and drives the real HTTP client through request-link
  → redeem → vote → change vote → sign out. **That test is what keeps the two
  halves from drifting again** — the next divergence fails a test instead of
  growing a row in a table.

**`apps/pulse-web` — the client.** Package, API contract and the story flow
rules (#84, review fixes #90), HTTP client and a demo API (#88; the demo was
deleted in #118). It was **deliberately ahead of the server** in two places the
product had decided — `method` on a poll, and vote-changing — and the server
caught up in #94, with the sign-in half closed in #116. Client and server now
speak one contract, held there by `test/end-to-end.test.ts` rather than by
prose. `Ballot = number[]` exists so `ranked` can be added later without
changing any shape.

- **The demo client is gone** (#118). `HttpPulseApi` is the only implementation
  of `PulseApi` now; the interface survives only because private fields make it
  nominally typed, so a screen typed to it can be stubbed with a plain object.
  See the open question under "Not built" — if screen tests use the real class
  with a fake `fetch` instead, the interface has no user and should go.

**Mockups.** `docs/mockups/pulse-screens/` (seven per-screen files, #97 —
screen 1 redesigned as a swipe ballot), plus `pulse-story-mobile-v1.html` and
`pulse-vote-states-v1.html` (#82, restored in #89 after #84 deleted them).
Style is translucent "Civic Glass"; **`hub-feed-v*.html` is NOT the reference.**

**CI.** Pulse is **exempt from the diff-size hard ceiling** (#119). The ceiling
was first raised 600 → 1000 for pulse in #93, and pulse hit the new number
anyway — the case that settled it was a branch that went _over_ by deleting an
unused module, so the guard was demanding a split in order to make the codebase
smaller. The WARN at 400 still fires and is the honest signal.
`.github/scripts/diff-size.sh` is the source of truth, and the exemption is
dir-scoped: `services/**` and `contracts/**` are still fully counted.

## Not built

- **The story UI itself — now the single blocking gap for a usable product.**
  `apps/pulse-web/src` holds only `api/` and `flow/story.ts`: no `index.html`,
  no entry point, no component for any of the six steps `steps()` enumerates.
  `vite.config.ts` proxies `/api` to a page that does not exist. The mockups in
  `docs/mockups/pulse-screens/` are the design, not the app. Two questions are
  owed to that ticket: whether the non-consuming `GET /api/sign-in/redeem` check
  belongs on `PulseApi` (served today with no client method, because only a
  redeem screen would call it), and whether `PulseApi` itself survives — since
  #118 deleted the demo client, `HttpPulseApi` is its only implementation, and it
  is kept only because private fields make it nominally typed, so a screen typed
  to the interface can be stubbed with a plain object. If the screen tests end up
  using the real class with a fake `fetch` instead, the interface has no user.
- **Pillar 3, the path to action** in any form: soliciting ideas, volunteer time
  or donations, and the proof-of-what-happened email. `proofEmailsOptIn` is
  collected at sign-in and currently leads nowhere.
- **Real mail delivery and real persistence.** `src/identity/mailer.ts` and the
  stores are what the tests run against; nothing is durable.

### Asked for by the operator, 2026-08-25 — not started

These came out of demoing the run. None is designed yet; none has a ticket,
because pulse has nowhere to put one (see open decision 4).

- **Back on the vote-submitted screen.** The Back control added in #132 sits in
  `BallotChrome`, so it is on a question while it is being asked. Once a vote
  settles, the outcome replaces the answering region and there is no way back
  from that screen — only the way on. The trail in `App` already supports the
  step; what is missing is the control in the settled state.
- **A way to see the result.** Some "view results" affordance from a question,
  showing the counts as a graph or other visualisation. `GET /polls/:id/results`
  already returns them and `HttpPulseApi.results` already fetches them; nothing
  in the client renders them. Note the standing constraint before designing it:
  **the counting is never the subject** — a result may show what people chose,
  never how a tally is computed or verified.
- **A subject browser.** A way to look through the subjects/questions available
  rather than only walking the run you were given. Undesigned and unscoped —
  it is not yet decided whether this is a list, a feed, or a search, nor how it
  relates to the graph a run walks.

## Open decisions

**Settled 2026-08-22 by the operator — do not re-litigate.**

1. ~~Sign-in paths disagree.~~ **The server's shape won.** The client moved to
   `/api/sign-in` and `/api/sign-in/redeem`. Rationale: the server's routes,
   tests and `API.md` were already written that way, and "sign in" is the plain
   word a person would use, where "claims" is jargon.
2. ~~Unknown domain: 403 or silence?~~ **The 403 naming the domain stays**, and
   the client renders that message. The trade was made knowingly: pulse is
   charter-exempt and is not defending against membership enumeration, and
   someone who signs in with a personal address is far better served by being
   told which address would work. The client translates that one 403 into an
   _answer_ (`{status:"not_eligible"}`), not a failure — every other 403 still
   throws.

**Still open.**

3. **Where pulse's data actually lives.** Storage is in-memory and
   storage-agnostic by design; no database has been chosen. Everything a
   `pnpm dev` session does dies with the process — voters, sessions, votes.
4. **Where a feature request goes** (raised 2026-08-25 by the operator, who
   asked that this be solidified). `memory/INDEX.md` has a destination for a
   landed ticket, a decision, an unsettled question and a trap — and none for
   "a thing we want to build that nobody has started". The ODC core has
   `docs/plans/phase-0.md`; pulse has no equivalent, so the three requests
   above are recorded in this file for lack of anywhere better, which does not
   scale. The options are a `docs/plans/pulse.md`, GitHub issues, or a
   `memory/BACKLOG.md`; each has a different answer to "who prunes it". Decide
   before the list grows past what one section can hold.
5. ~~Does signing out release the ballot identity?~~ **SETTLED 2026-08-26 —
   yes, it is cleared** (`ae11dc8`, in #128). Raised by the #128 review: the
   30-day `pulse_ballot` cookie survived sign-out, so on a shared browser the
   next person was handed the previous person's ballot to read and to
   overwrite — and an end-to-end assertion was holding the hole open by
   asserting it as intended. `POST /api/sign-out` now clears it, and `API.md`
   says so. **The accepted cost, do not rediscover it as a bug:** signing in
   again mints a new ballot identity, so one person who votes, signs out, signs
   back in and votes again is counted **twice**. Pulse is counted-not-verified
   and already deduplicates only per browser; being double-counted is a smaller
   harm than being read. Tying a ballot to a voter on sign-in would fix the
   double count and is a larger design change nobody has scoped.
6. **One press is one vote, against `odc-ui`'s explicit rule.** (Raised
   2026-08-26 by the #130 review.) `odc-ui` says, absolutely: "Always confirm a
   destructive or binding action… Picking and casting are separate presses" and
   "never let a double-tap cast twice". Pulse deliberately does neither — a run
   is meant to move at the speed of an opinion, and what makes it safe is that
   an answer can be changed until the question closes. That reasoning currently
   lives only in a PR body, which stops being readable after the squash. It
   needs an ADR or a line here; a rule this load-bearing should not be
   overridden by prose in a commit. Note the review's observation that the
   second half of the rule was doing real work: the same PR shipped a genuine
   double-cast on tap.

### Two bugs the 2026-08-26 review round found, now fixed — do not reintroduce

- **A browser tap is three events**, `pointerdown → pointerup → click`, and a
  real tap cast the ballot **twice** because the pointer handlers and the
  half's own `onClick` both answered it. The second cast returns `changed`, so
  a first-time voter was told their answer replaced an earlier one. Fixed in
  `d2d2994`: the halves are real buttons and own the tap; the pointer handlers
  answer only the gesture and hand off through a consume-once flag. **When
  testing a press, fire the whole sequence** — every test in the suite fired
  either a click or pointer events, never both, which is precisely why this
  shipped.
- **`hidden={settled}` hid nothing.** `[hidden] { display: none }` is a
  user-agent rule; `.ballot__content { display: flex }` is an author rule and
  beats it. The answered ballot stayed drawn, focusable and pressable under the
  outcome. jsdom cannot see this — it applies its own UA sheet but not the
  imported stylesheet — so no test could have caught it either way.

## Live cautions

- **`pnpm dev` generates an ephemeral session secret** and announces it; every
  restart invalidates every cookie. That is deliberate, not a bug to fix.
- **`pulse/4b-sign-in-routes` is an unlanded remote branch with no open PR**
  (head `861b983`). Nobody has said whether it is abandoned or owed. Check
  before starting sign-in work — do not assume either way.
- **Two agents in one worktree will eat each other's work.** On 2026-08-25 a
  spawned task and the session that spawned it both edited
  `/Users/williamchu/Desktop/odc-pulse-ui`. The task committed to its own branch
  and then discarded the shared working tree, taking an uncommitted edit from
  the other session with it. Spawn with `isolation: "worktree"`, per
  `.claude/skills/odc-orchestration`, and commit before you hand any part of a
  tree to somebody else.
- **A pulse branch is not automatically based on current master.** The story-UI
  stack was cut from a master that predated #126, so its diff showed
  `.claude/skills/odc-design/SKILL.md` as _deleted_. Run
  `git diff --name-status origin/master..HEAD` before every push and look for
  files you never touched; rebase rather than explaining it in the PR body.
- Pulse's own docs and this file are the only record of the workstream. The ODC
  core plan (`docs/implementation-plan.md`) does not cover pulse and will not
  tell you it exists.
