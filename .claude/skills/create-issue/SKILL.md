---
name: create-issue
description: Create short, plain-language GitHub feature tickets with a summary, a contained scope and observable acceptance criteria. Use when the user invokes /create-issue or asks to create an implementation issue or a bounded epic.
user-invocable: true
---

# /create-issue

Turn an authorised feature request into a short ticket a single developer can
implement and a reviewer can assess. Use simple words and bullets. The issue
tracks work; memory preserves session context and unresolved decisions.

## Workflow

1. Read the relevant workstream memory and search open issues for duplicates.
   Read code or API docs only as needed to establish the proposed scope.
2. Choose one observable change. Split large work into a bounded epic and small
   tickets; do not create all its children before their scopes are defined.
   An epic lists a finite set of outcomes, not an entire product roadmap.
   Cut by distinct behavior and responsibility, never by chat-message boundaries.
   Put shared foundations in one ticket; separate interfaces depend on them.
   Keep evidence recording, policy evaluation and enforcement separate when
   each has its own reviewable outcome. Avoid circular dependencies; name the
   initial supported path before a later extension.
3. Write the complete ticket locally using the template below. Keep normal
   tickets around 150–250 words, with 3–5 acceptance criteria. Use only the
   headings that help; omit empty sections.
4. Review it: can one developer finish the slice, can each criterion be checked,
   are dependencies real, and are undecided choices kept in memory? Label a
   prototype as a prototype. Do not claim an unfinished dependency is available.
   Compare proposed tickets together: no duplicated implementation ownership,
   and each one has its own outcome. An open policy prerequisite can block a
   defined feature, but a question by itself belongs in memory.
5. If the user authorised creating the issue, create it without another
   confirmation. Use a structured body argument or `gh issue create --body-file`.
   If the request is only to draft or discuss, return the draft instead.
6. Return the issue link and record durable decisions or unresolved questions in
   the workstream's memory. Follow repository rules for memory commits and PRs.

If essential scope is missing, ask one focused question and continue independent
research. Do not make a decision-only issue to hold a question. Do not choose
privacy rules, voting thresholds or other policy values on the user's behalf.

## Template

Title: a short action and its user-visible outcome.

```markdown
## Summary

- Who needs the change and what it lets them do.

## Scope

- The small behavior or screen this ticket delivers.
- The existing service or interface it uses, when relevant.

## Acceptance criteria

- [ ] Observable successful behavior.
- [ ] Relevant empty, unavailable or error behavior.
- [ ] Relevant permission/privacy behavior.
- [ ] Verification appropriate to the change, including UI accessibility when relevant.

## Dependencies

- Required issue, API or accepted decision; include a link.

## Context

- Link to the epic, memory or ADR. Keep the reasoning there.
```

## Writing rules

- Describe behavior, not a list of files to edit.
- Prefer concrete verbs: create, show, select, save, close.
- Write acceptance criteria as checks, not aspirations such as "works well".
- Keep estimates, priority and technical prescriptions only when provided or
  supported by the task. Do not invent deadlines.
- Reuse existing labels. Do not post implementation essays, conversation
  transcripts, handoff notes or unresolved policy debates as feature tickets.
- Ordinary defects and improvements to existing behavior are valid tickets.
- Respect the workstream boundary: Pulse tickets do not import the ODC ledger
  or hash-chain contracts unless a separately authorised integration exists.
