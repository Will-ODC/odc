# ADR-0021: A pulse poll models every vote method as (choice, value) pairs

- **Status:** accepted
- **Date:** 2026-09-02
- **Phase:** 0

## Context

Pulse serves two vote methods, `single` and `approval`, and a ballot on the wire
is an **array of choice indices** for both (`apps/pulse/API.md`). `Ballot =
number[]` was chosen in PR #94 specifically so that `ranked` could be added
later without changing any shape.

Designing the Postgres schema (ADR-0020) forced the question the array shape had
deferred: **a vote records a choice's _position_.** That has two consequences
already visible in the code. `memory/pulse.md` records PR #127's reasoning that
`Poll.choices` "can never grow to absorb" a suggestion, because growing the array
would move positions out from under existing votes. And `Poll.next` is a second
array kept position-for-position with `choices`, indexed in the client as
`poll.next[chosen]` — a **single** chosen value, in both `SwipeBallot.tsx` and
`ChoiceBallot.tsx`.

The operator asked for the poll/option model to support an arbitrary number of
vote types, called this critical even for MVP, and asked that it stay as simple
as possible.

The organising principle adopted: **put extensibility where change is expensive.**
A schema is expensive to change; a derived type is cheap. That is the whole
reason this ADR reaches as far as it does into storage and no further.

## Decision

**Every vote method is stored as a set of `(choice, value)` pairs.** The
methods worth supporting all reduce to that one shape, and only their constraint
and their tally differ:

| Method                         | Pairs | `value` means | Constraint                |
| ------------------------------ | ----- | ------------- | ------------------------- |
| single                         | 1     | 1             | exactly one               |
| approval                       | k     | 1             | k >= 1, distinct          |
| ranked (IRV, Borda, Condorcet) | k     | rank position | ranks distinct            |
| score, range, STAR             | k     | the score     | 0 <= value <= max         |
| cumulative                     | k     | points given  | sum = budget              |
| quadratic                      | k     | votes bought  | sum of squares <= credits |
| budget allocation              | k     | scaled amount | sum = total               |

Four tables:

```
polls        (id, question, method TEXT, method_params JSONB,
              created_at, closes_at, accepts_suggestions, is_entry_point)
poll_choice  (id UUID PK, poll_id, position INT, label, next_poll_id,
              UNIQUE (poll_id, position))
vote         (id UUID PK, poll_id, voter_id, cast_at,
              UNIQUE (poll_id, voter_id))
vote_choice  (vote_id, choice_id, value INTEGER DEFAULT 1,
              PK (vote_id, choice_id), ON DELETE CASCADE)
```

Four details carry the decision, and each is the kind a later reader will be
tempted to tidy away:

1. **`method` is plain `text` — not an enum, not a check constraint.** Either
   would make adding a vote type a schema migration. Validated in code against a
   registry instead, **adding a method is a code change and a data insert,
   never a migration.** This is the single most load-bearing line in the design.
2. **`method_params jsonb`** holds the per-method knobs — `{"maxScore": 5}`,
   `{"credits": 100}`, `{"maxSelections": 3}`. The shape legitimately varies per
   method and the database never queries into it, which is the narrow case where
   `jsonb` is right rather than lazy.
3. **`poll_choice.id` is a stable identity; `position` is display order only,
   and votes reference the id.** This is what lets a poll gain a choice or be
   reordered without invalidating a single existing vote.
4. **`value INTEGER`, defaulting to 1.** `single` and `approval` become
   degenerate cases that write 1 and ignore it. Integer rather than `numeric`
   because `pg` returns `numeric` as a string; budget allocation can use scaled
   integers.

In code, a **`VoteMethod` registry** — `{ name, parseParams, validate, tally }` —
so adding ranked voting is one new file and one registry entry, touching no
store, no route and no schema.

**The wire does not change.** `ballot: number[]` stays valid and means "these
choices, value 1 each", normalised to pairs at the HTTP edge; the client
continues to send indices and the server translates to choice ids. A richer
`{choice, value}[]` form arrives with the first value-carrying method and breaks
nothing already sent.

**Navigation: the highest-valued choice steers, ties broken by lowest position**,
as one plain function. `poll.next[chosen]` assumes exactly one choice was picked,
which is **already ambiguous for `approval`** — a shipped method — and latent
only because no seeded approval poll has a branching `next`. Making navigation a
per-method hook was considered and rejected: see below.

