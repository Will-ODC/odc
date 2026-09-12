# Pulse Plan — Work Nobody Has Started

**Written by:** odc-architect, 2026-09-11, by decision 2 of
`docs/decisions/0024-pulse-polls-are-posted-by-the-community-and-navigated-by-computation.md`,
which settles `memory/pulse.md` open decision 4: pulse had nowhere to put a
feature request, so requests accumulated in the memory entry.

**This file is that place.** It holds things we want to build that nobody has
started. Nothing here is a commitment to build it, and nothing here is ordered
except where this file says the operator ordered it.

---

## What goes here, and what does not

`memory/INDEX.md` has the full "where does this fact go" table and this file is
one more row in it. The short version:

| The thing you have                              | Where it goes                                     |
| ----------------------------------------------- | ------------------------------------------------- |
| A thing we want built that nobody has started   | **Here**                                          |
| A ticket that landed, or a phase that moved     | `memory/pulse.md`, at merge time **on master**    |
| A choice with alternatives and consequences     | A new ADR in `docs/decisions/`                    |
| A design question you could not settle          | `memory/OPEN-QUESTIONS.md`, under a dated heading |
| A trap the next session will otherwise re-hit   | "Live cautions" in `memory/pulse.md`              |
| Work already in flight — a branch or an open PR | The PR. Not here.                                 |

An item leaves this file when it lands. The PR that builds it **deletes its
section in the same diff** and records the landing in `memory/pulse.md` at merge
time — that is who prunes this file, and it is the reason the list cannot rot
the way a backlog does. An item nobody ever builds is deleted by the operator,
or it stays; a stale item here is visible, where a stale item in a memory entry
is load-bearing context that a fresh session reads as current.

Pulse is **charter-exempt** (`apps/pulse/CLAUDE.md`). Nothing in this file is
held to `docs/charter.md`, and the two boundaries that survive the exemption —
no reads or writes into `services/` or `contracts/`, and the counting is never
the subject — apply to every item below without being restated in each one.

## Required reading, per session

`CLAUDE.md` → `memory/INDEX.md` → `memory/pulse.md` in full → this file (your
item at minimum) → `apps/pulse/CLAUDE.md` and `apps/pulse/API.md` before
touching the server, `.claude/skills/odc-ui` before touching a screen,
`.claude/skills/odc-testing` before writing any code at all.

## Status vocabulary

Every item carries exactly one:

- **READY TO BUILD** — every decision it needs has been made. It may still have
  a dependency on other work; the item says so.
- **BLOCKED ON A DECISION** — somebody has to decide something first, and the
  item names what. Building it anyway means inventing the answer in code, which
  is how a product decision ends up as an implementation detail nobody knows
  was made.

## Ordering

**The only ordering the operator has given is: finish storage, then poll
authoring.** Everything else in this file is unordered, deliberately — do not
read position on the page as priority, and do not assign one.

