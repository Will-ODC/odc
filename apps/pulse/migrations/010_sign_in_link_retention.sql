-- #507: spent sign-in links retain only a digest so repeat clicks still hear
-- "already used". No address, community, opt-in, or timestamp is kept here.
create table used_claim (
  token_hash text primary key
);

-- Purge personal data from links spent before this upgrade as well.
with spent as (
  delete from pending_claim where used_at is not null returning token_hash
)
insert into used_claim (token_hash) select token_hash from spent;

-- Expired unused links are removed on the next sign-in-link write, using
-- that write's application clock. No periodic task or database clock is needed.
create index pending_claim_expiry_idx on pending_claim (expires_at);
