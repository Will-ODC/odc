-- 001: the event log, the runtime role, and the storage-layer guards.
--
-- Run by the migration (owner) role. Forward-only: a mistake is fixed by a new
-- numbered file, never by editing this one (the runner checks a checksum).

-- The runtime role. Roles are cluster-wide, so another database on the same
-- server may already have created it; a concurrent creator is not an error.
-- Its password is set by the runner from LEDGER_APP_PASSWORD, never written
-- here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    BEGIN
      CREATE ROLE ledger_app LOGIN;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
END
$$;

-- One row per event. `line` is the exact canonical export line
-- (export-format.md EX-7..EX-9) without its LF, so the export is every line in
-- seq order, each followed by "\n". The other columns are copies of envelope
-- fields that reads and the guards below need; the CHECKs tie the cheap ones to
-- `line`. `payload` lives only inside `line`.
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
  -- EX-7 fixes the envelope order: seq first, hash last.
  CONSTRAINT events_line_seq CHECK (left(line, 7 + length(seq::text) + 1) = '{"seq":' || seq || ','),
  CONSTRAINT events_line_hash CHECK (right(line, 74) = '"hash":"' || hash || '"}')
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
-- or the insert fails, even if the application is wrong. It takes the same
-- transaction-scoped advisory lock the writer takes (src/db/events.ts
-- APPEND_LOCK_KEY, "ledg"), so two writers that skip the application lock still
-- cannot both read the same tail.
CREATE FUNCTION events_check_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_seq  bigint;
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(1818584167);
  SELECT seq, hash INTO last_seq, last_hash FROM events ORDER BY seq DESC LIMIT 1;
  IF last_seq IS NULL THEN
    IF NEW.seq <> 1 THEN
      RAISE EXCEPTION 'events: first seq must be 1, got %', NEW.seq
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.prev_hash <> repeat('0', 64) THEN
      RAISE EXCEPTION 'events: seq 1 must have prev_hash of 64 zeros'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.seq <> last_seq + 1 THEN
      RAISE EXCEPTION 'events: seq must be %, got %', last_seq + 1, NEW.seq
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.prev_hash <> last_hash THEN
      RAISE EXCEPTION 'events: prev_hash of seq % must equal hash of seq %', NEW.seq, last_seq
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER events_link
  BEFORE INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION events_check_link();

-- Grants are part of the migration. The runtime role reads and appends; it
-- never changes or removes a row.
REVOKE ALL ON events FROM PUBLIC;
REVOKE ALL ON events FROM ledger_app;
GRANT SELECT, INSERT ON events TO ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM ledger_app;
