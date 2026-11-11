-- #550: replay markers need an application timestamp so old digests can be
-- purged without a database clock. Existing rows stay null until startup dates
-- them; that conservatively preserves them for one complete retention window.
alter table used_claim add column used_at timestamptz(3);

create index used_claim_used_at_idx on used_claim (used_at);
