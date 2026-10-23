-- 001: the event log, the runtime role, and the storage-layer guards.
--
-- Run by the migration (owner) role, which is trusted to run only reviewed
-- migrations: as owner it could disable or drop these guards, so
-- tests/db/migrations-scan.test.ts fails any migration that tries. Forward-only:
-- a mistake is fixed by a new numbered file (the runner checks a checksum).

-- The runtime role. Roles are cluster-wide, so another database on the same
-- server may already have created it. Its password is set by the runner.
DO $$ BEGIN
  CREATE ROLE ledger_app LOGIN;
EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
END $$;

-- One row per event. `line` is the export line (EX-7..EX-9) without its LF; the
-- CHECKs refuse a row whose columns disagree with it, so the link trigger checks
-- what the export shows. That `line` is canonical (key order, escaping, no
-- duplicate keys) is the application's EV-26 check, not the database's.
CREATE TABLE events (
  seq       bigint PRIMARY KEY CHECK (seq >= 1 AND seq <= 9007199254740991),
  type      text   NOT NULL CHECK (type ~ '^[a-z][a-z0-9_]*$'),
  version   bigint NOT NULL CHECK (version >= 1 AND version <= 9007199254740991),
  ts        text   NOT NULL,
  prev_hash text   NOT NULL CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  hash      text   NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  line      text   NOT NULL,
  -- A canonical line never holds a raw LF (EX-9 escapes it).
  CONSTRAINT events_line_single CHECK (strpos(line, E'\n') = 0),
  -- EX-7 order: seq first; prev_hash then hash last (13 + 64 + 10 + 64 + 2).
  CONSTRAINT events_line_seq CHECK (left(line, 7 + length(seq::text) + 1) = '{"seq":' || seq || ','),
  CONSTRAINT events_line_tail CHECK (
    right(line, 153) = '"prev_hash":"' || prev_hash || '","hash":"' || hash || '"}'),
  CONSTRAINT events_line_fields CHECK (line::jsonb @> jsonb_build_object(
    'seq', seq, 'type', type, 'version', version, 'ts', ts,
    'prev_hash', prev_hash, 'hash', hash))
);

-- Rule 4, belt and braces: whatever the role, the table refuses every change
-- but INSERT. Statement-level, so it fires even when no row matches.
CREATE FUNCTION events_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events is insert-only: % refused', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER events_no_update_delete
  BEFORE UPDATE OR DELETE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_refuse_change();

CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_refuse_change();

-- ES-6/ES-7/ES-24 at the storage layer: a new row continues the chain exactly,
-- or the insert fails. It takes the writer's advisory lock (src/db/events.ts
-- APPEND_LOCK_KEY), so writers that skip it still cannot both read one tail.
CREATE FUNCTION events_check_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last record;
BEGIN
  PERFORM pg_advisory_xact_lock(1818584167);
  SELECT seq, hash INTO last FROM events ORDER BY seq DESC LIMIT 1;
  -- An empty log takes seq 1 with a prev_hash of 64 zeros (ES-7).
  IF NEW.seq <> coalesce(last.seq, 0) + 1
     OR NEW.prev_hash <> coalesce(last.hash, repeat('0', 64)) THEN
    RAISE EXCEPTION 'events: seq % / prev_hash does not continue head seq %',
      NEW.seq, coalesce(last.seq, 0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER events_link
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_check_link();

-- Grants are part of the migration: the runtime role reads and appends only.
REVOKE ALL ON events FROM PUBLIC;
REVOKE ALL ON events FROM ledger_app;
GRANT SELECT, INSERT ON events TO ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM ledger_app;
