# ledger — API

The ledger listens on two ports.

- **Public** (`LEDGER_PUBLIC_PORT`): the read API. Unauthenticated, read-only.
  It exposes only what is already in the export (`contracts/read-api.md`).
- **Internal** (`LEDGER_INTERNAL_PORT`): the write path and the operator's
  close call. Bind it to a private network only. It needs no session or token:
  every request it accepts carries a signature the ledger checks against keys on
  the log.

Ballots are never submitted to the ledger. They reach the log only through
batches the ledger seals and the signer signs (see "Calls the ledger makes").

All error bodies are `{ "error": "<code>" }`, plus the fields named below.
On either port, an unknown path is `404 not_found`, a body over the port's
size limit is `413 payload_too_large`, a body whose content type is neither
JSON nor plain text is `415 unsupported_media_type`, and a server fault is
`500 internal`.
Request bodies are never logged.

## Operator decisions this API follows

Will chose these on 2026-10-21, during ledger planning. They are recorded here
because they shape the endpoints below.

- **Operator events are a conditional append (D2).** The operator signs
  `genesis` and `issue_created` against the head it read and submits them to
  `POST /appends`. If the tail has moved, the answer is `409 stale_tail` with
  the current head, and the operator re-signs. The endpoint is on the internal
  port only, and the ledger never holds the operator key.
- **New registrations are refused until `participant_registered` v2 is in
  `contracts/` (D3; ADR-0043 decision 2).** `POST /appends` answers
  `422 type_not_accepted` for `participant_registered`. The ledger's checker
  still reads v1 registrations already on a chain.
- **An operator-signed close call seals an issue's last batch (D4), once
  batching is wired in;** until then it answers `503 batching_unavailable`.
  `POST /issues/{issue_id}/close`, signed by the chain's `operator_pk`, seals
  the issue's open batch as its last (ET-24, ET-25). Without it an issue's
  batches are only ever sealed at `ballot_batch_min` or more.

## Public port

### `GET /events?since={seq}&limit={n}`

Exactly `contracts/read-api.md` RA-1 to RA-13.

- `since`: canonical non-negative integer (ES-5); exclusive; default `0`.
- `limit`: canonical positive integer; default `1000`; values above `1000` are
  clamped to `1000`.
- `200`, `application/json`: `{ "events": [...], "next": <int|null>, "head": "<64 hex>" }`.
  Events are full envelopes, ascending and contiguous, byte-identical in
  content to their export lines. `next` is the `seq` of the last event in the
  page when the server holds a later event, else `null`. `head` is the hash of
  the highest-`seq` event held, or 64 zeros when the log is empty.
- `since` beyond the head: `200` with `events: []`, `next: null` (RA-12).
- `400 bad_since`, `400 bad_limit` (RA-11): non-canonical or negative value, or
  `limit=0`. No partial page.
- `POST`, `PUT`, `DELETE`, `PATCH` on `/events`: `405 method_not_allowed`,
  with `Allow: GET, HEAD` (RA-13).

### `GET /head`

- `200`, `application/json`: `{ "seq": <int>, "hash": "<64 hex>" }`. For an
  empty log, `seq` is `0` and `hash` is 64 zeros. Advisory, like RA-8: it is
  not an anchor.

### `GET /export`

- `200`, `application/x-ndjson`: the whole log as an `export-format.md` file,
  streamed in `seq` order. Every line ends in LF (EX-4); an empty log is a
  zero-length body (EX-6). The bytes are the stored canonical lines, so the
  response verifies exactly as the log does.

## Internal port

_Lands in #462._

### `POST /appends`

Append one operator-signed event (`genesis` or `issue_created`) at the tail.

The submitter reads the head (`GET /head`), builds the event for
`seq = head.seq + 1` and `prev_hash = head.hash`, chooses `ts`, signs it with
the operator key (HA-15, HA-16) and submits it. The ledger never holds the
operator key.

- Request, `application/json`: `{ "event": { "seq", "type", "version", "payload", "ts", "prev_hash" } }`.
  No `hash`: the ledger computes it at insert (HA-13).
- `201`: `{ "seq": <int>, "hash": "<64 hex>" }`.
- `409 stale_tail`, with `"head": { "seq", "hash" }`: `seq` or `prev_hash` does
  not match the current tail (another append got there first). Re-read the
  head, re-sign and retry.
- `422 type_not_accepted`: `vote_cast` (ballots arrive only in batches) or
  `participant_registered` (refused until `participant_registered` v2 is in
  `contracts/`; ADR-0043 decision 2).
- `422 rejected`, with `"reason"`: the event would not leave the export `VALID`
  (EV-26), or a line would exceed the EV-25 cap. The reason is advisory text.
- `422 chain_not_valid`: the stored log does not verify `VALID`, so EV-26 bars
  every append.
- `503 batch_pending`: a ballot batch's sign request is stored but its run is
  not appended yet (for example, the signer is down). That batch is signed for
  the current tail only, so an operator append would strand its ballots.
  Retry later.
- `400 bad_request`: the body is not a JSON object of the shape above:
  exactly the key `event`, holding exactly those six keys; `seq` and `version`
  integers up to 2^53 − 1; `type`, `ts` and `prev_hash` strings; `payload` an
  object whose values are strings or numbers. Values are judged by EV-26
  (`422 rejected`), not here.
- The body limit is 131072 bytes (twice the EV-25 line cap).

The tail check and the insert happen under one lock: of two submitters racing
for the same tail, exactly one gets `201` and the other `409`.

