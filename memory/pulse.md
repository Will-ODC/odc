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

### Landed 2026-09-02/03 — the run-up to storage

| Squash    | PR   | What                                                         |
| --------- | ---- | ------------------------------------------------------------ |
| `ea03e5d` | #142 | `.claude/launch.json` — one command brings the demo up       |
| `7282510` | #143 | a Postgres service in CI, and the harness the stores land on |
| `b2ca72b` | #144 | ADR-0020 (Postgres) and ADR-0021 (the vote model)            |

**#142:** `preview_start` reads `.claude/launch.json`, so `pulse-api` then
`pulse-web` brings both processes up. Paths are relative on purpose — the first
version pointed at a worktree by absolute path and was aiming at an orphaned
checkout within the hour.

**#143:** `postgres:17` as a service on `repo.yml`'s **existing `checks` job**,
not a new `pulse.yml`, because a new job is not a _required_ check until an
admin edits the `protect-master` ruleset — the trade `repo.yml` already records
for its fixtures-manifest and Go verifier steps. The accepted cost: **every PR
in the repo now starts a container.** Also adds `pg` (devDependencies — only
`test/` imports it until the stores land) and `apps/pulse/test/database.test.ts`.

**Environment variables are pulse-owned: `PULSE_DATABASE_URL` and
`PULSE_REQUIRE_DATABASE`, never `DATABASE_URL` or `CI`.** Both obvious names
were tried and both were wrong — see the cautions below.

**#144:** the two ADRs. **ADR-0021 is the one to read before touching the
schema:** every vote method is stored as `(choice, value)` pairs, `method` is
plain `text` so adding a vote type is **never a migration**, and
`poll_choice.id` is a stable identity with `position` demoted to display order.

| `af55032` | #140 | where a question stands, once someone has answered |

### Landed 2026-09-06 — the one-press bargain, kept

| Squash    | PR   | What                                                          |
| --------- | ---- | ------------------------------------------------------------- |
| `5deb395` | #146 | an answer that says it can be changed, and a way to change it |

Pulse casts on one press. That was decided long ago and lived only in the body
of a squashed PR; **it is now `docs/decisions/0022-one-press-casts-and-says-so.md`**,
and `odc-ui`'s confirmation rule points at it as its one scoped exception. Read
the ADR before touching the outcome — three things in it are load-bearing:

- **The sentence and the control are one thing.** "You can change your answer
  until this question closes" is what stands in for the confirming press pulse
  does not ask for, so "Change my answer" must exist wherever the sentence is
  shown. They ship gated on the identical condition. A review caught them
  shipped apart — the sentence went in first, promising something no control
  could do, because settling removes the ballot and Back (absent on a run's
  first question) goes to the _previous_ one.
- **Reversibility is what buys the exception, not speed.** Pillar 3's donations
  and volunteer commitments are not reversible and still confirm. Do not read
  the ADR as "pulse does not confirm things".
- **`changeable` is read from `poll.open`, never assumed.** The sentence is not
  printed while the cast is in flight, on a poll that closed before the vote
  landed, or on a poll the client already knows is shut.

NEXT also moved out of `<Outcome>` into `<NextButton>`, so it stands beside the
results panel — settling open decision 7 below.

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

### Landed 2026-09-09/11 — sign-in reaches the client, and storage starts

| Squash    | PR   | What                                             |
| --------- | ---- | ------------------------------------------------ |
| `3907cc9` | #149 | the emailed sign-in link finally lands somewhere |
| `4ad806f` | #150 | the schema, and a runner that applies it         |

