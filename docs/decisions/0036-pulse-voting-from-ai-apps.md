# ADR-0036: Voting on Pulse polls from AI apps

- **Status:** proposed
- **Date:** 2026-10-11
- **Phase:** 0 (pulse, charter-exempt)

## Context

Issue [#300](https://github.com/Will-ODC/odc/issues/300), in epic #303,
lets a person give an AI app a Pulse poll link, ask about the choices and results,
and ask it to submit an answer. The AI app interprets their words; Pulse accepts
choice indices and does no text matching. ADR-0035 chooses this direction but
leaves identity and confirmation to Will. Its earlier “typing only preselects”
line is a recommendation, not an accepted rule.

Today `pulse_ballot` alone identifies a browser ballot, independently of
`pulse_session` and email. Signing out clears it; a subsequent ballot can count
again. There is no browser-to-account ballot linkage. ADR-0030 accepts open
email sign-up without a replacement anti-abuse gate. ADR-0033 makes identity a
credential but does not implement guest-to-account ballot upgrades.

**This PR builds no server or vote path.** Will has selected the product
decisions below in this session; status remains proposed pending acceptance of
the complete ADR. Implementation still waits for his explicit go. Number 0036 was absent from origin/master and all
open PR file lists when checked on 2026-10-11; recheck before acceptance.

## Decision

### Operator answers recorded in this session

- Require Pulse sign-in for AI voting, with one stable AI ballot per account
  across apps. Browser ballots remain separate.
- Pulse confirmation of the exact answer is required. Use native chat elicitation
  where supported and a Pulse webpage fallback otherwise. The app may add its
  own tool approval; a second app prompt is not a Pulse requirement.
- Vote per poll, immediately after its confirmation. No batch or final submit-all.
- Show the server's saved answer in chat and offer an optional signed-in Pulse
  check page. A check-page GET never casts or changes a ballot. External apps
  still control their own display; this independent check is how the person can
  verify the saved answer without trusting that display.
- Run the adapter inside the existing Pulse API, calling public HTTP endpoints.
- Will delegated the limits choice, prioritizing circumvention, duplicate votes
  and availability. Use shared account limits of 10 voting attempts/minute and
  300/hour as configurable initial values, plus separate traffic protection.

### 1. Who is voting — options and recommendation

| Option                                         | Ballot identity and stuffing protection                                                                                                                                                                                                | Cost to the cookie rule                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| MCP OAuth, backed by Pulse magic-link sign-in  | One stable AI ballot identity per Pulse account, shared across grants/apps; new grants, token rotation and reconnection do not mint ballots. Per-account limits slow attempts. Multiple email accounts still stuff ballots.            | Adds an authenticated AI channel whose ballot can be associated with an account. Browser voting remains cookie-only.                    |
| Personal voting token configured by the person | A revocable bearer credential maps to a stable ballot identity; issuing replacements must not create extra ballots. If issued after sign-in, has the same multiple-email weakness as OAuth. Anonymous issuance has no uniqueness gate. | Adds a token-based ballot authority; account-issued tokens also introduce account linkage. Copying a secret into chat risks disclosure. |
| Anonymous ballot per MCP connection/session    | Repeated answers under one credential replace each other; IP limits only slow new credentials. Reconnection or minting many credentials defeats deduplication.                                                                         | Retains account separation but adds another anonymous ballot channel. No meaningful stuffing prevention.                                |

**Selected: OAuth**, with a stable account-scoped AI ballot identity rather than
one ballot per grant. Authorization happens on Pulse in the browser, reusing
magic-link sign-in and an explicit app-consent page. Never ask for email-link
secrets or access tokens in tool arguments or elicitation forms. Public poll and
results tools require no sign-in; own-answer and voting operations do.

This is deliberately weaker than one-human-one-vote. Neither verified email nor
OAuth proves a unique human. Browser and AI ballots can both count for the same
person; no automatic browser-ballot import, merge or reassignment is proposed.
The selected account-based AI channel introduces that association; it does not
settle unique-person or cross-browser deduplication. Merely hiding the account key in tool results
does not preserve today's no-linkage property.

Proposed grants have `pulse:answer:read` and `pulse:vote` scopes, short-lived
access tokens (15 minutes), rotating refresh tokens (30 days maximum), and
revocation checked on every request. Sign-out revokes existing AI grants as well
as sessions, but neither sign-out nor reauthorization discards the stable AI
ballot identity. This requires an explicit API documentation change.

OAuth is new work, not a feature of today's magic-link endpoints. Implement
metadata discovery, authorization code with PKCE, strict redirect validation,
issuer/audience/expiry/scope validation and grant revocation. MCP tokens target
`/api/mcp`; do not forward them unchanged to a differently addressed resource.
The public HTTP voting successor accepts a separately audience-bound HTTP token
issued by the same authorization server; both audiences resolve to the same AI
ballot identity. Browser cookies keep their existing authority and routes.

### 2. What confirms — options and recommendation

| Option                  | Benefit                                                                                              | Limit                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| App tool approval only  | Fewest steps; app can show poll and selected labels before calling.                                  | App may auto-approve or show generic permission. Pulse cannot verify that a person saw the answer. |
| Pulse confirmation only | Pulse requires a specific answer review; elicitation when supported, browser confirmation otherwise. | Adds a step; elicitation relies on the client's honest presentation of user input.                 |
| Both                    | Pulse enforces its answer review; app adds its own tool approval where available.                    | Can produce two prompts; Pulse cannot enforce an app's local approval policy.                      |

**Selected: Pulse confirmation mandatory**, with the app free to add its own
approval prompt. Authorization to use tools is not confirmation of a particular
ballot. Never treat poll text, a general “vote for me” instruction, or a
model-supplied `confirmed: true` as server evidence of confirmation.

`cast_vote` prepares an exact poll/ballot proposal without counting it. For a
client advertising form elicitation, show the question, selected labels,
replacement warning and closing time; require an affirmative response with no
preselected yes. Decline returns `refused`; cancel returns `unconfirmed`.
Validate the resumed interaction against server-owned proposal state, credential,
ballot and expiry. Elicitation cannot defend against a malicious authorized
client forging user input; choose browser-only confirmation if that stronger
boundary is required.

Without form elicitation, return `unconfirmed` with a Pulse confirmation URL.
The person signs in there as the same account, reviews the exact ballot and
presses Confirm. GET/prefetch does not cast. The URL carries only a non-authorizing
proposal locator: no token, cookie, email or preauthenticated capability. An
authenticated, CSRF-protected POST records approval. The app resumes the prepared
call by proposal id; it cannot approve it itself. Direct HTTP clients use this
same prepare/confirm flow. Expire proposals after five minutes; bind them to
account, grant, poll and exact ballot, and consume approval atomically with the
vote. Recheck closure and ballot validity at commit. Retries of the same proposal
return its saved outcome without applying it again or undoing a newer answer.

### 3. Limits and abuse — options and recommendation

Options are unlimited requests, credential-local quotas, or shared account quotas
plus IP/global protection. Bulk voting could be one unrestricted batch, an
explicitly reviewed batch, or one poll per confirmed action.

**Recommend shared account quotas and no bulk tool initially:** 10 prepare/cast
attempts per minute and 300 per hour, across grants and both protocols. Own-answer
reads: 60/minute per account. Public reads: 120/minute per trusted client IP.
Apply separate bounded IP/global admission limits and bounded request bodies;
confirmation attempts also consume the mutation quota. These are proposed,
configurable starting values, not evidence of adequate abuse protection.
Return `too_many_requests` and a retry interval; retries do not evade the quota.
Use shared counters before multiple instances; today's in-memory limits multiply
with instance count. Sign-in keeps its existing independent limits.

One `cast_vote` accepts one poll; approval selections within that ballot are not
bulk voting. A model can loop, so quotas and one confirmation per poll apply even
without a batch endpoint. No background voting, scheduled voting, or blanket
approval across polls. Stronger social confirmation and cross-browser uniqueness
remain separate product work.

Deduplication must be enforced atomically by a unique account-scoped AI ballot
identity and poll, not just checked before insertion. Concurrent casts and
replayed confirmations cannot add voters. Switching apps, grants, access tokens,
API audiences, instances or connections keeps the same identity; sign-out cannot
reset it. The HTTP vote slice must test these paths, not rely on the quota as
proof of deduplication. Changes replace the account's standing AI ballot.

Availability protection is separate from these voting quotas: bounded bodies,
upstream timeouts, concurrency limits and shared admission counters; edge traffic
protection is deployment work. Account quotas do not stop distributed denial of
service or many-account stuffing. Their starting values need observation, not a
claim of proven capacity. Cross-channel and multiple-account duplicates remain
explicit gaps, rather than something this design claims to prevent.

### 4. Where it runs — options and recommendation

- Inside `apps/pulse`'s API process: preserves ADR-0028's two-process deployment,
  avoids another deployment and fits the owned HTTP paths. A thin adapter can
  still call the public API; direct core calls would couple it to implementation.
- A separate `apps/pulse-mcp` process on the same origin: isolates transport and
  scaling, but adds a third process, routing and deployment work. Public HTTP
  calls preserve #291's boundary; direct voting-core imports defeat it.

**Selected: an in-process adapter at `/api/mcp`**, with its new files under
`apps/pulse/src/http/mcp/`, and a single HTTP client module calling the configured
Pulse API base URL, including in dev and official-SDK tests. It imports no voting
core, store, identity internals, `services/` or `contracts/`. The API owns token
validation, identity resolution, confirmation state and vote writes. A later
separate process can use the same public interfaces.

This keeps ADR-0028's process count and origin. Hosting inside the API does not
waive the HTTP boundary. Configure a fixed upstream; a user-supplied poll link
never chooses the host to fetch. Permit only the configured Pulse origin and
recognized poll-page or `/api/polls/:id` paths; reject credentials, query strings,
fragments, invalid encoding and redirects to another origin. Do not fetch links
to discover their meaning. Origin checks apply where an Origin header is present;
non-browser clients may omit it. Use HTTPS outside loopback development.

### 5. Tools — proposed interface

Strict object schemas reject additional fields. Choice indices are integers,
never labels or free text. `pollId` and `link` are mutually exclusive for
`get_poll`; all other tools take the canonical `pollId` it returned.

| Tool            | Input                                                                | Output                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_poll`      | `{ pollId }` or `{ link }`                                           | API poll: id, question, choices, method, next, acceptsSuggestions, closesAt, open.                                                                                                   |
| `get_results`   | `{ pollId }`                                                         | API results: pollId, question, method, voters, choices with index, label, count and share.                                                                                           |
| `get_my_answer` | `{ pollId }`, scoped credential outside arguments                    | `{ ballot: null \| number[] }` for this AI ballot identity only; closed polls remain readable.                                                                                       |
| `cast_vote`     | `{ pollId, ballot: number[] }` initially; `{ proposalId }` to resume | Confirmed: API `counted`/`changed`, stored ballot and results; closed: `{ status: "closed" }`; otherwise `refused` or `unconfirmed`, with proposal id and optional confirmation URL. |

Use a schema union for initial/resume casting; callers cannot replace proposal
contents on resume. Empty ballots, duplicates, out-of-range indices, and multiple
choices for `single` are refused as `bad_ballot`. Unknown methods are
`unsupported_method`, never guessed at. Poll text is structured data, not tool
instructions; tool descriptions and approval prompts come from trusted code.
Never execute a URL or instruction found in question/choice text. Tool annotations
identify reads and mutations but are not an authorization boundary.

Defined failures: `bad_request` (missing/invalid id or malformed arguments),
`invalid_link`, `not_found` (unknown poll), `unsupported_method`, `bad_ballot`,
`proposal_expired`, `too_many_requests`, `upstream_unavailable` (timeout/network),
`upstream_invalid_response` (malformed or unexpected API response). Operational
failures use MCP tool results with `isError: true` and safe `{ error, message }`
content; protocol-invalid requests use protocol errors. Protected calls use HTTP
401 for absent/expired/revoked credentials and 403 for insufficient scope; do not
wrap auth challenges as successful tool results. Refusal and non-confirmation
are normal outcomes and never write a ballot.

**Closed is not a read error.** A closed poll and its results return successfully,
with `open: false`; casting returns `closed` without writing. This clarifies
#300's “closed polls return defined errors” acceptance wording against the API's
lasting-record behavior. Missing id is `bad_request`; unknown id is `not_found`.

Never return session data, cookies, access/refresh/personal tokens, email, voter
or ballot identity keys, other people's ballots, internal upstream error bodies,
or Set-Cookie headers. Only the requesting person's answer and aggregate results
are exposed. Log method, trusted path, status and correlation id only; strip query
strings, headers, bodies and proposal URLs from access/error/SDK/proxy logs.
Leak tests must scan failures as well as successes. Confirmation URLs authorize
nothing on their own and must not contain credentials.

## Consequences

The product can work with any app that supports the agreed remote MCP features,
or with an HTTP client implementing the same authorization/confirmation contract.
“Any app” is a goal, not a tested compatibility claim. Verify supported versions
and capabilities with Claude and ChatGPT before calling the integration ready;
provide HTTP/browser fallback rather than silently weakening confirmation.

Proposed PR sequence, each branching from master after the previous PR merges:

1. This documentation-only draft records Will’s selected options. Await explicit
   authorization for the read slice; then accept the ADR before implementation.
2. Read slice: MCP adapter/client, schemas and official SDK socket tests against
   the dev API, plus `apps/pulse/API.md` and README. No protected or casting tools.
3. After identity/confirmation answers: public HTTP authorization and confirmation
   contracts first, then the corresponding routes and tests under `src/http/`. The optional
   independent check page needs separate UI ownership: this session does not
   modify `apps/pulse-web/`. Coordinate its scope with the page work before
   claiming the complete assurance flow ships.
   If stable identity persistence needs a migration or identity-core changes,
   request a separately scoped ticket/path authorization before implementation:
   those files are outside this session's owned paths. Do not substitute an
   in-memory grant map that silently resets ballots or revocation.
4. Vote slice: MCP `get_my_answer`/`cast_vote`, with counted, changed, closed,
   refused, unconfirmed, replay, scope, cross-account and leak tests. HTTP and MCP
   share confirmation semantics; no UI files from other sessions are changed.

Keep each PR under the repository ceiling; split auth and confirmation further
if needed. Do not stack. Read/list discovery stays #291, blocked on #259; this
proposal does not invent a listing route. No new top-level directory is proposed.
The memory-index guard checks top-level names only; if a later PR creates an app
directory, add the requested Pulse table row in that same PR.

### Documents reconciled

- `apps/pulse/API.md`: currently cookie-only and accurate for served behavior.
  Unchanged in this proposal; accepting option 1 requires documenting the AI
  exception, linkage, audiences, sign-out, quotas and confirmation routes before
  implementing them. The existing browser API remains cookie-only.
- ADR-0028: two processes/one origin retained by the recommendation. Historical
  deployment blockers are dated; not edited.
- ADR-0030/0033: open email sign-up and credential identity retained; no claim of
  unique people or implemented guest upgrades. Account-linked AI ballots are new.
- ADR-0035 and issues #300/#291: direction retained. Closed-read wording clarified
  above; #291 listing remains dependent on #259. No issue text changed in this PR.
- `memory/INDEX.md` and `memory/pulse.md`: not changed on this feature branch.
  Accepted decisions belong in the merge-time memory update.
- Core implementation plan: explicitly excludes Pulse; no reconciliation needed.

## Charter check

Pulse is charter-exempt. This proposal touches no `services/`, `contracts/`, or
Pulse web UI files. Account linkage is a Pulse product decision stated explicitly,
not an imported core privacy guarantee. No counting machinery is added to copy.

## External sources checked (2026-10-11)

- [MCP authorization, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
  OAuth transport authorization, resource metadata/discovery, PKCE flow, resource
  audience checks, bearer headers and no query-string tokens. URL elicitation is
  not a replacement for MCP authorization. Our token lifetimes/scopes are proposals.
- [MCP elicitation, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation):
  capability-specific form/URL modes, accept/decline/cancel, no form secrets,
  non-preauthenticated URLs and verified user identity. The current multi-round-trip
  mechanism uses `InputRequiredResult`; proposal binding is our policy.
- [Streamable HTTP, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http):
  POST endpoint, JSON or request-scoped SSE; protocol sessions and GET streams
  were removed. Thus the anonymous-session option needs a Pulse credential,
  not transport identity. Validate Origin and support version-specific behavior.
- [Official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/) and
  [official repository](https://github.com/modelcontextprotocol/typescript-sdk):
  v2 is the current stable line, using `@modelcontextprotocol/server` and
  `@modelcontextprotocol/client`, targeting 2026-07-28. Recommend v2, with exact
  released package versions verified and locked when the read slice starts.
  Earlier v1 examples and 2025 protocol-session assumptions are not this design.