### `POST /issues/{issue_id}/close`

Seal the issue's open ballot batch as its **last** (ET-24, ET-25). From then on
the signer refuses every further ballot of the issue. There is no close event
on the log; readers learn an issue is closed only because no later ballot of it
appears.

- Request, `application/json`: `{ "ts": "<ES-20 timestamp>", "sig": "<128 hex>" }`.
  `sig` is an Ed25519 signature by the chain's `operator_pk` over the UTF-8
  bytes of
  `"ODC-LEDGER-CLOSE-ISSUE-v1\n" + <genesis hash> + "\n" + <issue_id> + "\n" + <ts>`,
  where the genesis hash is the chain's identity (ET-7a). `ts` must be within
  five minutes of the ledger's clock.
- `202`: `{ "status": "closing" }` while the last batch is sealed, signed and
  appended; `200`: `{ "status": "closed" }` once done or if already closed.
- `400 bad_request` (the body is not exactly `{ "ts", "sig" }`, both
  strings), `400 bad_ts` (malformed or outside the window),
  `404 unknown_issue` (no genesis yet, or `issue_id` is not the hash of an
  `issue_created` on the log), `401 bad_signature`.
- `503 batching_unavailable`: the request is valid but this ledger process
  has no batching module wired in, so nothing is sealed. Retry later.
- Checked in this order: body, `ts`, signature, issue, batching. A log with
  no genesis, or an `issue_id` that is not 64 lowercase hex, is `404` before
  the signature (there is no key to check it against, or nothing it could
  name). A replay inside the window is harmless: closing is idempotent.

## Calls the ledger makes

_Lands in #463 and the wiring PR._

The ledger calls only the signer's public API (ADR-0043), on the ballot write
path, through one client module (`src/clients/signer.ts`), from its batcher
(`src/batching/`). `services/signer` does not exist yet; this is the shape the
ledger is built against, and its tests use an HTTP double
(`tests/support/fake-signer.ts`). Bodies are `application/json`. Every call
has a timeout (default 10 s). Only a `4xx` whose body is
`{ "error": "<code>" }` with one of that call's documented codes (below) is a
definite refusal. Everything else is "no answer", because the signer may
already have acted: a timeout, network error, `5xx`, `408`, `429`, a `4xx`
without a documented code (a wrong path, a proxy), or a malformed `200` body.
The ledger then retries later with identical inputs. A signer
outage never crashes the ledger: batches stay pending.

### Seal: `POST /issues/{issue_id}/seals`

- Request: `{ "seal_id": "<32 hex>", "last": <bool> }`.
- `200`: `{ "batch_id": "<1-128 of [A-Za-z0-9_-]>", "counts": [<int>, ...] }`.
  `counts[c]` is the number of ballots for choice `c`; its length is the
  issue's `choice_count`. The signer closes the issue's open batch atomically.
  After a `last` seal it refuses every further entry of the issue.
- `seal_id` is an idempotency key the ledger chooses and stores before the
  call: the same `seal_id` MUST return the same batch, so a crash between the
  signer sealing and the ledger recording the answer is finished by asking
  again. **Ledger-proposed; ADR-0043 does not name it. To be confirmed when
  `services/signer` is built.**
- Refusals the ledger expects: `409 under_min` (a non-last seal below the
  issue's `ballot_batch_min`; nothing is sealed and the batch stays open),
  `404 unknown_issue`, `409 issue_closed`, `409 seal_conflict` (this
  `seal_id` was already used for another issue or another `last`). A refused non-last seal is retried
  at a later batch instant under a new `seal_id`; a last seal is re-asked
  with the same `seal_id` until it succeeds.

### Sign: `POST /batches/{batch_id}/signatures`

- Request, in this key order:
  `{ "issue_id", "first_seq", "ts", "first_prev_hash", "payloads": [{ "issue_id", "choice" }, ...] }`.
  `payloads` is the batch in the ledger's order (a cryptographic shuffle, not
  arrival order; ET-25). `ts` is the batch instant (ET-23); `first_seq` and
  `first_prev_hash` continue the tail the ledger holds locked.
- `200`: `{ "events": [<full envelope>, ...] }`, one `vote_cast` v1 per
  payload, in order: `seq` from `first_seq`, contiguous, all at `ts`, each
  `prev_hash` the `hash` of the event before it (the first is
  `first_prev_hash`), each signed by the registrar key, deterministically
  per RFC 8032, and carrying its `hash`.
- The signer checks the payloads' `(issue_id, choice)` multiset equals the
  sealed counts exactly. A batch is signed at one position only: the same
  request again returns the same run, and any other request for that batch is
  refused (`409 position_taken`). Its other documented refusals:
  `404 unknown_batch`, `409 payload_mismatch`, `409 counts_mismatch`.
- The ledger checks each returned event against what it sent at that index
  (`seq`, `ts`, `prev_hash`, payload, hash), then runs EV-26 on every line,
  and appends the run whole or not at all. A refused or mismatching run is
  never appended; the batch stays pending and is logged.

Before the sign call the ledger stores exactly that call's inputs (batch id,
issue, first `seq`, `ts`, first `prev_hash`, ordered choices), committed while
it holds the writer lock. After a crash, or after any sign attempt without an
appended run, it replays the stored request, unchanged, before appending
anything else; if the log already holds the run it only records completion.

The ledger also never tells anyone which line or batch holds a given ballot
(ET-21a). Nothing on either port is keyed by a ballot's submitter, and the
batcher's records hold counts and positions only, never an arrival time.
