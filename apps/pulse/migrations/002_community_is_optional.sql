-- 002_community_is_optional — a person may have no community (ADR-0030).
--
-- Forward-only, like 001: once applied anywhere, this file is never edited.
--
-- Anyone with a working email address may now sign in. An address whose domain
-- matches a row in `allowed_domain` still gets that community; every other
-- address gets none, and "none" is stored as null. Not an empty string and not
-- a placeholder community: either would read as a community that exists, and
-- a later "join a community" step would have to know to treat it as absent.
--
-- Recorded at claim time on `pending_claim` and copied onto `voter` at the
-- first redeem, so both columns change together. No default is added — the
-- application always writes the column, null included (see the header of 001
-- and `test/migrations.test.ts`).
--
-- ADR-0024 said its three `polls` columns would land in "migration 002". This
-- file takes the number instead, because the runner refuses a file numbered
-- below one already applied (src/db/migrate.ts); they move to the next free one.

alter table voter alter column community drop not null;

alter table pending_claim alter column community drop not null;
