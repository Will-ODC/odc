-- #576: opt-in public member profiles. The public UUID is deliberately
-- unrelated to the owning voter id and remains stable across edits/hiding.
create table member_profile (
  voter_id text primary key references voter (id),
  public_id uuid not null unique,
  display_name text not null check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
  ),
  bio text not null check (
    bio = btrim(bio)
    and char_length(bio) between 0 and 280
  ),
  visible boolean not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  check (updated_at >= created_at)
);
