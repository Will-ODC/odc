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
   (before update, the pattern of migration 016) refuses any change:

   ```sql
   create function polls_vote_privacy_fixed() returns trigger
   language plpgsql as $$
   begin
     if new.vote_privacy is distinct from old.vote_privacy then
       raise exception 'a poll''s vote privacy is fixed at creation';
     end if;
     return new;
   end $$;
   create trigger polls_vote_privacy_fixed before update on polls
     for each row execute function polls_vote_privacy_fixed();
   ```

3. **A public vote is not filed under the browser, and the database holds
   that.** The ballot cookie is shared by every anonymous vote from that
   browser, so an account stored beside a cookie-filed row would link the
   account to those anonymous answers in a database copy, which breaks
   ADR-0040. A public vote's `vote.voter_id` is `'pv:'` plus a fresh random
   UUID, made at first cast. It is derived from nothing, so it never equals a
   ballot identity (those start `b:`) and links nothing to anything. Key
   rotation cannot break it either. The account sits in a new table:

   ```sql
   alter table polls add constraint polls_id_vote_privacy_key unique (id, vote_privacy);
   alter table vote add constraint vote_id_poll_voter_key unique (id, poll_id, voter_id);
   create table public_vote (
     vote_id uuid primary key,
     poll_id text not null,
     voter_id text not null check (voter_id like 'pv:%'),
     vote_privacy text not null check (vote_privacy = 'public'),
     account_id text not null references voter (id),
     list_key uuid not null unique,
     foreign key (vote_id, poll_id, voter_id)
       references vote (id, poll_id, voter_id) on delete cascade,
     foreign key (poll_id, vote_privacy)
       references polls (id, vote_privacy) on delete cascade,
     unique (poll_id, account_id)
   );
   create index public_vote_account_idx on public_vote (account_id);
   ```

   Each part of this has one job:
   - **The `(poll, 'public')` foreign key** refuses an account on an anonymous
     poll's vote.
   - **The `voter_id` check and the three-column foreign key** refuse an
     account beside a cookie-filed row. Because the key has no `on update`, a
     later `update vote set voter_id = …` on a linked row (the shape of the
     ADR-0046 move) is refused too.
   - **A trigger** raises when a row's `voter_id` starts `pv:` on an
     anonymous poll, or does not on a public-vote poll. This is safe because
     the setting never changes (decision 2):

     ```sql
     create function vote_identity_matches_poll() returns trigger
     language plpgsql as $$
     declare
       privacy text;
     begin
       select p.vote_privacy into privacy from polls p where p.id = new.poll_id;
       if privacy = 'public' and new.voter_id not like 'pv:%' then
         raise exception 'a public-vote poll''s votes are filed under a pv: identity';
       elsif privacy = 'anonymous' and new.voter_id like 'pv:%' then
         raise exception 'an anonymous poll''s votes are never filed under a pv: identity';
       end if;
       return new;
     end $$;
     create trigger vote_identity_matches_poll
       before insert or update of voter_id, poll_id on vote
       for each row execute function vote_identity_matches_poll();
     ```

   **This SQL was executed** (2026-11-18, PostgreSQL 16, on migrations
   001–017 with existing rows) together with decisions 1, 2 and 8's SQL, and
   every refusal above fired with the expected error. Also checked: an
   unlinked anonymous row can still move its `voter_id` (the ADR-0046 shape),
   a re-cast's `update vote set cast_at` passes, and deleting the vote or the
   poll removes the `public_vote` row. The implementing migration copies this
   SQL and keeps a test that runs these cases against Postgres.

   Migration 007's principle applies: the storage layer refuses these whatever
   the code above it does. Deleting the vote deletes the link. The ADR-0040
   `confirmation` code is still written at first cast, so the confirmed counts
   and `vote_poll_confirmation_key` still hold. A person's public vote is always
   **found through `public_vote (poll_id, account_id)`**, never by recomputing
   the code. After a key rotation, a re-cast or a removal still finds it, and
   the row keeps its original code.

   The in-memory store has no foreign keys or triggers, so it enforces every
   refusal in code. The conformance suite runs each case against both stores,
   as ADR-0046 decision 6 does:
   - an account on an anonymous poll;
   - a `b:` row on a public-vote poll, and a `pv:` row on an anonymous one;
   - a linked row's `voter_id` changed;
   - a second row per (poll, account);
   - a changed setting.