**#149 closed pillar 1's UI hole.** The server emails `<web origin>/sign-in?token=…`
and the client had no router, so that URL opened the app, found no `?poll=`, and
showed the first question — `requestLink`, `redeem`, `me` and `signOut` sat fully
implemented in `HttpPulseApi`, called by nothing. `flow/route.ts` + `use-route.ts`
give three places; `App` becomes a picker owning no markup and the run moves to
`screens/Run.tsx`. Two screens follow mockups 01-claim and 02-sent. Three things
worth not rediscovering: `use-redeem.ts` holds the request in a **ref** rather
than guarding with a flag, because redeeming spends the link and StrictMode runs
every effect twice — bailing on the second run leaves nobody listening and the
screen sits on "Loading…"; a spent link is **replaced** in history, never pushed,
so Back cannot land on a URL guaranteed to fail; and a spent, expired or unknown
link is `empty`, not `error`, because only the server knows which and it already
writes the sentence.

**#150 is the first real storage.** `migrations/001_initial.sql` is the whole
schema as one forward-only file — ADR-0021's four voting tables column-for-column,
plus `voter`, `pending_claim`, `suggestion`, `allowed_domain` and the runner's own
`schema_migrations`. **ADR-0020's "the schema is five tables" is wrong** and was
always a remark inside an argument about ORMs, not a constraint. `src/db/migrate.ts`
applies pending files in numeric order, one transaction each, under an advisory
lock with a `lock_timeout`; it refuses both a file whose checksum changed after it
ran and a file numbering below one already applied. `src/db/config.ts` is now the
single place deciding what "unset" means. `pg` moved to `dependencies`.

**No stores yet.** #150 is foundation only — no store implementations, no compose
file, no vote-method registry (deferred by operator decision; the schema carries
`method_params` so it never needs a migration).

**The review caught the hole that mattered**, and it is the shape to expect again:
the runner applied anything absent from `schema_migrations` without checking it
sorted above the highest applied version, so 001 + 003 then 002 ran 002 **after**
003 and recorded a history that never happened — two branches each adding a
migration, merged either way. The file's own comment claimed forward-only was
"enforced rather than hoped for", which is exactly what made it hard to see:
the checksum guard stops an applied file being _edited_ and nothing stopped
history being _inserted into_. **Two promises, one of them unkept, behind one
confident sentence.**

**Every guard in #150 was mutation-checked** — twelve mutations, each rule
removed, each leaving its own test red and nothing else. Worth keeping as the
standard; `memory/pulse.md` has recorded "tests that could not fail" four
separate times now.

**What #150 owes the next change:** `vote_choice.vote_id` and `.choice_id`
reference their parents independently, so a row may name a vote on poll A and a
choice from poll B and the database will take it. Expressing it needs a composite
key that is not ADR-0021's shape, so the DDL is unchanged and **the store is the
only guard** — the conformance suite owes a case that writes a cross-poll pair
and is refused, against **both** implementations, the in-memory one having no
foreign keys at all.

### Landed 2026-09-12 — storage is real, and a `pnpm dev` that keeps things

| Squash    | PR   | What                                               |
| --------- | ---- | -------------------------------------------------- |
| `97aeff6` | #158 | identity on Postgres, and two sign-in races closed |
| `59b76c0` | #159 | the suggestion store on Postgres                   |
| `1efd457` | #160 | the dev server keeps what it is given, in Postgres |

**The four stores and the conformance suite are done.** With `PULSE_DATABASE_URL`
set, all five stores switch together — voters, votes, suggestions, sign-in links
and the allowlist — and without it everything stays in memory exactly as before,
so the demo still runs with nothing installed. **Item 1 of the eight-item list
below is closed, and so is item 3** (`PostgresDomainSource` plus `allowDomain`
make the allowlist rows, as `CLAUDE.md` always promised).

**Verified end to end on 2026-09-12, not just by tests:** sign in with a printed
link, vote, get `counted` with live results, kill the server, start it again —
same voter, vote still there, no crash on reseed. This is the first time a pulse
session has survived its own process.

**Two races #158 closed, both with a test that failed first.** Two clicks on one
link at once both signed in; `markUsed` now checks and spends in one step and says
whether _this_ call spent it, so the second click is told `already_used`. Two links
for one address redeemed at once made the slower one fail; `VoterStore.create`
throws `VoterExistsError` and the loser is signed in as the winner's voter, keeping
its own opt-in.

