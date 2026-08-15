# tally — service rules

- Reads ledger only via GET /events?since= polling. Never its tables.
- Must stay rebuildable from the export — and be tested that way.
- v1 = PLURALITY counting over ballots as recorded. NOT approval (a v1 ballot carries one `choice`, not a set) and NOT latest-vote-per-participant, which is not computable: a ballot carries no voter field (ET-21), so there is nothing to group or supersede by. Parallel methods later behind the same API shape.

Prior art: `docs/reference/odcmcp-prior-art.md` has a candidate tally
payload shape (parallel aggregations, weight/member_count per row).
