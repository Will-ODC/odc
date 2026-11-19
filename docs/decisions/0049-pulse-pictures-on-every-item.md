# ADR-0049: Every Pulse main-page item can carry a picture

- **Status:** accepted. Operator decisions of 2026-11-18, recorded under
  "Operator decisions" below; the decider is the operator.
- **Date:** 2026-11-18
- **Phase:** 0 (Pulse, charter-exempt; issues #700, #701, #427, #541)
- **Amends:** ADR-0047, narrowly: section 1's "pictures on contributions are
  not planned" and section 6's "contribution rows carry no `image` object"
  (and their empty slot); and D0's "polls or contributions for now", which
  E3 extends to discussion topics. Every other ADR-0047 rule, including
  operator decisions D0–D9 and D4a, is kept and applied to each new item kind
  as stated below.

## Context

Operator direction, 2026-11-18, verbatim: "All polls, posts, questions or
whatever goes on main page should take images as well, like Rediit."

ADR-0047 gave polls one picture and ruled contribution pictures out ("not
planned"), saying a later owner needs "a new owner kind and its own ADR
amendment for visibility, removal and reporting rather than a table
migration". This is that amendment.

What exists on master (bb8f265):

- **Picture storage is built** (#579, migration 016). `image` holds metadata
  and a neutral owner link (`owner_kind` in `poll`, `community`; `owner_id`
  text, deliberately not a foreign key); `image_bytes` holds the two WebP
  variants, deleted only with their `image` row. `image_upload` counts the
  hourly quota. `polls.image_id` (unique) names a poll's current picture.
  `content_change` is the append-only audit table, `target_kind` in `poll`,
  `community`, action `image_attach` only. Whether a picture may be served is
  decided in one function, `mayServe` (`apps/pulse/src/images/visibility.ts`).
- **Contributions** (#246, PR #572, migrations 013/014): `contribution`
  (`id` text, `owner_id` private, `public_record` jsonb, `private_messages`)
  and `contribution_replay` (canonical input, counts; the replayed response is
  rebuilt from the current record). Each has a community (the organizer's, or
  General). There is no `hidden` flag. The detail response already carries
  `canManage`, computed from the session, under `Cache-Control: no-store`.
- **The main list is mixed in the client** (`flow/browse-items.ts`) from two
  listings, `GET /api/polls` and `GET /api/contributions`. Poll rows carry
  `image` (`upload` or `tile`); contribution rows carry none.
- **Discussion topics** (#541) are not designed or built. Their ticket already
  says a topic takes an optional picture "through the shared picture field
  (#700) and the picture rules of the ADR extending ADR-0047".
- **Migration numbers:** 017 is the last applied; 018 is claimed by ADR-0048
  step 1 (#685).

The word "posts" in the direction is read as contributions and, when built,
discussion topics: those are the only non-poll items the main page shows or
is planned to show. If the operator meant another item kind, it follows the
same rules by adding an owner kind (section 1).

## Operator decisions (2026-11-18)

Asked after the first draft of this ADR; answered by the operator the same
day. Question text as asked, answer as given.

- **E1 — "Default for a contribution or topic without a picture: the
  community's default, a default per contribution type, or no default (the
  empty slot)?"** Answer: "Same as polls": the community's default picture,
  then a generated tile. The empty slot is dropped.
- **E2 — "One picture or several per item?"** Answer: one picture per item.
- **E3 — "Does the site owner's soft delete extend to discussion topics?"**
  Answer: yes, same as polls and contributions.

## Decision

### 1. One store, one owner kind per item kind

A picture on any item is a row in the existing `image` table with its bytes in
`image_bytes`, linked by `owner_kind` and `owner_id`, exactly as ADR-0047
section 1 decided. No second picture table, no per-kind bytes table.

- **Owner kinds:** `poll` (built), `community` (category defaults, #586),
  `contribution` (#701), `topic` (#541). A kind is added by the migration of
  the step that first attaches it, never ahead of the table it names: the
  `topic` kind arrives in #541's migration, not now.
- **The item names its current picture** with its own nullable, unique
  `image_id uuid references image (id)` column, as `polls.image_id` does. For
  contributions this is a column on `contribution`, **not** a field inside
  `public_record`: the picture is projected at read time from the current
  link (section 4), so a remove or replace never has to rewrite the stored
  public record or the replay, and a replayed creation response shows the
  picture as it is now (contribution replays already rebuild from the current
  record).
- **The #701 migration** (next free number at build time; 019 or later while
  ADR-0048's 018 is pending) widens `image.owner_kind` and
  `content_change.target_kind` checks to add `contribution`, and adds
  `contribution.image_id`. It drops and re-creates the two check constraints;
  it never edits migration 016. #541's migration does the same for `topic`.
- **Visibility per kind, in `mayServe`:** a `contribution` picture is served
  only if it is the contribution's current picture and the contribution is
  visible (today: it exists; #585's soft delete joins this, as polls' does in
  #584). A `topic` picture follows the same shape with whatever visibility
  #541 defines. One function still decides for every kind, and every body and
  listing row calls it, so a body never points at a picture its route refuses.
- **Routes stay where they are.** `POST /api/poll-images` remains the single
  upload route and `GET /api/poll-images/:id/{display,thumb}.webp` the single
  serving route for every kind. A pending picture is attached to nothing and
  has no kind until an item claims it, so one upload route is the natural
  shape. Rejected: renaming to `/api/images` now. It buys only a name, and
  costs the nginx upload location, the client, `API.md`, MCP output, tests and
  the picture URLs already stored in poll creation replay responses, which
  would then need a permanent alias anyway. The path is a historical name;
  `API.md` says so.
- **Attach at creation.** Each item's creation route gains the same optional
  `image: { "id": <uuid>, "alt": <text> }` as `POST /api/polls`: the picture
  must be pending and uploaded by the same account; attaching is part of the
  creation transaction; the picture id is part of the canonical replay input;
  a replay attaches nothing twice; refusal is 422 `image_unavailable`. For
  contributions that is `POST /api/contributions`, whose strict schema gains
  the field.

### 2. Rules kept from ADR-0047, now for every kind

Unchanged and applied to contributions and topics as they apply to polls:

- **Processing and limits (ADR-0047 sections 3 and 11):** JPEG, PNG, WebP by
  content; no SVG, GIF, HEIC or animation; 10 MiB, 40 MP, 8,000 px, 200 px
  minimum; every upload re-encoded with all metadata dropped; `display`
  within 1,600 px and `thumb` 256 square centre crop (D3).
- **Quotas are per account across all kinds:** 20 accepted uploads per rolling
  hour and 5 pending pictures at once, counted from the same `image_upload`
  and `image` rows whatever the picture is later attached to. A person
  posting polls and contributions shares one allowance; a second allowance per
  kind would double what one account can store. Replacing counts toward it.
- **Alt text required (D2)**, 1–300 code points; decorative (`alt=""`) in the
  list beside the title, the picture's text alternative on the item's page.
- **One picture per item (E2)**, as built for polls. No galleries.
- **Bytes and `image` row go together**, with the retention exception for
  reported or auto-hidden pictures (ADR-0047 sections 1, 8, 9).
- **What is public (ADR-0047 section 12):** the same `image` object fields
  only. Never the uploading account. A contribution's or topic's picture
  reveals nothing about its poster that the item does not already show.

### 3. Who may remove or replace (D0, D1)

- **The poster**, meaning the account that published the item: for a
  contribution, its owning account (the organizer, `owner_id`); for a topic,
  its author. Routes per kind, the shape of #582's:
  `DELETE /api/contributions/:id/image` and `PUT /api/contributions/:id/image`
  with `{ "id": <pending uuid>, "alt": <text> }`; topics get the same under
  their own path in #541. Each writes a `content_change` row
  (`image_remove`, `image_replace`). #701's migration adds both actions to
  the `content_change.action` check unless #582 has already added them;
  whichever merges first adds them, the other reuses them. Both answer the item's own 404 when
  the item is not visible.
- **How the poster learns they may do it:** for contributions, the existing
  `canManage` in `GET /api/contributions/:id` (session-derived, `no-store`) is
  enough; no new route. It is true only for the owner and reveals nothing to
  anyone else. Polls keep ADR-0047 section 8's private route, because a
  poll's public body says nothing about the viewer.
- **The site owner does not moderate pictures separately (D0).** Their tool is
  soft-deleting the whole item: polls in #584, contributions in #585, and
  discussion topics (E3) in #541, with the same 30-day restore window and
  purge (D8), which deletes every `image` row the topic owns.
- **Purge:** #585's contribution purge, in one transaction, first sets
  `contribution.image_id` to null (the foreign key would otherwise refuse the
  delete), then deletes every `image` row whose owner is the contribution
  (current and still-retained earlier pictures), with any bytes left, as
  #584 does for polls.
- **Interim emergency path (D9 applied).** Pictures ship before reporting and
  soft delete for contributions too. A contribution has no `hidden` flag, so
  until #585 the only emergency path for an abusive contribution picture is a
  database operator, in one transaction: inserting a `content_change` row
  (`image_remove`, actor kind `site_owner`, the display variant's SHA-256,
  a reason), then setting `contribution.image_id` to null, then deleting the
  `image` row (the cascade removes the bytes; the triggers allow exactly
  this). The `image_remove` action exists by then, because contribution
  pictures arrive only with #701, whose migration adds it (above). This is a real deletion, not
  a hide; it is accepted because no review exists yet to need the picture.
  `DEPLOY.md` states it beside the poll `hidden` path.

### 4. Defaults and the listing contract (#427)

- **Every public body and listing row of every kind carries `image`.** One
  server projection builds it for all kinds (today's `publicPollImage`
  becomes kind-neutral). The shape is ADR-0047's, unchanged, with no new
  value:
  - `{ "kind": "upload", displayUrl, thumbUrl, width, height, alt }`,
  - `{ "kind": "category", displayUrl, thumbUrl, width, height, alt }` (#586),
  - `{ "kind": "tile" }`, drawn by the client from the item's community.
- **One default chain for every kind (E1, "same as polls"):** the poster's
  visible `upload`, then the item's community default (`category`, once #586
  builds defaults), then the `tile`. Until #586 lands, an item without an
  upload shows the tile. A contribution's community is the one it already
  carries; a topic uses its community if #541 gives it one, else General's,
  as legacy polls do.
- **The empty slot is dropped.** ADR-0047 section 6's empty slot for
  contribution rows existed only because contributions had no picture; every
  row now has an `image`, so no `none` value or empty slot is needed.
- **Where `image` appears:** `GET /api/contributions` rows, `GET
/api/contributions/:id`, `GET /api/profiles/:publicId/contributions` and
  `GET /api/me/contributions` rows, alongside polls' existing places. One
  listing request per page still supplies every thumbnail: no per-item fetch
  (#427's acceptance).
- **The client's row** is one design for every kind (#427): thumbnail from
  `thumbUrl` or the tile, decorative, beside the title; a failed
  picture never hides the title, state or link.

### 5. Reporting and automatic hiding (#583)

- **Picture reports are per owner kind:** target kinds `poll_image` (built by
  #583), `contribution_image`, `topic_image`, in #233's shared report store,
  under D6 (signed-in only) and ADR-0037's approved limits (ten an hour, one
  unresolved report per reporter and target, reporter private).
- **Automatic hide at 3 distinct reporters (D7) for every kind.** The item
  falls back as section 4 says for its kind and stays visible; the poster may
  replace; the hidden picture is purged 30 days after it stopped being shown.
- **Who adds a target:** #583 builds the store with a target per owner kind
  that has pictures when it is built. A kind whose pictures land later adds
  its own target in its own ticket: `contribution_image` in #701 if #701
  merges after #583, else #583 adds it; `topic_image` in #541.
- **Whole-item reports** stay as decided: poll reports go to the site owner's
  review and never hide a poll (ADR-0047 section 9). This ADR adds no
  whole-contribution or whole-topic report target; that belongs to #233/#585
  (contributions) and #297's moderation rules (topics, per #541).

### 6. Topics (#541)

#541 takes a picture by these rules with no further ADR: owner kind `topic`,
`topic.image_id`, attach in its creation route, poster remove/replace,
`topic_image` reports, the same default chain (E1), and site-owner soft
delete with restore and purge (E3). Its own design (mockup first, as its
ticket says) decides the topic's table, visibility and attribution; it must
call `mayServe` for its kind, treat a soft-deleted topic as not visible, and
use the shared field (#700).

### 7. The shared picture field (#700)

One web component for every posting form: choose, preview
(`img-src 'self' blob:`, ADR-0047 section 4), required description, Remove and
Replace, uploading state, and type, size, busy and network errors that keep
the draft. Its copy shows the limits of section 2. #580 (polls), #701
(contributions) and #541 (topics) adopt it; no form builds its own.

### 8. Audit

`content_change` gains target kinds as owner kinds arrive (section 1) and
actions as steps first write them. Every attach, remove, replace, automatic
hide and purge of any kind's picture is a row, with the stored `display`
variant's SHA-256 and no content (ADR-0047 section 9).

### 9. Build order and tickets

ADR-0047's steps are unchanged; this ADR inserts and widens:

| Order | Ticket | What                                                                                                                                                                                           | Depends on                         | Scope change                                                                                                                                                                     |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #579   | Store, upload, poll `image` (built)                                                                                                                                                            | —                                  | none                                                                                                                                                                             |
| 2     | #700   | Shared picture field: mockup, operator approval, component                                                                                                                                     | this ADR                           | cites ADR-0049                                                                                                                                                                   |
| 3     | #580   | Poll form adopts the field                                                                                                                                                                     | 1, 2                               | already uses #700                                                                                                                                                                |
| 4     | #701   | Contributions: migration (owner kind, `contribution.image_id`, audit kind), attach in creation, `image` on every contribution body and row, page display, form via #700, poster remove/replace | 1, 2; #598 if first                | **Yes:** at least a server PR and a web PR; includes remove/replace; fallback is the tile until #586, then the community default; adds `contribution_image` if #583 merged first |
| 5     | #427   | One thumbnail row for polls and contributions, reading `image` from both listings                                                                                                              | 1; 4's server PR for contributions | **Yes:** contributions show thumbnails or tiles like polls (no empty slot); may ship polls first                                                                                 |
| 6     | #296   | Picture on the question page (polls)                                                                                                                                                           | 1                                  | none                                                                                                                                                                             |
| 7     | #582   | Poll remove/replace                                                                                                                                                                            | 1, 3, 6                            | none                                                                                                                                                                             |
| 8     | #583   | Reports and auto-hide                                                                                                                                                                          | 1, 6, 7                            | **Yes:** a picture target per owner kind with pictures at build time (`contribution_image` if 4 merged first)                                                                    |
| 9     | #584   | Poll soft delete (ADR-0047)                                                                                                                                                                    | 8                                  | none                                                                                                                                                                             |
| 10    | #585   | Contribution soft delete                                                                                                                                                                       | 9, 4                               | **Yes:** purge deletes the contribution's `image` rows and bytes; a soft-deleted contribution's picture is never served                                                          |
| 11    | #586   | Community defaults, ODC decisions, Home banner                                                                                                                                                 | 1, 5                               | **Yes:** the community default also applies to contributions (and topics), then the tile                                                                                         |
| later | #541   | Topics, with pictures and soft delete by section 6                                                                                                                                             | 2, 9, its own deps                 | **Yes:** owner kind `topic` in its migration; `topic_image` reports; site-owner soft delete, restore and purge (E3)                                                              |

Steps 2 and 6 can run in parallel; 4's server PR can start once this ADR is
accepted, before #700 is approved, since it needs no UI. The ticket bodies
carry these scope notes (edited with this ADR).

## Consequences

- Contributions gain a picture with no new table, route or dependency: one
  migration, one more owner kind in `mayServe`, one more field on the
  contribution schema and bodies.
- The `image` contract is unchanged; contributions and topics reuse it, so
  MCP `get_poll` and its exact-shape check are unaffected.
- Topics gain site-owner soft delete (E3), the third kind with it.
- Storage grows with contribution pictures under the same per-account quota;
  ADR-0047's size estimate holds within a factor of two.
- Database backups now carry contribution pictures too (ADR-0047's backup
  note covers it; `DEPLOY.md` names contributions).
- An abusive contribution picture before #585 can only be removed by hand
  deletion (section 3), a weaker path than polls' `hidden` flag.
- The upload route keeps a poll-specific name for every kind.

### Documents reconciled

- **ADR-0047:** amended by this ADR (sections 1 and 6, contributions); not
  edited, as a historical record. Its other rules stand.
- **`docs/plans/pulse.md`** "P12 — Poll thumbnails": its statement that
  contribution rows carry no picture and its step list no longer match.
  **Updated in this PR** (renamed to pictures on every item, the statement
  replaced, #700/#701 inserted, scope notes on #427, #583, #585, #586).
- **`apps/pulse/API.md`:** documents contribution bodies without `image`. **Changed by #701** (and #427/#586 as they touch
  it), in the same PR as the code, not here, because API.md documents what is
  served.
- **`apps/pulse/DEPLOY.md`:** the interim emergency path for contribution
  pictures and the backup note. **Changed by #701's server PR.**
- **`apps/pulse/README.md`** ("Poll pictures") and **`apps/pulse/CLAUDE.md`**
  (`src/images/` described as poll pictures): **changed by #701's server PR**,
  when the code makes them untrue.
- **`docs/plans/contributions.md`:** says nothing about pictures. No change.
- **GitHub issues #701, #427, #583, #585, #586, #700, #541:** scope notes from
  section 9 added to each body (existing text kept), alongside this PR.
- **`memory/pulse.md`:** updated on master at merge time, not on this branch.
- **`memory/INDEX.md`:** nothing conflicts; no change.

## Charter check

Not applicable: `apps/pulse` and `apps/pulse-web` are charter-exempt
(`apps/pulse/CLAUDE.md`). The surviving boundaries hold: storage is Pulse's
own, nothing reads or writes `services/` or `contracts/`, and no copy here
describes how votes are counted.
