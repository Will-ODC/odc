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

1. **Email magic-link identity** — an email link claims an id; the email's
   domain is the membership proof. Domain allowlists are **rows in a table**,
   never code: adding a community's domain is an insert, not a deploy.
2. **One-screen story UI** — one screen, guided, media-and-information bites
   with the vote embedded. Translucent "Civic Glass" style from
   `docs/mockups/` (see the pulse UI notes; `hub-feed-v*.html` is NOT the
   reference).
3. **Path to action** — every story solicits ideas, volunteer time, or
   donations, and emails proof of what happened unless the person opted out.

## Rules that do apply here

- **Votes are counted and shown, and the counting is never the subject.** No UI
  copy about hashes, chains, verification, or how a tally is computed. People
  do not care; saying it makes the product about the machinery instead of the
  vote.
- **No reads or writes across into `services/` or `contracts/`.** Pulse owns
  its own storage and stands alone. If pulse ever publishes to the ODC ledger,
  it does so through the ledger's public API and nothing else — that is a
  future option, not a current dependency.
- Tests ship with the change, not after (`.claude/skills/odc-testing` still
  applies to how we work, even though the charter does not).
- One small branch per change; `pulse/<n>-<short-description>`.

## Layout

```
src/voting/   polls, votes, results — the core domain, storage-agnostic
test/         node:test, run against dist/ after `pnpm build`
```
