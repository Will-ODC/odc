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
| A thing we want built that nobody has started   | A GitHub issue; its design detail may live here   |
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
no reads or writes into `services/` or `contracts/`, and no copy that claims a
hash chain, ledger or check pulse does not have yet (ADR-0039) — apply to every
item below without being restated in each one.

## Required reading, per session

`CLAUDE.md` → `memory/INDEX.md` → `memory/pulse.md` in full → this file (your
item at minimum) → `apps/pulse/CLAUDE.md` and `apps/pulse/API.md` before
touching the server, `apps/pulse-web/CLAUDE.md` and `.claude/skills/odc-ui`
before touching a screen, `.claude/skills/odc-testing` before writing any code
at all.

## Status vocabulary

Every item carries exactly one:

- **READY TO BUILD** — every decision it needs has been made. It may still have
  a dependency on other work; the item says so.
- **BLOCKED ON A DECISION** — somebody has to decide something first, and the
  item names what. Building it anyway means inventing the answer in code, which
  is how a product decision ends up as an implementation detail nobody knows
  was made.

A built item is deleted, not marked built: git and `memory/pulse.md` keep the
record. (P4, P4a, P4b and P7 were pruned on 2026-10-10. P2 and P8 stay while
each has an open part.)

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

## P2 — The sign-in community picker · BUILT 2026-10-09; one question left

