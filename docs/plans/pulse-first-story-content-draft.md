# Pulse first story — simple welcome and progress draft

> **Historical draft.** Status lines below are as of the draft's date and are not
> kept current; `memory/pulse.md` holds where Pulse stands now.

**Content draft · 2026-10-12.** Question content is not published. Entry merged in PR #347; tutorial and centred layout are in PR #363.

## Flow for review

**Welcome → Start voting → one-screen progress/purpose → related votes.**

The existing welcome introduction and 1/2/3 steps stay simple. After Start voting,
show a second screen with recent work and why ODC exists, then a prominent
**Help choose what comes next** button. This interprets the operator's answer
about what happens after Start voting; it is merged in PR #347.

Each screen must fit without scrolling at standard text size on mobile and
desktop. Enlarged text/zoom must remain usable. No compulsory video or tutorial.

## Welcome screen

### Help shape an Online Democratic Community

A place where people discuss ideas, decide together and work toward action.

1. **Understand** — Read the explanation and question.
2. **Discuss** — Compare ideas and add your view.
3. **Vote** — Choose an answer and press Submit.

**Start voting**

Use “Comments are coming soon” until #297 is available. Video #339 comes later.

## Screen after Start voting — proposed visible copy

### What we're building together

**Built · 20 October 2026**

- Email-confirmed votes, with both result numbers.
- Post a question, anonymous by default.
- A shorter "How votes count" page.
- Vote cards open when a question loads.

**Why ODC?**

- **Your data has value.** Social platforms gain value from it. ODC aims to put
  its control and benefits back in your hands.
- **Anonymity stays an option.** Optional verification can give stronger
  evidence that contributions come from distinct people, rather than bots.
  Everyone’s ballot remains equal in ODC’s charter.
- **Shared resources, shared decisions.** Our goal is to pool resources and
  choose together how to use them to improve members' wellbeing.

**Help choose what comes next**

These purpose statements describe the goal, not guarantees already delivered
by Pulse. No paragraph about implementation machinery belongs on this screen.

## Crucial related votes — choose any, answer one at a time

| Question                                  | Short choices                                                     | Intended follow-through                                              |
| ----------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| How should the voting page look?          | Conversation / Question with discussion below / Compare both      | Review comparable previews, then a design proposal.                  |
| How should optional data be used?         | No extra collection / Ask separately for each use / Explain first | A concrete purpose/consent proposal; voting is not personal consent. |
| How should the website cover its costs?   | Donations / Approved advertising / Compare proposals              | Show costs, spending plans and terms before a funding trial.         |
| When should we vote on these rules again? | Every three months / Every year / When a change is proposed       | A review/revote proposal with clear timing.                          |

Discussion prompt on each: **What would you change?**

These are related questions for everyone, independent of earlier answers.
There are no answer-dependent branches in this draft. The related-question
list may offer the other votes without forcing a vote to proceed; it must not
pretend they are answer-selected Next destinations.

A funding preference does not spend pooled money or adopt a spending policy.
A later concrete funding proposal must show what the money would support and
how allocation is decided. No action or data sharing is triggered by a vote.

## Editorial checks and dependencies

- Recent-work items must come from dated, merged changes, with source links
  available without cluttering the main text. Replace the period/items as the
  window advances; never label PR #347, comments or the tutorial as built yet.
- Evidence for this sample window: merged PRs #386 (confirmed votes, both
  result numbers), #393 (posting a question, anonymous by default), #405
  (shorter "How votes count") and #403 (vote cards open on load), all merged
  on 20 October in America/Vancouver (earlier window: #313/#322/#344, 11
  October). The sample is static, not a live
  changelog service. Merged code is not proof of a deployed website.
- **Charter boundary:** anonymous ballots remain equal (charter §§3, 5, 8).
  Verification may improve confidence in contributed data; it must not imply
  less voting power for anonymous people. Avoid nationality labels for bots.
- Pulse is charter-exempt. Do not claim its features implement all ODC
  constitutional/contracts guarantees. Describe the shared purpose and
  reviewed work honestly; keep core guarantees distinct from app progress.
- Optional verification, data control, consent, funding and democratically
  allocated resources are goals/proposals here, not shipped features.
- #341 / PR #347 implements welcome, progress/purpose and independent related
  links. Fresh review APPROVE at cc3a864; all six CI jobs pass. It preserves direct poll
  and sign-in links. Missing configured IDs show Coming soon. Merged as 08e1474.
- #342 tutorial and operator-requested centred intro styling are in ready, unmerged
  PR #363 (`1ae5906`). Local checks pass; all six CI jobs pass; fresh review APPROVE. The live demo is
  for design review, with sample polls separate from unpublished foundation content.
  Do not assume a practice/demo is wanted or cast votes through coach controls.
- #297 public comments, approved UI comparison previews, published first polls
  and related navigation remain full-walkthrough dependencies.
- Poll creation, anonymity and reporting stay with the other chat. No API,
  schema or permission changes are proposed here.
- #339 optional sketch video should tell the same short story; production and
  integration can follow after static content/flow review.

## Source links

- [Confirmed votes, PR #386](https://github.com/Will-ODC/odc/pull/386)
- [Posting a question, PR #393](https://github.com/Will-ODC/odc/pull/393)
- [How votes count, PR #405](https://github.com/Will-ODC/odc/pull/405)
- [Vote cards open on load, PR #403](https://github.com/Will-ODC/odc/pull/403)
- [Welcome PR #347](https://github.com/Will-ODC/odc/pull/347)
- [Tutorial #342](https://github.com/Will-ODC/odc/issues/342)
- [Comments #297](https://github.com/Will-ODC/odc/issues/297)
- [Video #339](https://github.com/Will-ODC/odc/issues/339)
