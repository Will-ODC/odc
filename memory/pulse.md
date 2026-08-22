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
- **Sign-in contract closed and wired end to end** — on branch
  `pulse/sign-in-contract`, **not yet merged**; record the squash commit here
  when it lands.
  The client moved to the server's `/api/sign-in*` shape; `wantsProofEmails`
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
rules (#84, review fixes #90), HTTP client and demo API (#88). It is
**deliberately ahead of the server** in two places the product has decided:
`method` on a poll, and vote-changing. `Ballot = number[]` exists so `ranked`
can be added later without changing any shape.

**Mockups.** `docs/mockups/pulse-screens/` (seven per-screen files, #97 —
screen 1 redesigned as a swipe ballot), plus `pulse-story-mobile-v1.html` and
`pulse-vote-states-v1.html` (#82, restored in #89 after #84 deleted them).
Style is translucent "Civic Glass"; **`hub-feed-v*.html` is NOT the reference.**

**CI.** The diff-size ceiling was raised **600 → 1000** in #93 because pulse work
kept getting split into branches that pushed review-relevant changes out of the
PR they belonged to. `.github/scripts/diff-size.sh` is the source of truth.

## Not built

- **The story UI itself — now the single blocking gap for a usable product.**
  `apps/pulse-web/src` holds only `api/` and `flow/story.ts`: no `index.html`,
  no entry point, no component for any of the six steps `steps()` enumerates.
  `vite.config.ts` proxies `/api` to a page that does not exist. The mockups in
  `docs/mockups/pulse-screens/` are the design, not the app. A future ticket also
  has to decide which `PulseApi` a build uses (demo vs http), and whether the
  non-consuming `GET /api/sign-in/redeem` check belongs on `PulseApi` — it is
  served today with no client method, because only a redeem screen would call it.
- **Pillar 3, the path to action** in any form: soliciting ideas, volunteer time
  or donations, and the proof-of-what-happened email. `wantsProofEmails` is
  collected at sign-in and currently leads nowhere.
- **Real mail delivery and real persistence.** `src/identity/mailer.ts` and the
  stores are what the tests run against; nothing is durable.

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

## Live cautions

- **`pnpm dev` generates an ephemeral session secret** and announces it; every
  restart invalidates every cookie. That is deliberate, not a bug to fix.
- **`pulse/4b-sign-in-routes` is an unlanded remote branch with no open PR**
  (head `861b983`). Nobody has said whether it is abandoned or owed. Check
  before starting sign-in work — do not assume either way.
- Pulse's own docs and this file are the only record of the workstream. The ODC
  core plan (`docs/implementation-plan.md`) does not cover pulse and will not
  tell you it exists.
