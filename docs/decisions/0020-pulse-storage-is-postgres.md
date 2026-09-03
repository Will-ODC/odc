# ADR-0020: Pulse stores its data in Postgres

- **Status:** accepted
- **Date:** 2026-09-02
- **Phase:** 0

## Context

Everything durable in pulse is a JavaScript `Map`. Four stores —
`InMemoryVotingStore`, `InMemoryVoterStore`, `InMemoryClaimStore`,
`InMemorySuggestionStore` — hold voters, sessions, votes and suggestions, and
all of it dies with the process. The operator asked on 2026-08-25 for
infrastructure a developer can bring up repeatably and that resembles what will
run in production; `memory/pulse.md` has carried "where pulse's data actually
lives" as an open decision since.

**ADR-0001 already locks "Postgres per service", so the interesting question is
not whether that rule exists but whether it reaches pulse — and on a plain
reading it does not.** The charter names the two reasons for the choice:
"multi-service access and enforceable append-only grants". Neither applies here.
Pulse is forbidden from cross-service reads by `apps/pulse/CLAUDE.md`, so its
database has exactly one client by rule, forever. And it has no event tables:
its votes are one row per `(pollId, voterId)` and re-casting **replaces**, which
is the thing `services/ledger` forbids and pulse is exempt from. `odc-storage`,
which is where ADR-0001's storage half is operationalized, opens with an
explicit "Out of scope: `apps/**`".

So the strict machinery was already scoped away from pulse and only the engine
choice underneath it never was. SQLite was therefore a real option, not a
shortcut, and a narrow ADR scoping ADR-0001's storage line to `services/` would
have been consistent with a workstream already exempt from the charter, from
`odc-storage`, and from the diff-size ceiling.

Two further facts shaped this. **No database driver existed anywhere in the
repo** — no `pg`, Prisma, Drizzle or Kysely in any `package.json`, on any
branch. The "reuse what we already use" argument was unavailable, because
nothing had been built yet. And **CI had no database**: `repo.yml`'s `checks`
job ran with no service container.

## Decision

**Pulse stores its data in Postgres**, in its own database, reached through its
own `docker-compose.yml` with its own container per the convention in
`odc-service-boundaries`.

**What decided it against SQLite: the operator's stated goal is high or highly
dynamic traffic.** That means many processes. SQLite assumes one writer, so it
is out structurally rather than marginally. Recording the rejected option
matters here because every technical argument on the page favours it — pulse's
data is small, its access patterns are five keyed lookups and a single
`GROUP BY`, and SQLite would have made both CI and the dev environment simpler.
It loses on one fact about where the product is going, and that fact is the
whole reason.

Three subordinate choices follow:

- **Plain reviewed SQL migration files with a small runner, not an ORM.** Pulse
  is free of `odc-storage`'s constraints and could use auto-migration; it should
  not. The schema is five tables, pulse will never need model classes, and
  whatever lands here is the first thing an implementer of `services/ledger`
  will look at — where ORM auto-migrate against event tables is forbidden
  outright.
- **Timestamps are supplied by the application, never by the database.** No
  `DEFAULT now()` on any column. A clock is constructor-injected in five places
  (`identity/claim.ts`, `voting/store.ts`, `voting/suggestions.ts`, and twice in
  `http/session.ts`) and every HTTP test runs on a frozen clock. A database
  default silently bypasses all of it while most tests keep passing, which is
  what makes it dangerous rather than merely wrong. Timestamps stay in
  milliseconds: the sub-second lockout bug fixed in `35159dd` came from two
  timestamps disagreeing on precision.
- **The in-memory stores are kept, behind one shared conformance suite run
  against both implementations.** Two implementations of four interfaces will
  drift, and the suite is the only thing that makes keeping them safe. Without
  it the Postgres stores would be effectively untested — the deletable-green
  shape every review of this repo has found.

## Consequences

- **Pulse is the first real Postgres in the repo, and sets a pattern it does not
  govern.** An implementer of `services/ledger` will read pulse's migrations
  first. They must not inherit its looseness: the two-role migration/runtime
  split, forward-only migrations, `REVOKE UPDATE, DELETE` on event tables and
  the insert-only guard test are all still mandatory there. Pulse is exempt;
  nothing downstream of it is.
