# Read API — contracts/read-api.md

**Version:** 1
**Status:** DRAFTING (Phase 0 · T4). Not frozen.
**Companion specs:** `event-schema.md` (envelope), `hashing.md` (`hash`),
`export-format.md` (the file form of the same events), `evolution.md`.

The **read** interface of the ledger service: how any client pages through the
log online. It is read-only and unauthenticated — the log is public
(charter §9), and this endpoint exposes only what is already in the export.
Nothing here holds truth; a client can equally reconstruct everything from an
`export-format.md` file. This spec pins the request and response so any client
and any ledger implementation interoperate byte-for-byte on the event fields.

Every normative sentence is numbered `RA-n`. RFC-2119 keywords are normative.

---

## 1. Endpoint

- **RA-1.** The ledger service MUST expose `GET /events` returning events in
  ascending `seq` order.
- **RA-2.** `GET /events` accepts a query parameter `since` (integer, canonical
  form per `event-schema.md` ES-5). The response contains events with
  `seq > since` — i.e. `since` is **exclusive**. Omitting `since` is equivalent
  to `since=0`, which begins at the genesis event (`seq` = 1).
- **RA-3.** `GET /events` accepts a query parameter `limit` (integer, ES-5 form)
  bounding the number of events returned. If omitted, the server MUST apply the
  default of RA-6. A `limit` of `0` is invalid (RA-11).
- **RA-4.** The response MUST be `Content-Type: application/json` and MUST be a
  single JSON object (the envelope of §2), UTF-8, no BOM. (This differs from the
  NDJSON *file* export of `export-format.md`: the read API returns a JSON
  envelope wrapping an array; the export is line-delimited. The **event objects**
  inside are identical in both.)

## 2. Response envelope

- **RA-5.** A `200` response body MUST be a JSON object with exactly these
  fields:

  | field    | type            | meaning                                                        |
  | -------- | --------------- | -------------------------------------------------------------- |
  | `events` | array of events | zero or more events, each a full envelope (`event-schema.md`)  |
  | `next`   | integer or null | the `since` value to request the following page (§3); `null` when the server holds no event beyond this page |
  | `head`   | string          | the `hash` of the highest-`seq` event the server currently holds (64 lowercase hex), or 64 zeros if the server holds no events |

- **RA-6.** `events` MUST be ordered by ascending `seq`, contiguous (each `seq`
  exactly one greater than the previous within the array), and MUST contain at
  most `limit` events. The server's default and maximum `limit` MUST both be
  `1000`; a requested `limit` above `1000` MUST be clamped to `1000` (not
  rejected), and the response so produced is still valid.
- **RA-7.** Each element of `events` MUST be byte-reproducible as an
  `export-format.md` line for the same event: the six content fields serialize to
  the same values that yield the stored `hash` (`hashing.md`). A client MAY
  verify `hash` and the `prev_hash` linkage on the returned page exactly as it
  would on an export; the API grants no exemption from verification.
- **RA-8.** `head` describes the server's current knowledge and MAY advance
  between requests as new events are appended. `head` is advisory for liveness;
  it is **not** a substitute for the anchored head a verifier checks against
  (`export-format.md` EX-13, charter §4). A client MUST NOT treat `head` from
  this endpoint as the non-equivocation anchor.

## 3. Pagination

- **RA-9.** To page forward a client requests `GET /events?since={next}` using
  the `next` value from the previous response. When `next` is `null`, the client
  has reached the end of what the server holds; there is no further page until
  the log grows.
- **RA-10.** Pagination MUST be stable under append: because the log is
  append-only (never reordered or deleted) and `seq` is dense and monotonic
  (ES-7), a given `since` always yields the same events regardless of when it is
  requested, except that later requests may include events appended since. A
  client that has consumed up to `seq = N` resumes correctly with `since = N`
  and never misses or double-reads an event.

## 4. Errors

- **RA-11.** A malformed request — `since` or `limit` not a canonical
  non-negative integer (ES-5), or `limit = 0` — MUST return HTTP `400` with a
  JSON body `{ "error": "<machine-readable-code>" }` and MUST NOT return a
  partial `events` page. Defined codes: `bad_since`, `bad_limit`.
- **RA-12.** A `since` beyond the current head is **not** an error: the server
  MUST return `200` with `events: []`, `next: null`, and the current `head`.
  This lets a client poll the tail without special-casing "caught up".
- **RA-13.** The endpoint is read-only. It MUST NOT accept `POST`/`PUT`/`DELETE`
  on `/events`; appends occur through the ledger's write path, which is a
  separate service concern outside `contracts/`. This spec defines no
  authentication because the read surface exposes only public log data.

---

## Degrees of freedom closed (acid-test checklist)

| Degree of freedom                           | Closed by      |
| ------------------------------------------- | -------------- |
| Endpoint + ordering                         | RA-1, RA-6     |
| `since` inclusive vs exclusive; default     | RA-2           |
| `limit` default / maximum / clamp vs reject | RA-3, RA-6     |
| Response shape (envelope vs bare array)     | RA-4, RA-5     |
| Event object identity vs the export         | RA-7           |
| `head` meaning and its non-anchor status    | RA-8           |
| Pagination cursor + end-of-log signal       | RA-9           |
| Stability under append                      | RA-10          |
| Malformed-input status + codes              | RA-11          |
| `since` past head: empty page vs error      | RA-12          |
| Method surface / auth                       | RA-13          |

## Acid-test walkthrough

Two clients paging the same ledger both: start at `since=0`, read ascending
contiguous `seq` pages of at most 1000 events (RA-6), follow `next` until it is
`null` (RA-9), and re-verify each event's `hash` and linkage (RA-7) exactly as
against an export. Both treat `since` past the head as an empty `200`, not an
error (RA-12), and neither uses the response `head` as the anchor (RA-8). Given
identical server state they assemble the identical event sequence, identical to
the `export-format.md` file of the same chain.
