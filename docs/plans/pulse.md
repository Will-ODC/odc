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

**Work in flight is not an item here — go to its PR.** Check the open PRs
rather than this paragraph; a hardcoded list of what is in flight is wrong the
next time anyone opens a branch. The storage work and answer-independent related
polls were both listed here as in flight and have since landed (#150, #156, #157,
#158, #159, #160; and ADR-0025 via #148).

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
all resolved at request time), and ADR-0025 defines the related-poll edges (landed, #148)
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

## The identity work — P8 to P11, and why it is four items

Asked for by the operator 2026-09-12: **can pulse carry varying levels of
authentication — emailed link, public link, in-person verification, an app that
scans people in — or does that need an overhaul?** It does not. But the work
splits four ways because each part is gated differently, and only the first is
ready.

### The interaction principle behind all four

**"I want the app to behave like we are interacting now, where users decide on
bite-sized decisions, which models the community."** — the operator, 2026-09-12.

Pulse already has the machinery: `poll_choice.next_poll_id` means an answer picks
the next question, and ADR-0024 makes computed navigation primary. This states the
intent behind it: the run of small decisions **is** the product. Two consequences
bind every item below — **never interrupt a run with a wall** (a poll wanting a
higher level is one more small decision, offered and declinable), and **asking for
identity is itself one of those decisions**, offered when it buys something rather
than demanded at the door.

### Decided by the operator, 2026-09-12 — do not re-open

1. **Three levels, ordered: `none` < `link` < `email`.** Stored as words with the
   order in code, per ADR-0021's `polls.method` precedent, so `in_person` and
   `scan` are added later **with no migration**. The long-term direction named is
   **people verifying each other** — bumping phones or scanning a QR to confirm a
   real meeting — which is a rung for now, with `voter_credential.params` holding
   "who vouched" when it arrives.
2. **Votes carry `community` and `assurance`** — not who voted, what kind of
   voter.
3. **A stamp describes the answer currently standing.** Signing in does **not**
   re-stamp votes nobody re-cast; but re-casting is a fresh act and is stamped
   afresh. This keeps ADR-0022 whole: a vote stays changeable, so the one-press
   cast keeps the justification it depends on.
4. **Anonymous voting stays** — `community NULL, assurance 'none'`.
5. **Signing in upgrades the person, never their past votes.** A guest who
   verifies keeps their identity and gains the credential — unless the address
   already belongs to someone, in which case they become that person and the
   guest identity is dropped. **Nothing ever merges.**
6. **Anonymity is shown, not hidden.** **No such indicator exists today** —
   `apps/pulse-web` has none and `docs/mockups/pulse-screens/` has none; the word
   appears only as sample poll text in ODC-core decks. New UI, not an asset swap.
   It should eventually link to an explanation of data privacy and how pulse is
   paid for; that copy does not exist.
7. **The address is stored readably.** The client renders "Signed in as …"
   (`Redeem.tsx:135`, `Me.email` non-optional at `api/types.ts:105`) and
   `proofEmailsOptIn` promises mail that cannot be sent to a fingerprint. The
   operator's reasoning, recorded: storing addresses is what nearly every site
   does, and pulse's sensitive asset is vote attribution, which is protected
   structurally rather than by hiding addresses.
8. **A filtered tally is hidden below five people.** Filtering to three members of
   one community is close to naming how they voted.
9. **A gate mid-run is offered and declinable** — verify, or skip that question
   and carry on. **This depends on ADR-0025 being built** (see P10).
10. **Gating a poll later does not disturb votes already cast.** They keep the
    stamp they had and keep counting.

### What is still open

- **Does a public-link voter survive signing out?** Sign-out clears the ballot
  cookie (`server.ts:300-301`) and a link voter has no credential to re-present,
  so today they are gone. User-visible either way; confirm it is intended.
- **Does `/api/me` still return an address?** `publicVoter` returns
  `voter.email` (`server.ts:502`) and `API.md` documents `{ id, email, community }`.
  P8 must own that shape and the `API.md` edit, or say it is unchanged.
- **What does `proofEmailsOptIn` mean for someone with no address?** Stored on
  `voter` and `pending_claim`, asserted in four tests, rendered at
  `SignIn.tsx:172-183`.
- **May a filtered tally imply one person one vote?** It may not. `API.md:160-164`
  records that signing out and back in counts the same person **twice**. A result
  labelled "verified members only" reads as a stronger claim than pulse can
  support, and the label must not overstate it.
- **Is a `community` claimed via a public link worth the same as one proven by a
  domain?** Today both would sit in a tally indistinguishable. They are not the
  same evidence.
- **P2 interacts.** P2 changes how the community is decided at claim time, which
  is what makes P8 cheap. Whichever lands second is rework.

## P8 — Identity becomes a credential · READY TO BUILD

The one piece that needs no admin surface and no unwritten ADR.

**Why the blast radius is small.** `vote.voter_id` is the browser's ballot cookie
and the DDL says explicitly it is **not** a foreign key to `voter`
(`001_initial.sql:64-67`), so changing how people sign in cannot disturb voting.
Community is decided at claim time and stored (`claim.ts:112`), not re-derived.
The stores are interfaces with two implementations each (#156, #158), and the
conformance suite already guards the seam that widens.

Against that, `email` is not a field on the voter — it **is** the key
(`001_initial.sql:114-115`), reached through `VoterStore.byEmail` (`store.ts:54`),
`ClaimStore.liveFor(email)` (`store.ts:74`) and `VoterExistsError`
(`store.ts:46-51`). **Nothing records how a person was verified.**

```
voter              id, community, assurance   (no email column)
voter_credential   (kind, value) -> voter_id, params jsonb, verified_at
pending_claim      + kind; `email` becomes a generic subject column;
                   the index at 001_initial.sql:139 moves with it
```

**Scope, in full — this is larger than "move one column".** The `assurance`
column on `voter` and the ordered level vocabulary are **this item's**, not a
later one's. `liveFor(email)` → `liveFor(kind, subject)` is incoherent over a
table that only knows addresses, so `pending_claim` changes here too: its
Postgres query is `where email = $1` (`pg-store.ts:144`), called from
`claim.ts:105`. Decision 5's upgrade path — a guest who verifies keeps their
identity, or becomes the existing person — is also this item's; today `redeem`
mints an unrelated voter with `randomUUID()` (`claim.ts:165`) and never touches
the ballot cookie, so the path does not exist yet.

**What it must prove.** "Every existing test passes unchanged" is **not
available**: this renames the methods tests call by name —
`conformance/voter-store.ts` (`byEmail` at 41, 43, 115; `VoterExistsError` at 4,
95, 108, 121), `conformance/claim-store.ts:96`, `claim.test.ts:299`,
`http-sign-in.test.ts:310`. The honest criterion is **every existing behavioural
assertion still holds, with call sites renamed mechanically in the same diff.**

And passing them would not catch the regression that matters. Of the two races
#158 closed, race 1 (one link double-clicked) lives in `markUsed` and is
untouched. **Race 2 (two links, one address) is exactly what changes**: today
`PgVoterStore.create` is a single insert guarded by the `voter.email` unique index
and recovered via `isUniqueViolation` (`pg-store.ts:40-64`); it becomes two
inserts across two tables with uniqueness moved to `voter_credential` — new
transaction boundary, new error discrimination, and a new failure mode, **a voter
with no credential**. The tests that look like cover are not: `claim.test.ts:84`
uses the in-memory store, which has no concurrency, and
`conformance/voter-store.ts:89` is sequential. **`pg-identity-stores.test.ts` has
five tests and none creates concurrently.** So this item **adds** tests: two
concurrent `create` calls for one credential against Postgres (row-hold template
at `pg-identity-stores.test.ts:32`), and a case proving voter+credential is
written atomically. `memory/pulse.md:231` records "tests that could not fail"
four times; this would be the fifth.

**Note the tension with P10:** a public-link voter is _by construction_ a voter
with no credential — the failure mode above. Either this item's model
accommodates a credential-less voter deliberately, or P10 records that a link
voter is a `voter` row with `assurance 'link'` and no credential, unrecoverable
once signed out. **Decide it here, not there.**

**Migration traps.** Do **not** hard-code a number — P10, P11 and P6 all want one
and the runner refuses a file numbering below one already applied
(`migrate.ts:118`, `:194-215`). `test/migrations.test.ts:30-54` allows exactly two
column defaults, `'{}'::jsonb` and `1`, as set-equality — a defaulted `assurance`
fails it. Timestamps must be `timestamptz(3)` (`migrations.test.ts:56-76`).

**One seam to fold in, not duplicate.** `allowlist.ts:30-38` defines
`VerificationMethod`, whose docstring says invite codes and vouching "plug in here
without any caller changing" and whose `check(email)` is itself email-shaped.
Reconcile `voter_credential.kind` with it rather than adding a third word for the
same idea.

## P9 — Votes say what kind of voter cast them · BLOCKED ON A DECISION

Adds `community` and `assurance` to `vote`, written at cast time, plus the
anonymity indicator.

**Blocked because it changes a promise `API.md` makes in plain words:**

> No stored record connects an address to an answer, because the vote was never
> written down beside one. — `API.md:144-145`

The cast route reads no session today, deliberately (`server.ts:337-341`), and
this makes it the **first** handler to touch both the ballot identity and the
session cookie. In a community of three, `community` on a vote row is close to an
identifier — and that is about _storage_, which decision 8's display floor does
not address. **Write the ADR before the code**, and put `API.md` in scope.

**Wider than "the route".** `castVote(pollId, voterId, ballot)`
(`voting/store.ts:61-65`) has nowhere to put a stamp and `Vote`
(`voting/store.ts:17-23`) is shared, so this touches the interface, **both**
stores, the conformance suite and `server.ts:353`. Re-casting is an upsert
(`voting/pg-store.ts:138-145`), and per decision 3 the `do update` **must** carry
the new stamp.

**Recorded only — nothing reads it yet.** `results(pollId)`
(`voting/store.ts:68`) takes a poll id, `Results` (`:37-44`) has no filter, and
the tally is an unfiltered count (`voting/pg-store.ts:199-210`). Reading and
filtering — with decision 8's floor of five — is a further piece of work. Until
it lands, levels are recorded and inert; say so rather than implying the door is
guarded.

## P10 — Public links, and polls that ask for more · BLOCKED ON A DECISION

**Decided:** a link carries **one community**, an **expiry** and an **off
switch** — no use cap, which needs an exact counter under simultaneous clicks for
a limit anyone defeats by minting a second link.

```
invite_link   id, community, token_hash, expires_at, revoked_at, created_at
polls         + min_assurance
```

All timestamps `timestamptz(3)`; a defaulted `min_assurance` trips the guard at
`migrations.test.ts:30` — see P8's traps, they apply here unchanged.

**A public link is a shared secret.** Anyone who sees it can use it from any
number of browsers, so it gives **no deduplication at all**. The operator has
said plainly it is meant as a filter; expiry and revocation are what make it a
real speed bump. Recorded so nobody re-argues it.

**Decision 9 depends on ADR-0025, which is accepted and NOT built.** Skipping a
gated question needs somewhere to go, and `next` hangs off the choice you did not
make. ADR-0025's answer-independent related links are exactly that mechanism —
but there is no related-poll table in `001_initial.sql` and `API.md:198` lists
`GET /api/polls/:id/related` as "Planned — not served". **Building ADR-0025 is a
prerequisite for the skip path.**

**Blocked on P11**, and on three decisions of its own: who may mint a link for
which community; whether a gated poll hides itself or explains what is needed;
and whether a `community` claimed by link is presented differently from one
proven by a domain.

## P11 — An admin surface · BLOCKED ON A DECISION

Chosen by the operator over a throwaway script. **Two items point at this and it
had no entry**, which is what this file exists to prevent.

Needed by P10 (minting links, setting `min_assurance`) and by P6 (poll
authoring). Nothing of it exists: `src/http/server.ts` serves eleven routes and
none is administrative, there is no admin concept, no admin sign-in, and no
permission rules.

**Undecided, and all of it is "what is an admin?":** what makes someone one; how
they sign in; whether one admin acts for any community or only their own; and
whether this is a screen in `apps/pulse-web` or a separate surface. Read P6
before starting — one surface should serve links, polls and gates rather than
growing two.
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
