# ledger — service rules

- Event tables are INSERT-only, enforced at the storage layer; hash computed at insert; seq assigned here.
- Validation is self-contained against this log only — no calls to other services.
- Duplicate votes are recorded, not rejected; interpretation belongs to tally.
- Auth: issue_created → operator key; participant_registered → identity service key; vote_cast → registered participant signature.
- NEVER open services/verifier source in the same context as this service.
