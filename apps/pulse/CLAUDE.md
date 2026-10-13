# apps/pulse — Agent Guide

**Pulse is charter-exempt.** This is a deliberate, Will-decided exemption from
the repo-root rule that `docs/charter.md` wins. Pulse does not implement the
charter's democratic-legitimacy machinery and is not held to it: no keypairs,
no signatures, no linkage-map privacy model, no independent verifier, no hash
chain. Do not "fix" this. Do not flag it as a charter conflict.

## What pulse is

A community votes on something and sees the result. Someone claims an identity
with an email link, watches a short guided story, votes, and is told what action
follows. That is the whole product.

Three MVP pillars, in build order:

1. **Email magic-link identity** — an email link claims an id, and anyone
   with a working address may claim one (ADR-0030). The email's domain decides
   only which community, if any, the person belongs to; an unlisted domain
   means no community (`null`), never a refusal. Domain allowlists are **rows
   in a table**, never code: adding a community's domain is an insert, not a
   deploy.
2. **One-screen story UI** — one screen, guided, media-and-information bites
   with the vote embedded. The design of record is `docs/mockups/pulse-screens/`
   — translucent "Civic Glass" for screens 2–7, dark swipe ballot for screen 1,
   and `hub-feed-v*.html` is NOT the reference. See
   `.claude/skills/odc-design`; build it per `.claude/skills/odc-ui`.
3. **Path to action** — every story solicits ideas, volunteer time, or
   donations, and emails proof of what happened unless the person opted out.

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

## Layout

```
src/voting/     polls, votes, results — the core domain, storage-agnostic
src/identity/   email, domain allowlist, magic-link claims, voter store
src/http/       the Fastify surface and the signed session cookie
src/dev-server  the runnable dev entry: seeds a community and a poll, listens
test/           node:test, run against dist/ after `pnpm build`
```
