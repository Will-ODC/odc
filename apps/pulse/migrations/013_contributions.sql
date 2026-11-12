-- Public contribution records and private replay ownership are separate.
create table contribution (
  id text collate "C" primary key,
  owner_id text not null references voter(id),
  created_at timestamptz(3) not null,
  private_messages jsonb not null default '[]',
  public_record jsonb not null
);
create index contribution_newest on contribution(created_at desc, id desc);
create index contribution_owner_recent on contribution(owner_id, created_at);
create table contribution_replay (
  voter_id text not null references voter(id),
  request_key uuid not null,
  canonical text not null,
  contribution_id text not null references contribution(id),
  participation_count integer not null check (participation_count between 0 and 500),
  update_count integer not null check (update_count between 0 and 500),
  primary key (voter_id, request_key)
);
