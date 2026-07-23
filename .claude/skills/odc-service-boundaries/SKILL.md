---
name: odc-service-boundaries
description: Rules for creating services, adding endpoints, consuming other services, and changing contracts in the ODC monorepo. Use this skill whenever scaffolding a new service, adding or modifying any API endpoint, writing a client for another service, touching anything in contracts/, or wiring services together.
---

# ODC Service Boundaries

## Every service ships

```
services/<name>/
  README.md      # what it is, how to run it, one paragraph each
  API.md         # every endpoint: method, path, auth, request, response, errors
  src/
  tests/
  docker-compose.yml   # service + its own DB, runnable alone
```

`API.md` is written or updated BEFORE the endpoint is implemented.
If the API can't be written down simply, the design isn't done.

## Adding an endpoint

1. Draft it in `API.md`: noun-based paths, verbs from HTTP methods,
   plural resources (`/events`, `/issues/{id}/tally`).
2. Define every error response now, not when it first happens in prod.
3. Implement; add the tests `odc-testing` requires; done.

## Consuming another service

- Through its public HTTP API only, via one client module per consumed
  service (`src/clients/ledger.ts`). No scattered fetch calls.
- Shared types come from `contracts/` only. Never import another
  service's source. If you're tempted, the type belongs in contracts
  or you're crossing a boundary.
- Every client call handles: timeout, non-2xx, malformed body. The other
  service being down must degrade, not crash.

## Changing `contracts/`

Additive only. The procedure:

1. Propose in `CONTRACTS-CHANGE.md`: what, why, which services affected.
2. Bump the version; old events remain valid forever; verifiers must
   accept all published versions.
3. Add/extend golden fixtures for the new version.
4. NEVER: rename/remove fields, alter hashing, reinterpret existing types.
   If it feels necessary, stop and escalate to an architect planning session
   (Fable, or an Opus starting session acting as architect per the `CLAUDE.md`
   model note) — this is an architecture decision, not an edit.

## Encapsulation test

Before merging, ask: could another agent use this service correctly from
`README.md` + `API.md` alone, without reading the source? If no, the docs
or the design need work. Complexity lives inside; interfaces stay boring.
