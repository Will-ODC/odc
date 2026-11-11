# ADR-0046: A confirmed person keeps one ballot per poll

- **Status:** accepted (operator decisions, 2026-11-11, verbatim choices:
  "Replace the earlier vote", and for decision 4 "Browser just signed in",
  which is option A). Amends ADR-0040 decisions 4–6.
- **Date:** 2026-11-11
- **Phase:** 0 (pulse workstream, charter-exempt; issue #532)

## Context

A pulse vote is filed under the browser's `pulse_ballot` cookie. Signing out
clears that cookie, so a person who votes, signs out, signs back in and votes
again holds two ballots on one poll. ADR-0040 already counts them once in the
confirmed numbers: both carry the same keyed code (HMAC of account id and poll
id), and `results()` picks the most recently cast with `distinct on
(confirmation)`. The totals (`voters`, `count`) still count both. The operator
chose to replace the earlier vote, so the totals count each confirmed person
once too. Anonymous ballots stay one per browser.

Two ways to get there were weighed:

| Option                                                                                             | Older ballot row                     | What this browser shows (`/ballot`, My votes)                                                      | Database shows same-person pairs | Concurrency                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------- |
| R. Derive at read: totals count distinct `coalesce(confirmation, voter_id)`, most recent wins      | kept                                 | its own row, even when that row no longer counts. After sign-in it can show an answer not counted. | yes, as today                    | nothing to race                              |
| W. Replace on write: when a ballot becomes confirmed, delete the person's other ballot on the poll | deleted (one row per code, enforced) | the person's counted answer, or nothing                                                            | no                               | needs a lock; a unique index is the backstop |

Option R keeps rows but leaves each browser showing a ballot that may not be
the one counted, and the vote page would then disagree with the totals beside
it. It also keeps the "two ballots, one unnamed person" fact in the database
that ADR-0040 lists as a cost. Option W removes that fact and keeps "what this
browser shows is what counts" true.

History is not a reason to keep the row. The `vote` table is not insert-only:
`001_initial.sql` makes re-casting replace the row and its `vote_choice` rows,
which pulse is exempt to do (`apps/pulse/CLAUDE.md`). My votes lists current
ballots only, and nothing reads a superseded ballot. In the main case the older
ballot is already unreadable: sign-out cleared the cookie it is filed under.

## Decision

1. **Option W: replace on write.** At most one ballot per poll carries a given
   confirmation code. Migration `011_one_ballot_per_confirmation.sql` adds the
   partial unique index `vote_poll_confirmation_key on vote (poll_id,
confirmation) where confirmation is not null` and drops
   `vote_poll_confirmation_idx`, which the new index replaces. The invariant is
   held by the database, not only by the code.
2. **A cast while signed in replaces.** In one transaction, the store deletes
   every other ballot on the poll that carries this cast's code
   (`delete from vote where poll_id = $1 and confirmation = $2 and voter_id <> $3`;
   `vote_choice` cascades). Then it runs today's upsert. The cast wins without
   comparing `cast_at`, because it is the person's latest answer by definition.
   It needs no session after this point, and the stored row is unchanged:
   ballot id, poll, cast time, code, choices. A cast without a session deletes
   nothing. If its row already holds a code, the unique index guarantees no
   other ballot has that code.
3. **Sign-in confirmation replaces as well.** For each of this browser's
   ballots on an open poll, `confirmVotes` sets the code, as today. If another
   ballot on that poll already has the code, the two are compared by ADR-0040's
   rule: the later `cast_at` wins, and an exact tie goes to the greater
   `voter_id` in byte order. The loser is deleted. Closed polls are untouched,
   as ADR-0040 decision 3 requires, so closed results never change.
4. **Where the surviving ballot lives when this browser loses at sign-in.**
   **Option A, chosen by the operator on 2026-11-11 ("Browser just signed
   in").**
   - **A (chosen):** the newer answer moves to the browser that just
     signed in. Its own older row is deleted. The winning row's `voter_id` is
     set to this ballot, and its choices and `cast_at` are kept. The rule then
     has one form: a person's ballot on a poll is filed under the browser that
     last cast or confirmed it. My votes in the new browser shows the person's
     current answer, as #532 asks.
   - **B (not chosen):** this browser's older row is deleted, and the newer ballot stays
     where it is. This browser shows no vote on that poll. The other browser
     keeps showing the vote.
5. **The browser that lost its ballot no longer shows it.** Its `GET
/api/polls/:id/ballot` returns `null`, and the poll drops out of its My
   votes. If it votes again, it replaces the other ballot by the same rule.
   This happens only when the older browser still holds its cookie: the person
   is signed in on both browsers, or the older browser voted anonymously and
   never signed out. After a sign-out the older ballot cannot be read anyway.
6. **Concurrency: one lock per person, taken first.** Every confirming write
   (a cast with a code, or `confirmVotes`) first takes
   `pg_advisory_xact_lock(<person lock key>)`. That covers two casts at once,
   a cast during a sign-in, and two sign-ins at once. The lock key is a 64-bit
   value made by `ConfirmationKey` from the account id under its own label
   (`"pulse-vote-lock/v1"`). It is never stored, and it is meaningless without
   the key, like the code. It is per person rather than per poll because
   `confirmVotes` covers many polls. A single lock taken before any row lock
   means a sign-in and a cast by one person cannot deadlock on each other's
   rows.

   **Across people, rows are locked in one global order.** Two different
   people hold two different person locks, so those do not order them. On
   shared browsers their ballots can sit crossed: browser X holds Bo's
   ballot and browser Y holds Ada's. Ada signing in on X while Bo signs in on
   Y would each lock its own row and then wait on the other's ("own row, then
   the rival"), and Postgres would end one with a deadlock error (a 500 at
   sign-in). The same holds for two such people casting at once. So after
   the person lock, each confirming write locks **every row it can touch in
   one `select … order by id for update`**: for a cast, this browser's row
   and the person's row on the poll; for `confirmVotes`, this browser's rows
   on open polls (read first without a lock, to know which codes to make) and
   the person's row on each of those polls. Row locks are then always taken
   in `id` order, so no two writes can wait on each other in a cycle. A row
   changed by someone else while the statement waited is re-checked under
   read committed and dropped if it no longer matches; no row can newly take
   this person's code meanwhile, because only this person's writes set it,
   and they wait on the person lock. A sign-in whose own row was moved or
   deleted meanwhile confirms nothing on that poll. The Postgres tests
   `two_people_signing_in_on_each_others_browsers_at_once_do_not_deadlock`
   and `two_people_casting_on_each_others_browsers_at_once_do_not_deadlock`
   hold both writes at a barrier and fail with a deadlock without this rule.

   A cast without a session takes no person lock and locks only its own row,
   which serializes it as today; holding one row, it cannot close a cycle.
   The unique index turns any missed path into an error instead of a double
   count. The in-memory store applies the same rules in its single-threaded
   way, and the conformance suite runs both stores.

7. **Results.** `voters` and `count` keep counting rows, which now means one
   per browser for anonymous ballots and one per person for confirmed ones.
   `confirmedTally` needs no change: with one row per code, `distinct on` picks
   that row, and it stays as a guard. The response shape does not change.
8. **Existing duplicates.** Migration 011 first deletes, for each `(poll_id,
confirmation)` with more than one row, every row except the ADR-0040
   survivor (`order by cast_at desc, voter_id collate "C" desc`). It then
   creates the index. This includes closed polls, because the index cannot be
   conditional on closing time. Pulse has not been deployed (`memory/pulse.md`,
   "What stands between this and a usable deploy"), so this touches only
   development and test databases. The confirmed numbers do not change.
   `voters` and `count` fall by the number of duplicates removed.

## Consequences

- **The totals count a confirmed person once per poll.** People who vote
  without confirming still count once per browser. A second email address is
  still a second person, so "confirmed by email" must still not be presented
  as "one vote per human".
- **Privacy improves slightly and does not get worse.** The stored row is
  unchanged: no account id and no address. A copy of the database no longer
  shows two ballots confirmed by one person, because only one remains. The
  person lock key exists only inside a transaction. While a write holds it,
  `pg_locks` shows a value that only someone with the key could link to an
  account. That is no more than the code already reveals.
- **A new weakness, stated plainly.** ADR-0040 already lets someone who signs
  in on a browser another person voted on take over that person's anonymous
  ballot. Now the taken-over ballot can also replace, or be replaced by, the
  signer's own ballot elsewhere. That can delete the other person's anonymous
  answer outright. This is the same per-browser trade as ADR-0030, made worse.
  Sign-out clearing the cookie still limits it on shared machines.
- **Clock skew.** Rule 2 lets a cast win against a row with a slightly later
  `cast_at` written by another instance whose clock runs ahead. Rule 3
  compares `cast_at` and could choose differently in the same situation. Both
  still leave exactly one row. Skew between instances is already accepted
  elsewhere in pulse.
- **ADR-0040 decision 6 ("no flag and no uniqueness constraint") is reversed
  in part.** There is still no "this is the confirmed one" flag. There is now a
  uniqueness constraint, plus a lock to keep writes from hitting it.
- A row's `voter_id` can now change (decision 4A). Nothing keys on it except
  the ballot cookie and `vote_history_idx`, and both follow the row.

### Documents reconciled

Updated in the PR that implements this ADR (#532), unless marked otherwise:

- `docs/decisions/0040-pulse-confirmed-votes-keyed-code.md`: the status line
  now records that decisions 4–6 are amended here. **Updated with this ADR.**
- `apps/pulse/API.md`:
  - "The ballot cookie, and why voting needs no session": its last paragraph
    ("counted **twice**") is replaced with the new rule. The privacy bullet
    "the database does show that two ballots … same person" changes to
    "showed, until one replaced the other".
  - "Confirmed votes (ADR-0040)": "the other still counts in `voters` and
    `count`" changes to "the other is replaced".
  - The results paragraph "every ballot counts in them".
  - `POST /api/sign-in/redeem`: confirming can replace or move a ballot.
  - `POST /api/polls/:id/votes`: a signed-in cast replaces the person's other
    ballot on the poll.
  - `GET /api/my-votes` and `GET /api/polls/:id/ballot`: a poll can leave this
    browser's list when the same person votes elsewhere, and under 4A can
    appear at sign-in.
  - `POST /api/sign-out`: "it stays counted under the identity that cast it"
    gains "until the same person votes on that poll again".
- `apps/pulse-web/src/screens/Trust.tsx`: "signing out lets you add votes to
  the full total" is no longer true for a confirmed person. The copy needs a
  UI change and UI review.
- `apps/pulse-web/src/components/ResultsPanel.tsx`: the header comment "every
  vote, one per browser".
- `docs/plans/pulse.md` line 276 cites the old API.md "twice" passage, so it
  becomes stale history. Update it if the implementing PR owns that file;
  otherwise flag it.
- `memory/pulse.md` "Open decisions": the "counted twice … That cost is
  accepted" bullet is removed **on master at merge time**, following the
  memory rule. It is not changed on the branch.
- `apps/pulse/migrations/001_initial.sql` and `007_confirmed_votes.sql`:
  their comments describe the old rule, but migrations are forward-only and
  are never edited. Migration 011's header records the change.

## Charter check

Pulse is charter-exempt (`apps/pulse/CLAUDE.md`), so P1–P4 do not apply. The
deletes and the `voter_id` move are allowed only because pulse's `vote` table
is mutable. They are no precedent for `services/`, where event tables are
INSERT-only (root rule 4). Nothing here reads or writes `services/`,
`contracts/` or `tools/`.