**Built and merged** (#215, after its base #213). When an
address's domain matches two or more `allowed_domain` rows, `POST /api/sign-in`
answers 422 `choose_community` with the list, sends nothing and writes no claim;
the client asks "Which community are you signing in to?" and sends the same
request with `community`. A pick the address does not belong to is a 400
`unknown_community` at every count of matches, never quietly dropped. Zero or
one match is unchanged. The interim tie-break is **gone**: `DomainAllowlist.check`
became `memberships`, which returns every community at the most specific level
and picks none, because nothing else called it. The rules are in
`apps/pulse/API.md` under "Picking a community".

Decided already, do not re-open: that the person picks (ADR-0023), and that
`(community, domain)` stays the key.

**Open, for the operator — a later pick does not move a returning voter.** The
voter's community is written once, when their first click creates them
(ADR-0030), and redeem was left unchanged. So someone who first signed in to
`ubc-staff` and later picks `ubc-alumni` gets a link whose claim says
`ubc-alumni` and signs in still as `ubc-staff`. They are asked anyway, because
skipping the question only for addresses that have signed in before would tell
anyone which addresses have. `claim.test.ts`
`a_returning_voter_keeps_their_first_community_whatever_they_pick_later` pins
today's answer so a change is deliberate. The likely fix is redeem copying the
claim's community onto an existing voter when it differs — a one-line change,
but it reverses ADR-0030's "decided once" for this case, so it is a decision.

**Not decided, and not this item:** a person who belongs to two communities and
wants to act in both in one session. ADR-0024 point 6 says one community at a
time.

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

## P5 — Pillar 3, the path to action · UI DIRECTION SET; RECORDS AND NOTIFICATION RULES PENDING

Operator direction, 2026-10-11:

- The desktop has substantial unused space in the left and right columns around
  the main poll/questions/decisions. Improve the centre's layout and hierarchy;
  later use the surrounding columns for related polls and documented action
  outcomes from related polls (#331). Related polls use ADR-0025; Next remains
  the answer-selected graph path.
- Once a poll is closed, its final results belong in the centre, alongside any
  action planned because of it. Show subsequent action/progress and documented
  outcomes there too (#332), with evidence and distinct planned, reported and
  reviewed states. Poll closure alone does not prove action happened.
- Publishing a documented poll-linked action outcome triggers email to eligible
  people who opted in, linking back to those results and action records (#333).
  Mere closure or a plan is not the outcome-notification trigger.

Reuse the action record work (#246), contributions/claimed results (#247), and
reviewed evidence (#248), rather than introducing duplicate records. Related
poll reads and action read APIs are dependencies, not shipped features.

**Still to settle before implementation:** publishing authority and action record
rules from #246–#248; which recipients are associated with which poll; whether
existing `proofEmailsOptIn` covers these messages; consent withdrawal, opt-out
and delivery rules. The preference is collected at sign-in but no outcome mail
is sent today. Soliciting donations/volunteers and funding remain separate work;
no payments or automatic claims of impact are introduced by this UI direction.

The conversation ballot uses pick-then-Submit (ADR-0035); donations and volunteer
commitments also require confirmation.

## P6 — Poll authoring · CREATION BUILT

ADR-0037 records the operator's 2026-10-11 choices: one-week editable close,
suggestions off (#336), signed-in posting, community or General destination,
anonymous public attribution by default, optional naming, five creations per
rolling hour, and Owner/granular unlimited-posting grants. The approved purpose
statement and first-post acknowledgement ship with creation. The served
interfaces are in `apps/pulse/API.md` (PR #389).

The design, storage, HTTP and public attribution foundations are merged; see
`memory/pulse.md` for current status. The implementation slices are:

1. **Merged (#389/#387):** creation HTTP boundary and public attribution:
   authenticated context/create and owner grant/revoke,
   origin checks, bounded input, retry contract and safe public projections.
   Real HTTP with disposable Postgres, all documented error cases and privacy tests.
2. **Merged (PR #393):** creation screen and attribution: first-post promise, anonymous/named choice,
   secondary closing-time control, published conversation link, recoverable
   errors, keyboard and actual phone/desktop checks. No ballot side effects.

Each step receives fresh review (substantive fixes reviewed again), package checks,
push/PR and all required green CI before moving on. No agent approval or merge.
Use the next unused migration number from current master; never edit an applied
migration.
Do not invent authors or membership for existing data.

Reporting/review (#233–#236), duplicate warnings (#261), suggestions (#336),
photos/summary (#296), comments (#297) and browse (#259/#260) remain separate.
Broad public posting launch waits for reporting/review and the automatic-hide
threshold design. ADR-0024's hide-not-delete and automatic-hide direction remain.
Account penalties and appeals do not arrive implicitly with creation.

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
   afresh. A vote remains changeable until close; the conversation card uses
   pick-then-Submit (ADR-0035).
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
  **Answered by P8 slice 1: unchanged** (ADR-0033) — `email` is read back from
  the voter's `email` credential. What a credential-less voter is sent is P10's.
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

## P8 — Identity becomes a credential · SLICE 1 BUILT, SLICE 2 NOT BUILT

The one piece that needs no admin surface and no unwritten ADR.

**Status (2026-10-09).** Split in two, recorded in ADR-0033 (proposed, for the
operator to confirm):

- **Slice 1 — built** (branch `pulse/35-identity-is-a-credential`): the storage
  change, behaviour-preserving. Migration `004_identity_is_a_credential.sql`
  adds `voter_credential`, `voter.assurance` and `pending_claim.kind`, renames
  `pending_claim.email` to `subject`, and drops `voter.email`. The levels live
  in `src/identity/assurance.ts`. `byEmail` → `byCredential(kind, value)`,
  `liveFor(email)` → `liveFor(kind, subject)`, `VoterExistsError` →
  `CredentialTakenError`, and `create(voter, credential)` writes both or
  neither. A voter with no credential is **allowed by the model and created by
  nothing** — that is this item's answer to the P10 tension below. `/api/me`
  is unchanged. The concurrent-create and atomicity tests below are written.
- **Slice 2 — not built:** decision 5's upgrade path. A guest who verifies
  keeps their identity and gains the credential, or becomes the existing
  person; and the ballot cookie. `redeem` still mints a fresh voter
  (`randomUUID()`) and never touches the ballot cookie.

The file and line references below are as of before slice 1 and are kept as
the reasoning that scoped it; the identifiers they name have since been renamed
as listed above.

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
written atomically. `memory/pulse.md` (live cautions) records "tests that could not fail"
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

Needed by P10 for minting links and setting `min_assurance`. P6 now has its own
accepted Owner and narrow posting-grant rules (ADR-0037), implemented in internal
storage; its HTTP routes and form remain unbuilt. Those permissions do not settle
P10's broader administration policy, and P6 does not wait for this decision.

**Undecided, and all of it is "what is an admin?":** what makes someone one; how
they sign in; whether one admin acts for any community or only their own; and
whether this is a screen in `apps/pulse-web` or a separate surface. Read P6
before starting and reuse its established posting authority where applicable;
do not silently broaden those permissions to links or assurance gates.

---

## Not in this file

- **Infrastructure and deployment status.** Pulse has two Docker images and a
  Compose serving profile (`apps/pulse/docker-compose.yml`, ADR-0028), started
  with `just pulse-up`. See the app READMEs for commands and `memory/pulse.md`
  for remaining deployment prerequisites. The root `docker-compose.yml` and
  `just up` are separate ODC core scaffolding, not the Pulse runtime.
- **Anything already built.** `memory/pulse.md` is the record of what landed and
  is the only place that answers "does this exist already". Three of the
  operator's earlier requests were satisfied by work that shipped afterwards, and
  the entry says so next to each one.
