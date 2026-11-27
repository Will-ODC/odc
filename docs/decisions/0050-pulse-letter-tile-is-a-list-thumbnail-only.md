# ADR-0050: The Pulse letter tile is a list thumbnail only

- **Status:** accepted. Operator decision of 2026-11-27, recorded under
  "Operator decision" below; the decider is the operator.
- **Date:** 2026-11-27
- **Phase:** 0 (Pulse, charter-exempt; issues #296, #701, #427, #586)
- **Amends:** ADR-0047 section 6 (the `tile` default) and ADR-0049 section 4
  (E1, "same as polls"), narrowly: where the client draws the `tile`. The
  server's default chain, the `image` object and every API body are
  unchanged. Every other rule of both ADRs stands.

## Context

ADR-0047 section 6 resolves every poll's `image` on the server: the poster's
`upload`, then the community's `category` default (#586, not built), then
`{ "kind": "tile" }`, which "the client draws" as a coloured square with the
first letter of the community label. It did not say where. ADR-0049 E1 gave
contributions (and later topics) the same chain.

`docs/plans/pulse.md` P12 step 4 (#296) then said "defaults show as a small
tile" on the question page, and the merged work followed it: #296 (#727)
draws the tile under the question when a poll has no upload, and #701's web
PR (#732) does the same under a contribution's title. The Home/Browse list
does not draw thumbnails yet (#427 is open).

## Operator decision (2026-11-27)

Asked about the green letter tile shown under the question on a poll's own
page when the poster uploaded no picture, the operator answered: "should be
there. it was meant to be in place of where a thumbnail would be on the list
polls view from home", then clarified: "should NOT be there".

Read together: the tile is the thumbnail placeholder in list rows. It was
never meant to appear on an item's own page.

## Decision

1. **The server is unchanged.** Every poll, contribution (and, when built,
   topic) body and listing row keeps carrying `image`, resolved in ADR-0047's
   order, with `{ "kind": "tile" }` as the last default. No new value, field
   or route. Where to draw each kind is the client's choice; ADR-0047
   section 6 already leaves the drawing of the tile to the client.
2. **The tile is drawn in list rows only**: the Home/Browse mixed list and
   any other list of items that shows thumbnails (#427's one row design, and
   profile or "my" lists if they adopt it). There it stays as ADR-0047
   section 6 describes: colour by a stable hash of the community ID, first
   letter of its label, decorative beside the title.
3. **An item's own page shows no picture when the item has no upload.** On
   the question page and the contribution page (and the topic page, #541),
   `image.kind === "tile"` renders nothing: no tile, no placeholder, no
   empty frame or reserved space. The question or title is followed directly
   by the next content (context, byline). This matches the existing rule
   that a failed picture leaves no empty frame (`docs/plans/pulse.md` P12
   step 4).
4. **`upload` on an item page is unchanged**: the display picture under the
   question or title, with its description as alt text, removed without a
   frame if it fails to load.
5. **Not decided here: `category` on an item page.** Whether a site-owner
   community default picture (#586, `kind: "category"`) shows on an item's
   own page, or only as a list thumbnail like the tile, is unsettled. The
   operator's answer was about the generated tile only. Until the operator
   decides, the client keeps its current `category` rendering on item pages
   (the small default size); #586 must get the answer before it ships, since
   `category` is not served before #586.

## Consequences

- No API, server, migration or MCP change. `apps/pulse/API.md` keeps the
  same shapes; one sentence changes to say the client draws the tile in list
  rows.
- Until #427 lands, the tile is drawn nowhere: the list has no thumbnails
  yet, and item pages no longer draw it. That is accepted; #427 is where the
  tile is first meant to appear.
- The tile component survives for #427's list row; only its use on item
  pages goes. memory/pulse.md's leftover #727 nit already expects the tile
  hash to move to a shared module when #427 lands.
- **Open, for the operator:** item-page display of a `category` default
  (decision 5). It belongs in `memory/pulse.md` "Open decisions (operator)"
  (the home `memory/INDEX.md` names for Pulse decisions waiting on the
  operator), added on master at merge time. `memory/OPEN-QUESTIONS.md` is for
  the ODC core only, so it is not used.

### What must change (one follow-up web PR; code not edited here)

- `apps/pulse-web/src/components/ItemPicture.tsx`: `ItemPicture` returns
  nothing for `kind: "tile"` on item pages; `CommunityTile` is kept (or moved
  to a shared module) for #427's list row. `category` handling unchanged
  (decision 5).
- `apps/pulse-web/src/screens/Conversation.tsx` (question page, the
  `ItemPicture` under the `h1`) and
  `apps/pulse-web/src/screens/ContributionDetail.tsx` (the `ItemPicture`
  under the title): no code change needed beyond `ItemPicture` if it stays
  the item-page component; check no wrapper reserves space.
- `apps/pulse-web/src/components/ItemPicture.css`: `span.item-picture--tile`
  styles move with the tile to the list row, or stay for it.
- Tests that assert the tile on an item page, to be inverted (no `img` role
  with the community name; the heading's next sibling is the next content):
  - `apps/pulse-web/test/Conversation.test.tsx`: "opens the first question
    expanded..." (expects the `General` tile after the heading) and the
    `it.each(["category", "tile"])` "renders a small tile for a %s picture"
    (split: `tile` renders nothing; `category` unchanged).
  - `apps/pulse-web/test/Contributions.test.tsx`: "shows the default
    contribution tile without an image element", and any removal-flow
    assertion that expects the tile on the page after the organizer removes
    the picture (the stub returns `{ kind: "tile" }`; the page should then
    show no picture).
  - Fixtures that only pass `{ kind: "tile" }` as data (`Browse.test.tsx`,
    `Profile.test.tsx`, `NewContribution.test.tsx`,
    `session-changes.test.tsx`, `stub-api.tsx`) and the API-shape assertion in
    `tests/pulse-integration/test/contributions-http.test.ts` stay as they
    are: the API is unchanged.
- Mockups: none in `docs/mockups/` depicts the tile on the question or
  contribution page (checked: `pulse-picture-field-v1.html`,
  `pulse-light-v1.html`; `governance-modern-v1.html`'s `status-tile` is
  unrelated). #427's list-row mockup is where the tile is drawn.

### Documents reconciled

- **ADR-0047** section 6 and **ADR-0049** section 4 (E1): amended by this
  ADR as to where the tile is drawn; not edited, as historical records.
- **`docs/plans/pulse.md`** P12 step 4 (#296): "defaults show as a small
  tile" is now wrong for the tile. **Not edited in this PR** (this branch
  carries the ADR only, by instruction); the follow-up web PR changes it to
  "no upload shows no picture; a `category` default's display is open
  (ADR-0050)". Lines 472–479 and 625 describe the server chain and stay
  true.
- **`apps/pulse/API.md`** ("Pictures (ADR-0047, ADR-0049)" and the poll body
  note): "the client draws a generated tile" becomes "the client draws a
  generated tile in list rows; an item page shows no picture". Shapes
  unchanged. **Changed by the follow-up web PR.**
- **`memory/pulse.md`**: its #296 line ("a poll with no upload shows the
  small default tile") is superseded, and the open `category` question is
  added under "Open decisions (operator)". Updated on master at merge time,
  not on this branch.
- `apps/pulse/README.md`, `apps/pulse-web/README.md`,
  `apps/pulse-web/CLAUDE.md`, `docs/mockups/`, `memory/OPEN-QUESTIONS.md`,
  `memory/INDEX.md`: nothing states the item-page tile; no change.

## Charter check

Not applicable: `apps/pulse` and `apps/pulse-web` are charter-exempt
(`apps/pulse/CLAUDE.md`). Nothing here touches `services/` or `contracts/`,
and no copy describes how votes are counted.