**`Results` is deliberately not generalised.** Its `count` and `share` will be
wrong for score and ranked. It is computed, nothing persists it, and PR #140 has
just shipped a panel that reads those fields. Generalising it now would be
paying early for a shape not yet clearly seen, and it costs one PR whenever the
second family of methods lands.

## Consequences

- **Adding a vote type never requires a migration.** That is the property this
  ADR exists to buy, and the one to check any future change against.
- **The schema barrier to promoting a suggestion is removed; the product
  decision is not.** PR #127 rules that a suggestion matching a poll's own
  choice is answered `on_ballot` rather than added, and `memory/pulse.md`
  justifies it partly by the impossibility of growing `choices`. Stable choice
  ids make growing `choices` possible. **Whether a popular suggestion should
  ever become a votable choice remains an open product question and is not
  decided here** — only the technical impossibility is gone.
- **`is_entry_point` distinguishes where a run may start** from a follow-up poll
  reachable only through another poll's `next`. Without it, the first page that
  lists polls will show mid-run branch questions out of context, and working out
  retroactively which polls were branches would need a migration and a backfill.
- **Ordering is a query, not stored data.** The operator described three ways a
  person could be given the next question — a curated group of related polls,
  a "most relevant" ranking, and random — all selected by the viewer on a
  browsing page. All three are resolved at request time. A group needs a
  `poll_group` table and a nullable `group_id`, which is a purely additive
  migration, so deferring it costs nothing; relevance needs usage signal that
  does not exist yet; random needs no schema at all, though random plus
  pagination needs a stable per-session seed or people get repeats and gaps.
  **This is also why navigation was not made a per-method hook** — under any of
  the three, per-choice branching becomes the exception rather than the rule,
  and the hook would have to be unwound.
- **There is no `GET /api/polls`.** Every route is `/api/polls/:id/...`, so any
  browsing page needs a listing endpoint first. That is that page's work, not
  this one's.
- **A naming hazard, recorded before it is spent.** In ordinary civic usage a
  _ballot_ is the collection of questions — the natural name for a group of
  polls. Pulse has already spent the word on **one person's answer to one poll**,
  on the wire and throughout the client, and it cannot be reused. The codebase
  already calls one person's traversal a **run**. If the group needs a name,
  _agenda_ is the plain-language candidate and _docket_ the precise but
  jargon-heavy one; `odc-ui`'s dictionary rule favours the former.

### Documents reconciled

- **`apps/pulse/API.md`** — says a ballot is "an array of choice indices" and
  lists `single` and `approval`. Both remain exactly true: the wire form is
  unchanged and index-based, and `method` gaining further values later extends
  the list rather than contradicting it. **Checked, no change needed.** The
  first value-carrying method must update it in the same PR.
- **`apps/pulse/CLAUDE.md`** — describes `src/voting/` as "the core domain,
  storage-agnostic", which this ADR preserves: the registry and the pair form
  are domain concepts, and the schema serves them. **Checked, no change needed.**
- **`docs/decisions/0020-pulse-storage-is-postgres.md`** — the sibling decision
  this schema lands in. Consistent; no edit needed.
- **`docs/charter.md` and `contracts/`** — pulse is charter-exempt and shares no
  event schema with `contracts/`. Nothing here touches ballot events on the
  governance chain. **Checked, no change needed.**
- **`memory/pulse.md`** — records #127's reasoning, which this ADR makes
  partially stale (the technical half), and lists the poll graph as settled.
  **Not updated in this PR, deliberately:** memory entries are updated on master
  at merge time per the merge checklist in `.claude/skills/odc-pipeline`. Owed
  at merge.

## Charter check

**Pulse is charter-exempt** per `apps/pulse/CLAUDE.md`, so P1–P4 are not the
standard applied here. The two boundaries that survive the exemption are both
checked:

- **"No reads or writes across into `services/` or `contracts/`."** Honoured.
  This schema is pulse's own and shares nothing with the ledger's event schema.
  Note in particular that `vote_choice` rows are **deleted and rewritten** when
  someone changes their answer, and `vote` carries a `UNIQUE (poll_id,
voter_id)` upsert key — both are correct here and both would be rule-4
  violations in `services/`. This ADR must never be cited as a precedent for
  event storage.
- **"The counting is never the subject."** Honoured, and worth stating because
  this ADR is entirely about how counting works: none of it is user-visible.
  The `VoteMethod` registry, the pair form and the tally are internal. A method
  may change what a result _says people chose_; no copy may explain how a tally
  is computed or verified.
