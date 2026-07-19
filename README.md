# ODC — Online Democratic Community

Public infrastructure for collective decision-making: a permanent, verifiable
record of deliberation, votes, and action. Not an app — apps are clients of it.

- **Why / what:** `docs/charter.md`
- **How / when:** `docs/implementation-plan.md`
- **Where we are:** `memory/STATE.md`
- **Working with agents:** `CLAUDE.md`

## Quickstart

```sh
pnpm i                  # install workspace + tooling
pnpm lefthook install   # wire up local git hooks (pre-commit, pre-push)

just            # list commands
just up         # start all services (docker compose)
just test       # run every service's tests
just verify     # run the Go verifier against a fresh export
```

Local hooks run format + lint on staged files at commit time and unit tests of
changed services at push time. Run them by hand anytime with
`pnpm lefthook run pre-commit`.

Core loop the MVP must demonstrate:
**register → create issue → vote → tally → export → verify.**
