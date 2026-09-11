# ADR-0024: Pulse polls are posted by the community and navigated by computation

- **Status:** accepted
- **Date:** 2026-09-11
- **Phase:** 0

## Context

Nothing in pulse creates a poll. There is no `POST /api/polls` in
`apps/pulse/src/http/server.ts`, no admin surface, and no seed job. Polls and
their entire `next` graph are the `SEED` literal in
`apps/pulse/src/dev-server.ts` — three questions, wired to each other by hand,
in a file that refuses to start outside development. `memory/pulse.md` names
this "the gap most likely to be discovered late, because in dev it is
invisible", and that is exactly right: a developer always has three polls, and
**a deployed pulse has nothing to vote on.**

So the question is not whether authoring gets built. It is what authoring _is_,
and the operator considered two answers.

**A — authored stories.** A trusted author writes a branching run in one
sitting: the questions and the `next_poll_id` wiring together, because the
wiring only makes sense to whoever wrote the questions. Curated, high quality,
low volume. It is the closest thing to what pulse is today, and the `SEED`
literal is a hand-built instance of it.

**B — crowdsourced questions with computed navigation.** Community members post
questions. `next_poll_id` stays mostly empty. Grouping and related-polls do the
navigating, so a "story" is a sequence generated at request time rather than an
authored one. High volume, light curation.

**One fact makes these structurally different rather than a matter of taste.**
`next_poll_id` is authored **per answer** — `Poll.next` is one nullable target
per choice, position for position with `choices` — and it cannot be inferred
algorithmically. Knowing where "No" leads requires knowing what "No" _means_.
No amount of text similarity, usage signal or graph analysis recovers it,
because the fact was never in the data; it was in the author's head when they
wrote both questions. A is therefore the only model in which per-choice
branching can be the normal case, and B needs a different mechanism for getting
from one question to the next, not a cheaper version of the same one.

ADR-0021 already saw this coming. Recording why navigation was not made a
per-method hook, it says that under any of the three browsing orders the
operator described — a curated group, a relevance ranking, or random —
per-choice branching "becomes the exception rather than the rule". This ADR is
that sentence being cashed.

## Decision

### 1. Polls come to exist by being posted

**B is chosen.** Community members post questions. Poll authoring is a public,
identified action rather than an operator or editor action, and the product
grows by volume of questions rather than by curation of runs.

Two things follow directly and are part of the decision rather than
consequences of it:

- **`Poll.next` stays in the domain, the schema and the API, and stays mostly
  empty.** It is not removed, not deprecated, and not reinterpreted. It becomes
  the exception — an authored branch, available to whoever has a reason to wire
  one — and nothing a posted question has to supply.
- **Getting to a second question is computed.** Grouping and answer-independent
  related polls are how a person reaches anything after the question in front
  of them. That work is designed in the open draft PR #148 and is not
  re-decided here.

### 2. Feature requests go in `docs/plans/pulse.md`

`memory/pulse.md` open decision 4 records that pulse has nowhere to put a thing
we want to build that nobody has started: the ODC core has
`docs/plans/phase-0.md` and pulse has no equivalent, so requests accumulate in
the memory entry, which does not scale. The recorded options were a plan file,
GitHub issues, or a `memory/BACKLOG.md`. **The answer is a plan file,
`docs/plans/pulse.md`, created in this PR.**

The reasons, shortest first:

- It mirrors `docs/plans/phase-0.md`, which already exists, is already the
  answer for the other workstream, and needs no new convention explained to
  anybody.
- `memory/pulse.md` records that pulse's own docs and that memory entry are the
  **only** record of this workstream — the ODC core plan does not cover pulse
  and will not tell you it exists. An in-repo file keeps the record where a
  fresh session is already told to look. GitHub issues move half of it
  somewhere nothing in the context protocol reads.
- `memory/BACKLOG.md` would put a list everybody appends to inside `memory/`,
  which is the one directory updated **on master at merge time specifically
  because parallel agents conflict on files everyone edits**. A plan file under
  `docs/plans/` is edited on the branch that changes the work, like any other
  document.

