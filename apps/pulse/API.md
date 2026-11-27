# pulse API

What the server speaks today. Anything not listed here does not exist yet. A
section headed **Planned — not served** records an accepted interface before
implementation, as required by the service-boundary workflow; it says so
explicitly and is not part of the current server.

Every error is `{ "error": "<slug>", "message": "<one plain sentence>" }`. The
`message` is safe to show a person as-is. No response explains how anything is
counted. A body larger than a route accepts is 413 `body_too_large` on every
route.

In local development, all seven seeded questions are listed in General, which
is the default Home/browser listing.
They retain no author attribution. Community listing otherwise follows the same
rules as created questions; legacy polls without a community remain excluded.

Unexpected API faults use generic response messages and are logged by error
class and valid SQLSTATE only. Mail-provider failures may additionally log the
HTTP status; provider response text, error messages, stacks, causes, row details
and request bodies are never part of fault diagnostics (#503). Planned 4xx
responses and request-log formatting are unchanged.

## Signing in

### Identity response caching

`GET /api/me` and both `GET` and `POST /api/sign-in/redeem` send
`Cache-Control: no-store`, including error responses. Browsers and shared
caches must not retain identity details or sign-in-link state.

### Request origin

`POST /api/sign-in`, `POST /api/sign-in/redeem`, `POST /api/sign-out`,
`POST /api/polls/:id/votes` and `POST /api/polls/:id/suggestions` accept a
request only when its `Origin` header exactly matches the configured web origin
(`PULSE_WEB_ORIGIN`), the same check the poll-creation mutations use. A missing or
foreign `Origin` is answered 403 before the body is read and before anything is
sent, spent, set or cleared:

```json
{
  "error": "origin_not_allowed",
  "message": "That request did not come from Pulse."
}
```

Browsers send `Origin` on every POST, same-origin included, so the pulse-web client
needs nothing extra. Non-browser callers must send it themselves. The origin comes
from trusted server configuration, never from `Host` or a forwarded header; a server
built without a web origin refuses all of these writes.
`GET /api/sign-in/redeem` changes nothing and needs no `Origin`.

### Local development mailbox

Development uses the ordinary `POST /api/sign-in` and redemption endpoints for
all addresses. No email is delivered externally. `GET /api/dev/mailbox` serves
an HTML inbox of captured messages, newest first, with the actual sign-in links.
It is linked from the development client's Check your email screen. Opening the
mailbox does not redeem links; clicking a message's link follows ordinary browser
redemption, including expiry, one-use tokens and ballot confirmation.

Only `buildDevServer` registers the mailbox; production returns 404.
The configured web origin must be loopback (`localhost`, `127.0.0.1` or `[::1]`).
The request must come from a loopback peer with Host matching that origin; a
foreign Origin or cross-site Fetch Metadata is refused with 403 `local_only`.
Normal top-level navigation may omit Origin. Responses are HTML, no-store,
no-referrer, non-embeddable and have a restrictive Content Security Policy.
The inbox is empty after an API restart, even with persistent storage; request
a fresh link if the old message is gone. Use only disposable development data.
`POST /api/dev/sign-in` is not served.

Identity is an email address and nothing stronger. There are no passwords. **Anyone
with a working address may sign in** (ADR-0030). The address's domain decides only
which community, if any, the person belongs to: a domain listed in a table names a
community — adding one is an insert, not a deploy — and any other address signs in
with no community.

### `POST /api/sign-in`

```json
{
  "email": "ada@student.ubc.ca",
  "proofEmailsOptIn": false,
  "community": "ubc-students"
}
```

`proofEmailsOptIn` is optional and must be a real boolean; anything else is refused
rather than read as `false`, because it is the opt-in for hearing what came of a vote.

`community` is optional and, when present, must be a string — `null` is refused like
any other non-string rather than read as "no pick". It is the person's answer to
`choose_community` below, and is only needed then.

| Status | Body                                        | When                                                           |
| ------ | ------------------------------------------- | -------------------------------------------------------------- |
| 200    | `status: "sent"` + `message`                | a link is on its way                                           |
| 400    | `error: "invalid_email"`                    | not a usable address                                           |
| 400    | `error: "bad_request"`                      | no `email`, a non-boolean opt-in, or a non-string `community`  |
| 400    | `error: "unknown_community"`                | `community` names one this address does not belong to          |
| 422    | `error: "choose_community"` + `communities` | the address belongs to several communities and none was picked |
| 403    | `error: "origin_not_allowed"`               | missing or foreign `Origin` (see "Request origin")             |
| 429    | `error: "link_already_sent"`                | a link is already outstanding for this address                 |
| 429    | `error: "too_many_requests"`                | too many attempts from this client                             |
| 503    | `error: "send_failed"`                      | the mail provider would not take the message                   |

#### Picking a community (P2, ADR-0023)

One email domain may belong to several communities (`allowed_domain` is keyed on
`(community, domain)`). When an address's domain matches two or more rows, **the
person picks** which community they are signing in to, and the server does not pick
for them. The community they pick is recorded on the link and copied onto the voter
when it is clicked, and it is what decides where they may post (ADR-0024).

Asked without `community`, such an address is answered:

```json
{
  "error": "choose_community",
  "message": "That address can sign in to more than one community. Choose one.",
  "communities": [{ "id": "ubc-alumni" }, { "id": "ubc-staff" }]
}
```

**Nothing is mailed and no link is created**, so being asked costs the person none of
their outstanding-link allowance. The client asks them and sends the same request
again with `community` set to one of the `id`s. `communities` is sorted by `id` for
display and the order means nothing. Each entry is an object so that a display name
can sit beside `id` later; `allowed_domain` has no such column today, so `id` is all
there is. 422 rather than 400 because nothing in the request is wrong — it is one
answer short.

The rules for `community`, the same at every number of matches:

- **Two or more matches, no `community`:** 422 `choose_community`, as above.
- **Any number of matches, `community` one of them:** that community is used. With a
  single match, sending it is allowed and changes nothing.
- **Any number of matches, `community` not one of them** — another domain's
  community, one that does not exist, or any community at all for an address that
  matches none: **400 `unknown_community`**, `"That address cannot sign in to that
community."`, and nothing is mailed. A pick is never quietly dropped: someone who
  asked for one community and was signed in to another, or to none, would be told
  nothing went wrong. The realistic way to hit this is a row removed between the two
  requests; a client should take the person back to the email step.
- **Zero or one match, no `community`:** exactly as before this existed — no extra
  step and the same responses.

"Matches" means the most specific rows only. Matching is by exact domain unless a row
says `include_subdomains`, and where a subdomain row and an exact row both match, the
exact one is the answer, not a choice: a narrower row carves a community out of a
broader one. An exact row and a subdomain row **for the same domain** are the same
specificity, and both are choices.

The choice is checked before the per-address cap, so a pick that would be refused is
refused as `unknown_community` even when the address is at its cap; a valid pick is
then capped like any request (`link_already_sent`). The cap is per address, not per
community — picking the other community is not another link. The per-client rate
limit counts every request, `choose_community` answers included, so signing in this
way costs two of the client's ten an hour.

**Only the first pick sticks — open, for the operator.** The voter's community is
written once, when the voter is created by their first click, and a returning voter
keeps it (see `POST /api/sign-in/redeem` below). So a returning person whose address
matches several communities is still asked, and their pick is recorded on the link,
but **signing in does not move them to the community they picked**. They are not
skipped past the question, because answering "you already have a community" only to
addresses that have signed in before would tell anyone which addresses have. Whether a
later pick should move a voter is a product decision P2 does not take
(`docs/plans/pulse.md` P2).

**Not decided, and not supported:** acting in two communities in one session.

The 200 body is `{ "status": "sent", "message": "Check your email for a link to sign
in." }` — a sentence safe to show as-is, for a client that would rather not write its
own.

There is no refusal for the domain. Until ADR-0030 an address whose domain named no
community was answered `403 not_a_member`; that answer no longer exists, and such an
address is sent a link like any other.

Rate limited per client (10/hour by default), separately from the per-address cap on
outstanding links. The 429 sentence names no interval, because the window is
configurable.

**The two 429s mean opposite things and must not be read off the status.**
`link_already_sent` is the per-address cap: a link really is on its way, and a client
should show it the same screen a first request shows. `too_many_requests` is the rate
limiter: nothing was sent and nothing is coming, so it has to read as a failure.
Answering both with one slug told rate-limited people to go and check an inbox that
would stay empty.

**The 503 is the same distinction one step further, and a refusal rather than a
fault (ADR-0027).** `too_many_requests` is pulse declining to send; `send_failed` is
pulse having tried and the provider having refused. Both must read as failures and
neither may show "Check your email", which shown for mail that was never sent leaves
someone waiting instead of pressing the button again. A provider that is down is not
a bug in pulse, so it is not answered with a 500 and not logged as one. The message
is `"We could not send that email just now. Try again."`, and the provider's own
explanation is never in it — a 422 naming an unverified sending domain is an
operator's problem and reads to anyone else as gibberish. **A refusal repeating
cannot fix — a revoked key, an unverified domain — is not this 503**; it stays a 500,
because telling everyone to retry forever is how a broken deploy goes unnoticed.

**A 503 does not use up the address's link allowance when the provider said it never
took the message** (its answer was 408, 429 or 503). The link pulse wrote for that
email is forgotten, because no email carries it, so the next request after the outage
is sent rather than told a link is already on its way. **Any other failure keeps the
link live** until it expires: a timeout or dropped connection, or a 500, 502 or 504
that a gateway may have sent after the provider had already delivered the email
(P4a in `docs/plans/pulse.md`).

### `GET /api/sign-in/redeem?token=…`

Reports whether a link is still good. **Consumes nothing.** Mail scanners and
prefetchers follow every URL in an email; if looking spent the link, people would
arrive to find it already used. Pulse web also uses this read to show the
address before asking the person to sign in.

| Status | Body                                                   | When                |
| ------ | ------------------------------------------------------ | ------------------- |
| 200    | `{ status: "ready", email }`                           | the link is live    |
| 400    | `error: "bad_request"`                                 | no token in the URL |
| 410    | `error: "expired" \| "already_used" \| "unknown_link"` | it is not usable    |

### `POST /api/sign-in/redeem`

```json
{ "token": "…" }
```

Spends the link and sets the session cookie. Pulse web sends this request
only after the person presses the **Continue as** button naming the address. Same 400/410 answers as the
GET, plus 403 `origin_not_allowed` for a missing or foreign `Origin` (see "Request
origin"), which spends nothing. On success:

```json
{
  "status": "signed_in",
  "voter": { "id": "…", "email": "…", "community": "…" },
  "firstTime": true
}
```

One door: this creates the identity the first time and signs the same person back in
every time after. There is no separate sign-up.

**It also confirms this browser's votes** (ADR-0040). If the browser making the click
holds a `__Host-pulse_ballot` cookie, every vote filed under it on an anonymous poll
that is still open becomes a confirmed vote of the person signing in — see "Confirmed votes" below. A
closed poll's votes are left as they are, so its results stop changing when it closes.
Nothing about this shows in the response, and no ballot cookie is minted here.

A person keeps **one vote per poll** (ADR-0046). If they already hold a vote on that
poll in another browser, the one **cast more recently** stays, and it stays **in this
browser**: when the other browser's vote is the newer one, its answer and cast time
move here, and the other browser no longer holds a vote on that poll. When this
browser's vote is the newer one, the other browser's is deleted. So after signing in,
`GET /api/my-votes` and `GET /api/polls/:id/ballot` in this browser show the person's
current answer, which may be one this browser never cast.

`community` is a string, or **`null` when the address's domain named no community**
(ADR-0030). It is always present, never left out, so a client reads one shape either
way. Null is the honest answer — no community — rather than an empty string or a
placeholder a client would have to know to treat as absent. The community is decided
when the link is asked for and kept: a domain added to the table later does not change
the community of someone who already signed in.

Two clicks on one link at once — a double click — sign in once: the first sets the
cookie and the second is answered 410 `already_used`. A client should not show that
second answer as a failure to someone who is, in fact, signed in.

The pending row containing the address is deleted atomically when the link is
spent; only a token-hash replay marker remains, preserving `already_used` for
repeat clicks without retaining the pending address. An expired, unused row is
eligible for removal once it expires, and a replay marker 20 minutes after use
(the 15-minute link lifetime plus a five-minute margin). Eligible rows are
removed at the next server startup or redemption; a sign-in-link request also
removes expired pending rows. There is no periodic sweep, so with no such
event a row can stay past its time. A link therefore remains recognisable as
`already_used` for at least its usable lifetime; once its marker or expired
pending row has been removed, it answers `unknown_link`. Both remain 410 and cannot sign
anyone in. All retention boundaries use the application clock. Link lifetime
and the success response are unchanged.

### `POST /api/sign-out`

No body. From the web origin it always answers `200 { "status": "signed_out" }`,
whether or not anyone was signed in — asking to be signed out is not something to
refuse. A missing or foreign `Origin` is answered 403 `origin_not_allowed` (see
"Request origin") and changes nothing: no cookie is cleared and no session ends. It clears the session
cookie **and** atomically advances that voter's session generation in shared
storage, so every earlier session stops working on every server instance,
regardless of differences between their clocks.

It also clears **`__Host-pulse_ballot`** — see "The ballot cookie" below.
Signing out ends this browser's ability to read or change the vote it cast. The vote itself is not
withdrawn; it stays counted under the identity that cast it, and **a confirmed vote
stays confirmed** (ADR-0040), until the same person votes on that poll again, which
replaces it (ADR-0046).

### `GET /api/me`

Who is signed in, according to the cookie.

```json
{ "voter": { "id": "…", "email": "…", "community": "…" } }
```

The voter is **wrapped**, the same way it is in the redeem response, so a later field
about the session itself can be added beside it without changing what `voter` means.
`community` is a string or `null`, exactly as in the redeem response.

This shape is unchanged by P8 (ADR-0033), which stores the address as a credential the
voter holds rather than as the voter's key: `email` is read back from that credential,
and every voter so far signs in by email, so it is always a string.

| Status | Body                  | When                                                        |
| ------ | --------------------- | ----------------------------------------------------------- |
| 200    | `{ voter }`           | signed in                                                   |
| 401    | `error: "signed_out"` | no cookie, an expired or older generation, or no such voter |

A 401 here is an ordinary answer — "nobody is signed in" — not a fault. The client
reads it as `null`.

## Member profiles

Profiles are opt-in. A profile is public once a display name is saved; the owner
can hide it. The profile's opaque `publicId` is
generated by Pulse, is not the voter id or derived from an email address, and
stays the same when the name changes or visibility is turned off and on.

Profile text is plain text. Display names are trimmed, contain 1–80 Unicode
code points with at least one visible character (a letter, number,
punctuation mark or symbol), and need not be unique. They contain no control or
format characters, which refuses bidi overrides and isolates (U+202A–U+202E,
U+2066–U+2069), with one exception: the zero-width non-joiner and joiner
(U+200C, U+200D) are allowed, because emoji sequences and Persian and Indic
names use them. A name made only of invisible characters is refused. Bios are trimmed and contain 0–280 Unicode
code points. NUL characters, malformed Unicode, unknown fields and non-string
text are refused. No profile response contains an email address, credential,
internal voter id, session data, votes, ballots, or other private account
activity. Contributions are read through the separate list routes below.

### `GET /api/profiles/:publicId`

Public, with no session required and no cookies created or renewed. Successful
and unavailable responses send `Cache-Control: no-store` so hiding a profile
takes effect without a cached public copy lingering.

```json
{
  "publicId": "f8cdca64-0d4f-4b99-b5bc-e6b749843ad8",
  "displayName": "Ada",
  "bio": "Neighbour and community gardener.",
  "createdAt": "2026-11-12T12:00:00.000Z"
}
```

The body is an allow-listed public projection. `bio` is always a string,
including `""` when the member left it blank. `createdAt` is when the member
first saved a profile; changing the name, bio or visibility does not change it.

A malformed public id, a missing profile and a hidden profile all return the
same status and body, so this route never reveals whether an account or hidden
profile exists:

```json
{ "error": "not_found", "message": "That profile is unavailable." }
```

### `GET /api/profiles/:publicId/contributions?cursor=…`

Public. Lists contributions published by the account that owns this visible
profile, newest first, with the same `{ contributions, nextCursor }` page and
cursor rules as `GET /api/contributions`. A malformed id, missing profile and
hidden profile all return the same `404 not_found` as the profile route. The
lookup uses the private owning account id, never the display name, and neither
that id nor an email is returned. A malformed cursor or any query field besides
`cursor` returns 400 `bad_request`. When the server has no contribution storage
configured, a visible profile's list returns 503 `contributions_unavailable`.

### `GET /api/me/profile`

Requires the current signed-in member and sends `Cache-Control: no-store`.
Before the member has saved a display name it returns `200 { "profile": null }`.
Otherwise it returns the owner view:

```json
{
  "profile": {
    "publicId": "f8cdca64-0d4f-4b99-b5bc-e6b749843ad8",
    "displayName": "Ada",
    "bio": "Neighbour and community gardener.",
    "visible": true,
    "createdAt": "2026-11-12T12:00:00.000Z",
    "updatedAt": "2026-11-12T12:05:00.000Z"
  }
}
```

No `Origin` is required because this route changes nothing. A missing, expired
or revoked session returns 401 `signed_out`. Storage failures return 500
`server_error`.

Optional query `ownerAccountId`: the account the editor is reading for (the
`id` from `/api/me`). The web client always sends it. If another account is
signed in, the route returns 409 `account_changed` and no profile, so a page
that missed an account switch never shows one account's profile in another's
form. An empty value returns 400 `bad_request`.

### `PUT /api/me/profile`

Requires the current signed-in member, `Content-Type: application/json`, and an
`Origin` exactly matching `PULSE_WEB_ORIGIN`. The strict JSON body is:

```json
{
  "ownerAccountId": "account-id-from-api-me",
  "displayName": "Ada",
  "bio": "Neighbour and community gardener.",
  "visible": true
}
```

All four fields are required. `ownerAccountId` is the nonempty account id from
`GET /api/me` that the editor loaded, including before a profile exists. It is
a write precondition, never a target account chosen by the caller. If it differs
from the authenticated session account, the server returns 409 `account_changed`
without writing anything. The editor clears the draft, reloads the session and
profile, and tells the person their account changed.

`displayName` may not read as **"Verified voter"**: that label is what a public
vote shows for an account with no profile name (ADR-0048). The name is compared
after NFKC normalization and lower-casing, ignoring every mark, format character,
separator, punctuation and whitespace, and the blank fillers U+3164, U+115F,
U+1160, U+FFA0, U+2800 and U+1D159. So `" verified   VOTER "`, `"verified-voter"`,
`"Verifiedvoter"` and the name with invisible joiners in it are all refused, while
`"Verified voter 2"` is not. Such a write answers 400 `reserved_name`, "That name
is kept for voters without a profile name. Choose another.", and saves nothing; the database refuses the name
too. Lookalike letters from other scripts are not caught.

The first successful write generates the stable
public id and creation time; later writes update the same row. Setting
`visible` to `false` makes the public route unavailable without discarding the
id, text or creation time. The response is `200` with the same `{ profile }`
owner view as the GET route and `Cache-Control: no-store`.

The owner profile routes are limited per client and per route to 30 requests a
minute by default, including refused requests. The PUT body limit is 2 KiB.

| Status | Error                | Meaning                                      |
| ------ | -------------------- | -------------------------------------------- |
| 400    | `bad_request`        | Invalid JSON, shape, fields, text or type    |
| 400    | `reserved_name`      | `displayName` is "Verified voter"            |
| 401    | `signed_out`         | Missing, expired or revoked session          |
| 403    | `origin_not_allowed` | PUT has a missing or foreign Origin          |
| 409    | `account_changed`    | PUT draft owner differs from session account |
| 413    | `body_too_large`     | PUT body exceeds 2 KiB                       |
| 429    | `too_many_requests`  | More than the per-client route limit         |
| 500    | `server_error`       | Unexpected storage fault; safe generic reply |

### `GET /api/me/contributions?cursor=…`

Requires the current signed-in member and returns only contributions owned by
that account, newest first, with the standard contribution page shape. The web
profile uses this owner-only list for links to the existing progress-update and
organizer-inbox controls. Another signed-in account receives its own list; a
signed-out request returns 401 `signed_out`. Responses are `no-store` and
contain no private account identifier or message body.

Optional query `ownerAccountId`, as on `GET /api/me/profile`: the account the
page is reading for (the `id` from `/api/me`). The web profile always sends it.
If another account is signed in, the route returns 409 `account_changed` and no
list; an empty value returns 400 `bad_request`. A malformed cursor, or any
other query field besides `cursor`, returns 400 `bad_request`. When the server
has no contribution storage configured, it returns 503
`contributions_unavailable`.

## The session cookie

`__Host-pulse_session`, `HttpOnly`, `SameSite=Lax`, `Secure`, path `/`,
no Domain, 30 days. Local HTTP development (`secureCookies: false`) uses
`pulse_session` without Secure. Both cookie names are selected together from
`secureCookies` (true by default). Production never reads the old unprefixed
`pulse_session` or `pulse_ballot` cookies: deployment requires a fresh sign-in
and loses access to earlier browser ballots; their votes remain counted.

It carries the voter id, a session generation, issue and expiry times, and a
signature over them. Expiry is checked on the server, not left to the browser.
Each request compares the generation with the current voter row. Sign-out
increments that row atomically, so earlier sessions stop working on every
device. A new sign-in receives the current generation. A sign-in racing with
sign-out may receive an older generation and need a fresh link; it cannot
restore a session that sign-out revoked.

Session cookies issued before the generation format are refused and require a
new sign-in. Ballot cookie values retain their format, but production only
reads them under the `__Host-pulse_ballot` name.

## Polls, ballots, and results

A poll is a question with a fixed, ordered set of choices and a `method` that says
how it is answered: `single` is one choice, `approval` is any number of them. A
ballot is an **array of choice indices** in both cases — the method decides how many
entries are allowed, not the shape. A choice is referenced by its position in
`choices`, never by its text.

A vote is **changeable until the poll closes.** Casting again before close replaces
the ballot; there is no "already voted" refusal. This is a plain, mutable
record — pulse is charter-exempt, so nothing here is append-only or hash-chained.

Polls are a **graph**: `next` names, for each choice, the poll that answering that way
opens. Answering is also navigating.

### Anonymous and public-vote polls (ADR-0048)

Every poll carries `votePrivacy`, `"anonymous"` or `"public"`, fixed when it is
created and never changed. Anonymous is the default, and every seed and older poll
is anonymous: everything below about the ballot cookie, confirmation and sign-in
describes anonymous polls, exactly as before.

On a **public-vote poll** each vote is shown with the voter's profile display name,
or "Verified voter" when they have none, to everyone who can see the poll. So:

- Voting needs an email sign-in, and the cast must say `"publicVote": true`, which a
  client sends only from a vote card that showed the "Votes are public" notice (see
  `POST /api/polls/:id/votes`).
- The vote is the **account's**, found by the session from any browser. It is never
  filed under the ballot cookie, which public-vote routes neither read nor mint, and
  sign-in never moves or confirms it. It is always confirmed, so on such a poll
  `confirmedVoters` equals `voters`.
- Signing out hides it from that browser but does not remove it.

- Anyone who can see the poll can read its names and answers, a page at a time
  (`GET /api/polls/:id/public-votes`).
- The voter may remove their vote while the poll is open
  (`DELETE /api/polls/:id/votes/mine`); after it closes the vote is fixed.

A public-vote poll is made by `POST /api/polls` with `"votePrivacy": "public"`
(ADR-0048 step 4b). Nothing changes the setting afterwards.

### The ballot cookie, and why voting needs no session

`__Host-pulse_ballot`, `HttpOnly`, `SameSite=Lax`, `Secure`, path `/`,
no Domain, 30 days. Local HTTP development uses `pulse_ballot` without Secure.
It is minted the first time this browser reads or casts a ballot. Sign-out
clears both selected cookies with the same security and path attributes.

**A vote is filed under this cookie and under nothing else**, whether or not the
person has ever given an address. Two consequences, both deliberate:

- A vote counts the moment it is cast. Signing in afterwards **verifies** a person; it
  is never how their vote is found, and it never gates the vote.
- **No account id and no address is ever stored beside an answer**, except on
  public-vote polls, which are not filed under this cookie (ADR-0048). What a confirmed
  vote stores instead is a **one-way keyed code** (ADR-0040): HMAC-SHA256, under a key
  only the server holds (`PULSE_CONFIRMATION_KEY`), of the account id and the poll id.
  Precisely what that means:
  - A copy of the database alone does not show who voted what: without the key, the
    code cannot be computed from an account id, and it cannot be reversed.
  - **Whoever holds the key as well as the database can work it out**, by computing
    the code for every account and looking for it. That is the accepted limit; full
    separation is the ODC core's job (identity service and private linkage map).
  - The code is the same for one person on one poll. The database showed when two
    ballots on the same poll were confirmed by the same (unnamed) person, until one
    replaced the other: now it holds at most one per person per poll (ADR-0046). Codes
    differ between polls, so they do not link one person's votes across polls.
  - A vote nobody confirmed stores nothing of the kind.

It is signed by the session signer, and each cookie is refused in the other's place.
Presented as a session, a ballot cookie names a voter that does not exist, so it signs
nobody in. Presented as a ballot, a session cookie is **ignored**: every ballot identity
has started with `b:` since the cookie was introduced and carries no session
generation, and a value without the prefix or with a generation is treated as no
ballot. The browser is minted a fresh ballot, as if it had none, and sign-in confirms
nothing for it. So copying a session into `__Host-pulse_ballot` can never file
a vote under an account id.

Deduplication is therefore per browser, which is weak on its own. That is the accepted
trade for counting a vote before anyone has been asked for anything.

**`POST /api/sign-out` clears this cookie too.** It has to. The cookie lasts thirty
days and is the only thing a ballot is filed under, so a browser that kept it across a
sign-out would hand the next person the previous person's ballot — to read, and to
overwrite, since a second cast under the same identity _replaces_ rather than adds. On
a shared or public machine that is the one way pulse can leak how somebody voted, and
it is wider than the per-browser weakness above.

Signing in again mints a **new** ballot identity, so one person who votes signed in,
signs out, signs back in and votes again casts from a new ballot. That second vote
**replaces** the first (ADR-0046): a confirmed person holds one vote per poll, so they
are counted once. A vote cast without signing in, and never confirmed, is still counted
once per browser.

### `GET /api/my-votes?limit=20&cursor=…`

The current browser's saved answers, newest cast first: the ballots filed under
the signed `__Host-pulse_ballot` cookie, including for someone who has not signed
in, and, when a valid session is present, that account's votes on public-vote polls
(ADR-0048), merged into the same order and cursor. It never creates a cookie. With
neither a valid ballot cookie nor a session it returns an empty page.
`POST /api/sign-out` clears both cookies, so this history disappears from that
browser. A poll also leaves this list
when the same person votes on it in another browser while signed in, and one can
appear here when this browser signs in and the person's newer vote moves here
(ADR-0046). Every response, errors included, carries
`Cache-Control: private, no-store` and `Vary: Cookie`, because the answer depends
on who is asking.

```json
{
  "votes": [
    {
      "pollId": "question-id",
      "votePrivacy": "anonymous",
      "question": "Should we open a garden?",
      "choices": ["Yes"],
      "ballot": [0],
      "castAt": "2026-10-20T12:00:00.000Z",
      "closesAt": null,
      "open": true
    }
  ],
  "nextCursor": null
}
```

Each entry is the current ballot for one poll: `ballot` holds the chosen
positions in ascending order and `choices` their labels in the same order.
The additive `votePrivacy` field is the poll's fixed setting, `"anonymous"` or
`"public"`.
`closesAt` is the poll's closing time or `null`, and `open` says whether it was
open when this page was read. It has no account id, voter id, or confirmation code. Closed polls
remain listed, and a changed answer moves to the top. `limit` defaults to 20
and accepts 1 through 50. A cursor is an opaque page boundary tied to cast
time and poll id; pass it unchanged. Invalid or extra query parameters return
400 `bad_request`. A cursor never grants access to a different browser's votes.
As with public poll browsing, this is a live list, not a snapshot: changes while
paging can move entries. A page may hold fewer than `limit` entries, even none,
and still carry a `nextCursor`: an entry whose question was deleted while the
page was read is left out. Keep following the cursor until it is `null`.
Storage failures return 500 `server_error`.

Signing out clears the cookie in that browser; it does not revoke the ballot
identity on the server. Anyone holding a copy of the cookie can read this
list, as they could already read each of its ballots one poll at a time.

### `GET /api/polls?community=ID&limit=20&cursor=…`

Public browsing (#259), without a session or ballot cookie. `community` is
required; anyone may read any community, including `pulse-general`. An unknown
community returns an empty page. `limit` defaults to 20 and accepts integers
from 1 to 100. Each query parameter may occur once; unknown parameters are refused.

```json
{
  "polls": [
    {
      "id": "question-id",
      "question": "Should we open a garden?",
      "method": "single",
      "createdAt": "2026-10-20T12:00:00.000Z",
      "closesAt": null,
      "open": true,
      "image": { "kind": "tile" },
      "votePrivacy": "anonymous"
    }
  ],
  "nextCursor": null
}
```

Each row carries the poll's `votePrivacy` and the same `image` object as
`GET /api/polls/:id` (see "Pictures (ADR-0047, ADR-0049)" below), so a page
shows thumbnails without a read per poll.

Lists open and closed polls in that community, excluding hidden polls and legacy
polls without a community. No private author, account, ballot or vote data is
returned. Fetch `GET /api/polls/:id` for choices and public attribution.
Results are newest first by creation time, then descending UTF-8 poll ID bytes.
Openness is evaluated at request time. Empty pages return `polls: []`.

Pass `nextCursor` unchanged for the next page; null means no further page.
Cursors are versioned, bound to the requested community, and contain only public
ordering keys. They confer no access and may outlive the referenced poll.
Pagination uses an exclusive creation-time/ID boundary, so unchanged polls are
neither repeated nor skipped. New polls before that boundary require a fresh
first page; deletion/hiding removes polls from subsequent pages. This is a live
listing, not a snapshot: backdated insertions or visibility changes may alter
later pages.

400 `bad_request` means a missing/blank/overlong community (maximum 200 characters),
invalid limit, repeated/unknown parameter, malformed cursor (maximum 2048
characters), unsupported cursor version or cursor from another community.
500 `server_error` uses the standard recoverable error body on storage failure.
No cookies are created or renewed by this route.

### `GET /api/polls/:id`

The poll, in the shape the client reads. No session required — a story viewer reads
this while moving through the story, and it reveals nothing about a person.

```json
{
  "id": "ads-free",
  "question": "Should the ODC stay free of paid ads?",
  "context": null,
  "choices": ["No", "Yes"],
  "method": "single",
  "next": ["ads-allowed", "pay-for-it"],
  "acceptsSuggestions": false,
  "closesAt": "2026-08-28T12:00:00.000Z",
  "open": true,
  "image": { "kind": "tile" },
  "votePrivacy": "anonymous"
}
```

`votePrivacy` is always present: `"anonymous"` or `"public"` (see "Anonymous and
public-vote polls" above). Creation responses, first and replayed, carry it too; a
replay saved before it existed reads `"anonymous"`. MCP `get_poll` passes it on.

`image` is always present: the poster's picture (`kind: "upload"`) or
`{ "kind": "tile" }`, which the client draws. See
"Pictures (ADR-0047, ADR-0049)" below.

`next` has one entry per choice, position for position, and `null` where that choice
ends the run. Always the same length as `choices`.

`context` is optional background supplied by the poster: a plain-text string, or
`null` when absent (including seed and legacy polls). Markup-looking characters
are literal text, never HTML or Markdown. Public poll reads, creation responses
(first and replayed) and MCP `get_poll` return this field. Poll listing rows do
not carry it: they carry `image`, not `context`.

`acceptsSuggestions` says whether people may add options of their own — see below.

`closesAt` is an ISO timestamp, or `null` when the poll has no closing time. `open`
is the server's own reading of whether votes are still accepted, not a copy of a
clock the client would have to re-check.

**Authored polls (ADR-0037)** carry two more fields, `community` and `attribution`:

```json
{
  "community": { "id": "pulse-general", "label": "General" },
  "attribution": { "kind": "named", "name": "Ada" }
}
```

- `community` is `{ id, label }`: where the poll was posted. General is
  `pulse-general` / `"General"`; another community's label is the one stored for
  it, which today is its id.
- `attribution` is exactly `{ "kind": "anonymous" }` or exactly
  `{ "kind": "named", "name": <the poster's own display name> }`. The name is a
  self-description, not a verified identity. Nothing else is ever in it.
- Seed and older polls that were not published through creation have **neither
  key** — absent, not `null`. No author is invented for them.
- The body never includes the author's account id, email, credentials, posting
  permission, purpose acknowledgement or idempotency key. Whoever posted
  anonymously is not identified by this route.

The body is built by one allow-listed projection (`src/voting/public-poll.ts`),
which copies each field by name. The creation stores build their answer with
the same function (the creation routes are not served yet; see below), and MCP
`get_poll` passes this body on, so the representations cannot drift apart.

| Status | Body                 | When         |
| ------ | -------------------- | ------------ |
| 200    | the poll             | it exists    |
| 404    | `error: "not_found"` | no such poll |

### Planned — not served: `GET /api/polls/:id/related`

> **The current server does not serve this route.** This is the accepted contract for
> the next implementation PR (ADR-0025); no current client depends on it.

The polls related to this question independently of the answer anyone gave. No
session or ballot cookie is required. This is separate from `next`: `next` is selected
by a choice, while this route can return any number of related questions regardless of
the ballot.

```json
{
  "polls": [
    {
      "id": "community-budget",
      "question": "Where should next year's community budget go?",
      "method": "approval",
      "open": true
    }
  ]
}
```

Each related poll appears once. `polls` is an ordered array in the display order the
server selected for this request. Relationship storage carries membership only, so
clients must not treat array position as a durable rank. An empty set is
`200 { "polls": [] }`.

Related links are directed. A link from poll A to poll B does not imply B links to A.
Self-links, repeated targets, and links to missing polls are rejected when the
relationship is written. A target may also be the answer-specific `next` poll; a
future client that combines both lists shows that target once, with `next` taking
precedence.

| Status | Body                 | When                   |
| ------ | -------------------- | ---------------------- |
| 200    | `{ polls: [...] }`   | the source poll exists |
| 404    | `error: "not_found"` | no such source poll    |

### `GET /api/polls/:id/results`

The tally. No session required.

```json
{
  "pollId": "p1",
  "question": "Where next?",
  "method": "approval",
  "voters": 2,
  "votePrivacy": "anonymous",
  "choices": [
    { "index": 0, "label": "Park", "count": 2, "share": 100 },
    { "index": 1, "label": "Library", "count": 1, "share": 50 },
    { "index": 2, "label": "Rink", "count": 1, "share": 50 }
  ]
}
```

`voters` is the number of **ballots**, not the number of selections: one per confirmed
person (ADR-0046) and one per browser for votes nobody confirmed. `share` is `count / voters * 100`, rounded to one decimal, `0` when
nobody has voted. For an `approval` poll a voter picks several choices, so shares
legitimately **sum to more than 100** — that is correct and is not normalised away.
`votePrivacy` is the poll's setting, on this body and on the `results` of a cast; the
numbers are counted the same way for both kinds. MCP `get_results` passes it on.

**Confirmed numbers** sit beside the totals (ADR-0040; see "Confirmed votes" below).
`confirmedVoters` is how many people confirmed by email, **counted once per person**;
each choice's `confirmedCount` is how many of them picked it, and `confirmedShare` is
`confirmedCount / confirmedVoters * 100`, rounded the same way. All three are `0` when
nobody has confirmed, and they are always present. `confirmedVoters` never exceeds
`voters`. Every ballot counts in the totals, confirmed or not, and a confirmed person
has one ballot per poll, so the totals count them once too.

```json
{
  "pollId": "p1",
  "question": "Where next?",
  "method": "single",
  "voters": 3,
  "confirmedVoters": 1,
  "choices": [
    {
      "index": 0,
      "label": "Park",
      "count": 2,
      "share": 66.7,
      "confirmedCount": 0,
      "confirmedShare": 0
    },
    {
      "index": 1,
      "label": "Library",
      "count": 1,
      "share": 33.3,
      "confirmedCount": 1,
      "confirmedShare": 100
    }
  ]
}
```

#### Confirmed votes (ADR-0040)

This describes anonymous polls. A public-vote poll's votes are always confirmed and
are the account's own (see "Anonymous and public-vote polls").

- A vote is **confirmed** when it is cast by someone signed in, or when the browser
  holding its ballot cookie signs in afterwards (`POST /api/sign-in/redeem`, open polls
  only).
- **One vote per person per poll** (ADR-0046). A vote cast while signed in replaces
  the person's vote on that poll in any other browser: that browser's
  `GET /api/polls/:id/ballot` answers `null` and the poll leaves its My votes. When a
  browser signs in, the person's vote **cast most recently** stays and the other is
  replaced; the survivor is filed under the browser that signed in (see
  `POST /api/sign-in/redeem`). Signing in later does not make an older vote the most
  recent — the cast time decides, not the sign-in time. Votes cast in the same
  millisecond settle on one of them, the same one every time.
- Changing an answer keeps a vote confirmed, signed in or not. Changing it while
  signed out replaces nothing elsewhere. Casting while signed in as someone else makes
  it that person's confirmed vote instead.
- Signing out does not remove a confirmation.
- One person is one account, which today is one email address. Two addresses are two
  confirmed people.

| Status | Body                 | When            |
| ------ | -------------------- | --------------- |
| 200    | the results          | the poll exists |
| 404    | `error: "not_found"` | no such poll    |

### `GET /api/polls/:id/ballot`

This browser's own current ballot, so the UI can show what was picked. **No session
required** — on an anonymous poll the ballot cookie is the identity, and one is minted
if this browser has none yet.

On a **public-vote poll** it reads the session instead: signed in, the account's vote
on this poll from any browser; signed out, `null`. The ballot cookie is neither read
nor minted there.

Every response, `404` and errors included, carries `Cache-Control: private, no-store`
and `Vary: Cookie`, so no shared cache or proxy hands one person's answer to the next
reader of the same URL.

```json
{ "ballot": [0, 2] }
```

`ballot` is `null` when this browser has not voted on this poll. Under ADR-0046 it
also becomes `null` when the person whose vote it was has since voted on this poll in
another browser while signed in, or has signed in on another browser: their one vote
on the poll is then filed there, whichever answer was newer — the newer answer moves
there if it was this browser's, and this browser's older one is deleted if not (see
`POST /api/sign-in/redeem` and "Confirmed votes"). After a sign-in on this browser it
can be an answer cast in another browser, moved here. Its choices come back
in the poll's order, whatever order they were cast in: for `single` and `approval` — the
only methods today — a ballot says which choices, not a ranking of them.

| Status | Body                 | When         |
| ------ | -------------------- | ------------ |
| 200    | `{ ballot }`         | always       |
| 404    | `error: "not_found"` | no such poll |

### `POST /api/polls/:id/votes`

Requires `Origin` exactly matching `PULSE_WEB_ORIGIN` (403
`origin_not_allowed` otherwise, before body parsing) and
`Content-Type: application/json` (parameters such as `charset=utf-8` allowed;
missing or other types return 400 `bad_request`). Refused requests change nothing.

Cast or change a ballot. **No session required** on an anonymous poll, on purpose —
see the ballot cookie above. A public-vote poll needs one (below).

```json
{ "ballot": [1, 2] }
```

`publicVote` is optional; when present it must be `true`, and anything else is 400
`bad_request`. A client sends `"publicVote": true` only from a vote card that showed
the "Votes are public" notice. It must match the poll: a cast on a public-vote poll
**without** it, or on an anonymous poll **with** it, is 409 `vote_privacy_mismatch`,
"This poll's voting settings changed. Reload the page before you vote." So a client that has never heard of public-vote polls can never cast a
named vote, and one that believes a poll is public never files an anonymous vote.

The ballot is validated the same way the client validates it before sending: every
entry is a whole number naming a choice this poll has, entries are distinct, and a
`single` poll takes at most one. An **empty ballot is refused**, not read as a
retraction — the client never sends one, so an empty ballot is a bug, not someone
withdrawing their vote.

On a `counted` (first ballot) or `changed` (replacing a prior one) outcome, the
response carries the stored ballot (in the poll's order, as above) and the fresh
results, so the client need not ask again:

```json
{
  "status": "changed",
  "ballot": [1, 2],
  "results": { "pollId": "p1", "…": "…" }
}
```

When the poll has closed, the body is just `{ "status": "closed" }`.

A session is still not required. When one is present (the `__Host-pulse_session`
cookie, valid as for `/api/me`), the vote is **confirmed** as that person's (ADR-0040; see "Confirmed
votes" above), and it **replaces** that person's vote on this poll in any other browser
(ADR-0046). `status` still describes this browser's ballot: `counted` when this browser
had none, even if it replaced one elsewhere. Without a session, the vote keeps whatever
confirmation it already had and replaces nothing elsewhere.

**On a public-vote poll** a session is required, and the vote is the account's:
`counted` for its first vote on the poll, `changed` after, from whichever browser.
No ballot cookie is read or minted. The checks run in this order, and a refused cast
writes nothing and mints no cookie:

1. 403 `origin_not_allowed`, then 400 `bad_request` for the body.
2. 404 `not_found`.
3. 409 `vote_privacy_mismatch` (either kind of poll), before anything about the
   person is read, so an old client is never walked through sign-in towards a named
   vote it did not describe.
4. 503 `public_votes_unavailable` when the server has no confirmation key; nothing
   public is ever written without one.
5. 200 `{ "status": "closed" }` when the poll has closed.
6. 401 `sign_in_required`: "Sign in with your email to vote on this poll. Your vote
   will be shown with your profile name."
7. 400 `bad_ballot`.

The `results` in the answer carry `votePrivacy`, as `GET …/results` does.

| Status | Body                                                | When                                                           |
| ------ | --------------------------------------------------- | -------------------------------------------------------------- |
| 200    | `status: "counted" \| "changed"` + ballot + results | the ballot was recorded                                        |
| 200    | `status: "closed"`                                  | the poll is past its closing time                              |
| 400    | `error: "bad_request"`                              | missing/wrong Content-Type or no ballot array of whole numbers |
| 403    | `error: "origin_not_allowed"`                       | missing or foreign Origin                                      |
| 400    | `error: "bad_ballot"`                               | the ballot is not a valid answer to this poll                  |
| 400    | `error: "bad_request"`                              | `publicVote` present and not `true`                            |
| 401    | `error: "sign_in_required"`                         | public-vote poll and no valid session                          |
| 404    | `error: "not_found"`                                | no such poll                                                   |
| 409    | `error: "vote_privacy_mismatch"`                    | `publicVote: true` does not match the poll's setting           |
| 503    | `error: "public_votes_unavailable"`                 | public-vote poll and no confirmation key configured            |

### `GET /api/polls/:id/public-votes?limit=20&cursor=…`

A public-vote poll's names and answers (ADR-0048). **No session**; no cookie is read
for it or set. Every response, errors included, carries `Cache-Control: no-store`.

```json
{
  "items": [
    { "name": "Ada", "choices": [1] },
    { "name": null, "choices": [0, 2] }
  ],
  "nextCursor": "q0x…"
}
```

- `name` is the voter's **current** profile display name, read live, whether or not
  the profile is visible; a rename relabels every public vote they have cast, closed
  polls included. `null` means the voter has no profile: clients show it as
  "Verified voter" in a distinct style, with no link. Names are self-chosen and not
  unique.
- `choices` are poll-order indices, ascending, matched on `ChoiceResult.index`.
- Nothing else is sent: no email address, account id, ballot, vote id, cast time,
  profile `publicId` or bio, and no profile link.
- Order is fixed at each vote's first cast and is **not chronological**; a re-cast
  keeps its place, so paging never skips or repeats an entry. A removed vote leaves
  the list.
- `limit` is 1–50, default 20. `nextCursor` is `null` on the last page. Otherwise
  pass it back unchanged as `cursor`. It is opaque and sealed: it names this poll and
  a position, cannot be read or forged, differs every time even for the same
  position, and stops working if the server's confirmation key changes (then start
  from the first page again).
- Closed polls stay listed.
- **Rate limit:** `publicVotesRateLimit`, 60 requests a minute per client address by
  default, counting every answer from this route. It is one in-memory counter per
  address (per process, like every pulse limit), which MCP's `get_public_votes`
  shares: each tool call counts against its caller's address, and MCP's own read
  of this route is not counted again (see "MCP public reads"). Over it: 429
  `too_many_requests` with `Retry-After` in seconds.

The checks run in this order:

1. 429 `too_many_requests`.
2. 400 `bad_request` for the query: a `limit` outside 1–50, a malformed `cursor`, or
   any other parameter.
3. 404 `not_found` for no such poll.
4. 409 `anonymous_poll` when the poll's votes are anonymous, so a client can tell it
   from a missing poll: "This poll's votes are anonymous, so no names are shown."
5. 503 `public_votes_unavailable` when the server has no confirmation key, which seals
   the cursor.
6. 400 `bad_request` for a cursor that does not open or was given out for another
   poll. Both query and cursor refusals say "Start again from the first page of votes."
7. 404 `not_found` for a hidden poll. The page is read through a query that leaves
   hidden polls out, so a poll hidden while it is read is never served.

| Status | Body                                | When                                                  |
| ------ | ----------------------------------- | ----------------------------------------------------- |
| 200    | `{ items, nextCursor }`             | a visible public-vote poll, open or closed            |
| 400    | `error: "bad_request"`              | bad `limit`, a cursor that does not open, other query |
| 404    | `error: "not_found"`                | no such poll, or a hidden one                         |
| 409    | `error: "anonymous_poll"`           | the poll's votes are anonymous                        |
| 429    | `error: "too_many_requests"`        | over `publicVotesRateLimit` for this address          |
| 503    | `error: "public_votes_unavailable"` | no confirmation key configured                        |

### `DELETE /api/polls/:id/votes/mine`

Requires `Origin` exactly matching `PULSE_WEB_ORIGIN` (403 `origin_not_allowed`
otherwise). No body. Removes the **signed-in account's** vote on a public-vote poll
while the poll is open: its answer and its name go together, `voters`,
`confirmedVoters` and the picked choices' counts fall by one, and the person may vote
again while the poll is open. The ballot cookie is neither read nor minted, and
signing out or "Forget my votes here" never removes a public vote; this route does.

```json
{
  "status": "removed",
  "results": { "pollId": "p1", "votePrivacy": "public", "…": "…" }
}
```

- `removed`: the vote was removed; `results` are the fresh results, as from
  `GET …/results`.
- `none`: the account had no vote on this open poll; `results` as above. Repeating a
  removal is harmless.
- `{ "status": "closed" }` with no results: the poll has closed, and its votes stay
  as they are, whether or not this account had one.

A **hidden** public-vote poll still allows removal while it is open: the list no
longer shows it, but the voter keeps the right to take their vote back.

**Anonymous polls have no removal.** Their ballots are found by cookie or code, not
by account, so this route answers 409 for them, with or without a session or ballot
cookie, and removes nothing.

The checks run in this order, and a refusal changes nothing:

1. 403 `origin_not_allowed`.
2. 404 `not_found`.
3. 409 `anonymous_poll`: "This poll's votes are anonymous and cannot be removed.
   You can still change your answer."
4. 503 `public_votes_unavailable` when the server has no confirmation key.
5. 401 `sign_in_required` without a valid session: "Sign in with your email to
   remove your vote."

The removal takes the person's vote lock first and reads the clock after it, so a
removal that waited past the close answers `closed` and removes nothing.

| Status | Body                                    | When                              |
| ------ | --------------------------------------- | --------------------------------- |
| 200    | `status: "removed" \| "none"` + results | the poll is open                  |
| 200    | `status: "closed"`                      | the poll is past its closing time |
| 401    | `error: "sign_in_required"`             | no valid session                  |
| 403    | `error: "origin_not_allowed"`           | missing or foreign Origin         |
| 404    | `error: "not_found"`                    | no such poll                      |
| 409    | `error: "anonymous_poll"`               | the poll's votes are anonymous    |
| 503    | `error: "public_votes_unavailable"`     | no confirmation key configured    |

## Options people add themselves

Only on a poll whose `acceptsSuggestions` is true.

A suggestion is **not** a choice on the ballot. Choices are addressed by position and a
vote records that position, so adding one mid-poll would change what earlier ballots
meant. Suggestions sit beside the poll, are counted on their own, and become choices
only when someone opens a new poll on them.

Nothing records who made one.

### `GET /api/polls/:id/suggestions`

Most-said first.

```json
{
  "suggestions": [
    { "id": "…", "text": "Charge the members", "count": 12 },
    { "id": "…", "text": "Apply for grants", "count": 3 }
  ]
}
```

### `POST /api/polls/:id/suggestions`

Requires `Origin` exactly matching `PULSE_WEB_ORIGIN` (403
`origin_not_allowed` otherwise, before body parsing) and
`Content-Type: application/json` (parameters such as `charset=utf-8` allowed;
missing or other types return 400 `bad_request`). Refused requests change nothing.

```json
{ "text": "we could charge members" }
```

Near-duplicates are **folded together, never refused**. Two phrasings are the same
idea when the words that carry meaning overlap enough; the first wording submitted
keeps the floor and the count rises. Refusing a duplicate would only teach people to
phrase around the check, which turns a list of options into a list of synonyms.

```json
{
  "status": "seconded",
  "suggestion": { "id": "…", "text": "Charge the members", "count": 2 },
  "related": [{ "id": "…", "text": "Charge members once a year", "count": 1 }]
}
```

`status` is `added` when nobody had said it and `seconded` when someone had. `related`
is what came close without being close enough to fold in — shown so a person can see
they are near an existing idea, not used to refuse them.

There is a third answer. When the text matches one of the poll's **own choices**,
nothing is added and the choice is named back instead:

```json
{
  "status": "on_ballot",
  "choice": { "index": 2, "label": "Grants" },
  "related": [{ "id": "…", "text": "Grant funding from the city", "count": 1 }]
}
```

`choice.index` is the position to cast for it — the same index a ballot carries — and
`label` is the poll's own wording. Note there is **no `suggestion` field** on this
answer, because none was created.

Nothing is added on purpose, and the distinction is the whole reason suggestions exist
separately: a choice is **votable** and a suggestion is not. Adding a second copy of an
option the ballot already offers would split the very agreement it was meant to
gather — some people voting for it and others seconding a suggestion of it — while
`Poll.choices` stays fixed, because a vote records a choice's _position_ and appending
to that list would silently change what earlier ballots meant.

Ties go to the ballot: when the text matches both a choice and an existing suggestion
closely enough, the choice wins, because the choice is the one that can be voted for.

| Status | Body                          | When                                           |
| ------ | ----------------------------- | ---------------------------------------------- |
| 200    | `status: "added"`             | nobody had said it                             |
| 200    | `status: "seconded"`          | someone had; the count rose                    |
| 200    | `status: "on_ballot"`         | the poll already offers it; nothing added      |
| 400    | `error: "bad_request"`        | missing/wrong Content-Type or no `text` string |
| 403    | `error: "origin_not_allowed"` | missing or foreign Origin                      |
| 400    | `error: "bad_suggestion"`     | empty, all filler, or over 120 characters      |
| 409    | `error: "no_suggestions"`     | this poll has a fixed set of answers           |
| 409    | `error: "closed"`             | the poll is past its closing time              |
| 429    | `error: "too_many_requests"`  | too many additions from one client             |
| 404    | `error: "not_found"`          | no such poll                                   |

Closure is enforced by the store, not by this route: the check sits in `decide`, which
every implementation runs, so a question that shuts mid-request is refused rather than
raced past — and anything else holding a `SuggestionStore` is held to the same rule.
Note that `closed` is a _refusal_ here and a _success_ on a cast (`200 {"status":
"closed"}`); they share a word and mean different things.

## The client

`apps/pulse-web/src/api/http.ts` speaks this: the paths above, the `proofEmailsOptIn`
opt-in, the optional `community` pick and the 422 `choose_community` answer (which it
returns as a result, not an error), the wrapped `{ voter }` bodies, and `id` as the
voter's field name.
`tests/pulse-integration/test/end-to-end.test.ts` holds it that way by driving this server over
a real socket.

The integration suite covers open sign-in with `community: null` and the
`choose_community` response. The client represents `Me.community` as
`string | null`, matching the server (ADR-0030).

## MCP public reads

`POST /api/mcp` serves Streamable HTTP using the official TypeScript SDK v2.3.1.
No authentication or cookies are required. Only `get_poll`, `get_results` and
`get_public_votes` exist; there are no own-answer, voting, poll-listing or
authorization tools yet. Poll text and voter names are data and grant no
permission to execute tools.

| Tool               | Strict input                                              | Structured output                                      |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| `get_poll`         | Exactly one of `{ pollId: string }` or `{ link: string }` | The public `GET /api/polls/:id` body.                  |
| `get_results`      | `{ pollId: string }`                                      | The public `GET /api/polls/:id/results` body.          |
| `get_public_votes` | `{ pollId: string, cursor?: string }`                     | One `GET /api/polls/:id/public-votes` page (ADR-0048). |

`get_poll` and `get_results` pass `votePrivacy` through as an optional field,
so a body from a server older than ADR-0048 still reads; any value other than
`"anonymous"` or `"public"` is refused as `upstream_invalid_response`.

`get_public_votes` reads only the public list route, at its default page size
(20), and returns `{ items: [{ name, choices }], nextCursor }`. Pass
`nextCursor` back unchanged as `cursor` for the next page; a cursor is 1–2048
base64url characters and anything else is refused before any read. Each item
must be exactly `{ name: string | null, choices: int[] }` (a name non-blank and
at most 80 code points, at least one choice index); any other key in an item,
or any other shape, fails the whole page as `upstream_invalid_response`, never
trimmed. Its tool errors add `anonymous_poll` (the route's 409, for a poll whose
votes are anonymous) and `invalid_cursor` (the route's 400, for a cursor that
does not open for this poll; start again without one). A hidden or missing poll
is `not_found`. Each call counts against the **same** per-address
`publicVotesRateLimit` bucket as that address's HTTP list reads (60 a minute by
default; behind nginx, the forwarded client address), before any read; over it
is `too_many_requests`. The tool's own read of the route reaches this process's
loopback listener with a per-process random `x-pulse-internal` header, which the
list's limiter passes so the caller is not counted twice; the header is never
configured, logged or sent to a configured upstream, and the web image's nginx
drops any copy a client sends. A call also counts toward
the route's 120 requests/minute.

`get_poll` passes an authored poll's `community` and `attribution` through as
optional fields, so a body from a server older than ADR-0037, or a seed poll's
body, still reads and gains neither key. Inside them the shapes are strict:
`community` is exactly `{ id, label }` (both non-empty strings); `attribution`
is exactly `{ kind: "anonymous" }` or `{ kind: "named", name }` with a name that
is not blank and is at most 80 code points. A body with anything else inside
either object — an extra key such as an account id or email, a name on an
anonymous attribution, an unknown kind, or `null` — is refused whole as
`upstream_invalid_response` rather than trimmed, because such an upstream is not
serving the public projection. Unknown keys elsewhere in the poll are still
stripped as before.

`get_poll` passes `image` through as an optional field in its exact public
shapes (`upload` with relative picture URLs, or `tile`); anything else inside
it is refused whole as `upstream_invalid_response`.

`get_results` passes the confirmed numbers through as optional fields, so a body from a
server older than ADR-0040 still reads, and refuses a body claiming more confirmed
people than voters, or more confirmed picks of a choice than confirmed people.

Identifiers contain 1–128 ASCII letters, digits, underscores or hyphens. Links
must use the configured public origin and `/polls/:id` or `/api/polls/:id`.
Userinfo, query strings, fragments and encoded path segments are rejected.
The current web client's `?poll=...` links are not supported by this slice;
use an id instead. Links are parsed, never fetched. All upstream requests use
one fixed API base URL, GET only, no forwarded headers/cookies, and no redirects.

Closed polls and their results remain readable; `get_poll` returns `open: false`.
Missing/invalid arguments and extra fields return SDK input-validation tool
errors (`isError: true`); protocol-invalid messages use protocol errors.
Tool failures carry `isError: true`, with safe `{ error, message }` structured
content: `invalid_link`, `not_found`, `unsupported_method`, `too_many_requests`,
`upstream_unavailable` (timeout/network/non-success), or
`upstream_invalid_response` (invalid, oversized or unexpected public body), and
for `get_public_votes` also `anonymous_poll` and `invalid_cursor`.
No upstream error message, private field, Set-Cookie or credential is returned.

The route accepts at most 16 KiB per request and 120 requests/minute per client IP.
This initial limiter is in memory and must become shared before scaling to
multiple instances. GET/DELETE return 405. SDK protocol validation handles
version/header/envelope errors. Origin, if present, must match the configured
public origin; non-browser clients may omit it. With a public origin configured,
Host must equal that origin's host exactly, port included, compared without
regard to case, and nothing else is accepted, not even this API's own loopback
listener: the web image's nginx forwards the client's `Host` verbatim, so a
loopback value would otherwise be a way in. Without one (in-process and `dev`),
Host must name the loopback listener. Route request logging is disabled to avoid recording
untrusted headers, query strings or bodies.

The `createServer` option `mcp` may specify `publicOrigin`, `apiBaseUrl` and
`timeoutMs` (default 5 seconds). Defaults target this API's loopback listener;
therefore the dev server works without configuration after it listens, including
on a throwaway port. Custom upstreams require HTTPS, except loopback HTTP.
The served entry point (`src/main.ts`) passes
`mcp: { publicOrigin: PULSE_WEB_ORIGIN }` and no `apiBaseUrl`, so through nginx
MCP answers at `<PULSE_WEB_ORIGIN>/api/mcp` and its reads stay on loopback. A
served API therefore refuses to start with a plaintext `PULSE_WEB_ORIGIN` other
than `localhost`, `127.0.0.1` or `[::1]`. The adapter reads only
public HTTP routes, without store/core imports. See ADR-0036.

## Poll creation (ADR-0037)

These routes require the current signed-in account; session generation/expiry
checks match `/api/me`, and the store checks the generation again inside its
transaction, so a sign-out that lands mid-request still wins. Creation never
reads, mints or clears the caller's ballot cookie, and these routes set no
cookie at all.

Mutations with bodies require `Content-Type: application/json` and an `Origin`
exactly matching the configured web origin (`PULSE_WEB_ORIGIN`, the same origin
sign-in links point at); missing/foreign origins are refused, including for
non-browser callers. Bodyless DELETE needs no Content-Type but retains the same
Origin check, and a DELETE that carries a body is refused. Origin configuration
comes from trusted server setup, not Host or forwarded headers. A server built
without a web origin refuses every creation mutation.

Every route here is rate limited per client: 30 requests a minute per route by
default (`creationRateLimit`), answered 429 `too_many_requests` — the same slug
and sentence as sign-in and suggestions. It counts every request, including
refused and replayed ones, and comes first. It is separate from the five-an-hour
posting quota (`posting_limit`), which counts only successful creations. A
`too_many_requests` answer's `Retry-After` is the rate limiter's wait, not the
posting quota's. Like the
other limits it is in memory, so N instances allow N times as much.

Then checks run in this order, before the body is read: creation available (else
503), Origin for mutations (else 403), session (else 401), Content-Type (else
400). Only then is the body read and parsed as strict UTF-8 JSON, and only then
is any account-bound data looked up. Responses carry `Cache-Control: no-store`.

A server started without a creation store — a test, or an embedding that does
not configure one — answers every route here with 503 `creation_unavailable`.
`main.ts` and `dev-server.ts` always configure one.

### `GET /api/poll-creation/context`

Authenticated, read-only, no side effects. Returns:

```json
{
  "community": { "id": "pulse-general", "label": "General" },
  "canPostUnlimited": false,
  "purposeVersion": "community-purpose-v1",
  "purposeAcknowledged": false
}
```

Community is derived from the stored account; non-General labels initially use
existing community IDs. Permission is a server result, never a request setting.
`canPostUnlimited` is true for the owner and for an account holding the
unlimited-posting grant. No Origin is required: it changes nothing, and no
cross-origin page can read it, since no CORS headers are sent.
401 `signed_out`; 503 `creation_unavailable` for unavailable storage; 500
`server_error` for an unexpected fault. The form
computes its one-week default for display; omitting the close time below makes
the server authoritative. First posts require the approved statement and promise.

### `POST /api/polls`

Required `Idempotency-Key`: client-generated UUID, scoped to this account
(compared case-insensitively). Required `Content-Type: application/json` and
`Origin`. JSON body (unknown properties refused):

```json
{
  "question": "Should we open a community garden?",
  "choices": ["Yes", "No"],
  "method": "single",
  "attribution": { "kind": "anonymous" },
  "purposeAcknowledgement": "community-purpose-v1"
}
```

- `question`: trimmed non-empty string, at most 1,000 Unicode code points.
- `context`: optional string, trimmed and at most 500 Unicode code points after
  normalizing CRLF to LF. Omitted, empty or whitespace-only strings mean absent
  (`null` in public responses); null and non-string inputs are refused. LF
  newlines are allowed; all other C0/C1 controls (including tab, bare CR and DEL)
  and lone surrogates are refused before trimming. Markup-looking text is kept
  literally, without HTML or Markdown processing.
- `choices`: 2–25 trimmed distinct non-empty strings, each at most 200 code
  points; equality is exact after trim, preserving existing domain rules.
- `method`: required `single` or `approval`.
- `closesAt`: optional UTC ISO timestamp with milliseconds, strictly after
  creation time. Omitted means creation time plus 604,800,000 milliseconds.
  Null is refused; no indefinitely open newly authored poll in this slice.
- `attribution`: optional, defaults to `{ "kind": "anonymous" }`. Named is
  `{ "kind": "named", "name": "Ada" }`, with a trimmed non-empty plain-text
  name of at most 80 code points. Anonymous names/extra fields are refused.
  Names are self-selected, not proof of identity, and never copied from email.
- `purposeAcknowledgement`: optional exact version string. Required unless v1
  is already recorded for this account; invalid versions are always refused.
- `image`: optional `{ "id": <uuid>, "alt": <text> }` naming the caller's own
  pending picture from `POST /api/poll-images` (lowercase UUID). `alt` is a
  required description: trimmed, 1–300 code points, same text rules as the
  question. Attaching is part of this transaction; the picture id and
  description are part of the canonical replay input, and a replay attaches
  nothing twice. A request without `image` has the same canonical input it
  always had.
- `votePrivacy`: optional `"anonymous"` (the default) or `"public"`; anything
  else, `null` included, is refused. It is fixed at creation and no route
  changes it (see "Anonymous and public-vote polls"). It joins the canonical
  replay input only when it is `"public"`, so saying `"anonymous"` replays like
  saying nothing. Without the server's confirmation key, a `"public"` request
  answers 503 `public_votes_unavailable` and writes nothing.
- `id`, `community`, `createdBy`, `next`, `acceptsSuggestions`, owner/permission
  fields and summaries are not writable inputs. Suggestions are false,
  all next entries null, ID is server-generated.
- All text must be valid Unicode without NUL characters. Invalid encodings
  (malformed UTF-8 bytes, or an escaped lone surrogate) return `bad_request`;
  valid astral characters (including emoji) are allowed.
- Maximum body: 32 KiB (32,768 bytes) UTF-8; a body of exactly that size is
  read. These are bounded resource checks, not quality judgements about a
  question's content.

201 on first publication; 200 on replay: `{ "poll": <public poll>, "replayed":
false | true }`. Public poll is the existing GET poll shape plus `community`
(the object above) and `attribution`. Named attribution contains only `kind`
and `name`; anonymous contains only `kind`. Never return account ID, email,
credentials, internal metadata or idempotency key. `votePrivacy` is always present. Legacy polls may omit the other
new public fields; no author is fabricated. `GET /api/polls/:id` and MCP
`get_poll` already serve this public representation for authored polls, built
by the same allow-listed projection. The `open: true` returned on a replay is
the original creation representation, even after the poll has closed;
`GET /api/polls/:id` gives the current state.

Canonical replay input consists of trimmed strings, ordered choices, method,
normalised attribution, explicit/omitted close time and the acknowledgement
field. Nonempty normalized context participates in replay comparison; omitted
and empty context add no canonical key, preserving existing retries. A replay
returns the saved response's `context` and `image` as first returned. A saved
creation response from before context existed returns `context: null`, and one
from before pictures returns `image: { "kind": "tile" }`; every other field keeps
its original public value. Omitted close time stays a sentinel, not recalculated. Replay is checked
before expiry/default-time and quota checks, so a valid saved request still
replays after its poll closes. Changed input with the same key returns 409.
Records remain durable for the poll's lifetime. Replays require a valid session
for the same account and return only its original public creation representation.

Successful creations count toward five in the preceding rolling 60 minutes
(`createdAt > now - 60 minutes`); exactly at the boundary they expire. Quota,
acknowledgement, idempotency, metadata, poll and choices share one transaction
and per-account concurrency guard. A refusal/rollback/replay consumes no slot.
Unlimited grants bypass this quota, not resource checks or authentication.

| Status | Error                      | Meaning                                                                             |
| ------ | -------------------------- | ----------------------------------------------------------------------------------- |
| 400    | `bad_request`              | Malformed/unknown fields, invalid key, shape, field length or future time; not JSON |
| 401    | `signed_out`               | Invalid, absent, expired or revoked session                                         |
| 403    | `origin_not_allowed`       | Missing or foreign Origin                                                           |
| 409    | `idempotency_conflict`     | Key already used for different canonical input                                      |
| 413    | `body_too_large`           | Body exceeds 32 KiB                                                                 |
| 422    | `purpose_required`         | First post needs the v1 promise                                                     |
| 422    | `image_unavailable`        | `image.id` is not the caller's pending picture (unknown, used or expired)           |
| 429    | `too_many_requests`        | More than the per-client request limit (above); not a posting-quota answer          |
| 429    | `posting_limit`            | Five creations in the rolling hour; integer Retry-After seconds                     |
| 503    | `creation_unavailable`     | Required storage unavailable; nothing partially committed                           |
| 503    | `public_votes_unavailable` | `votePrivacy: "public"` on a server without its confirmation key; nothing written   |
| 500    | `server_error`             | Unexpected fault; safe message, no private diagnostics                              |

Each uses the existing `{ error, message }` envelope. Auth/origin precede all
account-bound lookups. Retry the same key and input after an uncertain result;
use a new key for an intentionally different question. 503 covers a database
that cannot be reached, is shutting down, has no free connections, or rolled
the transaction back on a serialisation failure or deadlock. The request may
or may not have been saved (a connection can drop during the commit), so retry
it with the same key: a saved one replays, an unsaved one is created. `Retry-After` on `posting_limit` is the whole
number of seconds until the oldest of the five creations leaves the hour.

Nothing in creation diagnostics records request bodies, keys, author IDs,
account emails or credentials. The served request log records the method and
path only, and logs a posting-permission path as
`/api/posting-permissions/:voterId`, without the account id. A 500 from a
database error is logged by error class and SQLSTATE only, never its message or
detail, which can quote row values.

### `PUT /api/posting-permissions/:voterId` and `DELETE /api/posting-permissions/:voterId`

Owner-only grant/revoke of unlimited posting for an existing account, named by
its account id. PUT body is exactly `{ "permission": "unlimited_posting" }`
(JSON, at most 1 KiB; any other shape or extra field is 400); DELETE has no
body, and one sent with a body is 400. Both answer 204 with no body.
Repeated desired state is a no-op (204); grant/revoke audit records are kept.
No owner assignment, full-power grants or moderation permission in these routes.
The owner is the account whose email credential matches the trusted
`PULSE_OWNER_EMAIL` (trimmed and lower-cased, as sign-in normalises addresses);
unset or blank grants nobody, and a value that is not an email address stops
the server starting, in both `main.ts` and `dev-server.ts`. Public displays and
clients cannot bootstrap an owner. The owner also posts without the hourly
limit.

Errors: 400 `bad_request`, 401 `signed_out`, 403 `origin_not_allowed`,
429 `too_many_requests`,
403 `owner_required`, 404 `not_found` (only after owner authorisation, so a
non-owner learns nothing about which accounts exist), 413 `body_too_large` (PUT
body over 1 KiB), 503 `creation_unavailable`, 500 `server_error`. All changes are atomic and
attributed to the owner. Context exposes only the caller's effective posting
permission. No public grant listing or author/account inspection is introduced.

## Pictures (ADR-0047, ADR-0049)

A poll or contribution may carry one picture. Upload it first through the
shared `/api/poll-images` route, then attach it at publication. The path keeps
its historical name for uploads and both served variants. Pictures are stored in Pulse's Postgres as
two re-encoded WebP variants; the original upload is never stored or served.

### `POST /api/poll-images`

Signed-in only. The body is the raw file, with `Content-Type: image/jpeg`,
`image/png` or `image/webp` (no multipart), and `Origin` exactly the web
origin. Checks run in this order: the per-client rate limit (10 a minute,
429 `too_many_requests`); pictures configured (503 `images_unavailable`);
`Origin` (403 `origin_not_allowed`); session (401 `signed_out`); declared type
one of the three (415 `unsupported_image`), all before the API reads the body.
The API then reads it up to 10 MiB. In the served deployment nginx receives
and buffers the whole body (up to 10 MiB) before forwarding the request, so
these checks save the API's work, not the upload's bandwidth.

The file is judged by its content, never its declared type or name: a PNG sent
as `image/jpeg` is accepted as a PNG. JPEG, PNG and WebP are accepted; SVG,
GIF, HEIC, AVIF, animated PNG (an `acTL` chunk before the first `IDAT`) and
multi-page WebP are refused, never cut to a first frame. Size limits are read
from the header before a full decode. The picture is rotated by its EXIF
orientation, converted to sRGB, and **all metadata is dropped** (EXIF
including GPS location, XMP, IPTC, ICC). Two variants are stored: `display`
fits within 1600 × 1600 (aspect kept, never enlarged, WebP quality 80) and
`thumb` is a 256 × 256 centre crop (quality 75).

`201`, `Cache-Control: no-store`:

```json
{
  "image": {
    "id": "0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f",
    "width": 1600,
    "height": 900
  }
}
```

`width` and `height` are the display variant's. The picture is **pending**:
visible to nobody and attachable only by this account, for 24 hours. Pending
pictures older than that are deleted with their bytes at API startup and at
each upload (best-effort; a failed sweep never refuses an upload).

| Status | Error                | Meaning                                                                          |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| 401    | `signed_out`         | No current session                                                               |
| 403    | `origin_not_allowed` | Missing or foreign Origin                                                        |
| 413    | `image_too_large`    | Body over 10 MiB (10,485,760 bytes); exactly that size is read                   |
| 415    | `unsupported_image`  | Declared type not one of the three, or content not a still JPEG, PNG or WebP     |
| 422    | `image_dimensions`   | Over 8,000 px on a side, over 40 megapixels, or under 200 px on the shorter side |
| 429    | `too_many_requests`  | Per-client request limit (in memory, per instance)                               |
| 429    | `upload_limit`       | 20 accepted uploads in the rolling hour for this account; integer `Retry-After`  |
| 429    | `pending_limit`      | This account already holds 5 pending pictures                                    |
| 503    | `image_busy`         | This instance is decoding and its short queue is full; retry shortly             |
| 503    | `images_unavailable` | Pictures not configured, or storage unavailable                                  |
| 500    | `server_error`       | Unexpected fault                                                                 |

The hourly quota counts accepted uploads from a record kept apart from the
picture, so deleting a picture never refunds an upload. The account quotas
are counted in Postgres and checked before the file is
decoded, then again when it is stored. Nothing logs the body, the bytes or the
account; a processing fault is logged by error class only.

### `GET /api/poll-images/:id/display.webp` and `/thumb.webp`

No session; no cookie is read or set. `:id` must be a lowercase UUID before
anything is queried. A picture is served only while its owner allows it: for
a poll, while it is that poll's current picture and the poll is not hidden.
For a contribution, while it is the existing contribution's current picture.
Community default pictures arrive with category defaults; none is served yet.
Malformed, unknown, pending and unservable ids answer the same `404`, with
the same body as any unknown path:
`{ "error": "not_found", "message": "There is nothing here." }`.

`200` headers: `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: default-src 'none'`,
`Cross-Origin-Resource-Policy: same-origin`,
`Cache-Control: public, max-age=3600`, and a strong `ETag` that is the quoted
SHA-256 of that variant's stored bytes. A matching `If-None-Match` answers
`304` with the same `ETag` and `Cache-Control`. A removed or hidden picture
leaves browser caches within the hour. Rate limited per client (300 a minute
by default).

Behind the production nginx (`apps/pulse-web/nginx.conf`) these responses also
carry the site's page headers, so a browser sees a second, looser
`Content-Security-Policy` and a repeated `nosniff`. Browsers enforce every CSP
they receive, so the stricter `default-src 'none'` still applies. nginx also
answers an upload body over 10 MiB itself, with the same `413`
`image_too_large` JSON body as above.

### The public `image` field

Every poll body (`GET /api/polls/:id`, the creation response, MCP `get_poll`)
and every poll listing row carries `image`. Contribution bodies and listing
rows use the same projection:

```json
{
  "kind": "upload",
  "displayUrl": "/api/poll-images/0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f/display.webp",
  "thumbUrl": "/api/poll-images/0b8f4c1e-5d7a-4e2b-9c3d-1a2b3c4d5e6f/thumb.webp",
  "width": 1600,
  "height": 900,
  "alt": "A sunny garden plot"
}
```

or `{ "kind": "tile" }` when the item has no servable picture, for which the
client draws a generated tile. Category defaults (#586) will take precedence
over the tile once served. URLs are relative. `upload` appears exactly
when the picture route would serve it. Nothing else is ever in the object: no
uploading account, file name, original type or size, upload time or hash. A
poll creation response replayed from before pictures existed returns the tile.

Planned, not served (ADR-0047, plan P12 steps 5–9): category defaults
(`kind: "category"`), removing or replacing a poll picture, reporting, and the
site owner's soft delete.

## Contributions (#246, #247, #252)

Public `GET /api/contributions?cursor=...` returns `{contributions,nextCursor}`,
20 newest records at a time. Summaries omit participation and update arrays.
`GET /api/contributions/:id` returns `{contribution,canManage}`. The optional
session sets `canManage` to true only for the owning account. Every
contribution body and row includes the public `image` field described above,
including public profiles and the signed-in member's list. When the owning account
has a visible profile, `contribution` also contains
`organizerProfile:{publicId,displayName}`. When that profile is hidden or
missing, the field is absent and `organizerName` remains unchanged. The join is
by the private owning account id, never either public name. All responses use
`Cache-Control: no-store`. Reading never creates a ballot or changes a vote.

Signed-in `POST /api/contributions` publishes a community contribution. Strict
JSON requires `title` (160 characters), `description` (4000),
`organizerName` (80), and `kind` (`project`, `fundraiser`, `group_buy`, `offer`).
Text is trimmed and nonempty. Optional `communityBenefit` and `needs` accept
up to 2000 characters each and default to empty strings. Optional `image`
is a strict `{id,alt}` object with the same rules as poll creation: a lowercase
UUID naming the caller's pending picture and a trimmed description of 1–300
Unicode code points, with no NUL or unpaired surrogate. Publication consumes
the upload atomically. Unknown, expired, used or another account's picture
IDs return 422 `image_unavailable`.

The short posting form sends the required fields, plus `pollId` when the
author links a related question (it accepts a question link or ID and sends
only the ID). Any caller may supply `pollId` for a visible poll. A missing or hidden poll returns 404
`poll_not_found`. Group buys and offers may include `commercial` pricing with
`currency` (CAD/USD/GBP/EUR), integer `regularPriceMinor` (1–1000000000),
`offeredPriceMinor` (0–1000000000), `referenceUrl` and `terms` (2000).
When prices are provided, they must show at least 20% advertised savings.
An optional `fund` requires pricing and contains a `name` (1–160 characters)
and a whole-number `percentage` (1–100). These claims are unverified.

The public record adds `id`, `community:{id,label}`, `createdAt` ISO timestamp,
`status` (`open`,`in_progress`,`completed`,`cancelled`), `participations` and
`updates`. Community comes from the organizer's account, or General. Names are
self-selected public labels. Account IDs, email and request keys remain private.
Five new contributions per account per rolling hour are allowed.

`POST /api/contributions/:id/participations` accepts `{displayName,kind,message}`
with lengths 80/2000 and kind `help`, `pledge`, or `report`. Entries add `id` and
`createdAt`. Help/pledges require open/in-progress status. Reports can be added
after closure. Text and labels are public. A pledge moves no money.

Organizer-only `POST /api/contributions/:id/updates` accepts `{message,status,
evidenceUrl?}`. Message is 1–2000 characters. It appends a public update with
`id` and `createdAt` and changes status. The organizer may reopen a record.
Completion and evidence are organizer-reported, never independently verified.
URLs must be HTTP(S), without embedded credentials, at most 2000 characters.
Each record supports 500 participations and 500 updates. One account may add at
most 20 participations to one contribution, so one person cannot fill the
shared record. Identical idempotent retries do not consume another entry.

### Private messages to the organizer

`POST /api/contributions/:id/messages` accepts `{message}` with 1–2000
characters and a UUID `Idempotency-Key`. It returns `{id,replayed}` with 201
for a new message or 200 for a repeat with the same sender, contribution, key
and text. Reusing that key with different text returns 409. Each contribution
can receive up to 500 messages, with at most 20 from one account. Identical
idempotent retries do not consume another entry.

`GET /api/contributions/:id/messages` returns `{messages:[{id,message,createdAt}]}`
to the organizer. A signed-in non-organizer receives 403. Both routes require
sign-in and return 404 for an unknown contribution. Public responses never
include messages or sender information.

All POST bodies require `accountId`, a nonempty string containing the `/api/me`
account ID the page believes it is writing for. A missing or invalid field
returns 400 `bad_request`. A value different from the session account returns
409 `account_changed` before any write or idempotency record, including on
retries. This field is a precondition, never a choice of author. Clients clear
the refused form’s draft and recheck the session.

All POSTs require a valid session, configured web Origin, application/json and
UUID `Idempotency-Key`. For the three routes that return a contribution
(create, participate, update), the key is account-scoped across those three:
Pulse stores a revision reference with each key to reconstruct the original
response. A message key is separate: it is stored with that message, so it is
scoped to the sender and the contribution, and is never compared with keys
used on the other three routes.
Identical retries return `{contribution,replayed:true}` with 200. Pulse compares
picture id and normalized description using a fingerprint in the creation retry
record. Replays keep the original contribution revision and project its current
picture.
First writes return 201 with `replayed:false`. Changed inputs or targets using
the same key return 409. Session generation is checked in the transaction under
the account lock shared with sign-out. Mutation body limit is 32 KiB strict UTF-8.
Reads allow 120 requests/minute, mutations 30/minute, per route and client IP.

Errors use `{error,message}`. 400 `bad_request`; 401 `signed_out`; 403
`origin_not_allowed` or `organizer_required`; 404 `not_found` or `poll_not_found`; 409
`account_changed`, `idempotency_conflict`, `closed`, `record_full`, `sender_limit`; 413 `body_too_large`; 422 `image_unavailable`; 429
`too_many_requests`, `posting_limit`; 503 `contributions_unavailable`; 500
`server_error`. Origin/session checks precede body parsing. Required storage
failures leave no partial writes. Production persists in Postgres, development
uses its selected database or ephemeral memory. Payments, investments,
independent evidence reviews and automatic reputation remain future work.

### `PUT /api/contributions/:id/image` and `DELETE /api/contributions/:id/image`

Only the signed-in poster may manage the picture. Both routes require the
configured web Origin and use the 30 requests/minute mutation limit. PUT
accepts strict UTF-8 JSON `{id,alt}` with the same pending upload and
description rules as creation. DELETE takes no body. Both return 200 with
`{image}` and `Cache-Control: no-store`. DELETE with no picture already
attached returns the fallback and makes no change. These routes do not take
an idempotency key. An accepted replacement consumes its pending upload.

Replacing or removing deletes the old picture and both variants in the same
transaction as the link change and audit entry. Removed URLs return 404 at
the server and may remain in browser caches for up to one hour. The
response exposes only the public image fields.

Errors use `{error,message}`. Both routes return 400 `bad_request` with
"Check the picture and its description, then try again." for malformed requests,
including invalid PUT JSON or fields and a missing or incorrect PUT Content-Type.
Both return 401 `signed_out` with "Sign in to change this picture." for a missing,
expired or revoked session. Other errors include 403 `origin_not_allowed` or
`organizer_required`; 404 `not_found` for a missing contribution; 413
`body_too_large` over 32 KiB for PUT; 422 `image_unavailable` for an unavailable
pending upload on PUT; 429 `too_many_requests`; 503 `contributions_unavailable`;
500 `server_error`.
