# web — service rules

- Can start against mocks generated from contracts/.
- Keys are invisible to users: generated and stored client-side, exportable for the curious. The key is the registrant's own, which signs `participant_registered` v2 (`event-types.md` ET-10; ADR-0043: position-free, so sign without waiting for the ledger, after reading the chain's genesis hash); it never signs a ballot — ballots are signed by the registrar key, held by the signer service (ET-17, ET-22, ADR-0043).
- On the submission path, web gives no receipt (ET-21a): never which line or batch holds a ballot, never a verifiable statement that it was admitted, appended, or what it chose. "Accepted" or "refused", unauthenticated, is allowed.
- Follow the odc-ui skill for every user-facing string — plain language, enforced.
- MVP pages: register · issue list · issue detail + vote · results · 'verify this yourself' link.
