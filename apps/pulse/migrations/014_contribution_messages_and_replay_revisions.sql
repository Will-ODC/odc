alter table contribution
  add column private_messages jsonb not null default '[]'::jsonb;

-- The original response identifies an immutable prefix of the contribution.
alter table contribution_replay
  add column contribution_id text references contribution(id),
  add column participation_count integer check (participation_count between 0 and 500),
  add column update_count integer check (update_count between 0 and 500);

update contribution_replay
set contribution_id = public_response ->> 'id',
    participation_count = jsonb_array_length(public_response -> 'participations'),
    update_count = jsonb_array_length(public_response -> 'updates');

alter table contribution_replay
  alter column contribution_id set not null,
  alter column participation_count set not null,
  alter column update_count set not null,
  drop column public_response;