Two things are **in flight and are therefore not items here**: the storage work
(migration, runner and the four stores — PR #150 and what follows it) and
answer-independent related polls (draft PR #148). Go to those PRs, not to this
file.

---

## P2 — The sign-in community picker · READY TO BUILD

Owed by ADR-0023 and unticketed until now. A domain may prove membership of
several communities — `allowed_domain` is keyed on `(community, domain)` on
purpose — and **the answer is that the person picks which community they are
signing in to.**

What holds until this ships is an interim tie-break in
`apps/pulse/src/identity/allowlist.ts`: longest domain, then lowest community
alphabetically. It is commented as interim and its only job is to make the
answer a property of the rows rather than of the order a query returned them.

ADR-0024 gives this a second job, which raises what it is worth: **the community
someone picks at sign-in is what decides where they may post a question.** An
arbitrary answer is tolerable for which community admits you and is not
tolerable for where your question is published.

Decided already, do not re-open: that the person picks (ADR-0023), and that
`(community, domain)` stays the key. Not decided, and this item does not have to
settle it: what happens to a person who belongs to two communities and wants to
act in both in one session.

## P3 — The subject browser / home screen · BLOCKED ON A DECISION

Asked for by the operator 2026-08-25 and **sharpened 2026-09-06: a home screen
that browses all polls and batches of related polls, story-style.** That is the
only shape anyone has given it.

It has three jobs, and the third is new:

1. Look through the questions available, rather than only walking the run you
   were given.
2. ADR-0022 names it as the route back to a question from **outside** a run,
   where "Change my answer" is the route from inside one. **This is not a reason
   to weaken the in-run control** — that promise has to hold today, on one
   screen, with no navigation.
3. **ADR-0024 makes it the primary way anyone reaches a second question at
   all**, because under crowdsourced posting `next` is mostly empty.

**Blocked on:** whether this is a list, a feed, or a search, and how it relates
to the graph a run walks. None of that is decided. Two pieces of it are decided
or in flight and should be read first — ADR-0021 rules that **ordering is a
query, not stored data** (a curated group, a relevance ranking, and random are
all resolved at request time), and draft PR #148 designs the related-poll edges
this screen would batch.

Also owed by this item and not by #148: **there is no `GET /api/polls`.** Every
route is `/api/polls/:id/...`, so a browsing screen needs a listing endpoint
that does not exist.

## P4 — A real `Mailer` · BLOCKED ON A DECISION, then READY

`src/identity/mailer.ts` defines the interface and `ConsoleMailer` prints the
link to a terminal. **No provider implementation exists anywhere**, so nobody
outside a terminal can sign in and a staging environment is unusable without
this.

**Blocked on:** which provider. That is an operator decision and it is one
sentence long; everything after it is ordinary work behind an interface that
already exists.

Ship it with the things a mailer is always retrofitted with and should not be:
what happens when the provider is down (the sign-in route must not 500 on it),
and what the terminal mailer keeps doing in development, which is the flow being
demonstrable without a provider at all.

## P5 — Pillar 3, the path to action · BLOCKED ON A DECISION

The third MVP pillar, in any form: soliciting ideas, volunteer time or
donations, and the proof-of-what-happened email. `proofEmailsOptIn` is collected
at sign-in today and **leads nowhere.**

**Blocked on:** the whole shape. Nothing about this is designed. Donations in
particular reach payments, identity and obligations the product has never had.

The one thing already decided about it, from ADR-0022: pulse's one-press cast is
bought with **reversibility, not speed**, and pillar 3's donations and volunteer
commitments are not reversible and therefore **do** confirm. Do not read pulse's
ballot as a precedent for how this pillar's actions are taken.

## P6 — Poll authoring under ADR-0024 · BLOCKED ON DECISIONS; the operator's stated next work after storage

**How polls come to exist.** ADR-0024 chooses crowdsourced posting with computed
navigation, and this is the item that builds it. Today polls and their entire
`next` graph are the `SEED` literal in `dev-server.ts`; there is no
`POST /api/polls`, no admin surface and no seed job, and **a deployed pulse has
nothing to vote on.**

Read ADR-0024 in full before starting — its consequences are this item's scope,
and the summary below is not a substitute for them.

**Blocked on three rules the operator named as open when choosing B:**

- **Filtering.** What a posted question has to pass. `createPoll` validates
  shape only — non-empty question, 2–25 distinct non-empty choices — and cannot
  tell a real question from noise. Whether the duplicate machinery in
  `suggestions.ts` (`keywords()`, `overlap()`, `SAME_IDEA = 0.6`) is reused for
  questions, or duplicates are allowed and merged later, is open.
- **Who can post where.** Follows from P2: the community picked at sign-in
  decides where a question can be posted. **Posting requires a session; voting
  does not** — that asymmetry is deliberate under ADR-0024.
- **Moderation.** No moderator role exists anywhere in pulse. Post-moderation
  needs someone who can remove a question; pre-moderation needs a queue and
  kills the volume that is the whole point of crowdsourcing. The fork is open.

**Ready and waiting behind those, once decided** — all from ADR-0024's
consequences: migration 002 adding the community and author columns to `polls`
(author **cannot** be backfilled later, only defaulted); a removed/hidden state,
because `on delete cascade` means deleting a question destroys the votes cast on
it; server-minted poll ids, because `polls.id` is caller-supplied text today; a
rate limit keyed on the voter and backed by a shared store, since
`@fastify/rate-limit` is in-memory and ADR-0020 expects many processes; and
deciding who fills `closesAt` and `acceptsSuggestions` on a posted question.

**Depends on** the storage work landing first — that is the operator's stated
ordering — and on P2 for the community half.

## P7 — Two known bugs · READY TO BUILD

Found by the review of #146 on 2026-09-06, in code that PR did not touch, so
they were left out of it rather than widening one reviewable change. Nobody has
started them. They are small and independent; one branch each, or one branch for
both, is a judgement call about review size.

### P7a — `ResultsPanel` reads `yourChoice` two ways

"You picked X" resolves it as an array position
(`results.choices[yourChoice]`); the row badge uses `choice.index`. They agree
only because the server happens to return choices in poll order. **ADR-0021 is
what makes this urgent:** it gives `poll_choice.id` a stable identity and demotes
`position` to display order, so the first time results come back ordered any
other way, the panel names the wrong answer back to the voter. Pick one reading
and use it in both places.

### P7c — A poll the client already knows is shut is still fully pressable

`settled` never consults `poll.open` on either ballot, so one press still casts.
If the server disagrees and answers `counted`, the person gets a binding
one-press cast with neither a confirming press nor the reassurance sentence —
**the "worst of both worlds" ADR-0022 exists to prevent.** It needs
client/server disagreement to reach, so it is unlikely rather than impossible,
and it is the one state where that ADR's bargain is fully broken.

---

## P8 — Identity becomes a credential, and a public link becomes a way in · PARTLY BLOCKED ON DECISIONS

Asked for by the operator 2026-09-12: **can pulse support varying levels of
authentication — emailed link, a public link anyone can click, in-person
verification, an app that scans people in — or does that need an overhaul?**

**It does not need an overhaul.** The seams are already in the right places and
the extensibility pattern already exists in this repo. What it needs is for the
email address to stop being the identity.

### Why this is cheap now and gets dearer

Four properties make the blast radius small, and they are worth not breaking:

- **Voting does not depend on identity at all.** `vote.voter_id` is the browser's
  ballot cookie and is explicitly **not** a foreign key to `voter` — the DDL says
  so. Adding sign-in methods therefore cannot touch the vote path. Everything
  below stays inside `apps/pulse/src/identity/`, six files.
- **`pending_claim` is already method-agnostic** apart from one column: a token
  hash, a community, an expiry, and a one-use marker.
- **Community is decided at claim time and stored**, not re-derived from the
  address on read, so a different way of deciding it does not ripple.
- **The stores are already interfaces with two implementations each** (#156,
  #158), so the seam to widen is the one the conformance suite already guards.

Against that, `email` is not a field on the voter — it **is** the key:
`voter.email not null unique` described in the DDL as "the natural key",
`VoterStore.byEmail` as the primary lookup, `ClaimStore.liveFor(email)` for
throttling, and `VoterExistsError(email)` carrying it into the error type.
**Nothing anywhere records how a person was verified.** There is no column for
it, which is the actual gap: levels cannot vary if nothing stores which level
applied.

**Timing is the whole argument.** Nothing is deployed and there are zero
production rows, so this is the cheapest it will ever be. P4 (a real `Mailer`)
and P6 (poll authoring) both build on sign-in, and any screen that treats
"sign in" as "type your address" is another place to unpick later.

### The shape, and the precedent it follows

ADR-0021 already solved this problem once, for voting: `polls.method` is plain
`text` with a `method_params jsonb` beside it, **so that adding a vote type is
never a migration**. Apply the same shape to identity and the four methods above
are rows, not releases.

```
voter              -- no email column; identity, community, assurance
voter_credential   -- (kind, value_hash) PK, voter_id, params jsonb, verified_at
                   -- kind: 'email' today; 'in_person', 'scan' later, no migration
invite_link        -- the public link: community, expiry, revocation, use cap
```

A credential is **something a person can present again to be recognised**. That
is the line that decides what goes in the table, and it is why a public link is
a separate thing rather than a credential kind (see decision D1).

### Build order — four branches, each shippable alone

1. **Credential model, no behaviour change.** `002_*.sql` moves `voter.email`
   into `voter_credential` as kind `email`; `byEmail` becomes
   `byCredential(kind, value)`; `liveFor(email)` becomes `liveFor(kind, subject)`;
   `VoterExistsError` carries a credential, not an address. **Every existing test
   passes unchanged** — that is this branch's acceptance criterion, and it is
   what makes the rest safe. The two sign-in races #158 closed (double-click on
   one link; two links for one address at once) keep their tests **and keep
   passing**; they are the regression most likely to be reintroduced here.
2. **`assurance` recorded.** A plain `text` column on `voter`, set at claim time.
   Recorded only — nothing reads it yet. See D2.
3. **Invite links.** The `invite_link` table, a redeem path, and minting. **This
   branch is blocked on D3** and shares P6's problem: pulse has no operator
   surface of any kind, so there is nowhere for "create a link" to live.
4. **The client's side of it** — a landing screen for a clicked link, and a `Me`
   whose address is now optional. `apps/pulse-web`, `.claude/skills/odc-ui`.

**Deliberately not in this item: per-poll minimum assurance.** Recording a level
and _enforcing_ one are different changes, and the second touches the vote path
this item is careful not to touch. Until it ships, levels are recorded and inert
— say so rather than implying the door is guarded.

### Decisions this needs first

- **D1 — does a public-link voter survive their session?** A shared link
  identifies nobody, so each click can only mint a new voter. **Recommendation:
  no credential row; record provenance on the voter and accept that a signed-out
  public-link voter is gone and a fresh click is a new person.** The alternative
  — a durable secret held in a cookie — is real work and buys little. Whichever
  is chosen, **write down the consequence**, because it is visible to users.
- **D2 — what are the levels, and are they ordered?** Naming them is cheap;
  committing to a total order is not, and D-anything about ordering only matters
  once something enforces it. Suggest naming `none`, `public_link`, `email` now
  and deferring the order to the item that gates on it.
- **D3 — who mints an invite link, and where?** There is no admin route, no
  poll-creation route, and no production entry point. This is the same hole P6
  hits, and the two should probably be answered together rather than growing two
  different admin surfaces.
- **D4 — can one link serve more than one community?** `allowed_domain` is keyed
  `(community, domain)` precisely so one domain may prove several (ADR-0023), and
  P2 exists because somebody must then pick. A link that named several communities
  would inherit that whole problem; a link that names exactly one avoids it.
  **Recommendation: one link, one community.**

### What the operator said, and what is honest about it

The ask was framed as preventing double votes. **A public link cannot do that**
— it is a shared secret, usable from any number of browsers — and the operator
has already said plainly that it is meant as a filter, not a guarantee. Recorded
here so nobody re-argues it: expiry, revocation, a use cap and rate limiting make
a public link a real speed bump, and that is all it is claimed to be.

Worth stating beside it, because it is easy to assume otherwise: **pulse does not
prevent double voting today either.** Deduplication is per browser, `API.md` calls
it "weak on its own", and signing out and back in is documented as counting the
same person twice. Any item that claims to improve on that is making a change to
ballot secrecy — no stored record currently connects a person to an answer — and
that is an ADR, not an implementation detail.

## Not in this file

- **Infrastructure and a Docker dev environment that resembles production.**
  Recorded at length in `memory/pulse.md` with eight things such an environment
  must cover, most of which are now items above or in-flight storage work.
  Whoever takes it reads that section first — and reads the caution with it:
  every document says the story is settled (`justfile`, ADR-0001), and
  `docker-compose.yml` is `services: {}` with **no Dockerfile anywhere in the
  repository, on any branch, in its entire history.** `just up` starts nothing
  and exits 0. Check for a Dockerfile; do not cite the ADR as evidence one
  exists.
- **Anything already built.** `memory/pulse.md` is the record of what landed and
  is the only place that answers "does this exist already". Three of the
  operator's earlier requests were satisfied by work that shipped afterwards, and
  the entry says so next to each one.
