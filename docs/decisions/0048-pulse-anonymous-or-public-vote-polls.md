# ADR-0048: A pulse poll's votes are anonymous or public, fixed at creation

- **Status:** proposed (operator rules 2026-11-15, recorded on #685, are inputs
  and not reopened here; operator answers of 2026-11-15 on removal, MCP, the
  label and live names are folded in)
- **Date:** 2026-11-15
- **Phase:** 0 (pulse workstream, charter-exempt; issue #685; builds after #681)

## Context

Every pulse vote today is anonymous in ADR-0040's sense: it is filed under the
browser's ballot cookie and, if confirmed, carries only an HMAC code. The
operator wants a creator to choose, once, between that and a poll whose votes
are shown with the voter's profile display name. The rules are fixed: the poll
decides, never the voter; anonymous is the default and every existing poll is
anonymous, keeping ADR-0040 and ADR-0046 exactly; such a poll needs an email
sign-in to vote; each vote shows the voter's profile display name, or
"Verified voter" when there is none, with no name prompt; hiding a profile does
not remove the name; everyone who can see the poll sees the names, AI apps
included; a voter may remove their vote while the poll is open; the setting
never changes after creation.

**Terms.** Issue #685 says "visible", but "visible poll" already means a poll
that is not hidden (ADR-0037, `API.md` Contributions), and
`member_profile.visible` is a third meaning. This ADR says **public-vote poll**,
with the setting values `'anonymous'` and `'public'`. UI copy stays "Votes are
public" / "Votes are anonymous".

## Decision

1. **The setting.** Migration `018_vote_privacy.sql` adds
   `polls.vote_privacy text`, sets `'anonymous'` on every row, then
   `set not null`. **No column default** (the `DEFAULTS` guard is untouched),
   so every insert path, seeds and fixtures included, must say which it writes.
   It is plain `text`, not an enum, but **with** a check
   `vote_privacy in ('anonymous','public')`. ADR-0021's no-check rule protects
   `method`, where a new value is meant to be a code change. Here an unknown
   value would leave unclear whether names may be shown, and a third kind needs
   its own ADR. The name avoids `polls.attribution_kind = 'anonymous'`, which
   is about the poster.
2. **Fixed at creation, held by the database.** No route changes it. A trigger
   `polls_vote_privacy_fixed` (before update, the pattern of migration 016)
   raises when `new.vote_privacy is distinct from old.vote_privacy`.
3. **A public vote is not filed under the browser.** The ballot cookie is
   shared by every anonymous vote from that browser, so an account stored
   beside a cookie-filed row would link the account to those anonymous answers
   in a database copy, which breaks ADR-0040. A public vote's
   `vote.voter_id` is therefore `'pv:' || confirmation`, its ADR-0040 code for
   (account, poll). That value never equals a ballot identity (those start
   `b:`), and it is different on every poll, so it links nothing across polls.
   The account sits in a new table:
   ```sql
   alter table vote add constraint vote_public_identity_is_its_code check (
     voter_id not like 'pv:%'
     or (confirmation is not null and voter_id = 'pv:' || confirmation));
   alter table polls add constraint polls_id_vote_privacy_key unique (id, vote_privacy);
   alter table vote add constraint vote_id_poll_key unique (id, poll_id);
   create table public_vote (
     vote_id uuid primary key,
     poll_id text not null,
     vote_privacy text not null check (vote_privacy = 'public'),
     account_id text not null references voter (id),
     list_key uuid not null unique,
     foreign key (vote_id, poll_id) references vote (id, poll_id) on delete cascade,
     foreign key (poll_id, vote_privacy)
       references polls (id, vote_privacy) on delete cascade,
     unique (poll_id, account_id)
   );
   ```
   The composite foreign key with the constant column is the database rule that
   **refuses an account on an anonymous poll's vote**. Deleting the vote
   (removal, purge) deletes the link. The in-memory store has no foreign keys,
   so it enforces the same refusals in code. The conformance suite runs every
   case against both stores, as ADR-0046 decision 6 does: an account on an
   anonymous poll, a second row per (poll, account), a `pv:` row whose identity
   is not its code, and a changed setting.
4. **Casting on a public-vote poll** (`POST /api/polls/:id/votes`). Order:
   403 `origin_not_allowed`, the exact-Origin and JSON guard that #687 adds to
   this route for all polls. If #687 has not merged, a public-vote cast runs
   `requireWebOrigin` itself. Then 404, then `closed`, then **401
   `sign_in_required`** when there is no valid session ("Sign in with your
   email to vote on this poll. Your vote will be shown with your profile
   name."), then `bad_ballot`. A refused cast writes nothing, makes no
   anonymous ballot and mints no ballot cookie.
   - **With a session**, a separate store method `castPublic(pollId, accountId,
ballot, {confirmation, lockKey})` runs one transaction. It takes the
     person lock, then upserts on `(poll_id, voter_id = 'pv:'+code)`, replaces
     `vote_choice`, and inserts `public_vote` on first cast with a fresh random
     `list_key`. A re-cast keeps the row, its `vote_id` and its `list_key`.
   - **Nothing to conflict with.** No cookie ballot can exist on a public-vote
     poll, so there is no ADR-0046 cross-browser delete and no shared-browser
     conflict. The earlier draft's 409 is gone.
   - **Refusals abort the transaction.** The store throws, never returns a
     status from inside `inTransaction`. It refuses an `accountId` without a
     well-formed confirmation and lock key, and refuses `castPublic` on an
     anonymous poll.
5. **Confirmation key required.** `ServerDeps.confirmationKey` stays optional
   for tests. Without it, creation refuses `votePrivacy: "public"`, and casting
   or removing on a public-vote poll is refused, all with 503
   `public_votes_unavailable`. Nothing public is ever written without a code
   and a lock.
6. **Sign-in, ballot and My votes.** `confirmVotes` adds
   `and p.vote_privacy = 'anonymous'` as a guard; no cookie row exists on a
   public-vote poll, so the ADR-0046 move never touches one.
   `GET /api/polls/:id/ballot` on a public-vote poll reads the **session**:
   signed in, it returns the account's vote by code from any browser;
   signed out, `null`. The ballot cookie is neither read nor minted there.
   `GET /api/my-votes`, when a session is present, also includes that account's
   public votes (`… or v.id in (select vote_id from public_vote where
account_id = $acct)`), in the same `(cast_at, poll_id)` order and cursor.
   Signing out removes them from the list.
7. **The public list.** `GET /api/polls/:id/public-votes?limit=20&cursor=…`
   needs no session and sets no cookie. Closed polls stay listed. A hidden poll
   answers 404 `not_found`, here and over MCP. `limit` is 1–50, default 20. Rows are ordered
   by `public_vote.list_key`, a random value fixed at first cast, so re-casts
   never skip or repeat entries. The cursor is the base64url of the last
   `list_key`, which reveals no time, id or account. The order is therefore not
   chronological. `Cache-Control: no-store`. Body:
   `{ "items": [{ "name": "Ada" | null, "choices": [1] }], "nextCursor": … }`.
   `choices` are poll-order indices, matched on `ChoiceResult.index`. An
   anonymous poll answers **409** `anonymous_poll`, so clients can tell it from 404. **Never in the body:** email, account id, ballot, vote or list key in
   the clear, cast time, profile `publicId`, bio. There is no profile link
   (orchestrator decision): it would expose a hidden profile's stable id and
   tie the vote to the person's contributions.
8. **The name, read live.** The voting store's own query joins
   `public_vote.account_id = member_profile.voter_id` and takes `display_name`
   **without** filtering on `member_profile.visible`. This is the operator's
   choice of 2026-11-15. It is a separate allow-listed projection, not the
   profiles API, which hides hidden profiles. No profile row gives `null`. The
   client renders `null` as "Verified voter" in a distinct style, with no link.
   `PUT /api/me/profile` refuses the display name "Verified voter",
   case-insensitively after trimming, with 400 `reserved_name`, so a
   self-chosen name can never look like it.
9. **Poll, listing, creation, results.** `GET /api/polls/:id`, listing rows and
   creation responses always carry `votePrivacy: "anonymous" | "public"`; seed
   and legacy polls carry `"anonymous"`. `POST /api/polls` takes an optional
   `votePrivacy` (default `"anonymous"`; anything else is `bad_request`). The
   canonical replay input records it only when it is `"public"`, so old replay
   keys are unchanged. `/results` gains `votePrivacy`, and its numbers are
   unchanged; on a public-vote poll `confirmedVoters` equals `voters`.
10. **Removal while open.** `DELETE /api/polls/:id/votes/mine`, session
    required. Order: 403 `origin_not_allowed` (the shared Origin hook), then
    404 `not_found`, then 409 `anonymous_poll`, then 503 (decision 5), then 401
    `sign_in_required`. A closed poll gets 200 `{ "status": "closed" }` and
    nothing changes. Otherwise, after the person lock, one statement runs:
    `delete from vote where poll_id = $1 and voter_id = 'pv:' || $code`.
    `vote_choice` and `public_vote` cascade from it, so the answer and the name
    go together.
    - The response is 200 `{ "status": "removed" | "none", "results" }`, so
      repeating it is harmless.
    - `voters`, `confirmedVoters` and the counts of the choices picked fall by
      one. The person may vote again while the poll is open.
    - **Anonymous polls get no removal.** Their ballots are found by cookie or
      code, not by account, which would be different code with its own privacy
      questions.
11. **MCP.** `get_poll` and `get_results` pass `votePrivacy` through as an
    optional strict field. A new tool, `get_public_votes {pollId, cursor?}`,
    returns the same page as `/public-votes` and reads only that route.
    - Each item must be exactly `{ name: string | null, choices: int[] }`. Any
      other key fails the whole body as `upstream_invalid_response`, never
      trimmed.
    - The client (`mcp/client.ts`, which maps every 404 to `not_found`) maps
      the route's 409 to the tool error `anonymous_poll`.
    - It shares the MCP route's 120 requests/minute per IP limit, and the HTTP
      route keeps the same per-route limit as the other public reads.
    - There is no MCP voting tool. ADR-0036 (proposed) plans an
      account-scoped AI ballot. On a public-vote poll that would be a named
      vote, and ADR-0036's implementer must reconcile it with this ADR.
12. **Never to the core ledger.** Public-vote names and account links are pulse
    data only. ADR-0039 decision 5's route to core (#398, deferred) carries no
    name, account or `public_vote` row; how such polls cross, if at all, is
    that integration ADR's question.
13. **`/trust` copy (ADR-0039)** must say these things:
    - The creator picks once, and it cannot change. Anonymous polls work
      exactly as described today.
    - On a public-vote poll you sign in with email to vote. Your answer is
      shown to everyone who can see the poll, AI apps included, next to your
      current profile name, or as "Verified voter" when you have none.
    - "Verified" means only that an email address was confirmed. Names are
      self-chosen, not checked.
    - Hiding your profile does not remove your name. A rename relabels all
      your public votes, including on closed polls.
    - You can change or remove the vote until the poll closes. After that it is
      fixed. Signing out and "Forget my votes here" do not remove it.
    - Your email address is never shown.
    - The vote card and results say "Votes are public" or "Votes are
      anonymous", never "posted anonymously", which is attribution.
14. **Ship order**, so a public-vote poll can never exist before its notice and
    `/trust` copy:
    1. Migration 018 and both stores, with conformance cases.
    2. Routes and `API.md`, with creation still refusing `"public"`.
    3. MCP `get_public_votes`.
    4. The web UI and `/trust`. Only this step lets creation accept
       `"public"`, and it needs UI review.

## Consequences

- **Risks the operator accepted.** Public votes make coercion and vote-buying
  checkable, and a named answer can reveal sensitive views (health, politics,
  workplace). After close it cannot be removed. The mitigations are that
  anonymous stays the default, the notice comes before voting, and removal
  works while the poll is open.
- **Bulk collection.** The paged route and the MCP tool let anyone, including
  an AI app, harvest every name and answer on every public-vote poll. Only the
  existing rate limits slow it. A scraped name is not taken back by removal.
- **A rename relabels the past.** Names are read live, so renaming changes the
  name on every public vote the person has cast, closed polls included. This
  is the operator's choice (2026-11-15). A closed poll's record is therefore
  fixed in answers, not in names.
- **What a database copy shows.** Public-vote answers by account, and so by
  email (`voter.email`). Anonymous polls keep exactly ADR-0040's exposure,
  because no public row shares an identity with a cookie ballot. Cast times on
  two polls could still be compared by someone with the copy, and that is not
  a stored link.
- Display names are not unique, so two "Ada"s cannot be told apart.
  `public_vote.account_id` references `voter` with no cascade: future account
  deletion must decide what happens to public votes (orchestrator decision).
- **Deploy.** Stop every old API instance before applying 018. An old instance
  would fail on poll inserts (no `vote_privacy`). It would also accept
  signed-out casts on new public-vote polls, filed under the cookie, and run
  the old `confirmVotes`, which would re-code them. No old instance may serve
  while any public-vote poll exists.

### Documents reconciled

None is updated in this PR, which carries only the ADR. The implementing PRs
(decision 14) must update:

- `apps/pulse/API.md`:
  - "The ballot cookie": the "No account id … beside an answer" bullet gains
    "except on public-vote polls, which are not filed under it (ADR-0048)".
  - `GET /api/polls/:id` and the listing (`votePrivacy`), and `/results`.
  - "Confirmed votes" and `POST /api/sign-in/redeem`: anonymous polls only.
  - `/ballot` and `/my-votes`: these now read the session for public votes.
  - `POST …/votes`: the 401 and 503.
  - The new `/public-votes` and `DELETE …/votes/mine` routes.
  - `POST /api/polls`, `PUT /api/me/profile` (`reserved_name`), and MCP
    (`get_public_votes`).
- `apps/pulse-web/src/screens/Trust.tsx`: decision 13.
- `apps/pulse/README.md`: the 018 upgrade note (Consequences, "Deploy").
- `docs/decisions/0040-…` and `0046-…` status lines: "scoped to anonymous
  polls by ADR-0048".
- `docs/decisions/0036-…`: decision 11's note.
- `memory/pulse.md`, on master at merge: next migration 019, and a
  standing-decision line.

## Charter check

Pulse is charter-exempt (`apps/pulse/CLAUDE.md`), so P1–P4 do not apply.
Storing an account beside a ballot is exactly what core forbids, and it is no
precedent for `services/`. Nothing here reads or writes `services/`,
`contracts/` or `tools/`.