**The three PRs all went CONFLICTING before merge, and none of the conflicts was
real.** Each branch still carried the original commits of #156 (and #160 those of
#157) while master had them squashed, so git saw the same files added twice. This
is exactly the case `.claude/skills/odc-pipeline` describes, and its fix — replay
only the child's own work with `git rebase --onto origin/master <old-base-tip>` —
is the right one. **It was NOT the fix used here, because force-push was
unavailable to the session.** Instead master was merged in and the conflicted
files resolved to the content the clean rebase produces, with the merged tree
compared byte-for-byte against that rebase before pushing. Same master, extra
commits left on the branches. **Prefer the rebase when you can push one**; if you
cannot, verify the tree rather than trusting the conflict markers, because
resolving these by hand re-applies the base's changes on top of themselves.

## Not built

- **The bite/case screens and the action screen.** The ballot exists, since #140
  a results panel reachable from it, and since #149 the sign-in and redeem screens
  — so **the earlier note that nothing in the client signs anyone in is stale**.
  What is still missing is the middle of the story: `flow/story.ts` enumerates
  steps the app does not render. The mockups in `docs/mockups/pulse-screens/` are
  the design.
- **Pillar 3, the path to action** in any form: soliciting ideas, volunteer time
  or donations, and the proof-of-what-happened email. `proofEmailsOptIn` is
  collected at sign-in and currently leads nowhere.
