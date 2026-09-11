# ADR-0024: Pulse polls are posted by the community and navigated by computation

- **Status:** accepted
- **Date:** 2026-09-11
- **Phase:** 0
- **Amends:** ADR-0021's `polls` column list, additively — three columns land in
  migration 002, and `community` becomes a table the schema does not yet have

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

### 3. The rules B needs, settled by the operator 2026-09-11

B was chosen before the rules that make it safe were written. The operator has
now settled them. Each is stated with the reasoning that produced it, because
each is the kind of rule a later reader will otherwise re-derive from first
principles and get differently.

#### 3a. Duplicate questions are found with Postgres full-text search, and the result is a warning, never a refusal

The obvious move was to reuse the matcher pulse already has. **It is not
reused**, and the reason is a measurement rather than a preference. The operator
ran three approaches against the live database:

| Pair                                                           | `suggestions.ts` `overlap()` | `pg_trgm` |
| -------------------------------------------------------------- | ---------------------------- | --------- |
| "Should we allow ads?" · "Do we want advertising on the site?" | **0.00**                     | **0.13**  |
| "we could charge members" · "charge the members"               | 1.00                         | 0.56      |

**No word-matching method catches a genuine synonym.** The first pair is the
same question asked twice and every method scores it near zero; the second pair
is the same sentence rearranged and every method finds it. Postgres full-text
search does close one real gap the current code has — it equates word forms,
`advertising` with `advertise` and `members` with `member`, both verified — so
it is strictly better than the hand-rolled matcher, and unlike a similarity loop
it is **indexable**. That answers the scale objection below: scoring a new
question against every existing row was a full scan per post.

What full-text closes is the **inflection** gap, not the **synonym** gap. "Ads"
and "advertising" do not stem to the same token, and no amount of configuration
makes them. **That is precisely why the result is a hint and not a gate.** A
check that misses real synonyms would turn people away for the duplicates it
happens to catch while letting the ones it misses straight through — the worst
of both, and the cost lands on the person who was trying to contribute. So the
poster is shown what looks similar and may post anyway.

**`suggestions.ts` is not reused for questions**, and the reasons are worth
recording so nobody tries again:

- Its `NOISE` list strips "should", "could" and "we", which carry no meaning in
  a proposal and are load-bearing in an interrogative.
- Its thresholds (`SAME_IDEA = 0.6`, `RELATED = 0.3`) were tuned against
  suggestions of at most 120 characters. They may be right for questions; what
  they are not is evidence.
- It scores against every existing row in a loop, which is a short in-memory
  array per poll and a full scan across a community's questions.

**This decides nothing about suggestions.** They keep their existing matcher,
their thresholds and their `on_ballot` behaviour, all of which are tuned for
what they do and are not in question here.

#### 3b. Removal hides; it never deletes

A removed question gets a `hidden`/`removed` flag in migration 002. Its votes,
choices and suggestions survive untouched.

This is what the schema does **not** currently do: `001_initial.sql` gives
`poll_choice`, `vote`, `vote_choice` and `suggestion` all `on delete cascade`
from `polls`, so a `delete from polls` destroys every vote cast on the question.
Under B, removal is a moderation action taken by a person who can be wrong, and
**a moderator's mistake must not be unrecoverable.** Hiding is reversible;
deleting is not.

Decision 3h gives this a second, independent reason: a question that produced a
real action has to keep that record even after it comes down.

**Reconciling with draft PR #148:** its proposed `poll_related_poll` uses
`on delete restrict`, which refuses the delete rather than taking the votes with
it. Under "hide, never delete" the two never disagree, because no delete is
issued — but `restrict` is the posture that matches this decision, and the four
`cascade` rules in 001 are now the odd ones out. See the migration-002 list
below for the recommendation and its cost.

#### 3c. Moderation is community flagging with auto-hide at a threshold, plus manual removal

