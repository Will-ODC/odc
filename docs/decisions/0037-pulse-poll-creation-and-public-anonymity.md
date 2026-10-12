# ADR-0037: Pulse questions can be published anonymously by signed-in people

- **Status:** accepted — operator decisions approved 2026-10-11; technical contract subject to this PR's review
- **Date:** 2026-10-11
- **Phase:** 0 (Pulse, charter-exempt)
- **Amends:** ADR-0024 posting scope and default values; complements ADR-0030, ADR-0033 and ADR-0035

## Context

Pulse has identity, persistent voting and a live conversation page, but no public
creation endpoint. Seed questions conceal that gap. The operator chose creation
before further story work and approved the policy below. Public anonymity must
encourage honest participation while retaining accountability for authored text;
it must not silently connect an account to its private ballot.

## Decision

### Publication and scope

Signed-in people can publish a question with 2–25 distinct, non-empty choices,
using single or approval voting. The question closes after seven elapsed days
by default; a future closing time can be selected before publishing. Suggestions
are off in this slice; #336 owns their later setting and usable interface.
No author-selected branch links, photo, summary, comments or settings edits after
publication are introduced. All new choice-next entries are null.

The server chooses the posting community from the authenticated account's stored
community. An account with null community posts in the General public space,
whose reserved key is `pulse-general`. This is a posting destination, not a
membership: the account and pending claims remain null (ADR-0030). Existing
community keys are preserved; migration must refuse a pre-existing collision
with the reserved key rather than silently reinterpret it. Readers need no
session and community does not gate voting. Community members cannot choose
another posting destination through the creation request.

### Attribution and privacy

Public attribution defaults to anonymous. Naming yourself is optional. Named
publication uses a poster-supplied, per-post display name, rendered as plain text;
it is a self-description, not verified identity. It never defaults from an email.
Anonymous publication carries no public account ID, profile link or reusable
pseudonym. Public reads expose only anonymous/named attribution and the chosen
name, never the internal author account, credential, grant or idempotency key.

The internal author reference is separate from `vote.voter_id` and the browser
ballot cookie. Creation does not read, mint, reset or adopt a ballot cookie.
Existing sign-out, results and voting semantics stay intact. Internally linkable
posting is not anonymous to the service or people with database access; do not
promise otherwise. Moderation access must be authenticated, explicitly granted
and recorded before its operations ship. Anonymous text may itself identify
its author; no technical anonymity guarantee is made about its contents.

Approved explanation, displayed beside the anonymity control once authorised
moderation access exists:

> Your name is hidden from other readers. Authorised moderators can identify your account to address abuse.

Before that capability ships, use the accurate interim disclosure:

> Your name is hidden from other readers. Pulse keeps your account linked to this post to address abuse.

The public display name and attribution choice are fixed for this creation
slice. Changing them later needs a separately documented privacy contract.

### Posting permission and limits

Ordinary accounts can publish five questions in a rolling 60-minute window.
Count successful creations, not failed validation or retries. The quota check,
new poll, choices, internal author metadata, acknowledgement and idempotency
record commit together; a failure changes none of them. Serialise competing
creations for the same account across API instances. In-memory mode provides
same-process conformance only; multi-instance deployment requires Postgres.
Use the injected application clock; no database-generated timestamps.

Owner is a trusted server bootstrap identity, configured with
`PULSE_OWNER_EMAIL`, resolved through a verified email credential. No first
visitor, client field or supplied display name can claim ownership. Unset means
no owner bootstrap; malformed configured email fails startup. The owner bypasses
the posting quota only, not authentication, input validation or acknowledgements.

A separate, server-controlled `unlimited_posting` grant can be given or revoked
by the owner for a stable existing account ID. Record grantor, recipient and
times. Grant mutation verifies a current owner session and request origin;
clients never submit their own permissions to creation. #230's full-power grants
remain separately scoped: this narrow grant does not confer moderation, voting,
financial or owner authority. The design does not implement #230 implicitly.

