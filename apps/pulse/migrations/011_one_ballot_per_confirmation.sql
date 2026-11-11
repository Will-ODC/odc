-- 011_one_ballot_per_confirmation — ADR-0046. Forward-only, like every file here.
--
-- A confirmed person now holds ONE ballot per poll. 007 kept every ballot a
-- person confirmed and counted only the most recent as confirmed, so the full
-- totals counted a person who voted from two browsers twice. Now a cast while
-- signed in replaces the person's other ballot on the poll, and signing in
-- keeps the later of the two (`PostgresVotingStore`). The comments in 001 and
-- 007 describe the old rule; migrations are never edited, so this is where the
-- change is recorded.
--
-- Existing duplicates first: for each (poll, code) holding more than one
-- ballot, keep ADR-0040's survivor — the latest cast, an exact tie going to
-- the greater ballot identity in byte order, as `confirmedTally` orders them —
-- and delete the rest. Their `vote_choice` rows cascade. Closed polls too: the
-- index below cannot depend on a closing time. The confirmed numbers do not
-- change; `voters` and `count` fall by the ballots removed.
delete from vote
where confirmation is not null
  and id not in (
    select distinct on (poll_id, confirmation) id from vote
    where confirmation is not null
    order by poll_id, confirmation, cast_at desc, voter_id collate "C" desc
  );

-- The rule held by the database, not only by the store: at most one ballot
-- per poll carries a given code. It also serves results' grouping by code,
-- which is what the index it replaces was for.
create unique index vote_poll_confirmation_key on vote (poll_id, confirmation)
  where confirmation is not null;

drop index vote_poll_confirmation_idx;