Flagging scales without a moderator role, which is what makes it fit B: the
volume that crowdsourcing produces is exactly the volume a queue cannot absorb.
Enough flags on a question hides it automatically.

**Manual removal exists as well**, so a minimal operator/moderator capability is
needed after all — pulse has no role of any kind today, and this is the decision
that creates one. Both paths hide rather than delete, per 3b.

Two values are **deliberately not set here**: the auto-hide threshold, and who
exactly holds manual removal. See §5.

#### 3d. You post to your community; anybody may read

Community scopes **contribution, not visibility**. A signed-out visitor can
browse and vote, and the anonymous vote keeps the screen it was cast from.

This is the answer to the question 3 raised against itself: once a poll belongs
to a community, every listing query has a community in it, but the person
reading has no community until they sign in. Scoping reads would have meant
either a sign-in wall in front of browsing or an anonymous vote with nowhere to
happen. Neither is worth it, and neither was ever how voting worked — a vote has
counted before sign-in since PR #128.

#### 3e. `community` becomes a real table

Keyed, with `polls.community`, `voter.community`, `pending_claim.community` and
`allowed_domain.community` all referencing it. No fourth unconstrained text
column.

Community is plain `text` in three tables today, referencing nothing, so a
typo'd community name is a community that admits nobody and a question nobody
finds. A key makes that a foreign-key violation at the point of the mistake.

#### 3f. There is no upfront quality floor

`createPoll`'s mechanical checks stay exactly as they are — a non-empty
question, a known method, 2–25 distinct non-empty choices, a `next` array
matching the choices in length. Nothing is added in front of posting to judge
whether a question is any good. Flagging (3c) handles junk after the fact.

This is the same posture as 3a and for the same reason: a filter that cannot
tell a real question from noise refuses real questions, and the person it
refuses is the contributor the product needs.

#### 3g. `closesAt` and `acceptsSuggestions` are defaulted, and the defaults are editable

Both are shown with their default value and can be changed behind a **secondary
control**, so posting stays one fast screen for the person who does not care and
stays configurable for the person who does.

**The default values themselves are not chosen** — see §5. They become product
policy the moment they are picked: a default close time decides how long a
community question stays open, and a default for `acceptsSuggestions` decides
whether crowdsourced questions gather free text by default.

#### 3h. Questions that lead to action feed a newsletter

Pillar 3 gains its first concrete shape. Questions that result in real action
feed an **email newsletter**, whose distinctive job is telling people **what
happened as a result of their votes** — not "here is a new question" but "here
is what your vote did".

This sharpens `proofEmailsOptIn`, collected at sign-in and currently leading
nowhere, from a one-off proof email into a recurring digest.

Cadence, who is included, and what counts as "an action" are open — see §5.

> **This subsection is the operator's words summarised rather than quoted, and
> it is new product information rather than a reconciliation of something
> already written down. If the reading is wrong, this is the paragraph to
> correct.**

### 4. Two things settled by the code, not by the operator

Recorded here so authoring does not stop to ask, and marked plainly so nobody
cites them as operator decisions.

- **Poll ids are minted by the server.** `NewPoll.id` is caller-supplied and
  `polls.id` is `text primary key`; the seed supplies readable slugs like
  `ads-free`, and `createPoll` throws on a duplicate. On a public endpoint a
  caller-supplied id is a collision and a name-squatting surface at once. The
  column stays `text` — #148's design explicitly does not assume UUIDs — so this
  is a generated value written into the existing type, not a type change.
- **A posted question with three or more choices routes to `ChoiceBallot`.**
  Only the swipe ballot is two-sided; `ChoiceBallot.tsx` already exists and
  already renders the general case. `createPoll` permits up to 25 choices and
  needs no change. This is not a blocker and should not be rediscovered as one.

### 5. What genuinely remains open

Everything above is settled. These are not, and none of them is settled by
implication:

1. **The auto-hide flag threshold** (3c). Left open by the operator.
2. **Who holds manual removal** (3c). Left open by the operator. Pulse has no
   role of any kind today, so this is "what is the smallest capability that
   works", not "which existing role gets a permission".
