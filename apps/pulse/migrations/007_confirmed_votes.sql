-- 007_confirmed_votes — ADR-0040. Forward-only, like every file here.
--
-- A vote is confirmed when it was cast by someone signed in, or when the
-- browser holding its ballot signed in afterwards. A confirmed vote stores a
-- one-way keyed code — HMAC-SHA256 of the account id and the poll id under a
-- key only the server holds — and NEVER the account id or the address. Null
-- means the vote was never confirmed.
--
-- The code is the same for one account on one poll, so two browsers one
-- person confirmed from both carry it. Only that person's MOST RECENTLY CAST
-- vote counts as confirmed; the other still counts in the full totals. That is
-- worked out when results are read (`PostgresVotingStore.results`), from these
-- rows alone, rather than kept in a "this is the confirmed one" flag: with no
-- flag there is nothing for two confirmations racing for one person to leave
-- in a wrong state, so "one confirmed vote per person per poll" holds whatever
-- order concurrent writes commit in.
--
-- Nullable with no default, so existing votes are simply unconfirmed and the
-- column-default guard in test/migrations.test.ts is untouched.
alter table vote add column confirmation text;

-- Only the shape of a code fits here: 64 lowercase hex digits. An account id,
-- an address or a ballot id written into this column by mistake would put the
-- very connection ADR-0040 keeps out of the database right beside the answer,
-- and this refuses it at the storage layer, whatever the code above it does.
alter table vote add constraint vote_confirmation_is_a_code
  check (confirmation is null or confirmation ~ '^[0-9a-f]{64}$');

-- Results group a poll's confirmed votes by code; this serves that, and only
-- holds the rows that have one.
create index vote_poll_confirmation_idx on vote (poll_id, confirmation)
  where confirmation is not null;
