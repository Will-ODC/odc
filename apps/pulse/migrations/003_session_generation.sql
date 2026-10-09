-- Revocation ordering is a database counter, independent of API server clocks.
alter table voter add column session_generation bigint;
update voter set session_generation = 0;
alter table voter alter column session_generation set not null;
