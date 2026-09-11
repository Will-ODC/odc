-- 001_initial — the whole of pulse's storage, first cut.
--
-- Forward-only: once applied anywhere, this file is never edited. A correction
-- is a new numbered file, and the runner refuses to start if an applied file's
-- checksum changed, so that is enforced rather than hoped for.
--
-- Two rules run through every table here, and both are the kind a later reader
-- tidies back in. `test/migrations.test.ts` fails if either goes:
--
--   * NO `default now()` ON ANY COLUMN (ADR-0020). A clock is
--     constructor-injected in five places and every HTTP test runs on a frozen
--     one; a database default bypasses all of it while most tests keep passing.
--     `timestamptz(3)` keeps the milliseconds the application works in — the
--     sub-second lockout bug in 35159dd came from two timestamps disagreeing
--     on precision.
--   * `polls.method` IS PLAIN `text` — no enum, no check constraint
--     (ADR-0021). Either would make adding a vote method a migration. Methods
--     are validated in code against a registry instead.

-- The four voting tables are ADR-0021's, column for column.

create table polls (
  id                  text primary key,
  question            text not null,
  -- Plain text on purpose. See the header. Do not constrain it.
  method              text not null,
  -- Per-method knobs: {"maxScore": 5}, {"credits": 100}. The database never
  -- queries into it. Nothing writes it yet — the vote-method registry is still
  -- to come — and it is here now so the first method with knobs is a code
  -- change rather than a migration. Do not delete it as dead.
  method_params       jsonb not null default '{}'::jsonb,
  created_at          timestamptz(3) not null,
  -- Null means the poll never closes on its own.
  closes_at           timestamptz(3),
  accepts_suggestions boolean not null,
  -- Whether a run may START here, rather than being reachable only through
  -- another poll's onward link. Deciding it retroactively would need a
  -- backfill, so it is recorded when the poll is written.
  is_entry_point      boolean not null
);

create table poll_choice (
  -- A stable identity, which is what lets a poll gain a choice or be reordered
  -- without invalidating a vote. Votes reference this, never the position.
  id           uuid primary key,
  poll_id      text not null references polls (id) on delete cascade,
  -- Display order only.
  position     integer not null,
  label        text not null,
  -- The poll this choice opens next; null ends the run. Deliberately NOT a
  -- foreign key: a poll graph is authored in whatever order its polls are
  -- written, so a forward link routinely names a poll not inserted yet.
  next_poll_id text,
  unique (poll_id, position)
);

create table vote (
  id       uuid primary key,
  poll_id  text not null references polls (id) on delete cascade,
  -- The ballot identity from the browser's cookie. NOT a foreign key to voter:
  -- a vote counts before anyone signs in, so most voter_ids here have no row
  -- in voter and never will.
  voter_id text not null,
  cast_at  timestamptz(3) not null,
  -- One answer per person per poll; re-casting REPLACES. Correct for pulse and
  -- a rule-4 violation in services/ — never a precedent for event storage.
  unique (poll_id, voter_id)
);

create table vote_choice (
  vote_id   uuid not null references vote (id) on delete cascade,
  choice_id uuid not null references poll_choice (id) on delete cascade,
  -- What the pair means depends on the method: 1 for single and approval, a
  -- rank for ranked, a score for score/STAR, points for cumulative. Integer
  -- rather than numeric because pg returns numeric as a string.
  value     integer not null default 1,
  primary key (vote_id, choice_id)
);

-- Options people add themselves. Not choices: a suggestion cannot be voted for.
create table suggestion (
  id       uuid primary key,
  poll_id  text not null references polls (id) on delete cascade,
  -- The first wording submitted; later matching wordings do not replace it.
  text     text not null,
  -- How many people have now said something like it.
  count    integer not null,
  added_at timestamptz(3) not null
);

create table voter (
  id                  text primary key,
  -- Normalized address, the natural key: one voter per address.
  email               text not null unique,
  community           text not null,
  claimed_at          timestamptz(3) not null,
  proof_emails_opt_in boolean not null,
  -- Sessions issued before this no longer count. Null until the first sign-out
  -- — never epoch zero, which would compare as a real timestamp.
  sessions_valid_from timestamptz(3)
);

create table pending_claim (
  -- The SHA-256 of the magic-link token, hex. THE TOKEN ITSELF IS NEVER
  -- STORED: someone reading this table cannot sign in as anyone.
  token_hash          text primary key,
  email               text not null,
  community           text not null,
  proof_emails_opt_in boolean not null,
  created_at          timestamptz(3) not null,
  expires_at          timestamptz(3) not null,
  -- Set the moment it is redeemed. A link works exactly once.
  used_at             timestamptz(3)
);

-- Outstanding links for an address, to throttle requests: the one query over
-- this table that is not by primary key.
create index pending_claim_email_idx on pending_claim (email);

-- Who counts as a member of which community. These rows are the whole
-- configuration: adding a community's domain is an insert, never a deploy.
create table allowed_domain (
  community          text not null,
  -- Lowercase, e.g. "student.ubc.ca".
  domain             text not null,
  -- When true, subdomains count too. Off unless someone decided it.
  include_subdomains boolean not null,
  primary key (community, domain)
);
