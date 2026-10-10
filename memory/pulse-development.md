# Pulse development loop and issue triage

Operator directions recorded 2026-10-09. This is session context for Pulse,
not an implemented feature, a core-contract amendment or a completed security
review. Read alongside `memory/pulse.md`; implementations still need small
scopes and accepted technical decisions. Pulse remains independent of the ODC
hash chain and ledger.

## Accepted direction

- Where things go (issues, memory, ADRs) follows the repo-wide rule in
  `memory/INDEX.md` → "Where new information goes". Not restated here. A request
  to remember an uncertainty is not automatically an implementation ticket.
- Develop Pulse through a feedback loop: propose an improvement, gather feedback,
  select work, implement it, review it, then ask whether it helped.
- Initially the operator selects features for agents to implement; no vote is
  needed while there is one participant. Later, solicit feedback on what to
  build and how it should look and behave.
- The broader app can use different interfaces; Pulse begins as the primary
  interface. The interface itself, including its appearance and behavior, is
  open to public input and voting. A chat-style interface with decision popups,
  like the prompts in this conversation, is a strong candidate.
- Support numerous polls while reducing duplicate proposals and questions.
  ADR-0024 already accepts similar-question warnings using full-text search;
  they are warnings, not posting refusals.
- **Development votes require socially confirmed participants.** A sign-in or
  verified email alone is insufficient: participants must be confirmed by a
  community or other verified users. Guest/anonymous voting is excluded from
  this development decision process. This does not silently change eligibility
  for every existing Pulse poll.
- **Choices default to private.** Public attribution can eventually be an
  optional choice. Private ballots still require verified eligibility; voting
  privacy and participant verification are separate concerns.
- **Thresholds cover both participation and support.** Actual numbers and the
  support calculation are not chosen. A filtered-tally privacy cutoff or a
  moderation auto-hide threshold is not a development quorum.
- Cut tickets by distinct behavior and responsibility, not by the message in
  which an idea appeared. Shared backend work belongs in one ticket; separate
  interfaces depend on it instead of rebuilding it.

## Confirmation, trust and abuse decisions

Operator answers recorded 2026-10-09:

- The operator is the first account with full powers. People approved directly
  by that operator should also have full powers. Use plain product language;
  the term "super-user" is not required.
- As approval relationships extend beyond the operator, permissions should
  depend on trust. Possible factors include how closely someone is connected
  to a fully trusted account, contributions, and authentication evidence such
  as email verification or an in-person confirmation through the app. This is
  a direction for a later rule, not an approved score formula or weighting.
- The normal confirmation requirement is **one authorised community
  representative or two authorised individual participants**. The operator
  can establish the initial group directly. Two approvals must come from
  different people; repeat submissions by one person cannot supply both.
- Removing someone's voting access stops future votes. Past votes remain
  unless evidence of abuse calls for review; removal does not automatically
  erase their voting history or change finished decisions.
- People should be able to report participants, polls and messages easily,
  including abuse and threats. Reporting itself needs protections against
  misuse. Shared reporting, review and each report entry point are distinct
  implementation responsibilities.

Still open: the exact meaning of full application powers; permission propagation
and trust factors/weights; how contributions are established; approved community
representatives; the evidence required for in-person confirmation; effects of
revoked approvals on other people; and how past votes can be reviewed while
protecting ballot privacy. Trust-based permissions and vote weighting are
separate questions; no vote-weighting change was chosen.

ADR-0024 §3c currently accepts automatic poll hiding after enough flags, with
the count unchosen. Preserve that rule unless the operator explicitly changes
it and the architectural decision is amended. The reporting tickets below do
not choose a new penalty rule.

Reporting questions currently presented to the operator: who may submit reports,
and whether penalties require human review or may happen automatically. Proposed
protections include private reports, server-side submission limits and preventing
repeat submissions from multiplying the same unresolved complaint. Exact limits,
review roles, appeal behavior and the evidence needed to act remain undecided.

## Suggested structure, not yet ratified

