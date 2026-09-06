# ADR-0022: One press casts a vote, and the screen says it can be changed

- **Status:** accepted
- **Date:** 2026-09-06
- **Phase:** 0

## Context

`.claude/skills/odc-ui` states a rule without qualification:

> **Always confirm a destructive or binding action** — "You're voting YES on… —
> confirm?" Picking and casting are separate presses.

Pulse does not do this. A swipe, a tap on a ballot half, or an arrow key both
picks and casts, in one press. That has been true since the swipe ballot landed
(#129), and the reasoning for it has only ever lived in a pull request body,
which stops being readable after the squash. `memory/pulse.md` has carried it
as open decision 6 since 2026-08-26, raised by the #130 review, which asked for
an ADR or a line rather than a rule this load-bearing being overridden by prose
in a commit.

The rule is not arbitrary and the override is not free. The same PR that raised
the question shipped a genuine double-cast on tap — a browser tap is
`pointerdown → pointerup → click`, and both the pointer handlers and the half's
own `onClick` answered it, so a first-time voter was told their answer had
replaced an earlier one. The second half of the rule, "never let a double-tap
cast twice", was doing real work.

What justifies the first half being dropped is a property pulse has and a
signing ceremony does not: **an answer is not final.** A vote is changeable
until the poll closes, `changed` is a normal outcome rather than an error, and
re-casting replaces. A confirmation press defends against an irreversible
mistake; there is no irreversible mistake here to defend against. Against that,
a run is meant to move at the speed of an opinion, and a confirm step on every
question of a multi-question run is the largest single tax that could be put on
it.

But that bargain was only half kept. The outcome said "Counted." and nothing
else. Someone who has just been given no chance to confirm, and is not told the
answer can be changed, is in the worst of both worlds: no ceremony _and_ no
reassurance. The reassurance is not a nicety here — **it is the thing standing
in for the confirmation step.**

## Decision

1. **Picking and casting stay one press in `apps/pulse`.** No confirming second
   press on a ballot. This is a scoped exception to `odc-ui`'s confirmation
   rule, justified by changeability, and it does not extend to `services/web`
   or to any pulse action that is not changeable.
2. **The outcome must say the answer is in, and that it can still be changed** —
   plainly, in the words a person would use, on the same screen as the vote.
   `<Outcome>` renders "You can change your answer until this closes." under
   "Counted." and under "That replaces your earlier answer."
3. **That sentence is conditional on the fact, not assumed.** It is a
   `changeable` prop read from `poll.open`, not a constant, so it is never
   printed on a poll where it is untrue. Nothing is promised while the cast is
   still in flight, or when the poll closed before the vote landed.
4. **The rest of `odc-ui`'s rule is untouched.** "Never let a double-tap cast
   twice" still holds and is still tested; so does "`changed` is a normal
   outcome, not an error".

## Consequences

- The confirmation step's job — making sure the person knows what just
  happened and that they are not trapped by it — is done by copy rather than by
  a press. It therefore has to survive a fast read, which is why it is a
  separate sentence in the outcome rather than a footnote or a tooltip, and why
  it is muted rather than faint (faint measures under the 4.5:1 floor on the
  ballot ground).
- Anything added to pulse that is **not** changeable — a donation, a volunteer
  commitment, anything in pillar 3's path to action — falls back under
  `odc-ui`'s rule in full. The exception is bought with reversibility; where
  there is no reversibility there is no exception. Do not read this ADR as "pulse
  does not confirm things".
- A test asserts the sentence for both `counted` and `changed`, and asserts its
  absence while casting and on a closed poll, so a later reorganisation of the
  outcome cannot take the reassurance away silently.
- `odc-ui` gains a pointer to this ADR, so a reader of the rule finds the
  exception rather than finding pulse in violation of it.

### Documents reconciled

- `.claude/skills/odc-ui/SKILL.md` — the confirmation rule now names this ADR
  as the one scoped exception. Updated in this PR.
- `memory/pulse.md` — open decision 6 is settled by this ADR, and open decision
  7 (whether NEXT stays on screen while the results panel is open) is settled
  by the operator in the same change. Both updated **on master at merge time**,
  per the merge checklist in `odc-pipeline`; not on this branch.
- `apps/pulse/API.md` — unchanged. The wire contract already said a vote is
  changeable until close; this ADR is about whether the screen says so.
- No document outside `apps/**` and `.claude/skills/odc-ui` stated the rule
  this ADR scopes.

## Charter check

**None.** Pulse is charter-exempt by the operator decision recorded in
`apps/pulse/CLAUDE.md` and `memory/INDEX.md`, so P1–P4 do not reach this
decision, and this ADR must not be read as loosening them anywhere else. The
two boundaries that survive the exemption are both honored: nothing here reads
or writes across into `services/` or `contracts/`, and the copy it mandates
says what happened to a person's answer, never how anything is counted.
