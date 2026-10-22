# mcp — service rules

- Resources = tally and ledger reads; tools = vote casting submitted to identity, which admits the ballot; the separate signer signs it as registrar (`event-types.md` ET-17, ADR-0043). Nothing mcp or the voter holds signs a ballot (ET-22).
- On the submission path, mcp gives no receipt (ET-21a): never which line or batch holds a ballot, never a verifiable statement that it was admitted, appended, or what it chose.
- Built last: everything below it must already be trustworthy.
- Any logic beyond wrapping is a design smell — push it down and flag it.

Prior art: see `docs/reference/odcmcp-prior-art.md` before building —
a tested SDK skeleton and two reasoning-aid prompts exist in a local prototype.
