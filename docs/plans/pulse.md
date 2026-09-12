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

Nothing is in flight as of 2026-09-12. The storage work landed (#150, #156,
#157, #158, #159, #160) and answer-independent related polls landed as ADR-0025
(#148); both were listed here as in-flight and are recorded in `memory/pulse.md`
instead. P3's note that #148 is a draft PR is stale for the same reason.

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

## P8 — Identity becomes a credential, and votes say what kind of voter cast them · READY TO BUILD

Asked for by the operator 2026-09-12: **can pulse carry varying levels of
authentication — emailed link, a public link, in-person verification, an app
that scans people in — or does that need an overhaul?** It does not. The
decisions below were taken by the operator in the same session; what is still
open is listed at the end and none of it blocks this item.

**This item is the half that needs no admin surface.** Public links and per-poll
entry requirements are P9, which does.

### The interaction principle the operator named, 2026-09-12

**"I want the app to behave like we are interacting now, where users decide on
bite-sized decisions, which models the community."**

Pulse already has the machinery: `poll_choice.next_poll_id` means an answer picks
the next question, and ADR-0024 makes computed navigation the primary way anyone
reaches a second question. This states the intent behind it — the run of small
decisions **is** the product, and the aggregate of those decisions is the
community's picture of itself.

Two consequences bind the items below:

- **Never interrupt the run with a wall.** A poll that needs a higher level is a
  **step in the story**, phrased as one more small decision ("this one's for
  verified members — want to verify?"), not an error page or a redirect that
  loses someone's place. P9's gate must be designed that way or it breaks the
  thing it is embedded in.
- **Asking for identity is itself one of the decisions**, offered at the moment
  it buys something, not demanded at the door. That is the same reason entry is
  seamless and the ballot comes before sign-in.

### Why the blast radius is small

- **Voting does not depend on identity.** `vote.voter_id` is the browser's ballot
  cookie and the DDL says explicitly it is **not** a foreign key to `voter`
  (`001_initial.sql:64-67`). Changing how people sign in cannot disturb it.
- **`pending_claim` is nearly method-agnostic already** — a token hash, a
  community, an expiry, a one-use marker. Its email-shaped columns are `email`
  and `proof_emails_opt_in`.
- **Community is decided at claim time and stored**, not re-derived on read
  (`claim.ts:110-116`), so a new way of deciding it does not ripple.
- **The stores are interfaces with two implementations each** (#156, #158), and
  the conformance suite already guards the seam that widens.

Against that, `email` is not a field on the voter — it **is** the key, named so
in the DDL (`001_initial.sql:113-115`) and reached through `VoterStore.byEmail`,
`ClaimStore.liveFor(email)` and `VoterExistsError`. **Nothing records how a
person was verified.** That missing fact is the whole item.

### Decided by the operator, 2026-09-12 — do not re-open

1. **Three levels, ordered: `none` < `link` < `email`.** Stored as words with the
   order in code, following ADR-0021's `polls.method` precedent, so `in_person`
   and `scan` are added later **with no migration**.
2. **Votes carry `community` and `assurance`.** Not who voted — what kind of
   voter. This is what makes "results from verified members only" possible.
3. **The stamp is taken once, at cast time, and never changes.** Signing in later
   does **not** go back and re-stamp earlier votes. Retroactive rewriting was
   judged more machinery than it is worth.
4. **Anonymous voting stays.** A vote still counts before anyone gives anything;
   those rows carry `community NULL, assurance 'none'`.
5. **Signing in upgrades the person, not their past votes.** A guest who verifies
   an address keeps their identity and gains the credential — **unless** that
   address already belongs to someone, in which case they simply become that
   person and the guest identity is dropped. **Nothing ever merges**, so there
   are no conflict rules and no way to absorb another account.
6. **Anonymity is shown, not hidden.** A vote cast anonymously is visibly marked
   as such. **No such indicator exists today** — `apps/pulse-web` has none and
   the mockups have none; the word "anonymous" appears there only as sample poll
   text. This is new UI, not an asset swap.

**Consequence of 3 and 4, stated so nobody is surprised:** pulse shows the ballot
before it asks who anyone is, so on an ungated poll **most votes will be stamped
`none`**. That is correct and intended. Accurate stamps come from P9's per-poll
gate, which forces the verification to happen _before_ the vote rather than
re-writing it afterwards.

### The shape

```
voter              the person: id, community, assurance
                   (no email column)
voter_credential   how they prove it: (kind, value) -> voter_id, params jsonb,
                   verified_at. kind 'email' today; 'in_person', 'scan' later
                   with no migration. params carries "who vouched for you"
                   when peer verification arrives.
vote               + community (nullable), + assurance
```

`assurance` on `voter` is a plain word, set when they claim. The long-term
direction the operator named is **people verifying each other** — bumping phones
or scanning a QR to confirm a real-world meeting — which is a rung on this ladder
for now, and `voter_credential.params` is where "who vouched" will live.

### Build order — three branches

1. **Credential model.** A migration moves `voter.email` into `voter_credential`;
   `byEmail` becomes `byCredential(kind, value)`; `liveFor(email)` becomes
   `liveFor(kind, subject)`; `VoterExistsError` carries a credential.
2. **Vote stamping.** `community` and `assurance` onto `vote`, written at cast
   time. **This is the one branch that touches the vote path**, because the cast
   route reads no session today, on purpose (`server.ts:336-341`) and must start
   doing so. **That is an ADR, not an implementation detail** — write it before
   the code.
3. **The anonymity indicator** in `apps/pulse-web`, per `.claude/skills/odc-ui`.
   The operator wants it eventually to link to an explanation of data privacy and
   how pulse is paid for; that copy does not exist and is not this branch's job.

Branch 1 stands alone. Branch 2 needs branch 1's levels. Branch 3 needs branch 2.

### What branch 1 must prove — read this before writing the acceptance criterion

**"Every existing test passes unchanged" is not available and must not be
claimed.** Branch 1 renames the interface methods that tests call by name —
`conformance/voter-store.ts` (`byEmail` at 41, 43, 115; `VoterExistsError` at 4,
95, 108, 121), `conformance/claim-store.ts:96` (`liveFor`), `claim.test.ts:299`
and `http-sign-in.test.ts:310`. The honest criterion is: **every existing
behavioural assertion still holds, with call sites renamed mechanically in the
same diff.**

**And passing the existing tests would not catch the regression that matters.**
Of the two sign-in races #158 closed:

- **Race 1** (one link double-clicked) lives in `markUsed` and branch 1 does not
  touch it. Its test proves nothing here.
- **Race 2** (two links, one address) is exactly what changes. Today
  `PgVoterStore.create` is a **single insert** guarded by the `voter.email`
  unique index and recovered via `isUniqueViolation` (`pg-store.ts:39-61`). It
  becomes **two inserts across two tables** with uniqueness moved to
  `voter_credential` — new transaction boundary, new error discrimination, and a
  new failure mode (a voter with no credential: unreachable, unrecoverable).
- The tests that look like they cover it do not: `claim.test.ts:84` runs against
  the **in-memory** store, which has no concurrency, and
  `conformance/voter-store.ts:88` is sequential. **`pg-identity-stores.test.ts`
  has five tests and none is a concurrent `create`.**

So branch 1 **adds** tests: two concurrent `create` calls for one credential
against Postgres (the row-hold pattern at `pg-identity-stores.test.ts:32` is the
template), and a case proving the voter+credential pair is written atomically.
`memory/pulse.md` has recorded "tests that could not fail" four separate times;
this is the fifth shape of it.

### Two traps in the migration

- **Do not hard-code a migration number.** P9 and P6 both want one too, and the
  runner **refuses a file numbering below one already applied**
  (`src/db/migrate.ts:17-25`) — the bug #150's review caught. Take the next free
  number when it lands.
- **`test/migrations.test.ts:31-55` allows exactly two column defaults**,
  `'{}'::jsonb` and `1`. A `not null assurance` column with a word default fails
  that guard. `verified_at` must be spelled `timestamptz(3)`
  (`migrations.test.ts:57-75`).

### One existing seam to fold in, not duplicate

`src/identity/allowlist.ts:30-38` already defines `VerificationMethod`, whose
docstring says invite codes and vouching "plug in here without any caller
changing" — and whose `check(email)` signature is itself email-shaped. Folding
`voter_credential.kind` into that seam avoids ending up with three overlapping
words for the same idea (how membership is proved, how identity is presented,
how strong it was). **Reconcile them; do not add a third.**

### Still open — none of it blocks branch 1

- **Is the address stored readably or as a one-way fingerprint?** Readable is
  close to forced: the client renders "Signed in as …" (`Redeem.tsx:135`,
  `Me.email` non-optional at `api/types.ts:105`), and `proofEmailsOptIn` promises
  emails that cannot be sent to a fingerprint. Scrambling means dropping both.
  **Raised and deliberately left open.**
- **What does `proofEmailsOptIn` mean for someone with no address?** It is
  stored on `voter` and `pending_claim`, asserted in four tests and rendered by
  `SignIn.tsx:176-181`.
- **Does a guest survive signing out?** Sign-out clears the ballot cookie
  (`server.ts:300-301`); a guest has nothing else, so today they are gone.
  Confirm that is intended.
- **A floor before showing a filtered result.** Filtering a tally to three people
  from one community is close to naming them. A minimum group size is the usual
  answer and nobody has picked one.
- **P2 interacts.** P2 changes how the community is decided at claim time, which
  is the thing this item's third "why it is cheap" bullet leans on. Whichever
  lands second is rework.

## P9 — Public links, and polls that ask for more · BLOCKED ON A DECISION

The other half of the 2026-09-12 ask. **Blocked on there being an admin surface**,
which the operator chose over a throwaway script: pulse has no admin concept, no
admin sign-in, and no permission rules, and poll creation (P6) needs the same
thing. One surface serves links, polls and gates; building it is its own project.

**Decided already:** a public link carries **one community**, an **expiry date**
and an **off switch** — and no cap on uses. A cap needs an exact counter under
simultaneous clicks, which is a class of bug bought for a limit anyone can defeat
by minting a second link.

```
invite_link   id, community, token_hash, expires_at, revoked_at, created_at
polls         + min_assurance   the lowest level this poll accepts
```

**What a public link is and is not.** It puts someone in a community without an
address. It is a **shared secret** — anyone who sees it can use it from any
number of browsers — so it cannot tell two people apart and gives no
deduplication at all. The operator has said plainly it is meant as a filter, not
a guarantee; expiry and revocation are what make it a real speed bump. Recorded
so nobody re-argues it.

**Why the gate is what makes stamping useful.** P8 decision 3 stamps a vote once,
at cast time, and pulse shows the ballot first — so ungated polls collect mostly
anonymous votes. A poll carrying `min_assurance` forces verification _before_ the
vote, which is what produces accurate stamps without any retroactive rewriting.

**Also needs deciding, beyond the admin surface itself:** who may mint a link for
which community; whether a gated poll hides itself or explains what is needed;
and what happens to someone who already voted anonymously on a poll that is later
gated.

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