4. **Casting on a public-vote poll** (`POST /api/polls/:id/votes`).
   - **The voter's acknowledgement travels with the vote.** The body gains an
     optional `"publicVote": true`. A client sends it only from a vote card
     that showed the "Votes are public" notice beside the vote button (no extra
     click and no name prompt, per the operator's rules). A cast on a
     public-vote poll **without** it is refused, so a client built before this
     ADR, which never shows the notice, can never publish a named vote. A cast
     **with** it on an anonymous poll is refused too, so a client that thinks a
     poll is public never files an anonymous vote while telling the voter it is
     named. Both refusals are 409 `vote_privacy_mismatch`: "How this poll's
     votes are shown has not reached this page. Reload to see it before you
     vote." Old clients on anonymous polls send no field and are unaffected.

   The checks run in this order:
   1. 403 `origin_not_allowed`, the exact-Origin and JSON guard #687 put on
      this route for all polls.
   2. 400 `bad_request` for the body shape, which already runs before the poll
      lookup. It now also refuses a `publicVote` that is present and not
      `true`.
   3. 404 `not_found`.
   4. **409 `vote_privacy_mismatch`**, as above, on either kind of poll.
   5. 503 `public_votes_unavailable` (decision 5).
   6. `closed`.
   7. **401 `sign_in_required`** when there is no valid session: "Sign in with
      your email to vote on this poll. Your vote will be shown with your
      profile name."
   8. `bad_ballot`.

   A refused cast writes nothing, makes no anonymous ballot and mints no ballot
   cookie. The mismatch check comes before 401, so an old client is never
   walked through sign-in towards a named vote it did not describe.
   - **With a session**, a separate store method `castPublic(pollId, accountId,
ballot, {confirmation, lockKey})` runs one transaction. It takes the
     person lock, then re-checks that the poll is open with the injected clock;
     if it has closed meanwhile, it returns `closed` and writes nothing. Next it
     finds the vote through `public_vote` with `for update`. A re-cast replaces
     `vote_choice` and `cast_at` and keeps the row, `voter_id`, code and
     `list_key`. A first cast inserts `vote` (a new `pv:` identity, this code)
     and `public_vote` (a fresh random `list_key`).
   - **Nothing to conflict with.** No cookie ballot can exist on a public-vote
     poll, so there is no ADR-0046 cross-browser delete and no shared-browser
     conflict.
   - **Refusals abort the transaction.** The store throws, never returns a
     refusal from inside `inTransaction`. It refuses an `accountId` without a
     well-formed confirmation and lock key, and refuses `castPublic` on an
     anonymous poll. `closed` is an outcome, not a refusal, and leaves nothing
     written.

5. **Confirmation key required.** `ServerDeps.confirmationKey` stays optional
   for tests. Without it, every public-vote path answers 503
   `public_votes_unavailable`: creation with `votePrivacy: "public"`, casting,
   removal and the public list (which needs the key for its cursor, decision
   7). Nothing public is ever written without a code and a lock.
6. **Sign-in, ballot and My votes.** `confirmVotes` adds
   `and p.vote_privacy = 'anonymous'` as a guard, and the database already
   keeps cookie rows off public-vote polls.
   - `GET /api/polls/:id/ballot` on a public-vote poll reads the **session**.
     Signed in, it returns the account's vote through `public_vote`, from any
     browser. Signed out, it returns `null`. The ballot cookie is neither read
     nor minted there.
   - **`/ballot` is never cached.** Its answer depends on the session (and, on
     anonymous polls, on the ballot cookie), so on every poll and every
     outcome, 404 and errors included, it sends `Cache-Control: private,
no-store` and `Vary: Cookie`, set in an `onRequest` hook as `/api/me`'s
     `noStore` is. Without it a shared cache or the proxy could hand one
     person's named answer to the next reader of the same URL. `/my-votes`
     already sends `private, no-store` and gains `Vary: Cookie`.
   - `GET /api/my-votes`: the early empty-page return for a missing ballot
     cookie applies only when there is also no session. With a session, the
     list also includes that account's public votes (`… or v.id in (select
vote_id from public_vote where account_id = $acct)`, served by
     `public_vote_account_idx`), in the same `(cast_at, poll_id)` order and
     cursor. Signing out removes them from the list.
7. **The public list.** `GET /api/polls/:id/public-votes?limit=20&cursor=…`
   needs no session and sets no cookie. It has **its own per-IP rate limit**,
   `publicVotesRateLimit`, default 60 requests per minute. It is in memory,
   like every pulse limiter, with the same scale-out caveat.
   - Closed polls stay listed. A hidden poll answers 404 `not_found`, here and
     over MCP. An anonymous poll answers **409** `anonymous_poll`, so clients
     can tell it from 404.
   - **The page query filters hidden polls itself.** `getPoll` does not filter
     `polls.hidden`, so a route check alone would race a hide and would be one
     forgotten line from leaking. The store's `listPublicVotes` reads only
     through a join that excludes them, and an empty result on a hidden poll
     is answered 404 like a missing one:

     ```sql
     select m.display_name as name, pv.list_key,
            array(select pc.position
                    from vote_choice vc
                    join poll_choice pc on pc.id = vc.choice_id
                   where vc.vote_id = pv.vote_id
                   order by pc.position) as choices
       from public_vote pv
       join polls p on p.id = pv.poll_id and not p.hidden
                    and p.vote_privacy = 'public'
       left join member_profile m on m.voter_id = pv.account_id
      where pv.poll_id = $1 and pv.list_key > $2
      order by pv.list_key
      limit $3 + 1;
     ```

     - **One statement, one snapshot.** The choices come from the subquery in
       the same statement, so under Pulse's default `read committed` a
       concurrent re-cast or removal can never pair one vote's name with
       another moment's answer. A second query would see a newer snapshot.
     - **The first page** passes `$2 = '00000000-0000-0000-0000-000000000000'`.
       `list_key` is a random version-4 UUID, whose version bits are never
       zero, so no key equals or sorts below it. Later pages pass the
       `list_key` from the opened cursor.
     - `pc.position` is the poll-order index the wire uses (`ChoiceResult.index`).
       `list_key` never leaves the store's result except inside the sealed
       cursor, and `vote_id` is not selected at all. The in-memory store has no hidden
       polls (as today) and its conformance case hides a poll in the Postgres
       store and expects 404 there.

   - **Limiting by the real caller.** The route's limiter keys on
     `request.ip`, which behind nginx is the forwarded client (one trusted
     hop). MCP's own upstream reads reach the API from loopback, where every
     AI app would share one bucket. So those reads carry a per-process random
     header (`x-pulse-internal`, generated at start, never configured, never
     logged or sent anywhere else), the limiter's `allowList` passes them, and
     the MCP route counts `get_public_votes` against `publicVotesRateLimit`
     itself, keyed on the MCP caller's `request.ip` (decision 11).
   - **One bucket per address, shared by both paths.** `publicVotesRateLimit`
     is a single in-memory counter keyed on the client address, which the HTTP
     route and the MCP route both consult. It is not two
     `@fastify/rate-limit` route configs, which would keep separate counts and
     let one scraper take 60 a minute over HTTP and 60 more over MCP.
   - `limit` is 1–50, default 20. Rows are ordered by `public_vote.list_key`, a
     random value fixed at first cast, so re-casts never skip or repeat
     entries. The order is not chronological.
   - **The cursor is sealed.** It is AES-256-GCM over `{pollId, list_key}`
     with a fresh random 96-bit nonce, so the same position never yields the
     same cursor twice. The key is derived from `ConfirmationKey` under its own
     label, `"pulse-public-votes-cursor/v1"`. A cursor that fails to open, or
     names another poll, gets 400 `bad_request`.
   - The body is
     `{ "items": [{ "name": "Ada" | null, "choices": [1] }], "nextCursor": … }`
     with `Cache-Control: no-store`. `choices` are poll-order indices, matched
     on `ChoiceResult.index`.
   - **Never in the body or the cursor in the clear:** email, account id,
     ballot, vote id, `list_key`, cast time, profile `publicId`, bio. There is
     no profile link (orchestrator decision): it would expose a hidden
     profile's stable id and tie the vote to the person's contributions.
8. **The name, read live.** The voting store's own query joins
   `public_vote.account_id = member_profile.voter_id` and takes `display_name`
   **without** filtering on `member_profile.visible` (operator, 2026-11-15).
   This is a separate allow-listed projection, not the profiles API, which hides
   hidden profiles. No profile row gives `null`, which the client renders as
   "Verified voter" in a distinct style, with no link.
   - **The database reserves the label**, after refusing to run over existing
     rows that use it. Pulse is not deployed, so only development data can hit
     that. A database that does must be fixed by hand: rename or delete the
     rows, then re-run (018 runs in one transaction, so nothing is left half
     applied; checked). Profiles are never renamed silently.

     ```sql
     do $$
     declare
       n bigint;
     begin
       select count(*) into n from member_profile
        where lower(regexp_replace(display_name, '\s+', ' ', 'g')) = 'verified voter';
       if n > 0 then
         raise exception '% member profile(s) use the reserved name "Verified voter"; rename or delete them, then re-run 018', n;
       end if;
     end $$;
     alter table member_profile add constraint member_profile_name_not_reserved
       check (lower(regexp_replace(display_name, '\s+', ' ', 'g')) <> 'verified voter');
     ```

   - `PUT /api/me/profile` refuses the name first, with 400 `reserved_name`.
   - Lookalike spellings (other scripts) are not caught. The distinct rendering
     is the main defence.
9. **Poll, listing, creation, results.** `GET /api/polls/:id`, listing rows and
   creation responses always carry `votePrivacy: "anonymous" | "public"`; seed
   and legacy polls carry `"anonymous"`.
   - `POST /api/polls` takes an optional `votePrivacy` (default `"anonymous"`;
     anything else is `bad_request`). The canonical replay input records it
     only when it is `"public"`, so old replay keys are unchanged.
   - Replayed responses come from `poll_creation_replay.public_response`, where
     old rows have no `votePrivacy`. `publicPollReplay` supplies `"anonymous"`
     when it is absent.
   - `/results` gains `votePrivacy`, and its numbers are unchanged. On a
     public-vote poll `confirmedVoters` equals `voters`.
10. **Removal while open.** `DELETE /api/polls/:id/votes/mine`, session
    required. The checks run in this order:
    1. 403 `origin_not_allowed` (the shared Origin hook).
    2. 404 `not_found`.
    3. 409 `anonymous_poll`.
    4. 503 `public_votes_unavailable`.
    5. 401 `sign_in_required`.

    Then, in one transaction after the person lock, with the injected clock
    read after the lock:
    `delete from vote v using public_vote pv, polls p where pv.vote_id = v.id and pv.poll_id = $1 and pv.account_id = $2 and p.id = $1 and (p.closes_at is null or p.closes_at > $now)`.
    `vote_choice` and `public_vote` cascade, so the answer and the name go
    together.
    - When nothing was deleted, a closed poll returns 200 `{ "status":
"closed" }`, since closed polls stay fixed. Otherwise it returns
      `{ "status": "none", "results" }`. A delete returns `{ "status":
"removed", "results" }`, so repeating the call is harmless.
    - `voters`, `confirmedVoters` and the counts of the choices picked fall by
      one. The person may vote again while the poll is open.
    - **Anonymous polls get no removal.** Their ballots are found by cookie or
      code, not by account. Removing them would be different code with its own
      privacy questions.

11. **MCP.** `get_poll` and `get_results` pass `votePrivacy` through as an
    optional strict field. A new tool, `get_public_votes {pollId, cursor?}`,
    returns the same page as `/public-votes` and reads only that route.
    - Each item must be exactly `{ name: string | null, choices: int[] }`. Any
      other key fails the whole body as `upstream_invalid_response`, never
      trimmed.
    - The client (`mcp/client.ts` maps every 404 to `not_found`) maps the
      route's 409 to the tool error `anonymous_poll`.
    - It is limited by the MCP route's 120 requests/minute per IP, and each
      call also counts against the **same** `publicVotesRateLimit` bucket as
      that address's HTTP calls (decision 7). An over-limit call is the
      existing tool error `too_many_requests` (`mcp/client.ts`).
    - **The trusted production MCP origin is `PULSE_WEB_ORIGIN`.** Today
      `main.ts` passes no `mcp` options, so the route trusts only loopback
      `Host` values and refuses every request that arrives through nginx,
      which forwards the browser's `Host`. `main.ts` passes
      `mcp: { publicOrigin: config.webOrigin }`, the one public origin that
      serves both page and API. The route then accepts exactly that `Host`
      (the origin's host **with its port**, as the route compares it today),
      and an `Origin`, when sent, only if it equals it exactly; nothing is
      derived from request headers. `apiBaseUrl` stays unset, so upstream
      reads go to loopback and never back out through the proxy.
      `dev-server.ts` does the same with its `webOrigin`.
    - **nginx forwards `$http_host`, not `$host`.** `$host` drops the port and
      lowercases, so behind an origin with a port (the compose stack's
      `http://127.0.0.1:8080`) the exact `Host` check would refuse every MCP
      call, and the smoke test could only pass on a port-less HTTPS origin
      that CI does not have. Step 3 changes both `proxy_set_header Host`
      lines in `apps/pulse-web/nginx.conf` to `$http_host`, the client's
      `Host` verbatim. Chosen over limiting the smoke test to HTTPS because
      the API's check is an exact comparison with configuration, so its input
      should be the header as sent, and because the same image then works on
      Railway (no port) and locally (port) with one rule. This is no wider
      trust: nginx's `server_name _` already passes any `Host`, and the API
      still accepts only the configured one. A request with no `Host` never
      matches the configured host, so the API refuses it.
    - **Public-proxy smoke test.** Step 3 adds a check that runs the built web
      image in front of the real API image (with a throwaway Postgres and one
      public-vote poll written by SQL), and through the nginx port asserts:
      `POST /api/mcp` with `Host` and `Origin` equal to `PULSE_WEB_ORIGIN`
      lists `get_public_votes` and returns that poll's page; a foreign
      `Origin` or `Host` gets 403; `/public-votes` carries `Cache-Control:
no-store` and `/ballot` carries `private, no-store`; two forwarded
      client addresses get separate `publicVotesRateLimit` buckets, and two
      MCP callers from different addresses do too. It runs in CI beside the
      pulse-web image build, not only by hand as `nginx-smoke.sh` does today.
    - There is no MCP voting tool. ADR-0036 (proposed) plans an account-scoped
      AI ballot, which on a public-vote poll would be a named vote; its
      implementer must reconcile it with this ADR.