While there is one participant, record each design question, its options and the
operator's decision in memory without posting a poll. Later, the same question
can be put to eligible participants under the published voting rules. Selected
work becomes a contained implementation ticket; delivery still requires review
and passing checks.

Give a proposed improvement one home, with linked polls for priority, design
choices and post-release feedback. Create implementation issues when the work
is selected and defined; do not create an issue for every poll. Record whether
work was operator-selected or selected under a published voting rule.

Show similar existing proposals/questions before posting. Offer a link to
participate there while allowing genuinely different questions. Context matters:
community, release/version and the decision being asked. Linking or marking
duplicates must not silently merge ballot totals.

Build in contained slices: author/browse proposals; confirmed-participant
eligibility and account-level repeat-vote prevention; duplicate warnings;
published participation/support rules; links from a proposal to implementation
and release feedback. Their final issue scopes and order still need a plan.
Voting can select work without bypassing code review, tests or release checks.

## Created work and issue-writing skill

- [Epic #227](https://github.com/Will-ODC/odc/issues/227) tracks the bounded
  development-feedback loop. The confirmation count is now decided above; trust
  calculation, ballot privacy and threshold values remain open.
- [Ticket #228](https://github.com/Will-ODC/odc/issues/228) is a contained
  interactive chat-popup prototype: a sample conversation, one single-choice
  poll, eligibility/error states and keyboard/mobile behavior. Sample responses
  are labelled as a preview. Live integration waits for shared eligibility,
  account-ballot and decision-rule support.
- `/create-issue` produces short, bullet-focused Jira-style feature tickets:
  summary, scope, 3–5 observable acceptance criteria, real dependencies and
  context links. Search for duplicates and keep decision-only material in
  memory. The user authorised creating and applying this skill.
- The skill is `.claude/skills/create-issue/SKILL.md` (#229, merged), with a
  `.agents/skills/create-issue` symlink for Codex discovery. One copy is
  maintained. #227 and #228 were written with it.

## Contained trust and reporting tickets

Each is future implementation work with five acceptance checks. Open policy
values stay in this note and are explicit prerequisites, rather than being
chosen by the ticket author. These tickets do not start implementation.

- [#230](https://github.com/Will-ODC/odc/issues/230) — Give owner-approved users full application permissions.
- [#231](https://github.com/Will-ODC/odc/issues/231) — Record confirmations and check participant eligibility.
- [#232](https://github.com/Will-ODC/odc/issues/232) — Check confirmation permissions using trust rules.
- [#233](https://github.com/Will-ODC/odc/issues/233) — Submit abuse reports with duplicate and rate limits.
- [#234](https://github.com/Will-ODC/odc/issues/234) — Review reports and record outcomes.
- [#235](https://github.com/Will-ODC/odc/issues/235) — Report a participant from their profile or menu.
- [#236](https://github.com/Will-ODC/odc/issues/236) — Report an abusive poll from its screen.
- [#237](https://github.com/Will-ODC/odc/issues/237) — Report an individual chat message.
- [#238](https://github.com/Will-ODC/odc/issues/238) — Stop future development votes without erasing past ballots.

Dependency order: owner grants #230 before confirmation records #231; #231
uses initial owner-granted authority before the later trust check #232. Shared
report submission #233 precedes review #234 and entry points #235–#237; those
entry points also wait for their actual product surfaces. #237 requires saved
chat messages, which prototype #228 does not supply. Voting restrictions #238
wait for account-based development voting and accepted reviewer authority.

## Unresolved before voting implementation

1. What qualifies a community to confirm someone and who may act for it.
   Initial operator/direct approvals and full powers are decided above; later
   trust rules and their evidence remain open.
2. The confirmation count is decided above. Its recording, revocation and
   dispute rules remain open. A chain of endorsements alone does not prove
   unique humans. Voting-access removal preserves past votes pending an
   evidence-based review; the review/privacy mechanism still needs a design.
3. How one eligible account retains one ballot across devices and sign-ins.
   Current Pulse ballots are browser-cookie identities, separate from signed-in
   accounts; API.md explicitly describes repeat voting after signing out/in.
   A sign-in gate alone does not establish account-level uniqueness.
4. How ballot privacy is protected from public readers and from operators with
   database/secret access. Publicly hidden choices are not necessarily unlinkable
   to an account internally. No ballot-linkage design was approved in this chat.
5. Participation minimum, support rule and denominator, abstentions, ties,
   closing time, eligible audience, and when eligibility is measured. Avoid
   changing a published voting rule after votes have been cast.
6. How optional public attribution is offered without exposing other voters'
   choices. Private is the accepted default; detailed disclosure behavior waits.

## Issue review and disposition

The operator authorised concluding appropriate issues on 2026-10-09. Closing
decision/context issues does not settle their questions or cancel their recorded
ideas. Their original GitHub bodies remain available as provenance.

- **#192 — completed:** #202 supplied the batching conformance vectors. This
  is historical work, not a pending feature request.
- **#193 — completed:** #220/#221 supplied chain identity/reporting and #222
  supplied its fixtures. The reporting/precedence amendment landed as
  PR #224; closing #193 does not clear T9. See the core audit memory for its gate.
- **#217 — context transferred:** ADR-0024 settled duplicate warnings, hide
  rather than delete, community flagging/manual removal, posting to one's
  community and public reading. PR #218 corrected the plan's stale blocker.
  Posting still needs defaults for `closesAt` and `acceptsSuggestions`.
  Moderation still needs flagging eligibility, auto-hide threshold and manual
  removal authority. Newsletter choices and search-language configuration can
  wait. None of these values was selected in this conversation.
- **#214 — decision transferred:** account/ballot linkage remains open. The
  original options are browser-only ballots, adopting a stable account ballot
  with a stored mapping, or deriving the mapping using a server secret. Stored
  mappings allow database readers to associate ballots with accounts; derived
  mappings change the protection to secret custody. The issue recommended
  retaining browser-only ballots temporarily, but that cannot satisfy this new
  development feature's account-level repeat-vote requirement by itself.
  Preserve existing ballots during any later migration; the exact design needs
  an ADR before implementation.
- **#173 — deferred idea transferred:** an unobtrusive popup offers a vote
  about the page being read, potentially drafted by AI and approved by a human.
  Still undecided: extension/site integration, author approval, question framing,
  actionable outcome, consent for sending page content, and cost/spam controls.
  It depends on poll creation and is too broad for one ready implementation
  issue. Do not implement it from this memory note.
- **#205 — keep open:** selecting multiple answers on approval polls is a
  concrete behavior change. Choose the interaction and narrow acceptance
  criteria before implementation. PR #206 fixed result highlighting, not
  multiple-answer selection.
- **#186 — keep open:** a closed first question needs a way onward. The
  destination remains undecided; a question listing or a defined fallback is a
  contained feature. Do not invent an answer-dependent next step without an
  answer. The operator previously deferred this until poll creation.

Issue provenance: https://github.com/Will-ODC/odc/issues/217,
https://github.com/Will-ODC/odc/issues/214,
https://github.com/Will-ODC/odc/issues/173.

## Merged follow-ups (#213, #215, #239), cautions that remain

- #213 (P8 slice 1) and #215 (P2 picker) are merged. Both stores keep
  `discard(tokenHash)` **and** `liveFor(kind, subject, now)`.
- Core #224 took ADR-0032, so the Pulse credential record is **ADR-0033**.
  Migration 004 still says 0032 in a comment, and it stays byte-for-byte as is,
  because it is checksum-protected. Drain old API instances before applying 004.
- ADR-0033 is accepted (2026-10-10); its upgrade path stays open. Email
  assurance alone does not meet the development-voting rule. Nothing here starts
  P8 slice 2, social confirmation, trust scoring or account-based development
  voting.
- Open: whether a later community pick should move a returning voter (see
  `memory/pulse.md`).
