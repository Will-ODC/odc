# ODC mockup candidate context

Updated: 2026-10-20

## Pulse design of record and alternatives

Current build status lives in `memory/pulse.md`. This is the canonical index of
mockup standing; a historical deck is not a description of the running app.

| Record | Standing |
| --- | --- |
| `pulse-screens/09-chat-vote.html`; ADR-0035 | **Current conversation design of record.** The reusable vote card merged in PR #307. |
| [PR #313](https://github.com/Will-ODC/odc/pull/313), #301; [PR #322](https://github.com/Will-ODC/odc/pull/322), #302 | **Built conversation layout.** Compact Vote panel at the top right on desktop, expanding above the composer on phone; one Close button and a Vote tab to reopen. #313 built it; #322 made conversation the default and retired `Run`, `SwipeBallot` and `ChoiceBallot`. |
| `pulse-screens/08-desktop-vote.html`, #298 | Retained three-column desktop alternative, not the current default. |
| `pulse-screens/01-claim.html` through `07-action.html` | Historical split story deck, including the retired dark swipe ballot. Useful for earlier design intent, not the current screen inventory. |
| `pulse-vote-states-v1.html` | Historical layout, retained six-state coverage reference: nothing picked, selection, confirming, many options, already voted, closed without voting. Apply current reversible pick-then-Submit behavior (ADR-0035), not the deck's original irreversible-vote wording. |
| `pulse-story-mobile-v1.html` | Historical original single-file story reference, superseded by the split deck and then the conversation. |
| [Issue #314](https://github.com/Will-ODC/odc/issues/314) | Browser extension idea only; sample-data prototype proposed, browser/access decisions pending. |

Mockup 09 records the chosen conversation direction; the merged top-right panel
is its implemented layout. The assistant remains disabled. Welcome now lives at
`/` (#341/PR #347); explicit `/?poll=ID` and `/conversation?poll=ID` links open
the conversation. `/start` and `/questions` are the welcome flow's next pages.
The extension would be another client, with explicit content-to-poll association;
no live assistant or official votes are part of its first prototype.

## Charter-side ODC: pending primary candidates

- Mobile community: `odc-community-mobile-v1.html`
- Mobile ballot: `odc-ballot-voting-mobile-v1.html`
- Desktop: `odc-ballot-voting-desktop-v1-light.html`

Treat these three light-theme files as the charter-side design baselines and the first mockups to update or review in follow-up work.

## Status

- Candidate status: pending primary
- Not yet approved as final
- Dark-theme files remain alternatives and are not the active baseline
- Preserve the Ballots / Opinions / Actions taxonomy and the Online Democratic Community / verified humans terminology

## Current desktop direction

- Wide ballot workspace with a continuous translucent support panel on the left
- Video followed by a traditional filtered comment thread and a same-height objective AI guide
- AI combines plain-language information, a prominent text input, suggested questions, and source-bound answers
- Related ballots and illustrative past-ballot impact use simple arrow-controlled carousels
- Fixed voting bar contains only `Vote no` and `Vote yes`

## Current mobile ballot direction

- Single-column ballot learning flow with a compact explainer video
- One combined AI `Summary` card containing neutral information, a prominent dialog input, quick questions, and its answer area
- Mobile-friendly traditional comment thread replaces the opinion carousel
- Comment filters remain `Agree / Disagree / Popular / Random`
- Comments include posting, Helpful, Reply, stance labels, and a nested reply
- Fixed voting area uses `Vote no` and `Vote yes`

## Current mobile community direction

- Sleek translucent feed with the ballot used for review retained as the top feature
- Feed taxonomy and filters are `All / Ballots / Opinions / Actions`
- Canonical, project-relevant questions and clear category color coding
- Header uses `Online Democratic Community` and the fake `1,240 verified humans` count

## Shared design decisions

- Light-theme candidates are primary for current iteration
- Keep language short, functional, and easy to scan
- AI should appear objective through neutral summaries, balanced prompts, and source-bound answers
- Prefer traditional comment threads over one-opinion-at-a-time browsing
- Voting controls remain permanently accessible and text-light
- Translucent cards, soft gradients, restrained color taxonomy, and rounded controls define the visual system

## Known follow-up

- Desktop still labels its AI component `Plain-English guide`; mobile now uses `Summary`
- Candidate status remains pending until the three baselines are explicitly approved

## Other explorations (not primary candidates)

The following charter-side explorations do not supersede the primary candidates
above and are not references for Pulse.

- Governance/privacy flow: `governance-modern-v1.html` — a "Civic Glass"
  translucent treatment applied to a five-item constitutional/binding ballot
  agenda, with a community-home and ballot-detail screen.
- Original hub feed: `hub-feed-mockup.html` — historical feed exploration.
- Hub feed, import-ready: `hub-feed-v2.html` — feed, ballot, confirm sheet,
  discussion, and a dedicated loading/empty/error states screen.
- Hub feed, app style: `hub-feed-v3.html` — feed, ballot, confirm, discussion,
  and a dark-mode feed variant.

Both hub-feed decks depict a `discussion` surface with free-text positions and
threaded replies. For these charter-side decks, that is a **post-MVP
surface** — `CLAUDE.md` rule 5 (no free-text content in the event log, MVP) and
the current implementation plan scope this out of Phase 0/1. Pulse is
charter-exempt; its unbuilt comments are tracked separately in #297. Treat the
discussion screens as forward-looking illustration, not a claim about what ships
first.
