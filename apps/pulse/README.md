# pulse

A community votes on something and sees the result.

Someone claims an identity with an emailed link, watches a short guided story,
votes, and is told what action will follow. Membership in a community is proven
by the email's domain.

Pulse lives in the ODC monorepo but is a separate epic from the charter-governed
services in `services/`. It is intentionally exempt from the charter's
legitimacy machinery — see [CLAUDE.md](./CLAUDE.md) before changing anything
here.

## Status

Early. This package currently holds the voting core: polls, one vote per voter,
and results as counts. Identity (magic link), the story UI, and the path to
action are not built yet.

## Development

```bash
pnpm --filter @odc/pulse build
pnpm --filter @odc/pulse test
```

Lint, typecheck, and tests also run on every PR through the repo-wide CI in
`.github/workflows/repo.yml`, the same checks the rest of the monorepo uses.