- **CI gained a database, on the already-required job.** PR #143 puts a
  `postgres:17` service on `repo.yml`'s `checks` job rather than in a new
  path-filtered workflow, because a new job is not a _required_ check until an
  admin edits the `protect-master` ruleset — the same trade `repo.yml` already
  records for the fixtures-manifest and Go verifier steps. **The accepted cost is
  that every PR in the repo now starts a container**, the core's included. Split
  it out when that stops being worth it, and pair the split with the
  branch-protection change.
- **Environment variables are pulse-owned, and nothing is inferred from the
  ambient environment.** `PULSE_DATABASE_URL` and `PULSE_REQUIRE_DATABASE`, not
  `DATABASE_URL` and `CI`. A bare `DATABASE_URL` is among the most widely
  exported variables there is, and reading it aims the suite at whatever
  unrelated database a developer already has configured — harmless while the
  only statement is `select 1`, destructive once these tests run migrations.
- **The dev seed must become idempotent before this lands.**
  `InMemoryVotingStore.createPoll` throws `TypeError: poll already exists`, and
  `dev-server.ts` loops the `SEED` polls through it on every boot. That is fine
  against a fresh `Map`; once storage persists, **the first restart crashes on
  startup**.
- **Do not map host port 5432 in pulse's compose file.** A developer machine
  with a Postgres already listening there silently wins the loopback race, and
  the failure it produces (`role "pulse" does not exist`) does not look like a
  port collision. This cost real time on 2026-09-02.
- **`just up` and ADR-0001's dev-entry promise get closer to true, but are not
  yet true.** There is still no Dockerfile anywhere in the repository, on any
  branch, and `docker-compose.yml` is `services: {}`. Nothing in this ADR
  changes that; do not cite the justfile or ADR-0001 as evidence infrastructure
  exists.

### Documents reconciled

- **`docs/decisions/0001-stack.md`** — says "Postgres per service (own DB,
  append-only grants for event tables)". Pulse choosing Postgres **complies with
  it rather than contradicting it**, so no edit is needed. Had this ADR chosen
  SQLite, ADR-0001 would have required an explicit scope narrowing; it did not,
  and this note records that the question was asked. **Checked, no change
  needed.**
- **`.claude/skills/odc-storage`** — already opens with "Out of scope:
  `apps/**`" and is not contradicted by pulse acquiring a Postgres database. Its
  rules continue to bind `services/**` in full. **Checked, no change needed.**
- **`apps/pulse/API.md`** — describes the HTTP surface and says nothing about
  storage. **Checked, no change needed.**
- **`apps/pulse/CLAUDE.md`** — says pulse "owns its own storage and stands
  alone", which this ADR implements rather than changes. **Checked, no change
  needed.**
- **`memory/pulse.md`** — carries "where pulse's data actually lives" as open
  decision 3, which this ADR settles, and an eight-item deploy backlog whose
  storage entries this ADR answers. **Not updated in this PR, deliberately:**
  memory entries are updated on master at merge time, never on a feature branch,
  per the merge checklist in `.claude/skills/odc-pipeline`. Owed at merge.

## Charter check

**Pulse is charter-exempt** by the operator decision recorded in
`apps/pulse/CLAUDE.md`, so P1–P4 are not the test here and claiming otherwise
would misrepresent the workstream. This section is kept rather than dropped
because the template requires it, and because two boundaries do survive the
exemption and both are checked:

- **"No reads or writes across into `services/` or `contracts/`."** Honoured
  structurally and strengthened: pulse gets its own database with its own
  container, and the one-database-per-service convention means there is no
  shared store for a future shortcut to reach through. If pulse ever publishes
  to the ODC ledger it does so through the ledger's public HTTP API.
- **"The counting is never the subject."** Untouched — this ADR changes where
  rows live and no user-visible string.

For the avoidance of doubt: the append-only, hash-chained, independently
verifiable properties the charter requires of `services/ledger` are **not**
provided here and are not meant to be. Pulse's votes are a plain, mutable
record. A future session reading this ADR as a precedent for `services/**`
storage would be reading it wrong.
