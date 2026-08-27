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

## Built (PRs #79–#135 on master; detail in the squash commits)

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

### The story UI — LANDED 2026-08-26 (PRs #128-#131, #135, #127)

Pillar 2 is on master. A person can open the app, be asked a question, answer it
by swipe/tap/arrow key, see the outcome, walk on to the next question the answer
opens, add an answer of their own, and step back through the run.

| Squash    | PR   | What                                                             |
| --------- | ---- | ---------------------------------------------------------------- |
| `e587a5b` | #128 | server: a vote counts before anyone signs in; polls form a graph |
| `e4dac87` | #129 | the runnable shell, and screen 1 as a swipe ballot               |
| `d17cfe0` | #130 | walking a run of questions, and suggestions                      |
| `111b8f5` | #131 | the outcome replaces the ballot instead of covering it           |
| `202a2f4` | #135 | a way back through the run                                       |
| `08bff67` | #127 | a suggestion matching a choice answers `on_ballot`               |

**#135 is the PR #132 should have been.** #132 was auto-closed by GitHub when its
base branch was deleted on merging #131, and could not be reopened because the
head had been force-pushed after closing. Same commits, same content. **#132 still
holds the review discussion** — go there for it, not to #135.

**Two questions that section owed are now answered by the code:**

- **`PulseApi` survives, and is structural, not nominal.** The earlier note that
  private fields made it nominally typed is **stale** — there are no private
  fields in `types.ts`. Every screen and hook takes `api: PulseApi` as a prop and
  `test/stub-api.tsx` stubs it with a plain object, so the interface has real
  users and `HttpPulseApi` being the only class implementing it is fine.
- The non-consuming `GET /api/sign-in/redeem` check is **still not on `PulseApi`**.
  No redeem screen exists yet, so nothing has needed it.

## Not built

- **Screens 2-7 of the story.** Only the ballot exists. There is no CLAIM or SENT
  screen, no bite/case screens, no results screen and no action screen — so the
  magic-link identity built in pillar 1 has **no UI at all**: nothing in the
  client signs anyone in. `flow/story.ts` still enumerates six steps the app does
  not render. The mockups in `docs/mockups/pulse-screens/` are the design.
- **Pillar 3, the path to action** in any form: soliciting ideas, volunteer time
  or donations, and the proof-of-what-happened email. `proofEmailsOptIn` is
  collected at sign-in and currently leads nowhere.
- **Real mail delivery and real persistence.** `src/identity/mailer.ts` and the
  stores are what the tests run against; nothing is durable.

### Asked for by the operator, 2026-08-25

These came out of demoing the run. The first is now satisfied; the rest are
undesigned and have no ticket, because pulse has nowhere to put one (see open
decision 4).

- ~~**Back on the vote-submitted screen.**~~ **SATISFIED 2026-08-26 — verify
  before re-doing it.** #131 made the outcome replace the ballot _inside_ the
  chrome rather than covering the screen, so `BallotChrome` — and its Back —
  now renders on both sides of the `settled` branch in `SwipeBallot.tsx`. The
  control is there. **But no test asserts it**, so it can regress silently the
  next time that render is reorganised; a test that settles a vote and looks for
  Back is a one-line job and is the real remaining work here.
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