3. **Cadence, audience, and what counts as "an action"** for the newsletter
   (3h). Left open by the operator.
4. **The default values** for `closesAt` and `acceptsSuggestions` (3g).
5. **Who may flag** — raised here, not by the operator, and pointed at by 3d.
   Flagging by ballot cookie is anonymous and trivially gameable; flagging by
   signed-in voter is not, but 3d puts most readers outside any community. The
   threshold in 1 is meaningless until this is answered, because it counts
   something whose identity is undefined.
6. **Whether flagging reaches suggestions.** 3c decides moderation for
   questions. Suggestions are also public free text, also posted by anybody, and
   have no moderation at all — `submit` folds near-duplicates and refuses
   nothing else. Not a gap this ADR creates; one it makes visible.
7. **The full-text language configuration** (3a). `to_tsvector` takes a
   configuration — `'english'` — and a generated column pins it for every
   community the deployment ever serves.
8. **Whether `proofEmailsOptIn` consent covers a newsletter** (3h). See
   consequence 14; this needs a decision before the first digest is sent, not
   before the work starts.

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
   well as an unbuilt screen. Per 3d it takes no session and no community.

3. **Arriving at a question you have already answered stops being rare.** Under
   A a run was a graph its author walked; under B a person is routed by
   relatedness, and #148 notes that reciprocal links can return someone to a
   question they have seen. `GET /api/polls/:id/ballot` already returns this
   browser's prior ballot, so the data is there — but nothing renders "you
   already answered this" on arrival, because until now the only way back to a
   settled question was ADR-0022's in-run "Change my answer". The common case is
   about to become the one with no UI.

### What identity and community owe

4. **Posting requires being signed in; voting does not.** PR #128 established
   that a vote counts before anyone signs in — a vote is filed under the
   `pulse_ballot` cookie and nothing else. Under B that asymmetry becomes
   deliberate and load-bearing: **vote anonymously, post identified.**
   Moderation needs somebody to attribute a removed question to, and per-person
   rate limiting needs a person; neither can be built on a cookie a browser
   mints for itself. 3d completes the shape — read anonymously too.

   Mechanically this is a first: `requireVoter` exists and today guards only
   `GET /api/me`. `POST /api/polls` would be **the first route in pulse that
   requires a session in order to write anything.**

5. **Which community someone posts into follows from ADR-0023's sign-in
   picker**, and the picker has a constraint nobody has written down. ADR-0023's
   answer is that the person picks at sign-in. But `ClaimService.requestLink`
   resolves membership and writes `community` into the `PendingClaim` **when the
   link is requested**, and `pending_claim.community` is `not null` — so the
   community is fixed before the email is sent, not when the link is clicked.
   The picker therefore either happens on the sign-in screen, before the link
   goes out, which needs the client to learn which communities an address
   matches; or `pending_claim.community` becomes nullable and the pick moves to
   redemption. **That is a real fork and it is cheaper to decide than to
   discover.** Until the picker exists, the interim alphabetical tie-break in
   `apps/pulse/src/identity/allowlist.ts` silently decides which community a
   person's question is published into — tolerable for which community admits
   you, bad for where your words appear.

6. **A person belongs to one community at a time, and B does not change that.**
   `voter.community` is singular and 3e keys it. Someone whose address matches
   two communities picks one per sign-in, so "post to your community" means the
   one they picked. Acting in both in one session is not supported and is not
   decided here.

### What the schema owes, and what deferring it costs