12. **Never to the core ledger.** Public-vote names and account links are pulse
    data only. ADR-0039 decision 5's route to core (#398, deferred) carries no
    name, account or `public_vote` row. How such polls cross, if at all, is the
    integration ADR's question.
13. **`/trust` copy (ADR-0039)** must say:
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
    `/trust` copy. The API and web deploy separately. Each step is its own PR
    within `odc-pipeline`'s size limits; split step 2 (for example, cast and
    ballot, then list and removal) if it passes about 400 lines.
    1. Migration 018 and both stores, with conformance cases.
    2. API routes and `API.md`, with creation still refusing `"public"`.
    3. MCP `get_public_votes`, the `PULSE_WEB_ORIGIN` wiring and the
       public-proxy smoke test (decision 11).
    4. **4a, web only:** the public-vote vote card (which sends
       `publicVote: true` with the notice beside it), list, notices and
       `/trust` copy. Nothing can trigger them yet. UI review.
    5. **4b, deployed only after 4a is live:** the API accepts `"public"` at
       creation, and the creation form shows the option. UI review.

## Consequences

- **Risks the operator accepted.** Public votes make coercion and vote-buying
  checkable, and a named answer can reveal sensitive views (health, politics,
  workplace). After close it cannot be removed. The mitigations are that
  anonymous stays the default, the notice comes before voting, and removal
  works while the poll is open.
