# Pulse web — Agent Guide

The web app is Pulse's browser client. Read [Pulse's shared rules](../pulse/CLAUDE.md)
before changing it; those rules apply to both packages, including the charter
exemption and the requirement to describe only behavior that is built (ADR-0039).
The product roadmap is in `memory/pulse.md`; the server's current interface is
`apps/pulse/API.md`. Planned work in either document is not a claim that it is
implemented.

## Ownership and boundary

- `apps/pulse-web` owns browser screens, navigation, client state and API calls.
- `apps/pulse` owns server behavior and storage. The browser communicates through
  the public HTTP API documented in `apps/pulse/API.md`; it does not import server
  code or access storage.
- Production serves the client and API on one origin, with nginx forwarding
  `/api`; see [ADR-0028](../../docs/decisions/0028-pulse-is-served-as-two-images-on-one-origin.md)
  and the API guide's origin checks.
- Sign-in links contain a secret query token. Preserve the page's early
  `no-referrer` policy and nginx's query/referrer-safe logging; see the shared
  [web README security notes](./README.md#keep-these-rules) and the token route
  in [`apps/pulse/API.md`](../pulse/API.md).

## Layout and commands

`src/screens/` contains routed pages, `src/components/` reusable UI,
`src/flow/` interaction logic, `src/hooks/` client state and data hooks, and
`src/api/` HTTP calls and response types. `src/App.tsx` composes routes;
`src/main.tsx` starts the browser app. Browser tests are in `test/`, using
Vitest. The two real-HTTP cross-package suites live in the dedicated
`@odc/pulse-integration` workspace, which declares both apps as development
dependencies for test setup. Browser unit and component tests stay here;
production client code communicates through the API. See
[ADR-0041](../../docs/decisions/0041-pulse-integration-test-workspace.md).

```sh
pnpm --filter @odc/pulse-web dev
pnpm --filter @odc/pulse-web test
pnpm --filter @odc/pulse-web lint
pnpm --filter @odc/pulse-web typecheck
pnpm --filter @odc/pulse-web build
```

Run the cross-package integration suites with
`pnpm --filter @odc/pulse-integration test`. The matching checks are
`pnpm --filter @odc/pulse-integration typecheck` and
`pnpm --filter @odc/pulse-integration lint`. Root Turbo test commands include
these suites, while normal app builds remain independent.

The canonical mockup status index is
[`docs/mockups/CANDIDATE_CONTEXT.md`](../../docs/mockups/CANDIDATE_CONTEXT.md).
Keep `/trust` aligned with ADR-0039: it explains the current counting honestly
and never says votes are on a hash chain or ledger before that is built.
