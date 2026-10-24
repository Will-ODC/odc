-- 002: the batcher's own records (src/batching, src/db/batching.ts).
--
-- Ledger-internal; never exported, never served. Every table is INSERT-only,
-- like `events`: a row records a fact ("this seal was asked for", "the signer
-- answered with this batch"), and where a batch stands is derived from which
-- rows exist. Nothing here is about a ballot's submitter, and nothing records
-- when a ballot arrived: the ledger never sees ballots, only counts per choice
-- (ADR-0043). No table has an arrival-ordered key or a created_at column.

-- A seal the ledger is about to ask the signer for. Written BEFORE the call,
-- so a crash between the signer sealing and the ledger recording the answer
-- is finished by re-asking with the same seal_id (the signer answers the same
-- seal_id with the same batch).
CREATE TABLE batch_seal_intents (
  seal_id    text    PRIMARY KEY CHECK (seal_id ~ '^[0-9a-f]{32}$'),
  issue_id   text    NOT NULL CHECK (issue_id ~ '^[0-9a-f]{64}$'),
  last       boolean NOT NULL,
  -- The batch instant (ET-23), in ms since the epoch.
  instant_ms bigint  NOT NULL,
  -- ET-24a backstop: no two seals of one issue ever share an instant.
  UNIQUE (issue_id, instant_ms)
);

-- An issue has at most one last batch (ET-25).
CREATE UNIQUE INDEX batch_seal_intents_one_last
  ON batch_seal_intents (issue_id) WHERE last;

-- The signer sealed: its batch id and counts per choice (index = choice).
CREATE TABLE batch_seal_results (
  seal_id  text      PRIMARY KEY REFERENCES batch_seal_intents (seal_id),
  batch_id text      NOT NULL UNIQUE CHECK (batch_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  counts   integer[] NOT NULL CHECK (
    cardinality(counts) BETWEEN 2 AND 64
    AND array_position(counts, NULL) IS NULL
    AND 0 <= ALL (counts)
  )
);

-- The signer refused a non-last seal (for example under ballot_batch_min).
-- Nothing was sealed; the issue tries again at a later instant.
CREATE TABLE batch_seal_refusals (
  seal_id text PRIMARY KEY REFERENCES batch_seal_intents (seal_id),
  code    text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,64}$')
);

-- Exactly the inputs of the one sign call for a batch, written and committed
-- BEFORE the call, while the writer lock is held. Replay sends these, unchanged.
-- Every payload is {issue_id, choice}; `choices` holds them in the ledger's
-- order (ET-25: not arrival order).
CREATE TABLE batch_sign_requests (
  batch_id        text      PRIMARY KEY REFERENCES batch_seal_results (batch_id),
  issue_id        text      NOT NULL CHECK (issue_id ~ '^[0-9a-f]{64}$'),
  first_seq       bigint    NOT NULL CHECK (first_seq >= 2 AND first_seq <= 9007199254740991),
  ts              text      NOT NULL,
  first_prev_hash text      NOT NULL CHECK (first_prev_hash ~ '^[0-9a-f]{64}$'),
  choices         integer[] NOT NULL CHECK (
    cardinality(choices) >= 1
    AND array_position(choices, NULL) IS NULL
    AND 0 <= ALL (choices)
  )
);

-- The batch is done: its run committed (appended), or it was an empty last
-- batch with nothing to append. It commits apart from the run, by design:
-- recovery checks the log first (the batcher's `alreadyAppended`).
CREATE TABLE batch_completions (
  batch_id text    PRIMARY KEY REFERENCES batch_seal_results (batch_id),
  appended boolean NOT NULL
);

-- The operator asked to close the issue: seal its open batch as the last.
CREATE TABLE batch_issue_closes (
  issue_id text PRIMARY KEY CHECK (issue_id ~ '^[0-9a-f]{64}$')
);

-- A seal has one outcome: a result or a refusal, never both. The xact lock
-- (per seal_id) serializes concurrent inserts so each sees the other's commit.
CREATE FUNCTION batching_one_outcome() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(1650553960, hashtext(NEW.seal_id));
  IF EXISTS (SELECT 1 FROM batch_seal_results WHERE seal_id = NEW.seal_id)
    OR EXISTS (SELECT 1 FROM batch_seal_refusals WHERE seal_id = NEW.seal_id)
  THEN
    RAISE EXCEPTION 'seal % already has an outcome', NEW.seal_id
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER batch_seal_results_one_outcome BEFORE INSERT
  ON batch_seal_results FOR EACH ROW EXECUTE FUNCTION batching_one_outcome();
CREATE TRIGGER batch_seal_refusals_one_outcome BEFORE INSERT
  ON batch_seal_refusals FOR EACH ROW EXECUTE FUNCTION batching_one_outcome();

CREATE FUNCTION batching_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['batch_seal_intents', 'batch_seal_results',
    'batch_seal_refusals', 'batch_sign_requests', 'batch_completions',
    'batch_issue_closes']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
      FOR EACH STATEMENT EXECUTE FUNCTION batching_refuse_change()',
      t || '_no_update_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I
      FOR EACH STATEMENT EXECUTE FUNCTION batching_refuse_change()',
      t || '_no_truncate', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('REVOKE ALL ON %I FROM ledger_app', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO ledger_app', t);
  END LOOP;
END
$$;
