# ADR-0048: A pulse poll's votes are anonymous or visible, fixed at creation

- **Status:** proposed (operator rules 2026-11-15, recorded on #685, are inputs
  and not reopened here; this ADR decides only how they are stored and served)
- **Date:** 2026-11-15
- **Phase:** 0 (pulse workstream, charter-exempt; issue #685; builds after #681)

## Context

Every pulse vote today is anonymous in ADR-0040's sense: it is filed under the
browser's `pulse_ballot` cookie and, if confirmed, carries only an HMAC code.
The operator wants a creator to choose, once, between that and a **visible**
poll, where each vote is shown with the voter's profile display name. The
rules are fixed: the poll decides, never the voter; anonymous is the default and
every existing poll is anonymous, keeping ADR-0040 and ADR-0046 exactly; a
visible poll needs an email sign-in to vote; each vote shows the voter's profile
display name, or "unnamed verified voter" when there is none, with no name
prompt; hiding a profile does not remove the name; everyone who can see the poll
sees the names; the setting never changes after creation.

## Decision

1. **The setting.** Migration `018_vote_visibility.sql` adds
   `polls.vote_visibility text`, sets it to `'anonymous'` on every row, then
   `set not null`. **No column default** (the `DEFAULTS` guard in
   `test/migrations.test.ts` is untouched), so every insert path, including seed
   and test fixtures, must say which kind it writes. It is plain `text`, not an
   enum type, but it **has** a check `vote_visibility in ('anonymous','visible')`.
   ADR-0021's no-check rule protects `method`, where a new value is meant to be
   a code change. Here an unrecognised value would leave it unclear whether
   names may be shown, and a third kind needs its own ADR anyway. The name
   `vote_visibility` is chosen so it is never confused with
   `polls.attribution_kind = 'anonymous'`, which is about the poster.
2. **Fixed at creation, held by the database.** No route changes it. A trigger
   `polls_vote_visibility_fixed` (before update, the pattern of migration 016)
   raises when `new.vote_visibility is distinct from old.vote_visibility`. This
   refuses the change before and after the first vote, which is simpler than
   "until the first vote".
3. **Where the account link lives.** A new table, so `vote` and anonymous rows
   do not change:
   ```sql
   alter table polls add constraint polls_id_vote_visibility_key unique (id, vote_visibility);
   alter table vote add constraint vote_id_poll_key unique (id, poll_id);
   create table visible_vote (
     vote_id uuid primary key,
     poll_id text not null,
     vote_visibility text not null check (vote_visibility = 'visible'),
     account_id text not null references voter (id),
     foreign key (vote_id, poll_id) references vote (id, poll_id) on delete cascade,
     foreign key (poll_id, vote_visibility)
       references polls (id, vote_visibility) on delete cascade,
     unique (poll_id, account_id)
   );
   ```
   The composite foreign key with the constant column is the database rule that
   **refuses an account on an anonymous poll's vote**: a row can only reference
   `(poll, 'visible')`, which exists only for a visible poll. Deleting the vote
   (re-cast replacement under ADR-0046, purge) deletes the link.
   `unique (poll_id, account_id)` mirrors `vote_poll_confirmation_key`: one
   named vote per person per poll. Visible votes still get their ADR-0040
   `confirmation` code, so confirmed counts and the ADR-0046 lock and delete
   path work unchanged.
4. **Casting on a visible poll** (`POST /api/polls/:id/votes`). Order: 404 for
   no such poll, then `closed`, then **401 `sign_in_required`** when there is
   no valid session ("Sign in with your email to vote on this poll. Your vote
   will be shown with your profile name."). Nothing is written and no
   anonymous ballot is made. Then `bad_ballot`. With a session, the store runs
   today's confirmed-cast transaction (person lock, `id`-ordered row lock,
   delete the person's other coded ballot, upsert under this browser's ballot
   cookie). It then inserts `visible_vote (vote_id, poll_id, 'visible', accountId)`,
   doing nothing on conflict when the account already matches. **If this
   browser's row on the poll is linked to a different account** (Bo voted on a
   shared browser and his session ended without sign-out), the cast is refused
   with **409 `ballot_held_by_another_account`** and nothing is written. A
   visible vote is never overwritten by another person. Message: "This browser
   holds someone else's public vote on this poll. Sign out, sign in again, then
   vote." Sign-out clears the cookie, so the next ballot is fresh. The store
   method takes `accountId` only for visible polls and refuses it for anonymous
   ones in code, as well as by the foreign key.
5. **Sign-in confirmation and the move skip visible polls.** `confirmVotes`
   adds `and p.vote_visibility = 'anonymous'` to its open-poll query. A visible
   row already carries its caster's code and account, so re-coding it under
   whoever signs in on that browser would split code from account, and moving
   it would be pointless. ADR-0046 rule 2, a signed-in cast replacing the
   person's ballot in another browser, does apply. It is safe because the old
   row and its link are deleted together. The ballot cookie still files the
   row, so `GET /ballot` and My votes stay per-browser and read no session.
