# ADR-0035: Pulse's vote page is a conversation

- **Status:** accepted
- **Date:** 2026-10-11
- **Phase:** 0 (pulse, charter-exempt)

## Context

Pulse votes today on a dark swipe ballot: the question across the top, the
answers as two full-height halves on a phone (`SwipeBallot`), or rows for more
than two answers (`ChoiceBallot`), inside a three-column page on desktop
(`Run`, `AppShell`). On a wide window most of the page is empty.

The operator expects most polls to carry a photo and a short summary from the
poster (#296), and wants a comment system (#297) and, later, an AI assistant
(#280-#284). Two layouts were drawn on 2026-10-11 (#298):

- **08, three columns:** answered and browse on the left, the poll in the
  centre, comments on the right. Two ballot styles: A, the two halves; B, a
  pop-up after the #228 prototype.
- **09, a conversation:** modelled on the Claude app. The poster's photo and
  summary fill the upper page, a conversation sits below, and the vote card is
  docked just above a text box, like the question card Claude shows when it
  needs a choice. A person can also type their vote.

## Decision

The operator chose 09 and made it the default for the app. His answers on its
open questions, 2026-10-11:

1. **The swipe ballot is retired**, on phone as well as desktop. There is one
   way to vote: the vote card.
2. **A run of questions is one conversation.** Pressing Next brings the next
   question's card into the same thread.
3. **After voting, results show in the card's place**, with buttons to hide
   the card and to close it. **Placement superseded by ADR-0044 (2026-10-23):**
   results now sit below the saved answer in the main content; the persistent
   bottom drawer is reserved for voting.
4. **Desktop keeps a left side column** (Answered; browse when #259/#260 land).
5. **Comments are reached by scrolling the upper content** of the page, under
   the poster's summary, not in a side column or in the assistant's thread.

And two rules that follow from the design:

- **Voting by typing goes through an AI app, not a text matcher.** The
  operator's direction (2026-10-11): any AI chat app, and later pulse's own
  assistant, fetches the poll and submits the answer through pulse's MCP
  server or HTTP API (#300). Pulse does no text matching of its own. **Who is
  voting from an AI app, and what confirms a vote before it counts, are open
  decisions in #300.** The mockup's "typing only preselects, you always
  confirm" is a recommendation drawn as a proposal, not a decision.
- **Picking and casting are separate presses** on the card. ADR-0022's
  one-press exception was for the swipe ballot; when #302 retires that ballot,
  no pulse screen uses the exception. ADR-0022 still governs any future
  one-press control, and its other half holds: the screen says the answer can
  be changed until the poll closes.

## Consequences

- Work is the epic #303: the vote card (#299, which takes over
  #205's approval selection), AI-app voting through MCP and the API (#300),
  the page (#301, which sends approval ballots to the API), then the
  switch and the removal of `SwipeBallot`, `ChoiceBallot` and `Run` (#302).
- Parts that wait on other work are labelled gaps on the page, not fakes:
  photo and summary (#296, needs P6), comments (#297, needs ADR-0024's
  moderation values), the assistant (#280-#284: provider, privacy, cost),
  browse (#259/#260), and how a person knows their vote counted (under
  discussion).
- The conversation area has nothing to say until an assistant exists. It
  ships with a plain empty state; the card is how to vote until then.
- The #228 prototype's pop-up and the new docked card share one card
  component, so `/preview/chat` keeps working.
- Screen 08 stays in the deck as the alternative, recorded in the odc-design
  table.

### Documents reconciled

- `.claude/skills/odc-design/SKILL.md`: the table names 09 as the chosen
  direction and 08 as an option (in #298).
- `memory/pulse.md`: the decisions and the epic, in the memory PR that
  follows this one.
- **Deferred to #302, on purpose:** `.claude/skills/odc-ui/SKILL.md` (the
  ADR-0022 exception and the `SwipeDeck` row) and the swipe wording in
  `docs/plans/pulse.md` still describe what is served today, and stay true
  until the swipe ballot is removed. #302's scope names them.

## Charter check

Pulse is charter-exempt (`apps/pulse/CLAUDE.md`). Nothing here touches
`services/` or `contracts/`. The pulse rule that the counting is never the
subject is under reconsideration by the operator and is not changed here; the
page keeps a labelled slot for it.
