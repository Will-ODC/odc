# Pulse development loop and issue triage

Operator directions recorded 2026-10-09. This is session context for Pulse,
not an implemented feature, a core-contract amendment or a completed security
review. Read alongside `memory/pulse.md`; implementations still need small
scopes and accepted technical decisions. Pulse remains independent of the ODC
hash chain and ledger.

## Accepted direction

- GitHub issues mainly describe new features or changes to existing behavior.
  Each should be contained, small enough for one developer, and independently
  reviewable. An epic may group a finite set of such changes. Record necessary
  dependencies explicitly. Defects with a concrete behavioral fix still belong
  in issues.
- Session state, unresolved decisions, handoffs and deferred ideas belong in
  memory. Accepted architectural decisions belong in ADRs. A request to remember
  an uncertainty is not automatically an implementation ticket.
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

## Suggested structure, not yet ratified

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
  development-feedback loop. It does not settle the confirmation, privacy or
  threshold decisions below.
- [Ticket #228](https://github.com/Will-ODC/odc/issues/228) is a contained
  interactive chat-popup prototype: a sample conversation, one single-choice
  poll, eligibility/error states and keyboard/mobile behavior. Sample responses
  are labelled as a preview. Live integration waits for shared eligibility,
  account-ballot and decision-rule support.
- `/create-issue` produces short, bullet-focused Jira-style feature tickets:
  summary, scope, 3–5 observable acceptance criteria, real dependencies and
  context links. Search for duplicates and keep decision-only material in
  memory. The user authorised creating and applying this skill.
- [Skill PR #229](https://github.com/Will-ODC/odc/pull/229) adds the canonical
  `.claude/skills/create-issue/SKILL.md` and a `.agents/skills/create-issue`
  alias for Codex-compatible discovery. One copy is maintained. Both #227 and
  #228 were written using it. This PR and the memory update are pending merge.

## Unresolved before voting implementation

1. What qualifies a community to confirm someone, who may act for it, and how
   the initial trusted participants are established. The operator can select
   work while these rules remain undecided.
2. Whether one endorsement is sufficient, how endorsements are recorded, and
   what revocation, disputes and abuse handling do to eligibility and prior
   votes. A chain of endorsements alone does not prove unique humans.
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
  supplied its fixtures. The reporting/precedence amendment remains separate
  PR #224; closing #193 does not clear T9.
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

Checkpoint self-review: this note distinguishes accepted operator requirements
from proposals and unanswered questions, preserves the transferred issues'
essential reasoning, and leaves existing product behavior unchanged. Issue
cleanup does not implement participant verification, ballot privacy or thresholds.
