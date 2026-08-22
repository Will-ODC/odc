# pulse API

What the server speaks today. Anything not listed here does not exist yet.

Every error is `{ "error": "<slug>", "message": "<one plain sentence>" }`. The
`message` is safe to show a person as-is. No response explains how anything is
counted.

## Signing in

Identity is an email address and nothing stronger. There are no passwords. Membership
of a community is proven by the email's domain, and the allowed domains are rows in a
table — adding one is an insert, not a deploy.

### `POST /api/sign-in`

```json
{ "email": "ada@student.ubc.ca", "proofEmailsOptIn": false }
```

`proofEmailsOptIn` is optional and must be a real boolean; anything else is refused
rather than read as `false`, because it is the opt-in for hearing what came of a vote.

| Status | Body                         | When                                             |
| ------ | ---------------------------- | ------------------------------------------------ |
| 200    | `status: "sent"` + `message` | a link is on its way                             |
| 400    | `error: "invalid_email"`     | not a usable address                             |
| 400    | `error: "bad_request"`       | no `email`, or a non-boolean opt-in              |
| 403    | `error: "not_a_member"`      | the domain belongs to no community               |
| 429    | `error: "too_many_requests"` | too many links outstanding, or too many attempts |

The 200 body is `{ "status": "sent", "message": "Check your email for a link to sign
in." }` — a sentence safe to show as-is, for a client that would rather not write its
own.

Rate limited per client (10/hour by default), separately from the per-address cap on
outstanding links. The 429 sentence names no interval, because the window is
configurable.

### `GET /api/sign-in/redeem?token=…`

Reports whether a link is still good. **Consumes nothing.** Mail scanners and
prefetchers follow every URL in an email; if looking spent the link, people would
arrive to find it already used.

| Status | Body                                                   | When                |
| ------ | ------------------------------------------------------ | ------------------- |
| 200    | `{ status: "ready", email }`                           | the link is live    |
| 400    | `error: "bad_request"`                                 | no token in the URL |
| 410    | `error: "expired" \| "already_used" \| "unknown_link"` | it is not usable    |

### `POST /api/sign-in/redeem`

```json
{ "token": "…" }
```

The click. Spends the link and sets the session cookie. Same 400/410 answers as the
GET. On success:

```json
{
  "status": "signed_in",
  "voter": { "id": "…", "email": "…", "community": "…" },
  "firstTime": true
}
```

One door: this creates the identity the first time and signs the same person back in
every time after. There is no separate sign-up.

### `POST /api/sign-out`

No body. Always answers `200 { "status": "signed_out" }`, whether or not anyone was
signed in — asking to be signed out is not something to refuse. It clears the cookie
**and** moves the voter's sessions-valid-from to now, so a copy of the cookie kept
elsewhere stops working too.

### `GET /api/me`

Who is signed in, according to the cookie.

```json
{ "voter": { "id": "…", "email": "…", "community": "…" } }
```

The voter is **wrapped**, the same way it is in the redeem response, so a later field
about the session itself can be added beside it without changing what `voter` means.

| Status | Body                  | When                                                                      |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| 200    | `{ voter }`           | signed in                                                                 |
| 401    | `error: "signed_out"` | no cookie, an expired one, one issued before a sign-out, or no such voter |

A 401 here is an ordinary answer — "nobody is signed in" — not a fault. The client
reads it as `null`.

## The session cookie

`pulse_session`, `HttpOnly`, `SameSite=Lax`, `Secure` (off only in local development),
path `/`, 30 days.

It carries the voter id, when it was issued, when it expires, and a signature over all
three. Expiry is checked on the server, not left to the browser. Signing out moves the
voter's sessions-valid-from to now, so every cookie issued earlier stops working — on
every device, not only the one that clicked.

## Polls, ballots, and results

A poll is a question with a fixed, ordered set of choices and a `method` that says
how it is answered: `single` is one choice, `approval` is any number of them. A
ballot is an **array of choice indices** in both cases — the method decides how many
entries are allowed, not the shape. A choice is referenced by its position in
`choices`, never by its text.