- **Infrastructure, and a Docker dev environment that resembles production.**
  Asked for on 2026-08-25 after establishing that everything durable in pulse is
  a `Map`. The ask is not only "swap the stores": it is that a developer should
  be able to bring up the same shape of thing that will run in production, with
  one command, repeatably.

  **We do not have this, and the appearance that we do is the trap.** `justfile`
  defines `up: docker compose up --build -d`, and `docs/implementation-plan.md`
  and ADR-0001 both lock "root justfile over root docker-compose" as the dev
  entry point — so every document says the story is settled. But
  `docker-compose.yml` is literally `services: {}` with a comment saying
  "Populated as services land in Phase 1+", and **there is no Dockerfile
  anywhere in the repository, on any branch, in the entire history.** `just up`
  today starts nothing and exits 0. Do not cite the justfile or the ADR as
  evidence that infra exists; check for a Dockerfile.

  Pulse is also not covered by the convention even on paper. The root compose
  comment and `.claude/skills/odc-service-boundaries` describe per-service
  `docker-compose.yml` files, each with its **own** postgres container (core
  rule 1: no shared databases). Both were written for `services/`. Nothing says
  whether `apps/pulse` gets the same treatment, and the charter exemption does
  not answer it — the one-DB-per-service rule is an architecture convention, not
  a legitimacy rule, so exemption is not automatically a reason to skip it. That
  is the first thing to decide, before any YAML gets written.

  What a production-resembling environment has to cover, from reading the code
  rather than guessing — the dev-server's own comment ("the database-backed
  stores replace the three in-memory ones here and nothing else changes") is
  **wrong**, and is four swaps short:
  1. Four stores, not three: `InMemoryVotingStore`, `InMemoryVoterStore`,
     `InMemoryClaimStore`, `InMemorySuggestionStore`. All are behind interfaces
     already, so this part is genuinely the easy half. Note the vote schema is
     constrained: one row per `(pollId, voterId)`, and re-casting **replaces**,
     so it is an upsert on a unique key — the thing `services/ledger` forbids
     and pulse is exempt from.
  2. `ConsoleMailer` → a real `Mailer`. The interface exists; no provider
     implementation does anywhere. Without it nobody outside a terminal can
     sign in, so a staging environment is unusable without solving it.
  3. `StaticDomainSource` → a DB-backed `AllowedDomainSource`. `CLAUDE.md`
     promises allowlists are rows and adding a domain is an insert; today it is
     a literal in `dev-server.ts`, so it is a deploy.
  4. `PULSE_SESSION_SECRET` as a managed secret, and `secureCookies: true`.
  5. **A production entry point that is not `dev-server.ts`.** That file refuses
     to start outside development, guarded twice (`assertDevelopment`), on
     purpose — so this is a sibling `main`, never an edit to it. Anything that
     "makes dev-server production-capable" is undoing a deliberate safety
     property.
  6. **Poll creation, which has no home at all.** There is no `POST /api/polls`
     in `src/http/server.ts`; polls and their `next` graph are the `SEED`
     literal in `dev-server.ts`. A deployed pulse has nothing to vote on until
     authoring exists — an admin route, a seed job, or a migration. This is the
     gap most likely to be discovered late, because in dev it is invisible.
  7. Origin: dev relies on Vite's `/api` → `:8080` proxy so the session cookie
     is same-origin with no CORS or `SameSite` special-casing. Serving
     `pulse-web`'s `vite build` output from the same origin in production keeps
     that assumption true; splitting the origins means revisiting cookie code
     that was written assuming it never had to be.
  8. `@fastify/rate-limit` defaults to an in-memory store — correct for one
     process, useless across several. Multi-instance needs a shared store.

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
   6a. **A suggestion that matches a poll's own choice answers `on_ballot`**
   (#127). Nothing is added; the choice is named back with the index to cast
   for it. The reason is the distinction suggestions exist for — a choice is
   **votable** and a suggestion is not — and `Poll.choices` can never grow to
   absorb one, because a vote records a choice's _position_. Ties go to the
   ballot. Written into `API.md` in `82c5685`; it had shipped without being in
   the contract at all.
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
- **The way on must follow the poll graph, not the preview of it.** The NEXT
  button was drawn only when the next question's _preview_ had loaded, so one
  failed fetch left someone counted with a run still ahead of them and nothing
  to press. `poll.next[choice]` already says whether an answer opens another
  question and needs no network to say it; the preview is a label, nothing
  more. Fixed in `e7d9c68`. The general rule the codebase keeps half-learning:
  a preview that will not load is no reason to refuse someone the vote in front
  of them — and no reason to strand them after it either.
- **An arrow key pressed on the Back button cast a vote.** The swipe ballot
  answers arrow keys with a handler on the whole `<section>`, and Back was
  added inside it, so the keydown bubbled. The control is drawn as a left
  chevron, which makes the left arrow the most guessable key on the screen.
  Fixed in `8ae4714`. **The general shape, which will recur:** adding any
  focusable control that is not part of answering, inside a section that reads
  keys as answers, breaks the section's assumption. The first version of the
  test for it passed without the fix, because the run it walked landed on a
  _list_ screen and only the swipe ballot reads arrow keys — when testing a
  key, check you are on the screen that listens.
- **`hidden={settled}` hid nothing.** `[hidden] { display: none }` is a
  user-agent rule; `.ballot__content { display: flex }` is an author rule and
  beats it. The answered ballot stayed drawn, focusable and pressable under the
  outcome. jsdom cannot see this — it applies its own UA sheet but not the
  imported stylesheet — so no test could have caught it either way.

## Live cautions

- **Never `--delete-branch` a stacked PR while a child PR still targets it.**
  On 2026-08-26 merging #131 with `gh pr merge --squash --delete-branch` deleted
  `pulse/8-outcome-readability`, and GitHub **auto-closed #132**, which was based
  on it, instead of retargeting. It could not be reopened: the head branch had
  been force-pushed during an earlier rebase, and GitHub refuses
  (`state cannot be changed. The <branch> branch was force-pushed or recreated`).
  Restoring the deleted base branch does not unblock the reopen. The work had to
  be re-raised as #135. **Merge a stacked PR without `--delete-branch`, let the
  child retarget to master, then delete the branch by hand.**
- **A squash merge makes the branch above it conflict, every time.** The child
  still carries the parent's original commits while master has one squashed
  commit of them, so git sees the same changes twice. It is not a real conflict
  and must not be merged away — rebase the child, replaying only its own work:
  `git rebase --onto origin/master <old-parent-sha> <child-branch>`. Grab the
  old parent SHA **before** merging; `--delete-branch` takes the local branch
  too and with it the easy way to name it. This happened at every single step of
  the #128-#135 stack.
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
