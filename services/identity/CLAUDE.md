# identity — service rules

- Own database, never exposed, physically separate from ledger.
- The linkage map never appears in any API response, log line, or export. No exceptions.
- Ordering: emit participant_registered to ledger first; record linkage only on confirmed append; retries safe.
- v1 = keypairs + pseudonyms; blind signatures later behind this same API.