7. **`polls` needs three columns it does not have: the community, the author,
   and the hidden flag.** None goes into the schema PR now open (#150) — the
   operator's decision, and consistent with dropping `is_entry_point` in
   ADR-0023: nothing writes them yet, and a column nothing writes is not
   carried. They land in migration 002 with the authoring work.

   **The honest asymmetry.** `is_entry_point` is at least derivable later,
   painfully, from an intact poll graph. **Authorship of an existing row cannot
   be backfilled at all — only defaulted.** No artefact anywhere in pulse
   records who wrote a poll, so any poll created before migration 002 has no
   recoverable author, permanently. That is the price of deferring, it is
   accepted, and the mitigation is that the window is short: it runs from the
   first poll written to a real database until migration 002, and nothing but
   the dev seed writes polls today.

   Community is the gentler half, and 3e makes it gentler still: while exactly
   one community exists, defaulting every existing poll to it is exact rather
   than a guess.

8. **Migration 002 rewrites three shipped columns, which is more than adding
   two.** 3e means `voter.community`, `pending_claim.community` and
   `allowed_domain.community` all gain a foreign key, and a `community` table
   has to be **backfilled from the distinct values already in them** before
   those keys can be added. Forward-only numbering makes that fine; what it is
   not is a purely additive migration, and it is the reason the full list below
   is worth writing down in one place.

9. **The `on delete cascade` rules in 001 are now the odd ones out.** Under 3b
   nothing deletes a poll, so they should never fire — but they are still there,
   and `delete from polls` still destroys votes. Changing them to `restrict`
   makes the schema enforce the decision rather than trusting the code to honour
   it, and matches #148's `poll_related_poll`. The cost is that a genuine
   cleanup — a dev reset, a test teardown — then has to delete children first.
   Recommended, not decided.

10. **Migration 002 will trip `test/migrations.test.ts`, and that is the guard
    working.** The test asserts the **set** of column defaults in the migration
    SQL is exactly `'{}'::jsonb` and `1`. A `hidden boolean not null default
false` adds a third, so the test fails until `false` is added to `DEFAULTS`
    **deliberately** — which is what that list is for. Note it reads the SQL
    text, so `add column … default false` followed by `drop default` still trips
    it. The same file's `timestamptz(3)` and `\btimestamp\b` guards apply to
    every timestamp 002 adds.

11. **What migration 002 owes, in one list.** Assembled here because it is now
    large enough that discovering it piecemeal is how half of it gets missed:

    1. A `community` table, keyed, backfilled from the distinct values in
       `voter`, `pending_claim` and `allowed_domain`.
    2. Foreign keys from those three columns to it.
    3. `polls.community`, not null, keyed to the same table.
    4. `polls.created_by`, keyed to `voter.id`, **nullable** — pre-migration
       rows have no author and never will (consequence 7).
    5. `polls.hidden` (or `removed_at`), plus the `DEFAULTS` update in
       `test/migrations.test.ts` (consequence 10).
    6. A full-text index on the question — a generated `tsvector` column and a
       GIN index — and with it the language configuration of open question 7.
    7. A `flag` table: who flagged which poll, when, at most once each. Needed
       by 3c, and its "who" is open question 5.
    8. Optionally the `cascade` → `restrict` change of consequence 9.
    9. **A number that does not collide with #148.** The runner refuses a file
       that has never run but numbers below one that has, so authoring and
       related polls cannot both be `002` and cannot land in either order by
       accident. Whichever lands second renumbers before it merges.

12. **Poll ids must be minted by the server** (decision 4). Authoring generates
    the id; whether a readable slug is derived beside it for URLs is a separate,
    smaller question.

### Quality, volume, and the things that now have owners

13. **Rate limiting needs a shared store, and needs to be keyed on the person.**
    `@fastify/rate-limit` is registered with `{ global: false }` and defaults to
    an in-memory store — correct for one process, useless across several, and
    ADR-0020 chose Postgres precisely because the operator expects many
    processes. The default key is also the client address, which is the wrong
    key for an identified action: posting is limited per voter, or one person
    behind a shared address limits a campus. Both halves land with authoring.
    **This is the one place a hard limit survives 3a and 3f's warn-don't-block
    posture** — a rate limit is not a judgement about quality, so it may refuse.

14. **The newsletter reopens what `proofEmailsOptIn` consented to.** The flag is
    strictly opt-in — the route reads `body.proofEmailsOptIn === true` — and both
    `API.md` and the sign-in screen describe it as hearing what came of a vote.
    A recurring digest is a broader thing than a one-off proof email, and
    repurposing an existing opt-in into a subscription without changing the
    words is the kind of consent drift that is easy to do and unpleasant to
    undo. Either the copy changes before the first send, or the newsletter gets
    its own opt-in. Open question 8.

    Note also a pre-existing discrepancy this surfaces, which is **not** created
    by this ADR: `apps/pulse/CLAUDE.md` describes pillar 3 as emailing proof
    "unless the person opted out", while the code and `API.md` are opt-**in** and
    default to false. The code is the honest one. Flagged under Documents
    reconciled.

15. **The newsletter cannot be built before a `Mailer` exists.** No provider
    implementation exists anywhere in pulse; `ConsoleMailer` prints to a
    terminal. Pillar 3's digest is therefore blocked on the same missing piece
    that stops anybody outside a terminal signing in.

16. **Duplicate detection is a read path with a latency budget.** Full-text plus
    a GIN index makes the check indexable, but it still runs inside the posting
    request, against a community's whole question set, to render a warning the
    poster may ignore. It is a hint: if it is slow or unavailable, the post must
    still go through. Building it as a gate-shaped call that happens to be
    advisory is how it silently becomes a gate.

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
  _agenda_. None of that is contradicted. **Its four-table sketch is amended
  additively**: `polls` gains community, author and hidden in migration 002, and
  `community` becomes a table its sketch does not have. Following ADR-0023's
  precedent, ADR-0021 is **not edited** — ADRs here are a dated record, not a
  living spec, and the header of this file names what it amends.
- **`docs/decisions/0023-pulse-ships-without-is-entry-point-and-lets-a-domain-serve-several-communities.md`**
  — depended on twice: its community picker is a prerequisite of posting
  (consequence 5), and its reasoning for dropping `is_entry_point` is the
  precedent for keeping the three new columns out of #150 (consequence 7).
  **Consistent; no edit needed.** Two notes for whoever builds authoring. Its
  first argument — that there is no authoring surface to write `is_entry_point`
  from — is the thing this ADR starts to undo, and the column should be
  re-decided rather than re-added by default; under B it is probably still not
  wanted, since no run has an authored start. And its `(community, domain)` key
  is unaffected by 3e: keying the community column does not make a domain serve
  one community.
- **`apps/pulse/migrations/001_initial.sql`** — ships without the three columns
  of consequence 7 and with community as plain text, both of which this ADR
  confirms as intended rather than as omissions. **Checked, deliberately
  unchanged.** Migration 002 is where 3b, 3e and 3a land; see consequence 11.
- **`apps/pulse/test/migrations.test.ts`** — its `DEFAULTS` guard will fail on
  migration 002's `hidden` column, by design. **Not changed here** — it changes
  in the migration's own PR, where adding to that list is the deliberate act the
  guard exists to force. Checked, no change needed now.
- **`apps/pulse/API.md`** — describes only what the server speaks today, and
  this ADR adds no route and changes no response. `POST /api/polls` is not
  documented here, deliberately: it does not exist, and API.md's first line is a
  promise that everything in it does. Its description of `proofEmailsOptIn` as
  "the opt-in for hearing what came of a vote" is **still exactly true today**
  and is what consequence 14 says must be revisited before the first digest.
  **Checked, no change needed.**
- **`apps/pulse/CLAUDE.md`** — two things. Pillar 2's "guided story" is re-read
  rather than changed: a story becomes a generated sequence rather than an
  authored run, which changes how the sequence is produced, not what a person
  sees. And pillar 3 says pulse "emails proof of what happened **unless the
  person opted out**", while the code is opt-**in** and defaults to false — a
  pre-existing discrepancy this ADR surfaces rather than creates. **Not changed
  here**, because correcting a pillar description is a documents change of its
  own and this PR owns two files; it is recorded in consequence 14 and belongs
  to whoever builds pillar 3.
- **`apps/pulse/src/identity/claim.ts`** — fixes `community` at link-request
  time and is what makes consequence 5's fork real. **Unchanged**; named so the
  picker's builder finds it before designing around the wrong assumption.
- **`apps/pulse/src/voting/poll.ts`**, **`apps/pulse/src/voting/suggestions.ts`**
  and **`apps/pulse/src/dev-server.ts`** — unchanged. `Poll.next` keeps its
  meaning, `createPoll` keeps exactly the checks it has (3f), the suggestion
  matcher keeps its thresholds and its job (3a), and the `SEED` literal keeps
  being a development fixture. This is a documents-only change.
- **`docs/plans/pulse.md`** — **created in this PR** by decision 2, and seeded
  with the unstarted work already recorded in `memory/pulse.md`.
- **`memory/pulse.md`** — open decision 4 is settled by decision 2; the operator
  requests it carries move into the plan file; its "poll creation, which has no
  home at all" item is what this ADR answers. **Not updated in this PR,
  deliberately:** memory entries are updated on master at merge time, never on a
  feature branch, per the merge checklist in `.claude/skills/odc-pipeline`. Owed
  at merge, and it is a larger-than-usual edit — an open decision closes, a
  section moves out, `memory/INDEX.md` should gain the plan file, and **two
  entries are already stale against master**: #149 landed the sign-in and redeem
  screens, so "nothing in the client signs anyone in" is no longer true, and
  #150 fixed the `database.test.ts` skip bug.
- **Open draft PR #148** — proposes an ADR numbered **0023**
  (`docs/decisions/0023-related-polls-are-answer-independent.md`) for
  answer-independent related polls. **0023 is taken** by the decision on the
  branch this file sits on, and 0024 by this one. Its content is unaffected and
  is depended on by consequence 1; only the number collides, and its migration
  number now collides too (consequence 11, item 9). Not renumbered here — it is
  somebody else's branch.
- **`docs/charter.md` and `contracts/`** — pulse is charter-exempt and this ADR
  shares nothing with either. **Checked, no change needed.**

## Charter check

**Pulse is charter-exempt** by the operator decision recorded in
`apps/pulse/CLAUDE.md` and routed by `memory/INDEX.md`, so P1–P4 are not the
standard applied here and claiming otherwise would misrepresent the workstream.
The section is kept because the template requires it and because the two
boundaries that survive the exemption are real. Both are checked, and the
decisions in §3 touch the second more closely than most.

- **"No reads or writes across into `services/` or `contracts/`."** Honoured.
  Every decision and consequence above is about pulse's own tables, pulse's own
  routes and pulse's own membership check. Note specifically that crowdsourced
  authoring is **not** a step toward publishing to the ODC ledger: a posted
  pulse poll is a mutable row in pulse's own database, hideable and editable,
  and nothing here proposes a pipe to `services/`. Note also that 3b's "hide,
  never delete" is **not** append-only discipline arriving by the back door — it
  is a moderation-reversibility rule on a mutable table, and it must never be
  cited as precedent for event storage.
- **"The counting is never the subject."** Honoured, and it constrains the work
  this ADR makes visible. Posting a question, browsing related questions,
  flagging one and reading the newsletter are all things a person does with a
  question — none may be explained in terms of how a tally is computed. Three
  specifics, because each is a place the wrong copy is the natural copy:
  - The duplicate warning of 3a says a question looks like another one and shows
    it. It never shows a **score**, and never explains why the two matched.
  - The auto-hide of 3c tells somebody their question is no longer visible. It
    does not publish a flag count, which is both a number about the machinery
    and an invitation to brigade.
  - The newsletter of 3h says what happened as a result of people's votes. That
    is the one thing it is for, and it is a statement about an outcome, never
    about a tally's arithmetic.