- **Real mail delivery.** ~~and real persistence~~ — **persistence is BUILT as of
  2026-09-12** (#158, #159, #160): Postgres per ADR-0020 with ADR-0021's schema,
  the runner from #150, and a `pnpm dev` that keeps everything across a restart.
  Do not re-do it. What is still missing is the other half: **`ConsoleMailer` is
  the only `Mailer` anywhere**, so sign-in links print to a terminal and nobody
  who is not watching your console can sign in. That is now the single largest
  blocker to anyone but the operator using pulse, and it is undecided as well as
  unbuilt — no provider has been chosen.

### Asked for by the operator, 2026-08-25

These came out of demoing the run. The first is now satisfied; the rest are
undesigned and have no ticket, because pulse has nowhere to put one (see open
decision 4).

- ~~**Back on the vote-submitted screen.**~~ **SATISFIED 2026-08-26 — verify
  before re-doing it.** #131 made the outcome replace the ballot _inside_ the
  chrome rather than covering the screen, so `BallotChrome` — and its Back —
  now renders on both sides of the `settled` branch in `SwipeBallot.tsx`. The
  control is there. **The test it owed now exists** (#140) — a mutation removing
  Back from the settled chrome makes it, and only it, go red. This item is fully
  closed.
- ~~**A way to see the result.**~~ **BUILT 2026-09-03 — #140, squash `af55032`.**
  A quiet "See results" under the outcome opens a panel in place of it: how many
  have answered, your pick named back, and a bar per choice with its count and
  share. Three things about it worth not rediscovering:
  - **The counts ride in on the cast response**, not a fetch of their own. The
    server already returned them with the vote and the client was discarding
    them, so there is no second request, no loading state, no failure state, and
    no window in which the numbers can disagree with the answer just given.
  - **`PulseApi.results` is therefore dead client-side.** Nothing calls it. That
    answers the question of whether the interface earns its keep on that method.
  - **Bars scale to the widest share, not to 100** — an approval poll can push
    one share past most of a fixed scale and a single-choice poll can leave every
    bar short. The standing constraint held: the panel says what people chose,
    never how a tally is computed, and a test asserts it over both poll methods.
- **A subject browser.** A way to look through the subjects/questions available
  rather than only walking the run you were given. Undesigned and unscoped —
  it is not yet decided whether this is a list, a feed, or a search, nor how it
  relates to the graph a run walks.

  **Sharpened 2026-09-06 by the operator: a home screen that browses all polls
  and batches of related polls, story-style.** That is the first shape anyone
  has given it, and it now has a second job — ADR-0022 names it as the route
  back to a question from _outside_ a run, where "Change my answer" is the route
  from inside one. Still unscoped, and **not a reason to weaken the in-run
  control**: the ADR's promise has to hold today, on one screen, with no
  navigation.

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
  is the first thing to decide, before any YAML gets written. **ANSWERED
  2026-09-02 by ADR-0020: pulse follows the convention** — its own
  `docker-compose.yml` with its own container. The rule protects nothing with a
  single service, but deviating buys nothing either, and it keeps the root
  compose able to bring the whole stack up as `just up` promises.

  Two more of the eight items below are now decided rather than open. **Item 1
  (the four stores)** has its schema in ADR-0021 — and note the ADR adds two
  things the list does not: timestamps come from the application with no
  `DEFAULT now()` anywhere, because a clock is injected in five places and a
  database default silently bypasses all of them while most tests keep passing;
  and **the dev seed must become idempotent before any of this lands**, because
  `createPoll` throws on a duplicate id and `dev-server.ts` loops the `SEED`
  polls through it on every boot — fine against a fresh `Map`, a startup crash
  on the first restart once storage persists. **Item 6 (poll creation)** is
  unchanged and still the gap most likely to be found late.

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

### How close is a deploy? Assessed 2026-09-12, by reading the code

Storage was the visible blocker, so finishing it feels like the finish line. It
is not. **Four things block a deploy and three of them have no code at all** —
checked directly, not inferred:

| Blocker                       | State                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No `Mailer`**               | `ConsoleMailer` is the only `implements Mailer` in the tree. **This is the real gate** — without it a deployed pulse is unusable by anyone but whoever is reading the console.                                 |
| **No production entry point** | `src/dev-server.ts` is the only server file, and `assertDevelopment` guards it twice on purpose. Needs a sibling `main`, **never an edit to it** — item 5 below.                                               |
| **No poll creation**          | There is still no `POST /api/polls` in `src/http/server.ts`; polls are the `SEED` literal in `dev-server.ts`. A deployed pulse has nothing to vote on. Item 6, and still the gap most likely to be found late. |
| **No Dockerfile**             | Still none anywhere in the repo, on any branch. `apps/pulse/docker-compose.yml` now exists but brings up **Postgres only** — there is no image of the app to run. `just up` still starts nothing and exits 0.  |

Already fine, so do not re-litigate: **item 4's cookie half is correct** —
`src/http/server.ts` defaults `secure: deps.secureCookies ?? true`, and
`dev-server.ts` is the only thing that sets it false, guarded. Only the
"`PULSE_SESSION_SECRET` as a managed secret" half is outstanding.

Rough shape of the remaining work: **Mailer, a production entry point, and poll
creation are about three PRs the size of #158–#160** and would produce something
another person could actually use. Pillars 1 and 2 would then be deployable;
the middle of the story and pillar 3 would still be missing, so that is a demo,
not a product.

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

3. ~~Where pulse's data actually lives.~~ **SETTLED 2026-09-02 — Postgres**
   (`docs/decisions/0020-pulse-storage-is-postgres.md`), with the poll and vote
   schema in ADR-0021. The decision is made; the stores are not written, so
   everything a `pnpm dev` session does still dies with the process.

   **Read ADR-0020 before reopening this.** The argument is closer than the
   locked stack makes it look — ADR-0001's stated reasons ("multi-service access
   and enforceable append-only grants") reach neither a workstream forbidden
   from cross-service reads nor one with no event tables, and `odc-storage`
   already scopes itself out of `apps/**`. SQLite was a real option and every
   technical argument favoured it. **What ruled it out is the operator's goal of
   high or highly dynamic traffic** — many processes, which SQLite's single
   writer forecloses. Do not re-derive the technical case and conclude the
   decision was a mistake.

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

   **SETTLED 2026-09-06 — ADR-0022** (`docs/decisions/0022-one-press-casts-and-says-so.md`),
   landed in #146. One press stays, `odc-ui` names the exception, and the
   outcome now says the answer can be changed and offers a control that
   changes it. **The exception is bought with reversibility, not with speed** —
   do not extend it to anything final. The other half of the rule, "never let a
   double-tap cast twice", was never overridden and still holds.

7. ~~**Does NEXT stay on screen while the results panel is open?**~~
   **SETTLED 2026-09-06 by the operator — yes, it stays** (#146). Raised
   2026-09-03 by the two #140 reviews, which split on it; the second reviewer's
   argument won. Opening the panel used to replace the whole outcome, so a
   glance cost "Close" then NEXT, and it removed the only way forward from the
   screen — which is what turned the panel's overflow bug into a trap. NEXT now
   lives in `<NextButton>`, outside both the outcome and the panel, and stands
   under whichever is showing. Note the earlier entry read "**Left as-is
   deliberately**"; that was true of #140 and is no longer true of the code.

8. ~~**Where a feature request goes.**~~ **SETTLED 2026-09-11 — `docs/plans/pulse.md`**,
   mirroring the ODC core's `docs/plans/phase-0.md`. It keeps the workstream's
   record in-repo, where this file says pulse's own docs are the only record,
   and avoids the conflict problem a `memory/BACKLOG.md` would have — memory
   entries are updated on master at merge time precisely because parallel agents
   collide on files everyone edits. Open decision 4 above is closed by this.

9. ~~**`is_entry_point`, and whether a domain may serve two communities.**~~
   **SETTLED 2026-09-11 by the operator — ADR-0023**, landed in #150.
   `is_entry_point` is **dropped**: ADR-0021 specifies it, so its absence is a
   decision and not an oversight, and the cost is accepted — the backfill, not
   the migration, is the expensive half. **A domain may serve several
   communities**; the key stays `(community, domain)`. That made a latent bug
   reachable, since `DomainAllowlist` kept whichever equal-length row came first
   and a database-backed source has no inherent order, so one address could
   resolve to a different community run to run. The tie-break is now explicit —
   longest domain, then lowest community — and is **interim**. The real answer
   is that **the person picks** when their address matches more than one, which
   is sign-in work and lands with the sign-in screens.

10. ~~**How polls come to exist.**~~ **SETTLED 2026-09-11 by the operator —
    crowdsourced questions with computed navigation**, not authored stories.
    Community members post questions; `next_poll_id` stays mostly empty;
    grouping and related polls do the navigating. **ADR-0024 records it** (in
    flight at the time of writing — check it landed). Four consequences to hold
    on to:
    - **Navigation stops being optional.** Draft PR #148's related-polls work
      moves from nice-to-have to the primary way anyone reaches a second
      question. Note its proposed ADR number **0023 is now taken**.
    - **`polls` needs `community` and `created_by`, and has neither.** By
      operator decision they did **not** go into #150, since nothing writes them
      yet — consistent with dropping `is_entry_point`. They land in migration 002
      with the authoring work. The honest asymmetry: unlike `is_entry_point`,
      authorship **cannot be backfilled at all**, only defaulted, so any poll
      created before that migration has no recoverable author.
    - **Posting requires signing in; voting does not** (#128 counts a vote before
      anyone signs in). That asymmetry becomes deliberate and load-bearing —
      moderation and per-person rate limiting both depend on it.
    - **Which community you post into follows from ADR-0023's sign-in picker**,
      which is unbuilt. A dependency, not a detail.

    **Still open underneath it, and needed before any code:** duplicate
    filtering (reuse `overlap()`/`keywords()` from `suggestions.ts`, or allow
    duplicates and merge later?); moderation before or after posting (pre-
    moderation needs a queue and throttles the volume this choice exists for;
    post-moderation needs a **moderator role that exists nowhere in pulse**);
    and what counts as a real question at all, since `createPoll`'s validation
    is syntactic only.

### Traps the 2026-09-06 review round found, now fixed — do not reintroduce

- **A ref that survived because nothing ever came back.** A drag that commits
  answers the press through `gestureDecided`, and the `click` that consumes the
  flag never arrives — settling unmounts the halves in the same flush. That was
  harmless for as long as settling was terminal: `key={poll.id}` gave the next
  question a whole fresh screen. "Change my answer" is the first path that
  returns to a **live** screen with the old refs, and it swallowed the first
  keyboard press on a half — precisely where the new focus move sends someone.
  `changeAnswer()` now returns `gestureDecided` and `drag` to their mount state.
  **The general shape, which will recur:** any state that was safe only because
  a component always remounted becomes a bug the moment something resets it in
  place. When adding a reset, audit every ref, not just the ones the feature
  touches.
- **The test that could not fail.** Both "closed poll" tests drove a `closed`
  cast — and `<Outcome>` returns early on `closed` without ever reading
  `changeable`. Replacing `changeable={poll.open}` with a constant `true` left
  the entire suite green, so the clause ADR-0022 rests on was pinned by nothing.
  A poll with `open: false` and a `counted` cast is the only case that exercises
  the prop. **Ask of every guard: which test goes red if I hardcode this?**
- **`findByRole("status")` does not wait for the vote.** `<Outcome>` renders the
  same `role="status"` region while the cast is in flight, saying "Sending…", so
  the query resolves on the **casting** render and every assertion after it is a
  race against a promise. Three tests in #146 read the settled copy that way.
  They passed locally, where the microtask flushed first, and #147 went red in
  CI, where it did not. **Wait on the settled words** — `findByText("Counted.")`
  — then read the region. Reproduced locally by giving the stubbed `cast` a 20ms
  delay, which is worth doing to any test that awaits a region rather than a
  result.
- **A CSS class that never applied.** `.outcome > span` is 0-1-1 and
  `.outcome__changeable` was 0-1-0; specificity beats source order, so the
  sentence painted identically to the line above it and the rule's comment
  described behaviour the code did not have. Selector is now
  `.outcome > span.outcome__changeable`.

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

- **`polls` is the only plural table; the other seven are singular.**
  `polls`, then `poll_choice`, `vote`, `vote_choice`, `suggestion`, `voter`,
  `pending_claim`, `allowed_domain`. It reads at its worst inside `poll_choice`,
  which declares `references polls (id)` — both conventions on one line. This is
  **inherited, not a slip**: ADR-0021's own schema sketch writes `polls` beside
  `poll_choice`, and `001_initial.sql` copied it faithfully, as its header says
  it is doing. Cosmetic, but every query pays it. If it is ever standardised,
  singular is the cheaper end (seven of eight already are) and it **cannot be a
  hand-edit of `001_initial.sql`** — #150's runner refuses a file whose
  checksum changed after it ran, by design — so it needs a `002_*.sql` doing
  `alter table polls rename to poll`, plus the seven call sites. Raised
  2026-09-12; no decision taken.
- **The README's demo details drift from the seed.** As of 2026-09-12 the seeded
  polls are `ads-free`, `pay-for-it` and `ads-allowed`, and the cast route is
  `POST /api/polls/:id/votes` — **plural**. Both are easy to guess wrong from the
  prose; check `src/dev-server.ts` and `API.md` rather than the README when a
  smoke test 404s.
- **`pnpm run test` is `turbo run test`, and turbo 2 strips undeclared
  environment variables.** A variable set on a CI job does **not** reach the
  task unless `turbo.json` declares it. On 2026-09-02 this made PR #143 go green
  while proving nothing: `DATABASE_URL` was set on the job, a workflow step
  asserted it was set, turbo removed it anyway, and the database test took its
  skip branch — `# SKIP DATABASE_URL is unset`, 150 passed, 1 skipped, all
  checks green. Declare the variable under the task's **`env`** (not
  `passThroughEnv` — `env` is part of the cache key, and for anything that can
  change a result a cached pass would be a lie), and put the "this must not
  skip" guard **inside the test**. A workflow step can only see the shell, not
  the task. **A green tick is not evidence a test ran:**
  `gh run view <id> --log | grep -c '# SKIP'`.
- **Never key a test off `DATABASE_URL` or `CI`.** Both were tried in #143 and
  both were wrong. `DATABASE_URL` is among the most widely exported variables
  there is, so the suite aimed itself at whatever unrelated database the
  developer already had configured — harmless while the only statement is
  `select 1`, destructive once the store tests run migrations. And `CI` was read
  as "any non-empty value", so `CI=false` — a convention developers really do
  carry — meant "on CI" and turned a skip into a failure telling them the
  opposite. Hence `PULSE_DATABASE_URL` and `PULSE_REQUIRE_DATABASE`.
- **Do not map host port 5432 when pulse gets its compose file.** A developer
  machine with a Postgres already listening there silently wins the loopback
  race against the container, and the error it produces (`role "pulse" does not
exist`) looks like a credentials bug rather than a port collision. This cost
  real time on 2026-09-02 on the operator's own machine, which has one running.
- **A `D` in `git diff --name-status origin/master..HEAD` is not proof you
  deleted anything.** Two dots compares against master's _current tip_, so any
  file master gained after you branched reads as a deletion. On 2026-09-02
  `pulse/10-ci-database` appeared to delete `.claude/launch.json`, which #142 had
  added after the branch was cut. Use **three dots** — `origin/master...HEAD` —
  to see what the branch actually changes, and treat a two-dot-only `D` as a
  signal to rebase. Both forms are worth running: three dots answers "what do I
  change", two dots answers "am I stale". The caution below about a branch not
  being based on current master is the same symptom.

- **Stacked-PR discipline now lives in `.claude/skills/odc-pipeline`, not here**
  (#139, 2026-09-03). It absorbed the two traps this file used to spell out —
  never `--delete-branch` while a child PR still targets the branch (GitHub
  auto-closes the child and it cannot be reopened if its head was ever
  force-pushed; that is how #132 was lost and had to be re-raised as #135), and
  a squash merge makes the branch above it conflict every time, which is not a
  real conflict and must be rebased with `--onto`, never merged away. Both were
  learned on the #128-#135 stack, at every single step of it. **Read the skill;
  do not re-copy the rules back here** — one place only, per `memory/INDEX.md`.
  The same PR replaced the old blanket "do not stack PRs" ban, which no operator
  ever asked for, with a shallow-stack discipline. Do not re-derive the ban.
- **`.github/scripts/diff-size.sh` prints a false promise for pulse.** Its own
  comment says "The WARN at 400 still fires for pulse and is the honest signal",
  and this file repeated it — but the implementation excludes `apps/pulse/**`
  from the `--numstat` pathspec entirely, so a pulse branch reports **0 changed
  lines** and the WARN can never fire. #150 was ~1080 lines and printed 0.
  **Count by hand for any pulse change**, and do not cite the guard as evidence
  a branch is small. Unfixed: which half is wrong, the comment or the exclusion,
  is a decision rather than a typo.
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

### Two known bugs, found 2026-09-06, NOT fixed

Found by the review of #146 in code that PR did not touch, so they were left
out of it rather than widening one reviewable change. Nobody has started them.
(A third — `database.test.ts` skipping on `url === undefined`, so an empty
`PULSE_DATABASE_URL` ran the test and then failed about a variable that was not
set — **was fixed in #150**, which owned that file.)

- **`ResultsPanel` reads `yourChoice` two ways.** "You picked X" resolves it as
  an array position (`results.choices[yourChoice]`), the row badge as
  `choice.index`. They agree only because the server happens to return choices
  in poll order. **ADR-0021 is what makes this urgent**: it gives
  `poll_choice.id` a stable identity and demotes `position` to display order, so
  the first time results come back ordered any other way, the panel names the
  wrong answer back to the voter. Pick one and use it in both places.
- **A poll the client already knows is shut is still fully pressable.**
  `settled` never consults `poll.open` on either ballot, so one press still
  casts. If the server disagrees and answers `counted`, the person gets a
  binding one-press cast with neither a confirming press nor the reassurance
  sentence — **the "worst of both worlds" ADR-0022 exists to prevent.** Needs
  client/server disagreement to reach, so it is unlikely rather than impossible,
  and it is the one state where the ADR's bargain is fully broken.
