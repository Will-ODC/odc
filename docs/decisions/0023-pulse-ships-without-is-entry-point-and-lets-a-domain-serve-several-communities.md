# ADR-0023: Pulse ships without `is_entry_point`, and a domain may serve several communities

- **Status:** accepted
- **Date:** 2026-09-11
- **Phase:** 0
- **Supersedes:** one element of ADR-0021 (the `is_entry_point` column on `polls`)

## Context

Pulse's first migration (`apps/pulse/migrations/001_initial.sql`) turns
ADR-0020's decision to use Postgres and ADR-0021's poll/vote model into actual
DDL. Writing the DDL put two questions in front of the operator that the two
earlier ADRs had each answered on paper without the schema in view. Both were
decided by the operator directly; this ADR records what was decided, why, and
what it costs.

Two decisions are recorded here rather than in two files because they are the
same act — the schema going in — and because each is a small amendment to a
larger ADR rather than a decision with its own reasoning to develop. Splitting
them would produce two ADRs whose Context sections were the same paragraph.

## Decision

### 1. `polls` has no `is_entry_point` column

ADR-0021 specifies `is_entry_point` on `polls` and argues for it as follows:
without it, a page that lists polls will show mid-run branch questions out of
context, and working out retroactively which polls were branches would need a
migration and a backfill. **The operator has decided the column is not carried,
and the schema ships without it.**

The reasoning, stated plainly:

- The column exists to let a browsing page tell a run's **starting** question
  from a question reachable only through another poll's onward link.
- **The domain type never carried the field.** `Poll` in
  `apps/pulse/src/voting/poll.ts` has `id`, `question`, `choices`, `method`,
  `next`, `createdAt`, `closesAt` and `acceptsSuggestions`, and `NewPoll` has
  no entry-point input. Nothing in `src/` has ever had a value to write.
- **There is no authoring surface to write it from.** `POST /api/polls` does
  not exist — `memory/pulse.md`'s open decision 4 and ADR-0021's own
  consequences both record that polls are the `SEED` literal in
  `dev-server.ts` and that poll creation "has no home at all".
- **Nor a reader.** The browsing page the column serves is undesigned and
  unscoped; `memory/pulse.md` carries it as an operator request with no shape
  agreed.

So the column would land `not null`, be written the same value by every insert
the codebase can currently make, and be read by nothing. The operator chose not
to carry a column nothing writes.

### 2. `allowed_domain` keeps `primary key (community, domain)`

The migration's `allowed_domain` is keyed on the pair, which permits two rows
with the same `domain` and different `community`. Asked whether the key should
be `domain` alone — one domain, one community — **the operator's answer is that
the pair stays: a domain MAY serve several communities.** A university address
can legitimately prove membership of the alumni community and the staff
community at once, and the schema is not the place to forbid that.

That leaves a real resolution problem, which the review that raised it
identified as a bug independent of the product answer. `DomainAllowlist.check`
picks the most specific matching row by `b.domain.length > a.domain.length`.
Two rows for the same domain are the same length, `>` is false, and the reduce
keeps whichever row the source returned first. Today that is a literal array's
order; once `AllowedDomainSource.rows()` is a table query with no `ORDER BY`,
Postgres promises nothing about it at all. **The same address could be admitted
to a different community from one run to the next.**

Two things follow, and only the first is built here.

**An interim tie-break, now explicit: longest domain wins, then lowest
`community` alphabetically.** It is one clause. It is not a product answer and
is commented as such in `apps/pulse/src/identity/allowlist.ts`; its entire job
is to make the answer a property of the rows rather than of the order they
arrived in, so that a future DB-backed source cannot change who is admitted
where by changing a query plan.

**The real answer is that the person picks.** When an address matches more than
one community, sign-in asks which community they are signing in to. That is UI
and sign-in work, it lands with the sign-in screens — none of which exist yet
(`memory/pulse.md`: "nothing in the client signs anyone in") — and **it is not
built in this change.** The picking flow is owed; the interim rule is what
holds until it arrives.

## Consequences

- **Re-adding `is_entry_point` later costs a migration and a backfill, and the
  backfill is the expensive half.** Adding a nullable column is trivial;
  deciding, for every poll already in the database, whether it was an entry
  point or a mid-run branch is not. It is derivable from the poll graph only
  while the graph is intact and only under the assumption that "reachable from
  another poll's `next`" means "not an entry point" — which is exactly the
  assumption ADR-0021 wanted the column to make unnecessary. **This is the cost
  ADR-0021 named, and it is accepted rather than answered.**
