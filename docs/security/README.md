# Security documentation

Threat models, posture reviews, and phase-gate audit reports for ODC.

## What belongs here

- Phase-gate security audits (`audit-*.md`) — the adversarial reviews that gate
  a phase transition.
- Threat models and posture reviews.
- Reasoning about what the system conceals, what it exposes, and why.

## What must never appear here

**No secrets, and nothing whose safety depends on staying unread.** Not the
operator key, not the registrar key, not the private linkage map, not any
sample of the registrar's `{who, issue, choice}` knowledge, not credentials of
any kind — no live values, no illustrative-but-real values, no fragments.

This directory is public and is expected to stay public. Anything written here
should be safe in the hands of an adversary, because it will be.

## The principle

**Conceal keys and identity linkage; never conceal rules, formats, or logic.**

The security of this system rests on the correctness of published rules and on
the secrecy of a small, enumerable set of keys — never on an attacker not
understanding how it works. Charter §9 makes transparency the default and bars
hidden authority; a security review that could not itself be published would be
evidence of a design that does not hold up.

So: a document explaining exactly how ballot unlinkability is constructed
belongs here. A document that would weaken the system by being read does not
belong here — and if such a document seems necessary, that is a finding about
the design, not a reason for a private directory.

## Status of documents in this directory

Audits are **dated and scoped to the tree they examined**. An audit does not
stay true as the tree moves.

So every audit filed here **MUST** carry, near the top:

- the date and the commit or tree it examined;
- what was read and what was not, and why — an unexamined area named is worth
  more than a clean verdict that quietly did not cover it;
- for each question the audit set out to answer, an explicit result even where
  that result is "checked, no issue found", so a later reader can tell
  **"checked and clean"** apart from **"not examined"**. These look identical in
  a document that reports only findings, and confusing them is how a gap
  survives an audit.

An audit that makes a claim about what it demonstrated **MUST** leave behind
what a re-auditor needs to re-run it, or say plainly that it did not. Evidence
described but not retained is not evidence, and the fixes-then-re-audit path
depends on the next auditor being able to reproduce the last one.

A superseded audit is kept, not deleted — the record of what was checked and
when is itself the point.
