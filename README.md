# ODC — Online Democratic Community

Tools for communities to decide things together: talk it through, vote, and
act on the result.

This repo holds two things:

- **pulse** (`apps/pulse`, `apps/pulse-web`) — a voting app people can use
  today. Ask a question, people answer, everyone sees the result. It is kept
  simple on purpose and is exempt from the charter: votes are a plain record,
  with no signatures or public proof.
- **The ODC core** (`contracts/`, `services/`, `tools/`) — a public record of
  deliberation, votes and action that anyone can check for themselves. It is
  built to outlast any one app: apps write to it, and independent verifiers
  confirm nothing was changed. Still in its first phase: the rules (the
  contracts) and two verifiers exist; the record itself does not yet.

Pulse may write to the core one day, through its public API. Today the two
share repository tooling, with separate runtime code and storage.

`apps/pulse` is the API server; `apps/pulse-web` is the browser client. They
are sibling workspace packages because each builds its own Docker image.
The web image fronts the API on one origin, as recorded in
[ADR-0028](docs/decisions/0028-pulse-is-served-as-two-images-on-one-origin.md).

| You want                           | Read                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| Why ODC exists and its rules       | `docs/charter.md`                                                  |
| How and when the core is built     | `docs/implementation-plan.md`                                      |
| Where things stand                 | `memory/INDEX.md`, which points to `STATE.md` (core) or `pulse.md` |
| Pulse: run, test, serve            | `apps/pulse/README.md`                                             |
| Pulse web: pages and settings      | [apps/pulse-web/README.md](apps/pulse-web/README.md)               |
| Working with agents                | [CLAUDE.md](CLAUDE.md)                                             |
| Design references and alternatives | [Mockup index](docs/mockups/CANDIDATE_CONTEXT.md)                  |

## Quickstart

```sh
pnpm i                  # install the workspace and tooling
pnpm lefthook install   # turn on the git hooks

just              # list commands
just test         # run every test (JS packages and the Go verifier)
just rehearsal    # build a sample record and check it with both verifiers
```

To try pulse on your computer, see `apps/pulse/README.md`.

The git hooks check formatting and lint staged files on commit, and run
affected-package tests on push. Run them by hand with `pnpm lefthook run pre-commit`.

The core is done when it can show the whole loop working:
**register → create an issue → vote → count → export → verify.**