This is recorded here rather than in its own ADR because it is the same act:
choosing B is what produces a body of unstarted follow-on work large enough to
need somewhere to live, and the consequences below are that file's first
entries. Splitting them would produce two ADRs with one Context section between
them.

### 3. What is deliberately not decided here

Three rules the operator named as open when choosing B: **what filtering a
posted question passes**, **who can post where**, and **what moderation looks
like**. They are raised in the consequences and left open. B is the decision;
the rules that make it safe are not settled by this ADR and must not be read
out of it.

## Consequences

### What B makes load-bearing

1. **Navigation stops being optional.** With `next` mostly empty, the
   related-polls and grouping work is no longer an enhancement to a run that
   already flows — it is the only way anybody reaches a second question. Draft
   PR #148 therefore moves from nice-to-have to a prerequisite of the product
   working at all. Nothing else in the codebase can carry a person from one
   question to another.

2. **A listing route is owed with it.** ADR-0021 records that there is no
   `GET /api/polls` and every route is `/api/polls/:id/...`. Under A that was
   survivable, because a run had an authored starting question — the dev client
   opens `FIRST_POLL_ID` when given no other. Under B nothing hands anyone a
   first question, so "what do I see when I arrive" is an unanswered route as
   well as an unbuilt screen.

3. **Arriving at a question you have already answered stops being rare.** Under
   A a run was a graph its author walked; under B a person is routed by
   relatedness, and #148 notes that reciprocal links can return someone to a
   question they have seen. `GET /api/polls/:id/ballot` already returns this
   browser's prior ballot, so the data is there — but nothing renders "you
   already answered this" on arrival, because until now the only way back to a
   settled question was ADR-0022's in-run "Change my answer". The common case
   is about to become the one with no UI.

### What the schema owes, and what deferring it costs