- **Bulk collection.** The paged route and the MCP tool let anyone, including
  an AI app, harvest every name and answer on every public-vote poll. Only
  `publicVotesRateLimit` and the MCP limit slow it, and both are per IP and in
  memory. Sealed cursors give a scraper no stable per-vote id, but it can still
  diff successive full harvests by name. A scraped name is not taken back by
  removal.
- **A rename relabels the past.** Names are read live, so renaming changes the
  name on every public vote the person has cast, closed polls included. This
  is the operator's choice (2026-11-15). A closed poll's record is fixed in its
  answers, not in its names.
- **What a database copy shows.** Public-vote answers by account, and so by
  email address (`voter_credential`, kind `'email'`). Anonymous polls keep
  exactly ADR-0040's exposure. No public row shares an identity with a cookie
  ballot, and the database refuses one that would. Cast times on two polls
  could still be compared by someone with the copy, though no link is stored.
- Display names are not unique, so two "Ada"s cannot be told apart.
  `public_vote.account_id` references `voter` with no cascade, so future
  account deletion must decide what happens to public votes (orchestrator
  decision).
- **Deploy.** Stop every old API instance before applying 018.
  - An old instance would fail on poll inserts (no `vote_privacy`).
  - An old instance would try signed-out casts on public-vote polls; the new
    trigger now refuses those as errors.
  - An old instance would run the old `confirmVotes`.

  No old instance may serve while any public-vote poll exists. Step 4b's gate
  makes that the operating rule.

