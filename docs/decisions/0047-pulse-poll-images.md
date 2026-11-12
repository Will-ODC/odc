# ADR-0047: Pulse polls carry one picture, stored in Postgres, with defaults

- **Status:** accepted. Operator decisions of 2026-11-12, recorded under
  "Operator decisions" below; the decider is the operator.
- **Date:** 2026-11-12
- **Phase:** 0 (Pulse, charter-exempt; issues #296, #427)
- **Amends:** ADR-0037 (no edits after publication; community not writable;
  removal hides and never deletes) and ADR-0024 3b/3c, narrowly, as stated in
  sections 7–9. Builds on ADR-0028 and ADR-0030.

## Context

Operator direction, 2026-11-12: "begin planning adding of thumbnails for each
poll. there can be defaults, but they should be uploadable by the user, along
with the title. similar to reddit style."

Follow-up answers from the operator:

1. **Defaults:** a generated tile, "but also some defaults that should signify
   communities and one central one representing odc governing decisions,
   which we should encourage all users to vote on".
2. **Visibility:** an uploaded picture is shown as soon as the poll posts;
   anyone can report it; it can be removed.

#296 (image and context on the question page) and #427 (thumbnails in the
question browser) both waited on a storage, limits, editing and moderation
design that did not exist. `apps/pulse/API.md` lists photos as "not writable
inputs" of `POST /api/polls`. Nothing in Pulse stores binary data today.

Constraints that shape the choice:

- **ADR-0028:** two images, one origin. nginx serves the page and forwards
  `/api` to the API container, which publishes no port. The API image has no
  package manager; images are Trivy-scanned in CI.
- **The host is not chosen** (`apps/pulse/DEPLOY.md`). The runbook asks for a
  container host with managed Postgres, whose backups are a
  host/database-operator setting. Any second stateful store is a new
  provisioning, backup and secrets job on a host nobody has picked.
- **Several API instances must work** (ADR-0020). Anything kept on one
  container's disk is invisible to the others and lost on redeploy.
- **Scale is small.** Five publications per account per rolling hour
  (ADR-0037); an invited pilot first.
- **Today's CSP** is `default-src 'self'` with no `img-src`, so same-origin
  images already load and `data:`/`blob:` images do not.
- **"Governing decisions" exist only in the client.** The four
  "What should we decide next?" questions at `/questions`
  (`FoundationQuestions.tsx`) are poll IDs from `VITE_PULSE_*_POLL_ID`
  build variables. The server has no notion of a governance poll.