- **ADR-0021 is now partly stale, and a reader will find the discrepancy.**
  `001_initial.sql` says at the point where the column would be that its
  absence is deliberate and points here, and
  `apps/pulse/test/migrations.test.ts` fails if `is_entry_point` reappears —
  so someone "fixing" the schema to match ADR-0021 gets a red test and a
  pointer rather than a silent divergence.
- **A shared domain resolves deterministically but may resolve wrongly.** Until
  sign-in asks, someone whose address matches both `ubc-alumni` and `ubc-staff`
  is admitted to `ubc-alumni` every time, by nothing more principled than the
  alphabet. That is a knowingly arbitrary answer; what it is not is a different
  answer each time.
- **A later `unique (domain)` would be a product reversal, not a schema
  tidy-up.** Recorded in the migration's own comment, because the constraint is
  exactly what someone reading the table would think was missing.
- **The sign-in community picker is owed and unticketed.** Pulse has nowhere to
  put a feature request — `memory/pulse.md` open decision 4 — so this ADR is
  the record until that is settled.
- **`vote_choice` can still name a vote on one poll and a choice on another.**
  Not decided here and not deviated from: ADR-0021 specifies exactly those
  columns, so the DDL keeps them and the store is the only guard. The migration
  says so in a comment, and the conformance suite that lands with the stores
  owes a case for it against both implementations.

### Documents reconciled

- **`docs/decisions/0021-poll-choices-and-vote-values.md`** — specifies
  `is_entry_point` in its four-table sketch and argues for it under
  Consequences. **Superseded in that one element by this ADR and not edited.**
  ADRs in this repo are a dated record, not a living spec: ADR-0007 supersedes
  by writing a new ADR rather than by rewriting the old one, and rewriting
  ADR-0021 would destroy the reasoning this decision was made against. The
  header of this file names what it supersedes, and the migration comment
  points here from the place the column would have been.
- **`apps/pulse/migrations/001_initial.sql`** — carries both decisions, with a
  comment at each site saying which ADR and why. **Updated in this PR.**
- **`apps/pulse/src/identity/allowlist.ts`** — implements the interim
  tie-break and documents that it is interim. **Updated in this PR.**
- **`apps/pulse/API.md`** — describes the HTTP surface. Neither decision
  changes a request or a response: no route exposes `is_entry_point` (none
  could — the domain type has no such field), and the community a person is
  admitted to is already returned without saying how it was chosen.
  **Checked, no change needed.**
- **`apps/pulse/CLAUDE.md`** — says domain allowlists are "rows in a table,
  never code: adding a community's domain is an insert, not a deploy". Decision
  2 strengthens that rather than changing it — a domain serving two communities
  is two inserts. **Checked, no change needed.**
- **`memory/pulse.md`** — carries the operator requests, the open decisions and
  the sign-in gap this ADR leans on, and now also owes the community-picker
  item. **Not updated in this PR, deliberately:** memory entries are updated on
  master at merge time, never on a feature branch, per the merge checklist in
  `.claude/skills/odc-pipeline`. Owed at merge.
- **`docs/charter.md` and `contracts/`** — pulse is charter-exempt and shares
  nothing with `contracts/`. **Checked, no change needed.**

## Charter check

**Pulse is charter-exempt** by the operator decision recorded in
`apps/pulse/CLAUDE.md`, so P1–P4 are not the standard applied here, and
claiming otherwise would misrepresent the workstream. The section is kept
because the template requires it and because the two boundaries that survive
the exemption are real; both are checked.

- **"No reads or writes across into `services/` or `contracts/`."** Honoured.
  Both decisions are about pulse's own tables and pulse's own membership
  check. Nothing here reads or writes anything outside `apps/pulse`, and no
  column, constraint or rule in this ADR is shared with the ledger's event
  schema. In particular, **`allowed_domain` is not an event table and the
  membership check is not a legitimacy claim** — a person admitted to a
  community by the alphabet would be an unacceptable answer in `services/` and
  is an acceptable interim one here precisely because pulse is
  counted-not-verified.
- **"The counting is never the subject."** Honoured. Neither decision adds or
  changes a user-visible string. The community picker this ADR defers will add
  copy, and that copy asks which community someone belongs to — a question
  about them, not about how a tally is computed.
