# ADR-0039: Pulse explains how votes are counted, and never claims more than is built

- **Status:** accepted — operator decision of 2026-10-12
- **Date:** 2026-10-12
- **Phase:** 0 (Pulse, charter-exempt)
- **Replaces:** the rule "Votes are counted and shown, and the counting is never
  the subject" in `apps/pulse/CLAUDE.md` (written in #79)

## Context

`apps/pulse/CLAUDE.md` carried a rule that pulse UI copy must never mention
hashes, chains, verification, or how a tally is computed, on the grounds that
people do not care and that saying it makes the product about the machinery.
Several later ADRs (0020, 0021, 0023, 0024, 0030, 0033, 0035) recorded that
they "honoured" it, and `.claude/skills/odc-ui` repeated it.

The rule was written by an agent when pulse was scaffolded (#79, commit
`159f16f`). The operator never made it. On 2026-10-12 the operator said the
opposite: someone who has voted should be able to learn why they can trust
that their vote counts, and what they would need to know to check it or help
make it more trustworthy.

The same day the operator decided how pulse votes reach a public record: they
will go onto the ODC core ledger through the ledger's public HTTP API once the
ledger exists. There will be no separate pulse hash chain. Today pulse votes
are on no chain and no ledger, and the ledger is not built.

## Decision

1. **The rule "the counting is never the subject" is dropped.** Pulse may
   explain, in plain language, how votes are counted and why the count can be
   trusted.
2. **The explanation lives on one page,** "Why you can trust your vote", at
   `/trust` in `apps/pulse-web` (#351), linked from the vote card once a vote
   is counted. It needs no sign-in and makes no API calls. It has four parts:
   what pulse does today and cannot promise; the basics (hash, chain of
   records, digital signature, public copy, independent checkers, votes written
   in groups with rounded times); the plan; and how to help.
3. **Never claim more than is built.** No copy anywhere in pulse may say or
   imply that pulse votes are on a hash chain or ledger before they are. The
   page states plainly that they are not yet, and the "check the record
   yourself" affordance from `services/web` stays out of pulse until there is a
   record to check.
4. **Plain language.** Short sentences, no analogies, and every technical term
   explained in one plain sentence where it first appears.
5. **Pulse votes go onto the core ledger through its public API,** not onto a
   pulse-owned chain. This changes nothing that is built today: it is the route
   `apps/pulse/CLAUDE.md` already allowed, now chosen.

## Consequences

- The page is status, not a promise with dates. As the ledger work moves, the
  plan's steps move, and "Today" changes only after the code does.
- The `ResultsPanel` guard test stays: the results panel is about the answers,
  and its word scan now guards against claiming a record or a check pulse does
  not have, rather than against mentioning counting at all.
- Earlier ADRs that say they "honoured" the dropped rule are historical and are
  not edited; this ADR supersedes that rule for future work.
- When pulse votes do reach the ledger, the page must be revised in the same
  change that makes it true, and the "check it yourself" link can then be
  added.

### Documents reconciled

- `apps/pulse/CLAUDE.md` — the rule is replaced with the new one, in this PR.
- `.claude/skills/odc-ui/SKILL.md` — the "Pulse goes further" paragraph and
  its checklist line are rewritten, in this PR.
- `apps/pulse-web/src/components/ResultsPanel.tsx` and
  `apps/pulse-web/test/ResultsPanel.test.tsx` — comments that cited the rule are
  rewritten, in this PR.
- `.claude/skills/odc-design/SKILL.md` — its checklist line "no counting
  machinery in pulse" is rewritten, in this PR.
- `docs/plans/pulse.md` — the standing boundary "the counting is never the
  subject" is rewritten to the new rule, in this PR.
- `apps/pulse/CLAUDE.md` still calls publishing to the ledger "a future option,
  not a current dependency". That remains accurate (nothing depends on it yet)
  and is left as it is.

## Charter check

Pulse is charter-exempt (`apps/pulse/CLAUDE.md`), so P1–P4 do not govern it.
The page describes the core ledger's design accurately and does not relax any
charter rule for `services/`: the core's plain-language dictionary and trust
affordances in `odc-ui` are unchanged.