- **Pulse has no "category".** The only grouping of polls is the community
  (`community (id, label)`, migration 005; General is the reserved
  `pulse-general`). Contributions (PR #572, in progress) have their own
  types, which are not poll categories. There is no community admin (#458,
  P11).

## Operator decisions (2026-11-12)

- **D0 — who removes:** "poster only, but the site owner can soft delete polls
  or contributions for now (if inappropriate, for example)". The site owner
  does not moderate pictures separately; the owner's tool is soft-deleting a
  whole poll or a whole contribution.
- **D1 — after posting:** the poster may remove or replace the picture.
- **D2 — alt text:** required.
- **D3 — thumbnail crop:** square centre crop.
- **D4 — defaults:** "site owner uploads some default ones for category".
  A category is the community (D4a).
- **D5 — ODC decisions:** encouraged by a banner on Home, not by pinning.
- **D6 — who reports:** signed-in accounts only.
- **D7 — automatic hide:** after 3 distinct reporters.
- **D8 — soft-delete restore window:** 30 days, then purged. Confirmed the
  same day: the purge deletes the poll **and its votes** permanently, leaving
  only an audit row without content.
- **D9 — launch order:** first answered "ship reporting first", then reversed
  the same day: "wait reverse last decision, picture first is fine, we'll get
  to it". Uploads may go live before reporting, automatic hiding and soft
  delete are built (section 10).

- **D4a — what a category is:** the community. Each community gets a
  default picture set by the site owner; posters choose nothing new.

## Decision

### 1. Bytes live in Postgres

Processed picture bytes are stored in Pulse's own Postgres, in a table
separate from the picture's metadata, so bytes can be purged while the audit
row stays.

**The storage is neutral; the routes are about polls.** The tables are
`image` (metadata) and `image_bytes` (the two variants), not `poll_image`.
A picture is linked to what shows it by `owner_kind` and `owner_id`: `poll`
(a poll's own picture) or `community` (a category default, section 6); both
are null while the picture is pending. Whether a picture may be served is
decided per owner kind in one server function (section 4). The routes,
report kind and API names stay poll-specific (`/api/poll-images`,
`poll_image`). Reason: community defaults already make a second owner, so a
polls-only table would need a second link column at once, and a later owner
(for example a contribution) then needs a new owner kind and its own ADR
amendment for visibility, removal and reporting rather than a table
migration. Only polls and community defaults are in scope; pictures on
contributions are not planned.

| Option                                          | Why not                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres `bytea` (chosen)**                   | —                                                                                                                                                                                                                                     |
| Object storage (S3, R2, a host bucket)          | A second stateful service, credentials and backup policy on an unchosen host; signed URLs or a public bucket either add a second origin to the CSP or need nginx to proxy anyway. Worth revisiting only if images pass roughly 10 GB. |
| A host volume on the API container              | Not shared between instances, lost on redeploy on most container hosts, backed up separately from the rows that reference it.                                                                                                         |
| Base64 inside the poll row or the creation JSON | One-third larger, breaks the 32 KiB creation body and the replay record's canonical input.                                                                                                                                            |

Postgres keeps one backup, one transaction for "attach picture to poll", one
deletion path and the existing migration discipline. A processed upload is
about 150–300 KB (display) plus 15–30 KB (thumbnail). At the posting quota,
even 1,000 picture polls a month is well under 1 GB a year. Bytes are written
once and never updated; reads are cached (section 4).

### 2. Upload is a separate step, then attached

- `POST /api/poll-images` takes the raw file as the request body with
  `Content-Type: image/jpeg | image/png | image/webp` (no multipart, so no new
  body-parser dependency). It needs a signed-in session and the same Origin
  check as creation, and answers `201 { "image": { "id", "width", "height" } }`
  with a random UUID. The picture is **pending**: owned by the uploading
  account, visible to nobody, attached to nothing.
- `POST /api/polls` gains an optional `image: { "id": <uuid>, "alt": <text> }`.
  The picture must be pending and uploaded by the same account. Attaching is
  part of the existing creation transaction, and the picture ID is part of the
  canonical replay input. A replay attaches nothing twice.
- Pending pictures nobody attached are deleted after 24 hours, by the same
  best-effort sweep pattern as sign-in rows (startup and on each upload).

Rejected: multipart on `POST /api/polls` (mixes a large binary with the
idempotent JSON contract and its 32 KiB limit); client-only processing (the
server must parse the file anyway to trust it).

### 3. Processing, formats and limits

- **Accepted input:** JPEG, PNG and WebP, identified by decoding the file,
  never by the declared type or file name. SVG, GIF, HEIC and animated images
  are refused (`unsupported_image`). Animation is detected, not assumed:
  WebP when `sharp` reports more than one page, PNG when an `acTL` chunk
  appears before the first `IDAT` (a chunk walk over the upload, no extra
  dependency). Animated files are refused, never cut to their first frame.
  SVG can carry script; HEIC needs a
  patented decoder the standard build lacks. The form's
  `accept="image/jpeg,image/png,image/webp"` makes iOS convert HEIC photos to
  JPEG before upload.
- **Input limits:** at most 10 MiB (nginx's `client_max_body_size` for this
  one location is raised to match; its 1 MiB default applies everywhere else);
  at most 40 megapixels and 8,000 px on either side (checked from the header
  before full decode); at least 200 px on the shorter side.
- **Library:** `sharp` (libvips), in the API process, with prebuilt musl
  binaries matching the Alpine image. One decode at a time per instance plus a
  short queue; a full queue answers 503 `image_busy`. Rejected: ImageMagick
  (shells out, large CVE history, larger image); pure-JS `jimp` (slow and
  memory-heavy on phone photos).
- **Every upload is re-encoded.** The original bytes are never stored or
  served. The picture is rotated by its EXIF orientation, then **all metadata
  is dropped** (EXIF including GPS location, XMP, IPTC; ICC converted to
  sRGB). This is the privacy guarantee: no location or camera data leaves the
  server.
- **Two stored variants, both WebP:**
  - `display`: fits within 1,600 × 1,600, aspect kept, quality 80.
  - `thumb`: 256 × 256 square, centre crop (D3), quality 75. It is shown at up
    to 128 CSS pixels, so it stays sharp on 2× screens.

### 4. Serving

- `GET /api/poll-images/:id/display.webp` and `/thumb.webp`, no session.
  `:id` is checked to be a UUID before any query. A picture is served only if
  its owner allows it: for `poll`, the picture is the poll's current picture
  and the poll is visible; for `community`, it is that community's current
  default. Malformed IDs and pending, removed, replaced, auto-hidden and
  unknown pictures all answer the same 404, with the same body.
- Headers: `Content-Type: image/webp` (set by the server, which produced the
  bytes), `X-Content-Type-Options: nosniff` (already sent by nginx),
  `Content-Security-Policy: default-src 'none'`,
  `Cross-Origin-Resource-Policy: same-origin`, a strong `ETag` (the SHA-256
  of that variant's stored, re-encoded bytes) and
  `Cache-Control: public, max-age=3600`. An hour, not a year: a removed
  picture disappears from browsers within the hour, and revalidation is a
  cheap 304. This hash is public by nature, since anyone can compute it from
  the served bytes. No hash of the original upload is ever computed or kept.
- Same origin, through the existing nginx `/api/` location: no CSP change for
  served pictures. The posting form's local preview needs
  `img-src 'self' blob:` added to `security-headers.conf`.
- Route rate limit like the other public reads. No cookie set or read.

### 5. Alt text is required

A description is required with every upload (D2): 1–300 code points, plain
text, same Unicode rules as the question. On the question page it is the
picture's text alternative. In the browser list the thumbnail sits beside the
title, so it is decorative there (`alt=""`) to avoid reading every
description aloud between titles. Default pictures uploaded by the site owner
carry a description too.

### 6. Defaults are resolved by the server, in one order

Every poll's public body and every poll row in a listing carries an `image`
object. Contribution rows in the mixed Home/Browse list (PR #572) carry no
`image` object, and the web client gives them an empty slot of the thumbnail's
size, so titles stay aligned. The slot is empty rather than a tile because a
tile means "this poll's community default"; on a contribution it would claim
a picture or category that does not exist. The server picks the first that
applies:

1. **`upload`** — the poster's visible picture.
2. **`category`** — the poll's category has a default picture uploaded by the
   site owner (D4). ODC decisions are a category like any other (section 7);
   their default is the central governance picture.
3. **`tile`** — otherwise. The client draws it: a colour from a fixed palette
   chosen by a stable hash of the category ID, and the first letter of its
   label. Legacy polls with no community get the General tile.

All default pictures are uploaded by the site owner through an owner-only
route that uses the same upload pipeline, limits and description rule. Nothing
is shipped as a static asset, so a new category needs no deploy. The site
owner may set or clear a category's default at any time; clearing falls back
to the tile. Setting a new default or clearing one detaches the old default
picture and deletes its bytes in the same transaction, with an audit row
(section 9); polls in that community show the new default or the tile at
once, and browsers within the hour (section 4). Default pictures cannot be
reported: they are the site owner's, not a poster's.

**What a category is (D4a).** Category = community: the community row gains
a nullable `default_image_id`, and the poll's existing community picks its
default. No topic tag or poster-chosen field is added.

Server resolution keeps the web client, MCP `get_poll` and the listing in
agreement, and lets the listing return previews without a per-poll fetch
(#427).

### 7. ODC governing decisions are a reserved community, announced on Home

A reserved community, `odc-decisions`, labelled "ODC decisions", holds polls
about how Pulse and ODC run. Only the site owner and accounts granted
`governance_posting` (same owner-only grant routes and audit as
`unlimited_posting`) may publish there, by passing `community: "odc-decisions"`
to `POST /api/polls`. Any other value, or that value from anyone else, is
refused. This narrowly amends ADR-0037's "community is not writable";
ordinary posting is unchanged.

Its category default is the central governance picture. Because it is a
community, it is listed by the existing `GET /api/polls?community=odc-decisions`
with the same cursor and visibility rules; no new listing filter.

Encouragement (D5) is **a banner on Home**, not pinning: when ODC decisions
are open, Home shows one banner with the governance picture, a short line
inviting everyone to vote and a link to that list. Which open decisions the
browser has not answered can be counted from the existing My votes data; the
banner never casts a vote and can be dismissed for the session.

Rejected: a boolean `governance` flag on polls (needs its own listing filter
and a second way to say where a poll belongs); keeping the client's
build-variable IDs (the server cannot resolve a default or list them). The
`/questions` screen keeps its build variables until a later ticket points it
at this community.

### 8. The poster removes or replaces their picture

- `DELETE /api/polls/:id/image` removes it; `PUT /api/polls/:id/image` with
  `{ "id": <pending uuid>, "alt": <text> }` replaces it. Only the account that
  published the poll may do either (D0, D1). This narrowly amends ADR-0037's
  "no edits after publication": the question, choices, close time and
  attribution stay fixed.
- The old picture's bytes are deleted at once, in the same transaction; the
  poll shows the new picture or falls back to its default. **Exception:** a
  picture that is auto-hidden, or has an unresolved report, when it is removed
  or replaced keeps its bytes, never served, until the 30-day purge of
  section 9 (counted from the hide or from the removal, whichever is later).
  The retention rule wins so that the site owner's review (section 9) still
  has the reported picture as context. Step 6 of the plan adds this exception;
  before reporting exists, every removal deletes at once.
- Replacing counts toward the same upload quota. Each remove or replace is an
  audit row (section 9). Voters who answered before a replace are not told:
  the picture is presentation, not part of the ballot, and the question and
  choices they answered cannot change.
- A poster learns that they may do this from an authenticated, `no-store`
  route about their own polls; the public poll body says nothing about the
  viewer, and no response reveals an anonymous poster to anyone else.

### 9. Reports, automatic hiding and the site owner's soft delete

- **Report (D6):** any signed-in account may report a poll's picture or the
  poll itself, using the shared report store #233 with target kinds
  `poll_image` and `poll`, under ADR-0037's approved rules: ten reports per
  rolling hour, one unresolved report per reporter and target, reporter
  identity private. The poster is not told who reported.
- **Automatic hide (D7):** a picture reported by 3 distinct accounts is hidden
  automatically; the poll falls back to its default and stays visible.
  Nobody restores an auto-hidden picture (the site owner does not moderate
  pictures, D0); the poster may replace it, and reports on the new picture
  start from zero. An auto-hidden picture's bytes are purged after 30 days,
  also when the poster replaces or removes it meanwhile (section 8).
  This applies ADR-0024 3c to pictures with a threshold of 3.
- **Poll reports never hide a poll automatically.** They go to the site
  owner's review list, together with picture reports as context. ADR-0024
  3c's automatic poll hiding stays unbuilt and its threshold unchosen.
- **Soft delete (D0, D8):** the site owner may soft-delete a whole poll, for
  example when it is inappropriate. A soft-deleted poll disappears from every
  public read and listing at once (its picture with it). The site owner may
  restore it within 30 days. After 30 days it is purged: the poll, its
  choices, its votes and its picture bytes are deleted; the audit row keeps
  the poll ID, action, reason and times, without content. This amends
  ADR-0024 3b and ADR-0037 ("removal hides; never deletes") for site-owner
  soft deletes only. My votes already omits a poll deleted while paging.
- **Contributions** (PR #572) get the same soft delete, restore window and
  purge, in a separate step that waits for #572 to land.
- **Audit:** every attach, replace, remove, automatic hide, category default
  set or clear, soft delete, restore and purge is a row in an append-only
  change table: target, action, actor kind (`poster`, `site_owner`, `auto`),
  private actor account where there is one, reason, time. Purging keeps the
  row and the SHA-256 of the picture's stored `display` variant (the
  re-encoded bytes, the same value as its ETag); no hash of the original
  upload exists.

### 10. Launch order and the accepted interim risk

Pictures ship first (D9 as reversed): uploads may be open to everyone before
reporting, automatic hiding and soft delete exist. Accepted interim risk: an
abusive picture stays visible until its poster removes or replaces it, and
the site owner has no product tool yet. Until soft delete ships, the only
emergency path is a database operator setting the poll's existing `hidden`
flag, which already hides the poll and therefore its picture; whoever does
this records it by hand. Reporting (with automatic hiding) and the site
owner's soft delete follow as the next steps, not as a launch gate.

### 11. Rate limits

- `POST /api/poll-images`: 10 requests a minute per client (route limit, in
  memory like the others); 20 accepted uploads per account per rolling hour
  (counted in Postgres, like the posting quota, so it holds across
  instances); at most 5 pending pictures per account at once.
- Remove, replace, soft delete, restore and category-default routes: the
  existing creation route limit of 30 a minute.
- Reports: #233's approved limits.

### 12. What is public

The `image` object contains only: `kind`; for `upload` and `category`, the
two URLs and the `width` and `height` of the display variant, and the `alt`
text. Never the uploading account, original file name, original type or
size, upload time, report count or state. The stored variants' SHA-256 is
not in the body; it appears only as the ETag of the picture's own response
(section 4), where anyone could compute it anyway. A hidden or removed
picture simply resolves to the next default. Errors and logs follow the
existing rules: no bytes, no file names, no account IDs; a processing failure
logs the error class only.

## Consequences

- One new production dependency, `sharp`, with native binaries. The API
  Dockerfile's build and runtime stages must use the same platform
  (`linuxmusl-x64`) so `pnpm deploy --prod` copies the right optional package.
  Trivy now scans libvips; a libvips CVE means rebuilding the image.
- Database size grows with pictures, and **database backups contain picture
  bytes, including removed and purged ones, and purged polls, for the backup
  retention period**. `DEPLOY.md` states this next to the sign-in cleanup
  note.
- nginx gains one location with a larger body limit; every location keeps the
  shared security-header include (`DEPLOY.md` rule).
- Picture processing is CPU-bound in the API process. The single-decode queue
  bounds it; a busy instance answers 503 rather than slowing votes.
- Purging a soft-deleted poll deletes its votes. This is the first deletion of
  authored polls in Pulse and is limited to the site owner's soft delete.
- MCP `get_poll` gains `image` with relative URLs, like the web client.
  ADR-0036's public-origin rule applies before absolute links are advertised.
- The plain-text context excerpt of #296/#427 is **not** decided here; it is a
  separate small text field.
- Migrations: PR #572 (Contributions) adds `013_contributions.sql` and
  `014_contribution_messages_and_replay_revisions.sql`, so this work uses the
  next free number after #572 merges: 015 or later, never 013 or 014. Never
  edit an applied migration.
- Pictures depend on Contributions in one more way: #572 turns Home/Browse
  into one date-ordered list of polls and contributions, so the thumbnail
  column (#427) and the Home banner (#586) are built on that list, after
  #572 merges.

### Documents reconciled

- `docs/plans/pulse.md`: gains "P12 — Poll thumbnails" with the ordered steps
  and their tickets (#579–#586, #296, #427, #581). **Updated in this PR.**
  Its #246–#248 section is left alone; PR #572 edits it.
- `docs/plans/contributions.md` (arrives with PR #572): nothing conflicts;
  contribution rows carry no picture (section 6). No change.
- `apps/pulse/API.md`: says photos are "not writable inputs" and documents the
  listing and poll bodies without `image`. **Changed by step 1** (and steps
  5–9 for their routes), in the same PR as the code, in the ADR-0037 style.
- `apps/pulse/DEPLOY.md`: backups now carry picture bytes; nginx body limit
  for uploads; the interim emergency `hidden` path. **Changed by step 1.**
- `apps/pulse-web/security-headers.conf` and `nginx.conf`: `img-src 'self'
blob:` and the upload location. **Changed by steps 1 and 2.**
- ADR-0037: amended by sections 7–9 (picture remove/replace after
  publication; writable community for governance only; site-owner soft delete
  with purge). Not edited, as a historical record.
- ADR-0024: 3c applied to pictures (threshold 3); poll auto-hide stays
  unbuilt; 3b amended for site-owner soft delete with purge. Not edited.
- ADR-0028: unchanged; pictures are served through the existing `/api` proxy.
- `memory/pulse.md`: updated on master at merge time, not on this branch.
- `apps/pulse/CLAUDE.md`, `memory/INDEX.md`: nothing conflicts; no change.

## Charter check

Not applicable: `apps/pulse` and `apps/pulse-web` are charter-exempt
(`apps/pulse/CLAUDE.md`). The surviving boundaries hold: storage is Pulse's
own, nothing reads or writes `services/` or `contracts/`, and no copy here
describes how votes are counted.
