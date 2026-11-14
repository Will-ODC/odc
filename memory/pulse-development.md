# Pulse development loop, trust and reporting

Operator directions recorded 2026-10-09 (community paths 2026-10-23). Session
context for Pulse, not built features or a security review. Read alongside
`memory/pulse.md`. Pulse remains independent of the ODC hash chain and ledger.
Where things go (issues, memory, ADRs) follows `memory/INDEX.md`.

## Accepted direction

- Develop Pulse through a feedback loop: propose an improvement, gather
  feedback, select work, implement it, review it, then ask whether it helped.
  While there is one participant the operator selects features; later,
  solicit feedback on what to build and how it should look and behave.
- Pulse begins as the primary interface; the interface itself is open to
  public input and voting. A chat-style interface with decision popups is a
  strong candidate (#228 prototype).
- Support numerous polls while reducing duplicates. ADR-0024 accepts
  similar-question warnings (full-text search); they warn, never refuse.
  Linking or marking duplicates must not silently merge ballot totals.
- **Development votes require socially confirmed participants.** A sign-in or
  verified email alone is insufficient (so ADR-0040 "confirmed" votes do not
  qualify); guest voting is excluded. This does not change eligibility for
  existing Pulse polls.
- **Choices default to private.** Public attribution can later be optional,
  without exposing other voters' choices. Privacy and verification are
  separate concerns.
- **Thresholds cover both participation and support.** Numbers and the support
  calculation are not chosen. A privacy cutoff or auto-hide threshold is not a
  development quorum. Avoid changing a published voting rule after votes are cast.
- Cut tickets by distinct behavior and responsibility. Shared backend work is
  one ticket; separate interfaces depend on it.
- Suggested, not ratified: record each design question, options and the
  operator's decision in memory without a poll while there is one participant;
  give a proposal one home with linked polls; create issues only when work is
  selected; record whether work was operator-selected or vote-selected. Voting
  never bypasses review, tests or release checks.

## Confirmation, trust and abuse decisions (operator, 2026-10-09)

- The operator is the first account with full powers; people the operator
  approves directly also get full powers. Use plain product language.
- Beyond that, permissions should depend on trust (closeness to a fully
  trusted account, contributions, email or in-person confirmation). A
  direction, not an approved formula.
- Confirmation needs **one authorised community representative or two
  authorised individual participants**; two approvals must come from different
  people. The operator can establish the initial group directly.
- Removing voting access stops future votes; past votes stay unless evidence of
  abuse calls for review. Finished decisions do not change.
- Reporting participants, polls and messages must be easy, with protections
  against misuse. Submission, review and each entry point are separate work.

Still open: the exact meaning of full powers; permission propagation and trust
weights; how contributions are established; who counts as a community
representative and what qualifies a community to confirm; in-person evidence;
recording, revocation and dispute of confirmations (an endorsement chain alone
does not prove unique humans); effects of revoked approvals on others; how past
votes are reviewed while protecting ballot privacy, including from operators
with database access; participation minimum, support rule, abstentions, ties,
closing time and when eligibility is measured. Trust-based permissions and vote
weighting are separate; no weighting change was chosen. Settled since: one
ballot per signed-in person (ADR-0046) and keyed-code confirmations
(ADR-0040); development voting still needs social confirmation on top.

Reporting questions put to the operator: who may submit reports, and whether
penalties need human review. Proposed protections: private reports,
server-side limits, and repeat submissions not multiplying one complaint.
Limits, review roles, appeals and evidence remain undecided. ADR-0024 §3c's
auto-hide after enough flags (count unchosen) stands unless the operator
changes it and the ADR is amended; moderation still needs flagging eligibility
and manual-removal authority.

## Tickets

- [Epic #227](https://github.com/Will-ODC/odc/issues/227): the bounded
  development-feedback loop. [#228](https://github.com/Will-ODC/odc/issues/228):
  chat-popup prototype (sample responses labelled as a preview; live
  integration waits on eligibility, account ballots and decision rules).
- Trust and reporting, each with five acceptance checks; open policy values are
  prerequisites, not the ticket author's to choose:
  #230 owner-approved full permissions → #231 record confirmations and check
  eligibility → #232 trust-rule confirmation permissions; #233 report
  submission with duplicate and rate limits → #234 review and outcomes → #235
  participant, #236 poll, #237 chat-message reports (each waits for its product
  surface; #237 needs saved chat messages); #238 stop future development votes
  without erasing past ballots (waits for account-based development voting and
  reviewer authority).
- `/create-issue` (`.claude/skills/create-issue/SKILL.md`, #229, with an
  `.agents/skills/create-issue` symlink for Codex) writes the tickets.

## Community paths and lifecycle deliberation (2026-10-23)

The operator asked for Reddit-style community paths and a connected thread of
votes on community creation, banning, destruction and suspension under
constitutional rules. A request to deliberate, not an adopted policy.

- **#457** community paths: proposed `/c/<community-name>` instead of
  `/browse?community=ID`; prefix, naming rules and ID mapping to be accepted.
  Keep old links; a readable URL grants no rights. Independent of lifecycle
  enforcement and #440.
- **#458** one linked rules thread, reusing #255–#258 proposal/decision work,
  #285/#286 constitution versioning, #297/#423 discussion and #425 navigation.
  No new voting engine or admin implementation; no live polls until content,
  authority and decision rules are accepted.

Open for that thread: (1) which foundational text governs, what is protected,
and how amendments work; (2) who may create a community and initiate, decide,
review and carry out suspension, ban, restoration or dissolution — community-wide
versus banning a person in one community; (3) electorate, thresholds, timing,
evidence, notice, appeal and emergency limits; (4) what each state permits and
how restrictions end — suspension, banning and dissolution are not
interchangeable; (5) whether destruction means archive or deletion, and what
happens to polls, ballots, comments, memberships and links. No destructive
behavior is chosen. These are Pulse questions; no core charter change is
authorized, and accepted rules need an ADR before enforcement is scoped.

## Deferred ideas and kept-open issues

- **#173** (closed, idea kept): an unobtrusive popup offering a vote about the
  page being read, maybe AI-drafted and human-approved. Undecided:
  extension/site integration, author approval, framing, outcome, consent for
  sending page content, cost/spam. Too broad for one issue; do not implement
  from this note.
- **#205** (open): multiple answers on approval polls. Choose the interaction
  and acceptance criteria first.
- Newsletter choices and search-language configuration can wait (#217).