4. **`polls` needs at least two columns it does not have: the community a
   question belongs to, and who posted it.** Neither goes into the schema PR
   now open (#150) — the operator's explicit decision, and consistent with
   dropping `is_entry_point` in ADR-0023: nothing writes them yet, and a column
   nothing writes is not carried. They land in migration 002 with the authoring
   work.

   **The honest asymmetry, and it is the reason to state this rather than leave
   it implicit.** `is_entry_point` is at least derivable later, painfully, from
   an intact poll graph. **Authorship of an existing row cannot be backfilled at
   all — only defaulted.** There is no artefact anywhere in pulse from which the
   author of a poll created before migration 002 could be recovered, because the
   fact was never captured. Any poll created before that migration has no
   recoverable author, permanently. That is the price of deferring, it is
   accepted, and the mitigation is simply that the window is short: it runs from
   the first poll written to a real database until migration 002, and nothing
   but the dev seed writes polls today.

   Community is the gentler half: while exactly one community exists, defaulting
   every existing poll to it is exact rather than a guess. That stops being true
   the moment a second community is admitted, which is one `allowed_domain`
   insert away.

5. **Removing a question is a cascade today, not a state.** `001_initial.sql`
   gives `poll_choice`, `vote`, `vote_choice` and `suggestion` all
   `on delete cascade` from `polls`. Deleting a posted question therefore
   destroys every vote cast on it. Any moderation that can remove a question
   needs a removed/hidden **state** and a read path that respects it — another
   column migration 002 owes — not a `delete`. Note also that #148's proposed
   `poll_related_poll` uses `on delete restrict`, which would refuse the delete
   outright rather than silently taking the votes with it; the two behaviours
   need reconciling in whichever PR lands second.

6. **Poll ids must be minted by the server.** `NewPoll.id` is a caller-supplied
   non-empty string and `polls.id` is `text primary key`; the seed supplies
   readable slugs like `ads-free`, and `createPoll` throws on a duplicate id.
   That is fine for a literal written by one person and wrong for a public
   endpoint, where a supplied id is a collision and a name-squatting surface at
   once. Authoring generates the id; whether a readable slug is derived beside
   it for URLs is a separate, smaller question.

7. **There is no `community` table.** Community is a plain `text` column on
   `voter`, `pending_claim` and `allowed_domain`, and `allowed_domain`'s primary
   key is the pair `(community, domain)`, so there is nothing for a
   `polls.community` foreign key to reference. Migration 002 either adds a
   fourth unconstrained text column or promotes community to a real table with a
   key. That is a decision, not a detail, and it is better made when the column
   lands than discovered by a typo'd community name that admits nobody.

### What identity owes

8. **Posting requires being signed in; voting does not.** PR #128 established
   that a vote counts before anyone signs in — a vote is filed under the
   `pulse_ballot` cookie and nothing else, and `API.md` states that signing in
   afterwards verifies a person and is never how their vote is found. Under B
   that asymmetry stops being an artefact and becomes deliberate and
   load-bearing: **vote anonymously, post identified.** Moderation needs
   somebody to attribute a removed question to, and per-person rate limiting
   needs a person; neither can be built on a cookie a browser mints for itself.

   Mechanically this is a first: `requireVoter` exists and today guards only
   `GET /api/me`. `POST /api/polls` would be **the first route in pulse that
   requires a session in order to write anything.**

9. **Which community someone posts into follows from ADR-0023's sign-in
   picker.** A domain may serve several communities, and ADR-0023's answer is
   that the person picks at sign-in. That pick is what decides where they can
   post. The picker is unbuilt and unticketed, and nothing in the client signs
   anyone in at all — so this is a **dependency of poll authoring, not a detail
   of it.** Until it exists, the interim tie-break in
   `apps/pulse/src/identity/allowlist.ts` would silently decide which community
   a person's question lands in, by the alphabet. That is an acceptable answer
   for which community admits you and a bad one for where your question is
   published.

10. **Reading is not community-scoped, and under 8 it cannot easily become so.**
    Once a poll belongs to a community, every listing and related-polls query
    has a community in its `where` clause — but the visitor casting a vote has
    no community, because they have no identity beyond a ballot cookie. So
    either polls are world-readable and community scopes only _posting_, or
    browsing requires a sign-in and the anonymous vote loses the screen it was
    cast from. **Open question, raised not settled.** It is the first place
    where "vote anonymously, post identified" costs something rather than only
    buying something.

### Quality, volume, and the things nobody owns yet

11. **Duplicate questions become the main quality problem, and pulse already has
    machinery pointed at it.** `apps/pulse/src/voting/suggestions.ts` has
    `keywords()` and `overlap()` with `SAME_IDEA = 0.6` and `RELATED = 0.3`,
    built for exactly this shape of problem: two people saying the same thing in
    different words are counted as agreeing, and told so. Whether that is reused
    for questions, or duplicates are simply allowed and merged later, is an
    **open question and is not settled here.**

    Two things to know before reusing it, so the reuse is decided rather than
    assumed. First, **it does not scale as written**: `submit` scores a new text
    against every existing suggestion on one poll, which is a short in-memory
    array; scoring a new question against every question in a community is a
    full scan per post, and wants a trigram or `tsvector` index rather than a
    loop. Second, **the thresholds were tuned against suggestions, not
    questions** — `MAX_SUGGESTION_LENGTH` is 120 and the `NOISE` list strips
    "should", "could", "we", which are load-bearing words in an interrogative.
    The constants may well be right; what they are not is evidence.

12. **`createPoll`'s validation is syntactic, and is not a quality floor.** It
    requires a non-empty id, a non-empty question, a known method, 2–25 distinct
    non-empty choices, and a `next` array matching the choices in length. Every
    one of those is a shape check. It cannot tell a real question from noise, an
    insult, or the same question asked yesterday, and it was never meant to —
    the comment on it says it rejects "shapes the UI could not render or a voter
    could not answer meaningfully". Whatever filtering B needs is new code, not a
    tightening of this function.

13. **Rate limiting needs a shared store, and needs to be keyed on the person.**
    `@fastify/rate-limit` is registered with `{ global: false }` and defaults to
    an in-memory store — correct for one process, useless across several, and
    ADR-0020 chose Postgres precisely because the operator expects many
    processes. The default key is also the client address, which is the wrong
    key for an identified action: posting is limited per voter, or one person
    behind a shared address limits a campus. Both halves land with authoring.

14. **No moderator role exists anywhere in pulse.** There is no role column, no
    admin route, no permission check of any kind — `requireVoter` answers "is
    somebody signed in", never "who". So moderation is not a feature to switch
    on; it is a concept the codebase has never had. The fork, raised and **not
    settled here**: post-moderation needs someone who can remove a question and
    the removed state from consequence 5, and leaves bad questions visible until
    they act; pre-moderation needs a queue, someone to work it, and kills the
    volume that is B's entire point. Whoever settles it should also settle what
    a removed question does to the votes already cast on it, which consequence 5
    makes a real choice rather than a side effect.

15. **A posted question has fields nobody has decided who fills.** `closesAt`
    and `acceptsSuggestions` are both properties of a poll, and the seed sets
    them by hand — three days, and suggestions on for the two follow-ups. Under
    B either the poster is asked, which is two more fields on a form meant to be
    fast, or the system defaults them, and those defaults become product policy
    about how long a community question stays open. Smaller than the rest of this
    list, and easy to ship by accident.

16. **The swipe ballot has two sides.** Screen 1 is a left/right swipe, and the
    seed's own comment says a third choice "would have no side to land on", while
    `createPoll` permits up to 25. Posting is the first path by which a stranger
    chooses how many choices a question has, so authoring has to either route
    anything but a two-choice question to `ChoiceBallot`, or constrain what can
    be posted. The client already has both ballots; what it does not have is
    anything that picks between them at authoring time.

### What B makes cheaper, and one thing it makes worse

17. **Approval plus branching stops mattering.** ADR-0021 flags that
    `poll.next[chosen]` assumes exactly one choice was picked, which is already
    ambiguous for `approval` — a shipped method — and latent only because no
    seeded approval poll branches. ADR-0021 resolves it by rule (highest value
    steers, ties to the lowest position), which is arbitrary but deterministic.
    **Under B that arbitrary rule is rarely exercised**, because `next` is the
    exception rather than the mechanism, so the ambiguity never gets the chance
    to become a visible product behaviour people rely on. That is a point in B's
    favour and worth saying out loud: A would have made an arbitrary tie-break
    into a load-bearing navigation rule.

18. **B has a cold start that A did not.** An authored story ships with its
    questions; a crowdsourced one starts empty, and a brand-new community's
    first visitor sees nothing to vote on until somebody posts. A had the same
    problem for the first author and no one else. This does not change the
    decision, and the dev `SEED` does not solve it — that literal stays a
    development fixture, and ADR-0021 already records that it must become
    idempotent before storage lands, because `createPoll` throws on a duplicate
    id and `dev-server.ts` loops the seed through it on every boot.

### Documents reconciled

- **`docs/decisions/0021-poll-choices-and-vote-values.md`** — its consequences
  predict this decision ("per-choice branching becomes the exception rather than
  the rule") and record that ordering is a query rather than stored data, that
  there is no `GET /api/polls`, and the naming hazard around _ballot_ / _run_ /
  _agenda_. **Nothing in it is contradicted or superseded; this ADR cashes a
  prediction it made.** Checked, no change needed.
- **`docs/decisions/0023-pulse-ships-without-is-entry-point-and-lets-a-domain-serve-several-communities.md`**
  — this ADR depends on it twice. Its community picker is a prerequisite of
  posting (consequence 9), and its reasoning for dropping `is_entry_point` — do
  not carry a column nothing writes — is the precedent for keeping community and
  author out of #150 (consequence 4). **Consistent; no edit needed.** Note that
  ADR-0023's own first argument, that there is no authoring surface to write
  `is_entry_point` from, is the thing this ADR starts to undo: whoever builds
  authoring should re-read that ADR and decide whether an entry-point column is
  wanted after all, which under B it probably is not, since no run has an
  authored start.
- **`apps/pulse/API.md`** — describes only what the server speaks today, and
  this ADR adds no route and changes no response. `POST /api/polls` is not
  documented here, deliberately: it does not exist, and API.md's first line is a
  promise that everything in it does. **Checked, no change needed.** The PR that
  builds authoring updates it in the same change.
- **`apps/pulse/CLAUDE.md`** — says domain allowlists are rows rather than code,
  and that pillar 2 is a guided story. B keeps the first exactly and re-reads
  the second: a story becomes a generated sequence rather than an authored run,
  which is a change in how the sequence is produced, not in what a person sees.
  **Checked, no change needed**, and worth re-checking when the subject browser
  lands, because that is the change a reader would feel.
- **`apps/pulse/migrations/001_initial.sql`** — ships without the two columns of
  consequence 4, which this ADR confirms as intended rather than as an omission.
  **Checked, deliberately unchanged**: adding them here would put columns
  nothing writes into the first migration, which is the mistake ADR-0023 exists
  to avoid.
- **`apps/pulse/src/voting/poll.ts`** and **`apps/pulse/src/dev-server.ts`** —
  unchanged. `Poll.next` keeps its meaning and the `SEED` literal keeps its job;
  this is a documents-only change and nothing about how polls are created today
  moves until authoring is built.
- **`docs/plans/pulse.md`** — **created in this PR** by decision 2, and seeded
  with the unstarted work already recorded in `memory/pulse.md`.
- **`memory/pulse.md`** — open decision 4 is settled by decision 2; the three
  operator requests it carries move into the plan file; the "poll creation,
  which has no home at all" item under the infrastructure list is what this ADR
  answers. **Not updated in this PR, deliberately:** memory entries are updated
  on master at merge time, never on a feature branch, per the merge checklist in
  `.claude/skills/odc-pipeline`. Owed at merge, and it is the larger-than-usual
  memory edit — an open decision closes, a section moves out, and the line in
  `memory/INDEX.md` should gain the plan file.
- **Open draft PR #148** — proposes an ADR numbered **0023**
  (`docs/decisions/0023-related-polls-are-answer-independent.md`) for
  answer-independent related polls. **0023 is taken** by the decision above,
  which is on the branch this file sits on. Its content is unaffected and is
  depended on by consequence 1; only the number collides. Not renumbered here —
  it is somebody else's branch — and the recommendation is in the report that
  accompanies this change.
- **`docs/charter.md` and `contracts/`** — pulse is charter-exempt and this ADR
  shares nothing with either. **Checked, no change needed.**

## Charter check

**Pulse is charter-exempt** by the operator decision recorded in
`apps/pulse/CLAUDE.md` and routed by `memory/INDEX.md`, so P1–P4 are not the
standard applied here and claiming otherwise would misrepresent the workstream.
The section is kept because the template requires it and because the two
boundaries that survive the exemption are real. Both are checked, and this ADR
touches the second more closely than most.

- **"No reads or writes across into `services/` or `contracts/`."** Honoured.
  Every consequence above is about pulse's own tables, pulse's own routes and
  pulse's own membership check. Note specifically that crowdsourced authoring is
  **not** a step toward publishing to the ODC ledger: a posted pulse poll is a
  mutable row in pulse's own database, deletable and editable, and nothing here
  proposes a pipe to `services/`. If pulse ever publishes, it does so through
  the ledger's public HTTP API, and this ADR must never be cited as having
  started that.
- **"The counting is never the subject."** Honoured, and it constrains the work
  this ADR makes visible. Posting a question, browsing related questions and
  moderating one are all things a person does with a question — none of them may
  be explained to anybody in terms of how a tally is computed. In particular,
  the duplicate detection of consequence 11 must never tell a person their
  question was folded together with another **because of an overlap score**; the
  suggestion flow already gets this right, saying someone had said it and naming
  their wording, and question posting inherits that standard rather than
  inventing its own.
