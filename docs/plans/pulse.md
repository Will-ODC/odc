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

## P1 — The sign-in screens · READY TO BUILD

**Nothing in the client signs anyone in.** Pillar 1 — magic-link identity — is
built and served end to end on the server and has no UI at all: no CLAIM screen,
no SENT screen, no redeem screen. `flow/story.ts` enumerates six steps the app
does not render, and the design of record is `docs/mockups/pulse-screens/`.

Listed first because **P2 and P4 both sit on top of it**, not because it
outranks anything else.

Two things a session should know before starting, both already paid for:

- `GET /api/sign-in/redeem` reports on a link **without consuming it**, because
  mail scanners follow every URL in an email. It is still not on `PulseApi`,
  because no redeem screen has needed it.
- The one 403 the client treats as an _answer_ rather than a failure is
  `not_a_member`, which becomes `{ status: "not_eligible", message }` and shows
  the server's own sentence, which names the domain.

## P2 — The sign-in community picker · READY TO BUILD, depends on P1

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

## P4 — A real `Mailer` · BLOCKED ON A DECISION, then READY; depends on P1 to be worth anything

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

## P7 — Three known bugs · READY TO BUILD

Found by the review of #146 on 2026-09-06, in code that PR did not touch, so
they were left out of it rather than widening one reviewable change. Nobody has
started them. They are small and independent; one branch each, or one branch for
all three, is a judgement call about review size.

### P7a — `ResultsPanel` reads `yourChoice` two ways

"You picked X" resolves it as an array position
(`results.choices[yourChoice]`); the row badge uses `choice.index`. They agree
only because the server happens to return choices in poll order. **ADR-0021 is
what makes this urgent:** it gives `poll_choice.id` a stable identity and demotes
`position` to display order, so the first time results come back ordered any
other way, the panel names the wrong answer back to the voter. Pick one reading
and use it in both places.

### P7b — `database.test.ts` skips on `url === undefined`

An empty-string `PULSE_DATABASE_URL` runs the test instead, which then fails
claiming `PULSE_REQUIRE_DATABASE` is set when it is not — a misleading failure at
the exact moment somebody is wiring the stores up.

### P7c — A poll the client already knows is shut is still fully pressable

`settled` never consults `poll.open` on either ballot, so one press still casts.
If the server disagrees and answers `counted`, the person gets a binding
one-press cast with neither a confirming press nor the reassurance sentence —
**the "worst of both worlds" ADR-0022 exists to prevent.** It needs
client/server disagreement to reach, so it is unlikely rather than impossible,
and it is the one state where that ADR's bargain is fully broken.

---

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
