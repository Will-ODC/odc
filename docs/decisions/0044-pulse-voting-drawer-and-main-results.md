# ADR-0044: Pulse voting drawer and main-content results

- **Status:** accepted
- **Date:** 2026-10-23
- **Phase:** 0 (pulse, charter-exempt)

## Context

ADR-0035 put results in the vote card's place. The implementation placed that
card at the top right on desktop. Issue #422 calls for a persistent bottom
voting drawer. The operator refined its results placement on 2026-10-23:
results belong in the upper main content immediately below the user's answer,
and the drawer should default open when voting and be dedicated to voting.
This direction supersedes #422's original acceptance text putting results in
the drawer.

## Decision

Every question uses a bottom voting drawer on phone and desktop. It opens
with the choices visible, requires selection followed by explicit Submit,
and retains sending, retry and change-answer behavior. Closing leaves a Vote
handle; opening it never submits a ballot. A new question starts expanded
without carrying another question's unsent selection.

After submission, results and confirmation appear below the saved answer in
the main content, together with Change my answer and Next where applicable.
The drawer's handle then reads Change my answer and reopens voting to change it.
Closed-question results also appear in main content and never enable casting.
Main content and the drawer scroll independently so each remains reachable.
Results use compact rows without repeating the saved answer or its privacy
reminder. How votes count is a small circular info link immediately after Change
my answer. The live page has no Show me how tutorial control.
This changes layout, not vote storage, identity or APIs.

## Consequences

Results remain readable outside the voting surface. Keyboard focus follows a
successful submission to results and returns to the selected choice when
changing an answer. The existing sample-data preview retains its reusable card;
this decision governs the live question page. No drawer is invented for pages
without a poll, and no placeholder comments or assistant controls are added.

### Documents reconciled

- ADR-0035 marks its former results placement as superseded by this decision.
- `docs/mockups/CANDIDATE_CONTEXT.md` records the updated placement; historical
  mockup files remain historical references.
- `apps/pulse-web/README.md` describes the live drawer and main-content results.
- `memory/pulse.md` remains unchanged on the feature branch; reconcile its
  placement wording during the operator's merge checklist on master.

## Charter check

Pulse is charter-exempt. This changes only the browser layout and documentation;
no core services or contracts are involved.
