-- ADR-0048 step 1 (#685): a poll's votes are anonymous or public, fixed at
-- creation. Every existing poll is anonymous. The SQL below is the ADR's.

-- Decision 1. No column default: every insert path says which it writes. A
-- check, unlike `method`: an unknown value would leave unclear whether names
-- may be shown, and a third kind needs its own ADR.
alter table polls add column vote_privacy text;
update polls set vote_privacy = 'anonymous';
alter table polls alter column vote_privacy set not null;
alter table polls add constraint polls_vote_privacy_check
  check (vote_privacy in ('anonymous', 'public'));

-- Decision 2. Fixed at creation, held by the database.
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

-- Decision 3. A public vote is filed under a fresh `pv:` identity, never the
-- browser's ballot, and its account sits here. The `(poll, 'public')` key
-- refuses an account on an anonymous poll's vote; the `voter_id` check and
-- the three-column key refuse an account beside a cookie-filed row, and,
-- having no `on update`, refuse moving a linked row's `voter_id`.
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

-- A `pv:` row only on a public-vote poll, and only `pv:` rows there. Safe
-- because the setting never changes (decision 2).
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

-- Decision 8. "Verified voter" is what a public vote shows without a profile
-- name, so no profile may take it. Existing rows that use it are never
-- renamed silently: the migration refuses, and they are fixed by hand.
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
