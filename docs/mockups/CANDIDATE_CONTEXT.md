# ODC mockup candidate context

Updated: 2026-07-30

## Pending primary candidates

- Mobile community: `odc-community-mobile-v1.html`
- Mobile ballot: `odc-ballot-voting-mobile-v1.html`
- Desktop: `odc-ballot-voting-desktop-v1-light.html`

Treat these three light-theme files as the current design baselines and the first mockups to update or review in follow-up work.

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

Three additional decks explore alternate visual directions; none of these
supersede the primary candidates above.

- Governance/privacy flow: `governance-modern-v1.html` — a "Civic Glass"
  translucent treatment applied to a five-item constitutional/binding ballot
  agenda, with a community-home and ballot-detail screen.
- Hub feed, import-ready: `hub-feed-v2.html` — feed, ballot, confirm sheet,
  discussion, and a dedicated loading/empty/error states screen.
- Hub feed, app style: `hub-feed-v3.html` — feed, ballot, confirm, discussion,
  and a dark-mode feed variant.

Both hub-feed decks depict a `discussion` surface with free-text positions and
threaded replies. That is a **post-MVP surface** — `CLAUDE.md` rule 5 (no
free-text content in the event log, MVP) and the current implementation plan
scope this out of Phase 0/1. Treat the discussion screens as forward-looking
illustration, not a claim about what ships first.
