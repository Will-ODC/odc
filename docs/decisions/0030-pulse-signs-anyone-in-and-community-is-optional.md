# ADR-0030: Pulse signs anyone in, and community is optional

- **Status:** accepted
- **Date:** 2026-10-09
- **Phase:** 0
- **Supersedes:** in part ADR-0023 (the domain allowlist as the gate on who may
  sign in)

## Context

Pulse signs people in with an emailed link. Until now the address's domain also
decided whether they could sign in at all: `ClaimService.requestLink` answered
`not_a_member` (HTTP 403) unless a row in `allowed_domain` matched. ADR-0023
kept that table keyed on `(community, domain)` and took the gate for granted.

That gate is what makes a fresh deployment unusable. With no rows, nobody gets
in. On 2026-09-13 the operator answered "must we have a community to start?"
with no, and `docs/plans/pulse.md` P4c recorded it as open sign-up, leaving two
questions for this ADR: what `voter.community` holds for someone whose address
names no community, and what replaces the allowlist as protection against abuse.
The operator settled both, and two smaller points, on 2026-10-09.

Community does little today. `polls` has no `community` column, nothing in
`src/voting/` or `src/http/` branches on it, and the client only displays it.
Its one real job was the gate.

## Decision

1. **Someone whose email names no community simply has no community.** It is
   stored as `null`: `voter.community` and `pending_claim.community` lose their
   `not null` in `apps/pulse/migrations/002_community_is_optional.sql`, and the
   TypeScript field is `string | null` on `Voter` and `PendingClaim`, in both
   the in-memory and the Postgres stores. Not an empty string and not a
   placeholder community, either of which would read as a community that
   exists. The HTTP responses send `community: null`, always present. The
   operator: "just no community, that should be non issue."
2. **Nothing replaces the allowlist as abuse protection.** No anti-abuse
   mechanism is built. The operator: "this is only to start, it will be opened
   up to anyone later, who can join or leave communities freely." Joining and
   leaving communities is later work (P8 to P11 in `docs/plans/pulse.md`) and
   is not built here. Nothing here rules it out: a nullable community is the
   state a person who has left every community would be in, and the decisions
   recorded for P8 to P11 already give an anonymous vote `community NULL`.
3. **The allowlist stays, as a label only.** The operator: "A keep list". It
   never turns anyone away. An address whose domain matches a row still gets
   that community, with the same tie-break as before (longest domain, then
   lowest community alphabetically); every other valid address signs in with
   community `null`. `DomainAllowlist`, `VerificationMethod`,
   `PostgresDomainSource`, `allowDomain` and the dev seed all stay. Keeping them
   keeps P2 (the sign-in community picker) and the demo seed working, and they
   are cheap to remove when joining and leaving arrives.
4. **This change takes migration number 002.** ADR-0024's three `polls`
   columns, which it said "land in migration 002",
   move to the next free number, because the runner refuses a file numbered
   below one already applied (`apps/pulse/src/db/migrate.ts`).

Everything else about sign-in is unchanged: the link's lifetime, the cap on
outstanding links per address, the rate limit, and sign-out.

## Consequences

- **One person can now sign in under many free addresses and vote many times.**
  The allowlist was the only thing between a tally and unlimited free email
  addresses. Pulse is already counted-not-verified and already counts one
  person twice if they sign out and back in (`apps/pulse/API.md`), so this
  widens a known weakness rather than adding a new kind. Accepted for now, by
  the operator's decision 2.
- **The community is decided once, when the link is asked for.** Someone who
  signs in before their domain is added to the table keeps `null` after it is
  added, just as an existing member keeps their community if their row is
  removed. Joining a community later is P8 to P11's work.
- **`apps/pulse-web` is partly out of step with the server, and the rest is
  owed.** Its end-to-end test of an unclaimed domain, which ran against the
  real server, now expects a link and `community: null` instead of a refusal —
  changed in this PR, with the orchestrator's approval. The client itself still
  maps a 403 `not_a_member` to `not_eligible`, a path the server no longer
  reaches, and types `Me.community` as `string` where the server now sends
  `string | null`. Nothing breaks; that cleanup is a pulse-web follow-up.
- **The 403 `not_a_member` answer is gone from the API.** Nothing else in the
  HTTP surface changes shape: `community` was already in every voter body and
  now may be `null`.

### Documents reconciled

- **`docs/decisions/0023-…`** — treats the allowlist as the gate on sign-in.
  **Superseded in that one element and not edited**, following ADR-0023's own
  precedent: ADRs are a dated record. Its other decision, that one domain may
  name several communities, stands.
- **`docs/decisions/0024-…`** — says its `polls` columns land in migration 002.
  **Not edited**; decision 4 above moves them.
- **`apps/pulse/migrations/002_community_is_optional.sql`** — new, with a header
  pointing here. **Added in this PR.**
- **`apps/pulse/src/identity/{claim,store,pg-store,allowlist}.ts`,
  `src/http/server.ts`, `src/dev-server.ts`** — the docstrings that said the
  domain proves membership or gates sign-in. **Updated in this PR.**
- **`apps/pulse/API.md`** — removes the 403 row, documents `community` as a
  string or `null`, and records the client's two disagreements. **Updated in
  this PR.**
- **`apps/pulse/README.md`** and **`apps/pulse/CLAUDE.md`** — said the domain
  proves membership and that nobody signs in without a row. **Updated in this
  PR.**
- **`apps/pulse-web/test/end-to-end.test.ts`** — the unclaimed-domain test
  rewritten to the new behaviour. **Updated in this PR.** The rest of
  `apps/pulse-web` is owed, as above.
- **`docs/plans/pulse.md`** — its P4c section described this work as unbuilt.
  **Deleted in this PR**, per the plan's own rule that the PR building an item
  deletes its section.
- **`memory/pulse.md`** and **`memory/INDEX.md`** — record open sign-up as
  decided and unbuilt. **Not updated in this PR, deliberately:** memory is
  updated on master at merge time, per the merge checklist in
  `.claude/skills/odc-pipeline`. Owed at merge.
- **`docs/charter.md` and `contracts/`** — pulse is charter-exempt and shares
  nothing with `contracts/`. **Checked, no change needed.**

## Charter check

**Pulse is charter-exempt** by the operator decision recorded in
`apps/pulse/CLAUDE.md`, so P1–P4 are not the standard applied here. The two
boundaries that survive the exemption are checked, as ADR-0023 did:

- **"No reads or writes across into `services/` or `contracts/`."** Honoured.
  Every change is to pulse's own tables and code.
- **"The counting is never the subject."** Honoured. No user-visible string is
  added; one refusal sentence is removed.