### Documents reconciled

None is updated in this PR, which carries only the ADR. The implementing PRs
(decision 14) must update:

- `apps/pulse/API.md`:
  - "The ballot cookie": the "No account id … beside an answer" bullet gains
    "except on public-vote polls, which are not filed under it (ADR-0048)".
  - `GET /api/polls/:id` and the listing (`votePrivacy`), and `/results`.
  - "Confirmed votes" and `POST /api/sign-in/redeem`: anonymous polls only.
  - `/ballot` and `/my-votes`: these now read the session for public votes.
  - `POST …/votes`: `publicVote`, the 409 `vote_privacy_mismatch`, the 401
    and 503, and the order of checks.
  - `/ballot` and `/my-votes`: `Cache-Control: private, no-store` and
    `Vary: Cookie`.
  - "MCP public reads": the trusted origin is `PULSE_WEB_ORIGIN`.
  - The new `/public-votes` and `DELETE …/votes/mine` routes.
  - `POST /api/polls`, `PUT /api/me/profile` (`reserved_name`), and MCP
    (`get_public_votes`).
- `apps/pulse-web/src/screens/Trust.tsx`: decision 13.
- `apps/pulse/README.md`: the 018 upgrade note (Consequences, "Deploy"),
  `publicVotesRateLimit`, and the MCP section (reachable at
  `PULSE_WEB_ORIGIN/api/mcp` in production).
- `apps/pulse/src/main.ts` and `dev-server.ts`: the `mcp.publicOrigin` wiring.
- `apps/pulse-web/nginx.conf`: `proxy_set_header Host $http_host` (decision 11).
- `apps/pulse-web/README.md`: the public-proxy smoke test and its CI job.
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
