# ledger — service rules

- Event tables are INSERT-only, enforced at the storage layer; hash computed at insert; seq assigned here.
- Validation is self-contained against this log only — no calls to other services.
- Duplicate votes are recorded, not rejected — and cannot be de-duplicated on-log: a ballot carries no voter field (ET-21), so there is nothing to group by. One-ballot-per-human is registrar policy, off-log (ET-20).
- Auth: issue_created → operator key; participant_registered → identity service key; vote_cast → **registrar key** (declared in genesis, held by identity; ET-17). NOT a voter signature — ET-22 permanently bars any voter-held key or voter-produced signature in a ballot.
- NEVER open services/verifier source in the same context as this service.
