---
name: odc-storage
description: Append-only database and migration discipline for ODC services. Use this skill whenever creating or modifying any database schema, migration, table grant, or ORM configuration in any service — especially anything touching event tables.
---

# ODC Storage Discipline

Rule 4 says any UPDATE/DELETE on event tables is a bug. This skill is how
that rule survives contact with real tooling. Agents default to ORM
auto-migrations with full DDL/DML rights — which silently violates the rule
while all tests pass. Never do that.

## Two-role pattern (every service with a DB)

- **Migration role**: owns DDL, runs migrations, then is not used at runtime.
- **Runtime role**: what the service connects as. On event tables it has
  `INSERT, SELECT` only — migrations explicitly
  `REVOKE UPDATE, DELETE, TRUNCATE` from it.
- Belt-and-suspenders: a trigger on event tables that raises on
  UPDATE/DELETE regardless of role.
- Grants are PART OF THE MIGRATION, never manual setup. A fresh
  `docker compose up` must land in the correct-grants state.

## Migration rules

- Forward-only. No down-migrations on event tables.
- Event tables are additive-only: new nullable columns or new tables.
  NEVER `ALTER` a column that participates in the hash preimage.
- No ORM auto-migrate against event tables — migrations are explicit,
  reviewed SQL files.
- Every migration PR re-runs the insert-only guard test from `odc-testing`
  (attempt UPDATE and DELETE as the runtime role; both must fail).

## Non-event tables

Normal rules apply (identity's linkage map, tally's view caches) — but the
linkage map additionally never leaves identity's own database in any form,
including via migration tooling, dumps, or fixtures.
