-- 004_identity_is_a_credential — an address is something a voter holds, not
-- what a voter is (ADR-0032; docs/plans/pulse.md, P8).
--
-- Forward-only, like 001-003: once applied anywhere, this file is never edited.
--
-- Until now `voter.email` was the voter's natural key, and nothing recorded how
-- a person had been verified. After this file:
--
--   * `voter_credential` holds what a voter has proved: one row per
--     (kind, value), so one address still belongs to at most one voter — the
--     uniqueness `voter.email` carried moves to this primary key. `params`
--     is for what a later kind needs to remember (who vouched, for one).
--   * `voter.assurance` records how sure pulse is of the person, as a plain
--     word whose order lives in code (src/identity/assurance.ts), so a new
--     level is a code change and never a migration — the `polls.method` rule.
--   * A voter is NOT required to hold a credential. The foreign key runs from
--     the credential to the voter and nothing runs the other way, on purpose:
--     a public-link or anonymous voter (P10, decision 4) is a voter with none.
--   * `pending_claim` asks for a credential, so its address becomes a generic
--     `subject` of a `kind`, and the throttling index moves with it.
--
-- New not-null columns are added nullable, filled, then tightened (the 003
-- pattern), because test/migrations.test.ts allows no new column defaults.
-- Every timestamp is application-supplied; the backfill reuses `claimed_at`,
-- the moment each existing voter proved their address.

create table voter_credential (
  kind        text not null,
  value       text not null,
  voter_id    text not null references voter (id),
  params      jsonb not null default '{}'::jsonb,
  verified_at timestamptz(3) not null,
  primary key (kind, value)
);

-- Reading a voter's address back is by voter, not by credential.
create index voter_credential_voter_id_idx on voter_credential (voter_id);

insert into voter_credential (kind, value, voter_id, params, verified_at)
  select 'email', email, id, '{}'::jsonb, claimed_at from voter;

alter table voter add column assurance text;
update voter set assurance = 'email';
alter table voter alter column assurance set not null;

alter table voter drop column email;

alter table pending_claim rename column email to subject;
alter table pending_claim add column kind text;
update pending_claim set kind = 'email';
alter table pending_claim alter column kind set not null;

drop index pending_claim_email_idx;
create index pending_claim_kind_subject_idx on pending_claim (kind, subject);
