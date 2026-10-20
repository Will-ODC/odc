# apps/pulse — Agent Guide

**Pulse is charter-exempt.** This is a deliberate, Will-decided exemption from
the repo-root rule that `docs/charter.md` wins. Pulse does not implement the
charter's democratic-legitimacy machinery and is not held to it: no keypairs,
no signatures, no linkage-map privacy model, no independent verifier, no hash
chain. Do not "fix" this. Do not flag it as a charter conflict.

## Product and roadmap

Pulse is a charter-exempt community voting product. Its roadmap is grouped into
three pillars: email magic-link identity, the guided vote experience, and a path
from votes to action. This is roadmap structure, not a claim that every planned
feature is built. The vote page follows the conversation design chosen in
ADR-0035. Read
[`memory/pulse.md`](../../memory/pulse.md) for current implementation status and
next work.

ADR-0035 names the conversation as the vote page's design of record. Use the
[mockup index](../../docs/mockups/CANDIDATE_CONTEXT.md) to find the current
conversation design and distinguish it from historical decks and alternatives.
See `.claude/skills/odc-design` for design workflow and
`.claude/skills/odc-ui` for implementation guidance.

## Rules that do apply here

- **Pulse may explain how votes are counted, and never claims more than is
  built.** Plain-language copy about how votes are counted and why the count
  can be trusted is welcome; it lives on the "Why you can trust your vote"
  page (`/trust`, #351), linked from the vote card. No copy may say or imply
  that pulse votes are on a hash chain or ledger before they are: today they
  are not. Operator decision of 2026-10-12, ADR-0039; it replaces an
  agent-written rule (#79) that kept counting off the screen entirely.
- **No reads or writes across into `services/` or `contracts/`.** Pulse owns
  its own storage and stands alone. If pulse ever publishes to the ODC ledger,
  it does so through the ledger's public API and nothing else — that is a
  future option, not a current dependency.
- Tests ship with the change, not after (`.claude/skills/odc-testing` still
  applies to how we work, even though the charter does not).
- One small branch per change, named for its ticket: `pulse/<issue>-<short-description>`
  (the GitHub issue number, not a running count — see `.claude/skills/odc-pipeline`).

## Product status and references

`memory/pulse.md` is the current product and implementation status; the plans
and ADRs describe intended direction. A planned API or roadmap item is not a
built feature. Use `apps/pulse/API.md` for the served interface and its explicit
planned sections. Follow ADR-0039: describe only behavior that exists today.

## Layout

```
src/voting/     polls, votes, results — the core domain, storage-agnostic
src/identity/   email, domain allowlist, magic-link claims, voter store
src/http/       the Fastify surface and the signed session cookie
src/authoring/  poll publication rules and storage
src/db/         database connection and migration runner
migrations/     versioned SQL migrations
src/dev-server.ts development entry: seeds a community and poll, then listens
src/main.ts     production entry point
test/           node:test, run against dist/ after `pnpm build`
```

The `@odc/pulse-integration` workspace owns the two cross-package suites that
start the real server and exercise the browser flow over HTTP. It declares
both apps as development dependencies for test setup. This test-only
dependency does not change production ownership or the apps' independent
builds; browser unit and component tests stay in `apps/pulse-web/test/`.
See [ADR-0041](../../docs/decisions/0041-pulse-integration-test-workspace.md).

Run `pnpm --filter @odc/pulse build` before `pnpm --filter @odc/pulse test`;
the tests execute compiled files in `dist/`. Other package commands are
`pnpm --filter @odc/pulse lint` and `pnpm --filter @odc/pulse typecheck`.
