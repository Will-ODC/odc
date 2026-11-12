-- ADR-0047 step 1 (#579): poll pictures, stored in Pulse's own Postgres.
--
-- The storage is neutral: `image` holds a picture's metadata and its link to
-- what shows it (`owner_kind`, `owner_id`), `image_bytes` its two re-encoded
-- WebP variants. A picture is pending (no owner, no alt text, visible to
-- nobody) until it is attached. The original upload is never stored.
-- `uploaded_by` is private and never leaves the server.
create table image (
  id uuid primary key,
  uploaded_by text not null references voter (id),
  uploaded_at timestamptz(3) not null,
  -- The display variant's size, which fits within 1600 x 1600.
  width integer not null check (width between 1 and 1600),
  height integer not null check (height between 1 and 1600),
  owner_kind text check (owner_kind in ('poll', 'community')),
  -- Deliberately not a foreign key: the owner kind says which table it names.
  owner_id text,
  alt text,
  attached_at timestamptz(3),
  constraint image_pending_or_attached check (
    (owner_kind is null and owner_id is null and alt is null
      and attached_at is null)
    or (owner_kind is not null and owner_id is not null
      and attached_at is not null and alt is not null
      and length(btrim(alt)) > 0 and char_length(alt) <= 300)
  )
);
-- The pending sweep and the per-account pending count.
create index image_pending_idx on image (uploaded_at) where owner_kind is null;
-- One account's pictures (the pending count).
create index image_uploader_idx on image (uploaded_by, uploaded_at);
create index image_owner_idx on image (owner_kind, owner_id);

-- Written once, never updated, and deleted only with the `image` row
-- (ADR-0047 section 1): the cascade is the only way bytes go.
create table image_bytes (
  image_id uuid not null references image (id) on delete cascade,
  variant text not null check (variant in ('display', 'thumb')),
  bytes bytea not null check (octet_length(bytes) > 0),
  -- SHA-256 of `bytes`, which is the served ETag. Never a hash of the upload.
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  primary key (image_id, variant)
);

create function image_bytes_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'image bytes are written once and never updated';
  end if;
  -- Inside the cascade from `image` the parent row is already gone.
  if exists (select 1 from image where id = old.image_id) then
    raise exception 'image bytes are deleted only with their image row';
  end if;
  return old;
end $$;
create trigger image_bytes_guard before update or delete on image_bytes
  for each row execute function image_bytes_guard();

-- Every picture has both variants by the end of the transaction that made it.
create function image_has_variants() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from image where id = new.id)
    and (select count(*) from image_bytes where image_id = new.id) <> 2 then
    raise exception 'an image needs its display and thumb variants';
  end if;
  return null;
end $$;
create constraint trigger image_has_variants after insert on image
  deferrable initially deferred
  for each row execute function image_has_variants();

-- The hourly upload quota (ADR-0047 section 11) counts these rows, not
-- `image` rows: removing, replacing or sweeping a picture deletes its `image`
-- row and must never refund an upload. Deliberately no link to the picture.
-- Rows are never updated, and the store deletes one only once it is older
-- than the quota's one-hour window, so no account's upload history is kept
-- beyond what the quota needs.
create table image_upload (
  id uuid primary key,
  uploaded_by text not null references voter (id),
  uploaded_at timestamptz(3) not null
);
create index image_upload_uploader_idx
  on image_upload (uploaded_by, uploaded_at);

create function image_upload_no_update() returns trigger
language plpgsql as $$
begin
  raise exception 'image_upload rows are never updated';
end $$;
create trigger image_upload_no_update before update on image_upload
  for each row execute function image_upload_no_update();

-- A poll's current picture. The store keeps it consistent with the image's
-- owner link; one picture belongs to at most one poll.
alter table polls add column image_id uuid unique references image (id);

-- The append-only change table (ADR-0047 section 9). It holds no picture
-- content. `target_id`, `image_id` and `actor_id` are deliberately NOT foreign
-- keys: a later purge deletes the poll and the picture and keeps this row.
create table content_change (
  id uuid primary key,
  target_kind text not null check (target_kind in ('poll', 'community')),
  target_id text not null,
  image_id uuid,
  -- The stored display variant's SHA-256 (its public ETag), never the upload's.
  image_sha256 text check (image_sha256 ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('image_attach')),
  actor_kind text not null check (actor_kind in ('poster', 'site_owner', 'auto')),
  -- Private: the acting account where there is one.
  actor_id text,
  reason text,
  changed_at timestamptz(3) not null
);
create index content_change_target_idx
  on content_change (target_kind, target_id, changed_at);

create function content_change_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'content_change is append-only';
end $$;
create trigger content_change_append_only
  before update or delete on content_change
  for each row execute function content_change_append_only();
create trigger content_change_no_truncate
  before truncate on content_change
  for each statement execute function content_change_append_only();
