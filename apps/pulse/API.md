# pulse API

What the server speaks today. Anything not listed here does not exist yet.

> **This does not currently match `apps/pulse-web/src/api/types.ts`.** The client was
> written from the UI's needs and the server from the domain's, and they disagree on
> paths, on whether a vote can be changed, and on whether a ballot is one choice or
> several. The differences are listed at the bottom; they are product decisions, not
> merge noise, and they need settling before the two halves are wired together.

Every error is `{ "error": "<slug>", "message": "<one plain sentence>" }`. The
`message` is safe to show a person as-is. No response explains how anything is
counted.

## Signing in

Identity is an email address and nothing stronger. There are no passwords. Membership
of a community is proven by the email's domain, and the allowed domains are rows in a
table — adding one is an insert, not a deploy.

### `POST /api/sign-in`

```json
{ "email": "ada@student.ubc.ca", "wantsProofEmails": false }
```

`wantsProofEmails` is optional and must be a real boolean; anything else is refused
rather than read as `false`, because it is the opt-in for hearing what came of a vote.

| Status | Body                         | When                                             |
| ------ | ---------------------------- | ------------------------------------------------ |
| 200    | `status: "sent"`             | a link is on its way                             |
| 400    | `error: "invalid_email"`     | not a usable address                             |
| 400    | `error: "bad_request"`       | no `email`, or a non-boolean opt-in              |
| 403    | `error: "not_a_member"`      | the domain belongs to no community               |
| 429    | `error: "too_many_requests"` | too many links outstanding, or too many attempts |

Rate limited per client (10/hour by default), separately from the per-address cap on
outstanding links.

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

## The session cookie

`pulse_session`, `HttpOnly`, `SameSite=Lax`, `Secure` (off only in local development),
path `/`, 30 days.

It carries the voter id, when it was issued, when it expires, and a signature over all
three. Expiry is checked on the server, not left to the browser. Signing out moves the
voter's sessions-valid-from to now, so every cookie issued earlier stops working — on
every device, not only the one that clicked.

## Not in this branch

`GET /api/me`, `POST /api/sign-out`, and the poll and vote routes land in the branches
stacked on this one. They will be documented here as they arrive.

## Where the client and server disagree

| Thing           | Server (here)           | Client (`apps/pulse-web`)               |
| --------------- | ----------------------- | --------------------------------------- |
| Paths           | `/api/sign-in/redeem`   | `/claims/redeem`                        |
| Vote path       | `/api/polls/:id/vote`   | `/polls/:id/votes`, `/polls/:id/ballot` |
| A ballot        | one choice index        | an array — `single` and `approval`      |
| Changing a vote | first vote stands (409) | replaceable until close (`changed`)     |
| Unknown domain  | 403 naming the domain   | never reveals whether an address exists |
| Result count    | `total`                 | `voters`                                |
| Poll shape      | no `method`, no `open`  | both                                    |
