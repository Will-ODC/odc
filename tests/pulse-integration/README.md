# Pulse integration tests

These suites connect the real Pulse browser client to a real Fastify server on
an ephemeral loopback port. Setup uses the API app's in-memory stores, so no
Postgres, mail service or running application is required.

- `test/end-to-end.test.ts` runs the client HTTP adapter in Node.
- `test/conversation-http.test.tsx` runs the React app in jsdom against HTTP.

Both apps are explicit workspace development dependencies. Deep source imports
are test setup only; the browser app uses the public HTTP API. This package is
not part of either production image. See
[ADR-0041](../../docs/decisions/0041-pulse-integration-test-workspace.md).
The import-boundary lint permits this workspace to import either app for test
setup and assertions, but it does not permit imports from core `services/**`,
`tools/**` or `contracts/**`. This exception does not authorize production app
imports. Run
`pnpm test:boundaries` for focused regression coverage; the static check's
limits are documented in the [service-boundaries skill](../../.claude/skills/odc-service-boundaries/SKILL.md)
and [ADR-0042](../../docs/decisions/0042-import-boundary-enforcement.md).

Run from the repository root:

```sh
pnpm exec turbo run test --filter=@odc/pulse-integration
pnpm exec turbo run typecheck lint --filter=@odc/pulse-integration
```

Turbo builds both apps before the integration tests or their typecheck. Changes
to either app select this package in affected runs and invalidate the integration
test cache. For direct iteration, `pnpm --filter @odc/pulse-integration test`
runs Vitest without the upstream builds.
