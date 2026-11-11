-- #550: replay markers need an application timestamp so old digests can be
-- purged without a database clock. Existing rows stay null until startup dates
-- them; that conservatively preserves them for one complete retention window.
-- Expired pending_claim rows are now also purged at startup and on redeem, not
-- only on the next sign-in-link write as migration 010's comment says.
alter table used_claim add column used_at timestamptz(3);

create index used_claim_used_at_idx on used_claim (used_at);