Use an account-scoped idempotency key for creation. Identical canonical input
with the same key returns the original creation without another quota charge;
a changed payload is a conflict. Persist replay records with the poll; do not
expire them during this slice. Replay lookup precedes default-time calculation
and quota checks, so a retry tomorrow does not create another question.
A newly attempted creation after sign-out requires a new valid session.

### Purpose and first-post promise

Show the following statement and unchecked promise on the account's first post.
Save acknowledgement of version `community-purpose-v1` on successful publication,
not merely opening the form; show the reminder on later posts. Authentication
and server-side acknowledgement checks apply to API callers too.

**What this discussion is for**

Comments help us turn ideas into action that improves our community's wellbeing
as much as possible. Be honest, listen, and work together.

When we disagree, say so respectfully. Decide on a compromise together, or try
different ways to solve the same problem. Keep talking and share what works.

**I will discuss ideas without attacking, harassing or threatening people.**

Later reminder: **Be honest. Respect people. Help us move forward.**

The approved statement refers to comments; use it unchanged for the shared
publication promise, without pretending comments already exist. Disagreement
or criticism alone is not abuse. Changed statement versions need a separate
acknowledgement policy; this slice knows only v1.

### Reporting remains a separate launch dependency

The operator approved reports from any signed-in account, ten per rolling hour,
one unresolved report per reporter/target, private reports, owner review and
explicit moderation grants, hide/restore, and human review with recorded reasons
before account penalties. Reuse #233–#236 and #297; this creation PR series does
not deliver reporting or penalties. Automatic hide threshold, appeals and
penalty types remain unresolved. Preserve ADR-0024's auto-hide direction.
Broad public posting launch waits for reporting/review and automatic-hide design.
No creation screen promises a Report button or review capability that is absent.

## Consequences

- Implement in merge-gated steps: storage/permissions, creation HTTP boundary,
  then the creation screen and public attribution projection. Each receives
  meaningful checks, independent review, push, PR and passing CI before the
  next dependent step. William alone approves and merges.
- Community must become a keyed Pulse table, backfilled from existing labels;
  preserve null membership. Add author/visibility metadata without fabricating
  authors for legacy seeds; absent legacy attribution stays absent publicly.
  The next free migration number is checked at implementation time (001–004
  already exist). Never edit applied migrations.
- Existing deletion cascades do not authorise deleting authored polls. Removal
  hides; no destructive publication-removal operation is introduced.
- #261 owns advisory duplicate matching. Creation does not silently implement
  synonym detection or merge questions; matching failures must not block it.
- API field-size bounds are resource limits, not a new quality judgement.

### Documents reconciled

- `apps/pulse/API.md`: adds explicitly planned creation/context/grant interfaces
  before implementation; current served routes remain labelled accurately.
- `docs/plans/pulse.md`: replaces stale P6 blockers with this accepted direction
  and the concrete merge-gated steps. Reporting stays a broad-launch dependency.
- `apps/pulse/README.md`: links the planned contract; still says creation is unbuilt.
- ADR-0024: not edited as a historical record; amended here for General posting,
  defaults and deferred suggestion setting. Its full-text, hide-not-delete and
  public-reading decisions stand. Old ChoiceBallot wording is superseded by 0035.
- ADR-0030 and ADR-0033: no changes; null community and email credential behavior
  remain intact. No joining, account merging or ballot linkage is introduced.
- ADR-0035 and `apps/pulse-web/README.md`: no route/default change in this design
  PR. The new form will link to the existing conversation route.
- `apps/pulse/CLAUDE.md`: no conflicting implemented rule; no change needed.
- `memory/pulse.md`, `memory/pulse-development.md`, `memory/INDEX.md`: update
  at merge time on master, not this feature branch. Record the new narrow grant
  alongside #230's older full-power direction rather than silently replacing it.

## Charter check

Pulse is charter-exempt. All storage and endpoints are Pulse-owned; no imports,
reads or writes into `services/` or `contracts/`. No user copy about counting
machinery is introduced. Public posting anonymity is not the core ledger's
privacy model and does not change it.
