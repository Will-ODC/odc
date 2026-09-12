# ADR-0026: The fixed-list story model is superseded by the run

- **Status:** accepted
- **Date:** 2026-09-12
- **Phase:** pulse (charter-exempt)

## Context

`apps/pulse-web/src/flow/story.ts` was written before pillar 2 shipped. It
modelled a story as a fixed sequence — `claim → sent → bite[0..n] → vote →
results → action` — and carried the ballot rules a pick-then-confirm screen
would need: `toggleChoice`, `isValidBallot`, `isCastable`, `sameBallot`,
`castLabel` ("Cast my vote (3)").

Nothing in `src/` has ever imported it. Its only importer is its own 221-line
test. A consistency sweep on 2026-09-12 found it and asked whether it was dead
or whether it was scaffolding for the unbuilt middle of the story, which
`memory/INDEX.md` still records as missing.

It is dead, and the code that replaced it says so in its own comments. Three of
its assumptions have each been overturned by a decision taken since:

1. **A story is a fixed list of screens.** `screens/Run.tsx` walks a graph:
   "each choice names the poll it opens, so the run is a path through a graph
   rather than a fixed list of screens". ADR-0024 made computed navigation
   primary, and `poll_choice.next_poll_id` is what carries it.
2. **A story ends in one vote.** `Story.pollId` is singular and `progress()`
   counts `bites.length + 1`. The product is now a run of many small decisions
   — "users decide on bite-sized decisions, which models the community" (the
   operator, 2026-09-12), the principle `docs/plans/pulse.md` P8-P11 rests on.
3. **Signing in is steps 1 and 2 of the story.** `previousStep` carries
   deliberate logic to stop a person walking back into the sign-in panes.
   `Run.tsx` records the opposite: "signing in is a place you can go, never a
   gate you pass through". Since #149 sign-in is its own route, not a step.

The ballot half is superseded more simply: ADR-0022 decided pulse casts on one
press. There is no confirming button for `castLabel` to label and no selection
to `toggleChoice`, on either ballot screen.

## Decision

Delete `apps/pulse-web/src/flow/story.ts` and `apps/pulse-web/test/story.test.ts`.

Do not keep the `Bite` and `Story` interfaces as placeholders. `Bite` is eleven
lines describing an info card, and when the card screens are built their shape
comes from `docs/mockups/pulse-screens/`, which is the design of record per
`.claude/skills/odc-design`. Keeping the rest of the module alongside it would
leave ~90 lines modelling a product shape three decisions have overturned —
and a half-file that still typechecks reads as current to the next session,
which is worse than an absent one.

## Consequences

- ~380 lines go (159 of module, 221 of test). No behaviour changes: nothing
  imported the module.
- The five user-visible strings it carried — "Voting has closed", "Choose at
  least one", "Choose an option", "This is already your vote", "Change my vote"
  — go with it. None was reachable. The live copy for those states lives in
  `components/Outcome.tsx` and the two ballot screens.
- When the bite/case/action screens are built, the step model is designed
  against the run's graph rather than recovered from this file. That is the
  point: recovering it would reintroduce assumption 1.
- `git` keeps the module if it is ever wanted: it was last present at the
  commit this ADR lands on.

### Documents reconciled

- `.claude/skills/odc-ui/SKILL.md` — described `src/flow/story.ts` as a module
  "the screens only render", and listed the screen set as `Claim, Sent, Bite,
Vote, Results, Action`. Neither was true of the client before this ADR and
  both are updated in this PR.
- `memory/pulse.md` — updated at merge time, per `memory/INDEX.md`, not on this
  branch.
- `apps/pulse/API.md`, `apps/pulse/CLAUDE.md`, `apps/pulse/README.md` — none
  mention `story.ts`. Checked; no change needed.

## Charter check

Not applicable. `apps/pulse` and `apps/pulse-web` are charter-exempt by
operator decision — see `apps/pulse/CLAUDE.md` and `memory/INDEX.md`. No
principle P1-P4 is touched: nothing here concerns the ledger, identity
linkage, or any counted record.
