# ledger — service rules

- Event tables are INSERT-only, enforced at the storage layer; hash computed at insert; seq assigned here.
- Validation is self-contained against this log only — no calls to other services.
- Ballots are appended in BATCHES (ET-23–ET-25): `ts` quantized to the issue's declared `ballot_batch_interval_ms`; a batch withheld until it holds `ballot_batch_min` ballots, except as the issue's last; internal order NOT arrival order. The shuffle is not verifiable from the log — it is this service's obligation and nobody else can catch a breach of it.
- Duplicate votes are recorded, not rejected — and cannot be de-duplicated on-log: a ballot carries no voter field (ET-21), so there is nothing to group by. One-ballot-per-human is registrar policy, off-log (ET-20).
- Auth: issue_created → operator key; participant_registered → identity service key; vote_cast → **registrar key** (declared in genesis, held by identity; ET-17). NOT a voter signature — ET-22 permanently bars any voter-held key or voter-produced signature in a ballot.
- Genesis MUST declare registrar_pk != operator_pk (ET-9d). That is one string comparison and it is necessary, not sufficient: two distinct keys can still be held by one party and the log cannot tell, so custody (identity holds the registrar key, never the operator key) is policy this service depends on and cannot check.
- NEVER open services/verifier source in the same context as this service.
