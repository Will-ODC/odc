---
name: lead
description: Start or run a lead session in the ODC monorepo — either as the orchestrator that splits the operator's direction into one lead per feature, or as a lead that owns one feature and runs its own implementers. Use when the user invokes /lead, asks to start leads, or a brief says this session is a lead.
user-invocable: true
---

# /lead

The rules live in `.claude/skills/odc-orchestration`, section "Leads". This
skill is the way in; it adds no rules of its own.

1. `git fetch origin`. If this checkout's `master` is behind `origin/master`,
   read the Leads section from `origin/master`
   (`git show origin/master:.claude/skills/odc-orchestration/SKILL.md`) — the
   copy on disk may be stale.
2. Work out which role this session has:
   - **The session has a lead's brief** (a goal, owned folders, tickets, and an
     orchestrator to report to): you are a **lead**. Follow "What a lead does,
     in order", starting with the synopsis, and build nothing before the go.
   - **Otherwise** you are the **orchestrator**. If the operator has not named
     the initiative, ask what it is. Then follow "The orchestrator, before
     offering leads" and write one brief per lead from "The lead's brief".
     If the work is one feature, or the features share files, say so and stay
     flat instead of starting leads.
3. The orchestrator has every green lead PR reviewed, per "Review every green
   lead PR" in the Leads section (operator, 2026-10-20). Merging stays the
   operator's call.
