# Pulse authoring and anonymity — design draft

> **Historical draft.** Status lines below are as of the draft's date and are not
> kept current; `memory/pulse.md` holds where Pulse stands now.

Discussion draft from 2026-10-11. Approved decisions now live in
`docs/decisions/0037-pulse-poll-creation-and-public-anonymity.md` (merged #340),
with the planned API in `apps/pulse/API.md`. Those are authoritative for
implementation. Schema foundation #346 and internal Postgres publication/permission
store #354 are merged. Identity-label FK rollout #358 is merged. Memory adapter/conformance is in
reviewed, pushed PR #367 (#362), with all required CI green; it is not merged.
HTTP and UI remain unbuilt. Implementation has resumed; current
state and next steps are in `memory/pulse.md`.
This draft preserves the discussion and pending reporting details.

## Decisions confirmed in this conversation

- New polls close after one week by default; the poster can change the closing
  time before publishing.
- Suggested answers are off in the first creation slice. Separate issue #336
  owns enabling them and the conversation interface.
- Ordinary accounts may publish five questions per hour, enforced across API
  instances. The window and retry/idempotency contract need specification.
- A signed-in person without a community can post in a General public space;
  a person with a community posts there. This amends ADR-0024's posting scope.
- The initial privileged role is Owner. The owner has unlimited posting and
  can grant that specific permission without granting all owner powers.
  Reconcile this granular grant with #230's existing full-power grants; neither
  grant type silently changes the other.
- Anonymity and easy reporting must be designed together to support honest
  contributions while addressing abuse.
- New posts default to public anonymity, with naming yourself optional.
- Comments need a short, visible purpose statement and an explicit promise not
  to be abusive. The purpose is action that maximises community human wellbeing;
  collaboration, acknowledging disagreement, collective compromise or separate
  approaches to the same problem, and continued communication are essential.

## Approved community copy, placement and acknowledgement

Show the purpose beside the comment composer, with the full short statement
visible on first use. Keep a visible reminder on later posts and a way to reopen
the statement. Do not put essential commitments behind a terms link.

**What this discussion is for**

Comments help us turn ideas into action that improves our community's wellbeing
as much as possible. Be honest, listen, and work together.

When we disagree, say so respectfully. Decide on a compromise together, or try
different ways to solve the same problem. Keep talking and share what works.

Unchecked promise beside the first posting action:

**I will discuss ideas without attacking, harassing or threatening people.**

Privacy explanation beside the anonymous/named control:

**Your name is hidden from other readers. Authorised moderators can identify
your account to address abuse.**

Later-post reminder: **Be honest. Respect people. Help us move forward.**

The operator approved full statement display and an unchecked acknowledgement
on the first post, with the short reminder on later posts. Store acknowledgement
per account. Whether a later material wording change requires acknowledgement
again remains to be specified. No live promise of moderator access
until the permission and access controls exist. Public anonymity cannot prevent
someone recognising identifying details the author puts in their own text.

The operator approved this wording on 2026-10-11, including the plain heading
"What this discussion is for", the purpose statement, non-abuse promise,
anonymity explanation and later-post reminder. First-post placement and
acknowledgement timing are also approved. Disagreement and criticism of ideas must not count
as abuse merely because they are unwelcome.

## Anonymity policy — public default confirmed; access details pending

- Keep ballot choices private by default. Reporting a post or account must not
  disclose its author's ballot choices or change past votes automatically.
- Require sign-in to publish questions and future comments. Offer public
  attribution as named or anonymous; both remain attributable internally to a
  stable account for rate limits and authorised moderation.
- Explain anonymous posting accurately: hidden from public readers, not from
  the service. Define authorised moderator access, access records and retention
  before promising stronger privacy. Do not expose email addresses as public
  author labels. Named posting needs an agreed public display-name contract.
- Public author labels must not let readers correlate anonymous contributions
  across polls. Internal attribution remains available only through authorised
  moderation operations. Thread-local pseudonyms are an unresolved option.
- Separate posting restrictions from voting eligibility. An abusive post does
  not itself authorise removing someone's voting access.

## Reporting rules confirmed in this conversation

- Any signed-in person may report, including outside the target poll's community.
- Limit reports to ten per hour per account, across API instances. One unresolved
  report per person per target; repeated submission does not multiply reports.
- The owner is initially the reviewer and may explicitly grant moderation
  permission to others.
- Authorised reviewers may hide and restore content. Account penalties require
  human review and a recorded reason. Specific penalty types and appeal rules
  remain to be designed; this does not authorise altering private ballots.
- Design the automatic-hiding threshold separately before broad public launch;
  do not silently remove ADR-0024's accepted automatic-hiding direction.

## Reporting experience — agreed direction; remaining details

- A Report action beside each poll and, when built, each comment opens a short
  form: reason, optional details, Submit. Report the selected content even when
  its author is anonymous; the server resolves its account internally.
- Reports and reporter identities are private. Do not notify the reported
  person who filed the report. Public readers receive no report-count feed.
- Prevent repeat unresolved complaints from multiplying counts; enforce the
  agreed shared server limits and reporting eligibility.
- Separate report submission, reviewer outcome and enforcement. Reuse #233,
  #234 and #236; agree the public-comment target with #297.
- Preserve ADR-0024's accepted automatic poll hiding rule. Its distinct-reporter
  counting/threshold, appeal process and restoration interaction remain open.
  Human review is required before account-level penalties, independently of
  reversible automatic content hiding.
- Offer local Hide/mute separately from reporting if selected; it must not
  silently submit a report or restrict anyone else.

## Implementation order

1. Record confirmed authoring, anonymity and reporting rules in an ADR based
   on the repository template, reconciling ADR-0024, ADR-0030, #230 and API docs.
   Specify safe moderator access, public names, report reasons, rate windows,
   acknowledgement storage and automatic-hide values before their implementations.
2. Define creation API, community/author/visibility storage and explicit
   permissions; use the next unused migration number on current master.
3. Implement authenticated creation, shared limits, idempotency and the form;
   published questions open in the existing Conversation page.
4. Add report submission, minimal authorised review and poll Report action
   before broadly opening publication. Account restrictions and appeals need
   their own accepted scope. No automatic ballot deletion.
5. Build a short real question sequence; browse and related-poll navigation
   remain separate API work. Suggestions remain #336.

## Sources and reconciliation required

- ADR-0024: community posting, hiding, flags, editable defaults.
- ADR-0030: open sign-up with nullable community.
- memory/pulse-development.md and #230: owner/direct approvals and permissions.
- #233–#236 and #297: shared reports, review and actual content surfaces.
- #336: suggested answers, separately scoped.

This draft does not change existing privacy, eligibility or moderation policy.
It records confirmed directions and distinguishes them from proposals.
