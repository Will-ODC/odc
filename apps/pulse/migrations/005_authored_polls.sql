-- ADR-0037 foundation. Existing labels remain unconstrained until the store
-- rollout adds their foreign keys; existing seed/store writes must keep working.
-- No membership or authorship is invented for legacy data.
do $$
begin
  if exists (select 1 from voter where community = 'pulse-general')
    or exists (select 1 from pending_claim where community = 'pulse-general')
    or exists (select 1 from allowed_domain where community = 'pulse-general') then
    raise exception 'reserved General community key already used';
  end if;
end $$;

create table community (
  id text primary key,
  label text not null
);
insert into community (id, label)
  select community, community from (
    select community from voter
    union select community from pending_claim
    union select community from allowed_domain
  ) labels where community is not null;
insert into community (id, label) values ('pulse-general', 'General');

alter table polls
  add column community text references community (id),
  add column created_by text references voter (id),
  add column attribution_kind text,
  add column author_name text,
  add column hidden boolean not null default false;
-- false is a deliberately declared constant; no timestamp default is allowed.
alter table polls add constraint polls_attribution_check check (
  (created_by is null and attribution_kind is null and author_name is null)
  or (created_by is not null and community is not null and attribution_kind is not null
    and ((attribution_kind = 'anonymous' and author_name is null)
      or (attribution_kind = 'named' and author_name is not null
        and length(btrim(author_name)) between 1 and 80)))
);
alter table polls add constraint polls_id_author_unique unique (id, created_by);
create index polls_author_created_idx on polls (created_by, created_at);

create table publication_acknowledgement (
  voter_id text primary key references voter (id),
  purpose_version text not null check (purpose_version = 'community-purpose-v1'),
  acknowledged_at timestamptz(3) not null
);

create table poll_creation_replay (
  voter_id text not null references voter (id),
  request_key uuid not null,
  poll_id text not null,
  canonical_input jsonb not null check (jsonb_typeof(canonical_input) = 'object'),
  public_response jsonb not null check (jsonb_typeof(public_response) = 'object'),
  primary key (voter_id, request_key),
  unique (poll_id),
  foreign key (poll_id, voter_id) references polls (id, created_by) on delete restrict
);

-- Effective state and audit are separate; the future store changes both atomically.
-- These rows alone confer no authority: runtime grant mutation is owner-only.
create table posting_permission (
  voter_id text primary key references voter (id),
  enabled boolean not null,
  changed_by text not null references voter (id),
  changed_at timestamptz(3) not null
);
create table posting_permission_change (
  id uuid primary key,
  voter_id text not null references voter (id),
  enabled boolean not null,
  changed_by text not null references voter (id),
  changed_at timestamptz(3) not null
);