A vote is **changeable until the poll closes.** Casting again before close replaces
the voter's ballot; there is no "already voted" refusal. This is a plain, mutable
record — pulse is charter-exempt, so nothing here is append-only or hash-chained.

### `GET /api/polls/:id`

The poll, in the shape the client reads. No session required — a story viewer reads
this while moving through the story, and it reveals nothing about a person.

```json
{
  "id": "p1",
  "question": "Where next?",
  "choices": ["Park", "Library", "Rink"],
  "method": "approval",
  "closesAt": "2026-08-10T12:00:00.000Z",
  "open": true
}
```

`closesAt` is an ISO timestamp, or `null` when the poll has no closing time. `open`
is the server's own reading of whether votes are still accepted, not a copy of a
clock the client would have to re-check.

| Status | Body                 | When         |
| ------ | -------------------- | ------------ |
| 200    | the poll             | it exists    |
| 404    | `error: "not_found"` | no such poll |

### `GET /api/polls/:id/results`

The tally. No session required.

```json
{
  "pollId": "p1",
  "question": "Where next?",
  "method": "approval",
  "voters": 2,
  "choices": [
    { "index": 0, "label": "Park", "count": 2, "share": 100 },
    { "index": 1, "label": "Library", "count": 1, "share": 50 },
    { "index": 2, "label": "Rink", "count": 1, "share": 50 }
  ]
}
```

`voters` is the number of **distinct people** who voted, not the number of
selections. `share` is `count / voters * 100`, rounded to one decimal, `0` when
nobody has voted. For an `approval` poll a voter picks several choices, so shares
legitimately **sum to more than 100** — that is correct and is not normalised away.

| Status | Body                 | When            |
| ------ | -------------------- | --------------- |
| 200    | the results          | the poll exists |
| 404    | `error: "not_found"` | no such poll    |

### `GET /api/polls/:id/ballot`

The signed-in voter's own current ballot, so the UI can show what they picked.
Requires a session.

```json
{ "ballot": [0, 2] }
```

`ballot` is `null` when this voter has not voted on this poll.

| Status | Body                  | When             |
| ------ | --------------------- | ---------------- |
| 200    | `{ ballot }`          | signed in        |
| 401    | `error: "signed_out"` | no valid session |
| 404    | `error: "not_found"`  | no such poll     |

### `POST /api/polls/:id/votes`

Cast or change a ballot. Requires a session.

```json
{ "ballot": [1, 2] }
```

The ballot is validated the same way the client validates it before sending: every
entry is a whole number naming a choice this poll has, entries are distinct, and a
`single` poll takes at most one. An **empty ballot is refused**, not read as a
retraction — the client never sends one, so an empty ballot is a bug, not someone
withdrawing their vote.

On a `counted` (first ballot) or `changed` (replacing a prior one) outcome, the
response carries the stored ballot and the fresh results, so the client need not ask
again:

```json
{
  "status": "changed",
  "ballot": [1, 2],
  "results": { "pollId": "p1", "…": "…" }
}
```

When the poll has closed, the body is just `{ "status": "closed" }`.

| Status | Body                                                | When                                          |
| ------ | --------------------------------------------------- | --------------------------------------------- |
| 200    | `status: "counted" \| "changed"` + ballot + results | the ballot was recorded                       |
| 200    | `status: "closed"`                                  | the poll is past its closing time             |
| 400    | `error: "bad_request"`                              | body has no ballot array of whole numbers     |
| 400    | `error: "bad_ballot"`                               | the ballot is not a valid answer to this poll |
| 401    | `error: "signed_out"`                               | no valid session                              |
| 404    | `error: "not_found"`                                | no such poll                                  |

## The client

`apps/pulse-web/src/api/http.ts` speaks exactly this: the paths above, the
`proofEmailsOptIn` opt-in, the wrapped `{ voter }` bodies, and `id` as the voter's
field name. There is no remaining disagreement to record here; `apps/pulse-web/test/end-to-end.test.ts`
holds it that way by driving this server over a real socket.

The one refusal the client treats as an _answer_ rather than a failure is the 403
`not_a_member`: it becomes `{ status: "not_eligible", message }` and shows the
server's sentence, which names the domain, as-is.
