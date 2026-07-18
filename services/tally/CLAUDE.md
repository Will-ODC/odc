# tally — service rules

- Reads ledger only via GET /events?since= polling. Never its tables.
- Must stay rebuildable from the export — and be tested that way.
- v1 = approval counting, latest-vote-per-participant. Parallel methods later behind the same API shape.
