# ADR-0041: Pulse integration tests have their own workspace

- **Status:** accepted — operator-approved repository cleanup plan, 2026-10-20
- **Date:** 2026-10-20
- **Phase:** 0 (Pulse, charter-exempt)

## Context

Pulse is two sibling application packages: the API in `apps/pulse` and the
browser client in `apps/pulse-web` (ADR-0028). Two suites in the browser package
exercise both applications over real HTTP. They import API source to construct
an in-memory server and browser source to exercise the real client.

Those imports are not represented by workspace dependencies. Turbo cannot infer
them from relative source imports, so an API-only change can miss these suites
in `test --affected` and does not contribute its source changes to the browser
test task's dependency hash. The browser image also needs a separate typecheck
configuration to exclude tests that import an application absent from its build.

## Decision

1. Move the two suites, preserving their assertions, to the test-only workspace
   `tests/pulse-integration` (`@odc/pulse-integration`). Register that exact path
   in `pnpm-workspace.yaml` and declare both application packages as
   `workspace:*` development dependencies.
2. Keep browser unit and component suites in `apps/pulse-web/test` and API
   suites in `apps/pulse/test`. The integration runner is not a deployable app
   or a third product workstream; the Pulse row in `memory/INDEX.md` includes it.
3. The integration suite uses the existing in-memory API setup and real HTTP
   behavior. It may import the two Pulse implementations for test setup and
   assertions. That permission does not apply to production application code
   and grants no access to the ODC core or its contracts.
4. Connect integration tasks to both application builds in Turbo. Verify that
   changing either application selects the integration suite in affected runs
   and changes its task hash. Cache inputs alone cannot replace the package
   dependencies needed for affected selection.
5. Preserve independent application builds and Docker images. Retain the
   browser image's source-only typecheck configuration, with its explanation
   updated to distinguish shipped source from package-local tests.

No server exports, shared runtime library, shared storage or endpoint changes
are introduced. Automated enforcement of production import boundaries is a
separate follow-up.

## Consequences

- The test runner declares its own testing dependencies and configuration;
  application packages do not depend on one another to run these suites.
- Root Turbo test runs include the integration workspace. Its direct package
  command is `pnpm --filter @odc/pulse-integration test`.
- The browser package declares its own Node type dependency for its existing
  filesystem-based privacy test; it no longer obtains those types incidentally
  through backend imports.
- Existing integration assertions remain active under their new owner. The
  move must not reduce the tested sign-in, voting, replacement, retry or closure
  behavior.
- Cross-package source imports remain confined to the test runner. These are
  implementation-aware integration tests, not a public API for other clients.

### Documents reconciled

- Root `README.md` and `CLAUDE.md`: identify test ownership and entry commands.
- Both Pulse app READMEs and contributor guides: separate app-local tests from
  the shared integration suite and link its README.
- `tests/pulse-integration/README.md`: documents dependencies, commands,
  coverage and the test-only source-import exception.
- `apps/pulse-web/package.json` and `tsconfig.json`: declare and enable the
  Node types used by its own tests.
- `apps/pulse-web/tsconfig.build.json` and `Dockerfile`: explain source-only
  image checks without referring to cross-app tests in the browser package.
- `pnpm-workspace.yaml` and Turbo configuration: register the test workspace
  and express its dependency graph.
- `.claude/skills/odc-testing/SKILL.md` and `odc-ui/SKILL.md`: point contributors
  to the correct test owner.
- `memory/INDEX.md`: structural ownership path only; phase and completion
  status remain merge-time updates.
- `lefthook.yml` and `.github/workflows/repo.yml`: existing affected/root test
  commands discover the new workspace; comments describe that coverage.
- `apps/pulse/API.md`: updates the integration-test path and removes resolved
  client-disagreement notes. No HTTP contract changes.
- ADR-0028: the two-image, one-origin decision remains unchanged; this ADR adds
  test ownership rather than rewriting its historical rationale.

## Charter check

Pulse is charter-exempt. Neither application nor the test runner may import
core service implementations or core contracts. Verifier independence and the
core service/storage boundaries remain unchanged.