6. **The public list.** New `GET /api/polls/:id/visible-votes?limit=20&cursor=…`,
   with no session and no cookie, and the same availability as `/results`.
   Closed polls stay listed, as a lasting record. `limit` is 1–50, default 20,
   and the cursor is opaque, ordered `cast_at desc, vote id desc`.
   `Cache-Control: no-store`. Body:
   `{ "items": [{ "name": "Ada" | null, "choices": [1] }], "nextCursor": … }`.
   `choices` are poll-order indices, matched on `ChoiceResult.index`. `name: null`
   is the unnamed verified voter. The client shows "Verified voter (no profile
   name)" and never prompts for a name. An anonymous poll answers 404
   `error: "anonymous_poll"`. **Never in the body:** email, account id, ballot
   id, vote id, cast time, profile `publicId`, bio. The profile link is left
   out for three reasons: it would expose a hidden profile's stable id, it
   would link the vote to the profile's contributions, and the operator rule
   names only the name.
7. **How the name is read.** Live, in the voting store's own query, joining
   `visible_vote.account_id = member_profile.voter_id` and taking `display_name`
   **without** filtering on `member_profile.visible`. So a rename shows
   everywhere at once, and a hidden profile's name still shows. This
   deliberately does not go through the profiles API or store, which hides
   hidden profiles; the visible-vote read is a separate projection with its own
   allow-list. No profile row gives `null`.
8. **Poll, listing, creation, results.** `GET /api/polls/:id`, listing rows and
   creation responses always carry `voteVisibility: "anonymous" | "visible"`.
   Seed and legacy polls carry `"anonymous"`. `POST /api/polls` takes an
   optional `voteVisibility` (default `"anonymous"`; anything else is
   `bad_request`). The canonical replay input records it only when it is
   `"visible"`, so an old request's replay key is unchanged, and explicit
   `"anonymous"` is the same as omission. `/results` gains `voteVisibility`. Its
   numbers are unchanged; on a visible poll `confirmedVoters` equals `voters`.
9. **MCP.** `get_poll` and `get_results` pass `voteVisibility` through as an
   optional strict field. An unknown value is `upstream_invalid_response`. No
   MCP tool returns names in this ADR. A future tool would read
   `/visible-votes` and nothing else.
10. **`/trust` copy (ADR-0039)** must say: a poll's creator picks the kind once,
    and it cannot change; anonymous polls work exactly as described today; on a
    visible poll you must sign in with email to vote, and your answer is shown
    to everyone who can see the poll next to your current profile name, or as
    a verified voter with no name; "verified" means only that an email address
    was confirmed, and the name is self-chosen, not checked; hiding or renaming
    your profile does not remove your name, and a rename shows the new one;
    you can change a visible vote until the poll closes but cannot withdraw
    it; "Forget my votes here" and signing out do not unpublish it; it stays
    after the poll closes; your email address is never shown. The vote card
    and results say "Votes are public" or "Votes are anonymous" (issue
    acceptance), never "posted anonymously", which is attribution.

## Consequences

- **Risks the operator accepted.** Visible polls make coercion and vote-buying
  checkable, and a public answer next to a name can reveal sensitive views
  (health, politics, workplace) permanently, since a visible vote cannot be
  withdrawn. The default stays anonymous, and the notice before voting is the
  mitigation.
- A copy of the database shows visible-poll answers by account, and so by
  email (`voter.email`). This is no worse than the public page except for the
  address. Anonymous polls keep exactly ADR-0040's exposure.
- Display names are not unique, so two "Ada"s are indistinguishable on the list.
- `visible_vote.account_id` references `voter` with no cascade: any future
  account deletion must decide what happens to that person's visible votes.
- A person who votes on a visible poll from browser X, then signs in on Y, sees
  no ballot on Y until they vote there (decision 5). That is the cost of
  keeping sign-in from re-coding named votes.
- The rare 409 in decision 4 is a small UX cost bought so that one person can
  never overwrite another's named vote.

### Documents reconciled

None is updated in this PR, which carries only the ADR. The implementing PR
must update:

- `apps/pulse/API.md`: "The ballot cookie" (the "No account id … beside an
  answer" bullet gains "except on visible polls, see ADR-0048"); `GET
/api/polls/:id` and listing (`voteVisibility`); `/results`; "Confirmed votes"
  and `POST /api/sign-in/redeem` (anonymous polls only); `POST …/votes` (401,
  409, visible path); the new `/visible-votes` route; `POST /api/polls`; MCP.
- `apps/pulse-web/src/screens/Trust.tsx`: decision 10. UI review is required.
- `apps/pulse/README.md`: upgrade note for 018. Drain old API instances first,
  because an old instance's poll insert has no `vote_visibility` and fails.
- `docs/decisions/0040-…` and `0046-…` status lines: "scoped to anonymous polls
  by ADR-0048"; their decisions are otherwise unchanged.
- `memory/pulse.md`, on master at merge: next migration 019, and a
  standing-decision line for ADR-0048.

## Charter check

Pulse is charter-exempt (`apps/pulse/CLAUDE.md`), so P1–P4 do not apply.
Storing an account beside a ballot is exactly what core forbids, and it is no
precedent for `services/`. Nothing here reads or writes `services/`,
`contracts/` or `tools/`.
