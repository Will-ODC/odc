# ADR-0025: Related polls are independent of an answer

- **Status:** accepted
- **Date:** 2026-09-09
- **Phase:** 0

## Context

Pulse currently has one kind of link between questions. `Poll.next` has one
entry per choice, and the choice a person casts selects at most one next poll.
That is useful for an authored branch, but it cannot express "these are the
other questions related to this one" independently of the answer.

A guided run now needs to offer any number of related votes after a question.
The current client must keep working while that is added. Separately, a future
home screen is expected to browse groups of questions, but its feed, search,
ranking, and pagination are not designed yet.

ADR-0021 says ordering is selected by a query rather than stored on a poll. A
related-poll design must preserve that decision: membership and presentation
order are different facts.

## Decision

1. **A poll has zero or more directed, answer-independent related-poll links.**
   A link from A to B does not create a link from B to A. Reciprocal links and
   longer cycles are allowed; a direct self-link is not.
2. **`Poll.next` is unchanged.** It remains one nullable target per choice and
   keeps its answer-specific meaning. A target may appear both in `next` and in
   the related set because those links answer different questions. A client
   that later combines both sources must show a target once, giving the chosen
   answer's `next` link precedence.
3. **Postgres stores membership, not rank:**

   ```text
   poll_related_poll (
     poll_id         REFERENCES polls(id) ON DELETE RESTRICT,
     related_poll_id REFERENCES polls(id) ON DELETE RESTRICT,
     PRIMARY KEY (poll_id, related_poll_id),
     CHECK (poll_id <> related_poll_id)
   )
   ```

   Both columns use the existing poll-id type; this decision does not assume
   UUIDs or normalise ids. There is deliberately no `position`, priority, or
   group column.

4. **Polls are created with empty related sets; relationships are assigned after
   the polls exist.** An internal
   `replaceRelatedPolls(sourcePollId, targetIds)` operation validates every id,
   then atomically replaces one source poll's complete related set. A missing
   source, missing target, self-target, or repeated target leaves the existing
   set unchanged. The primary key, check, and foreign keys enforce the same
   rules in Postgres. A seed that wants A related to B and B related to A first
   creates both polls, then performs the two assignments. Duplicate question
   _content_ is a later editorial and deduplication concern; this decision only
   prevents duplicate links.
5. **A separate read route exposes the set:**
   `GET /api/polls/:id/related`. It returns every related target once as a poll
   preview. The response array is in the server's query-selected display order;
   that order is not stored as part of the relationship and does not promise a
   durable rank. The route needs no session and returns `404 not_found` when the
   source poll does not exist.
6. **This decision creates no authoring or publication API.** The first
   implementation adds relationship assignment to the internal voting
   boundary; a seed may create its approved polls first and assign their links
   second. Adding questions, near-duplicate question detection, publication
   state, and the home-screen browser are separate work. No new seeded question
   is approved by this ADR; each requires the operator's individual approval
   before publication.

## Consequences

- The poll graph has two explicit edge types: answer-specific `next` links and
  answer-independent related links. Existing clients see exactly the API they
  see today until they opt into the new route.
- A relation response is an ordered JSON array, but its membership carries no
  ordering semantics. Relevance, curated groups, and random ordering remain
  query policies, as ADR-0021 requires.
- An empty related set is a normal `200 { "polls": [] }`. Missing targets are
  rejected on write rather than silently omitted on read. Postgres prevents a
  related target from being deleted while a link names it.
- Reciprocal links can bring a person back to a question already seen. A later
  run builder must use its run history when deciding what to offer; relation
  storage itself does not encode traversal history.
- The word `related` already appears in suggestion responses for near matches.
  The route and table therefore say `related polls` explicitly; they do not
  reuse that suggestion shape or mix suggestions with votable questions.

### Documents reconciled

- **`apps/pulse/API.md`** — gains a clearly marked planned, not-yet-served route.
  Its description of the API served today and of answer-specific `next` remains
  true.
- **ADR-0021** — its query-selected-order rule is preserved. Its deferred
  `poll_group` describes reusable browsing groups; this ADR adds directed
  per-poll membership and does not settle the home-screen grouping design.
- **`apps/pulse/CLAUDE.md`** — unchanged. The voting domain remains
  storage-agnostic and Pulse still owns all of its storage.
- **`memory/pulse.md`** — its subject browser remains unscoped. This accepted
  decision is recorded there only on master at merge time, per `odc-pipeline`.
- **`apps/pulse/src/voting/poll.ts`** — unchanged in this documentation PR. Its
  `next` contract is preserved; related links arrive in the implementation PR.

## Charter check

**None.** Pulse is charter-exempt by the operator decision in
`apps/pulse/CLAUDE.md` and `memory/INDEX.md`. The two surviving boundaries are
honoured: related polls use only Pulse's own data, and the API describes which
questions are connected without explaining how votes are counted.
