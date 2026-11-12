-- Public contribution records and private replay ownership are separate.
create table contribution (
  id text collate "C" primary key,
  owner_id text not null references voter(id),
  created_at timestamptz(3) not null,
  public_record jsonb not null
);
create index contribution_newest on contribution(created_at desc, id desc);
create index contribution_owner_recent on contribution(owner_id, created_at);
create table contribution_replay (
  voter_id text not null references voter(id),
  request_key uuid not null,
  canonical text not null,
  public_response jsonb not null,
  primary key (voter_id, request_key)
);
