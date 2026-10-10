# ADR-0033: Pulse identity is a credential

- **Status:** accepted (operator, 2026-10-10). Decision 2 is the operator's
  own decision 1 of 2026-09-12; decision 7 (the upgrade path) stays open.
- **Date:** 2026-10-09
- **Phase:** 0 (pulse workstream, P8 slice 1)

## Context

Until now a pulse voter _was_ an address. `voter.email` was the natural key
(`001_initial.sql`), reached through `VoterStore.byEmail`, guarded by a unique
index and named by `VoterExistsError`; `pending_claim.email` throttled requests
per address. Nothing recorded how a person had been verified.

The operator decided on 2026-09-12 that pulse should carry varying levels of
sign-in (`docs/plans/pulse.md`, "The identity work — P8 to P11"): three
ordered levels `none < link < email`, stored as words with the order in code,
so that `in_person` and `scan` arrive later with no migration. P8 is the item
that makes the storage able to say that. This ADR records slice 1 of it: a
behaviour-preserving storage change. Nobody signs in any differently.

## Decision

1. **Migration `004_identity_is_a_credential.sql`.** A new table
   `voter_credential (kind, value) -> voter_id, params jsonb, verified_at`,
   primary key `(kind, value)`. Every existing voter is backfilled with one
   `('email', voter.email, voter.id, '{}', voter.claimed_at)` row: the moment
   they first claimed the address is the moment they proved it. `voter.email`
   is dropped. `voter.assurance text not null` is added (nullable, backfilled
   `'email'`, then tightened — the 003 pattern, since
   `test/migrations.test.ts` allows no new column defaults). On
   `pending_claim`, `email` becomes `subject`, a `kind` column is added the
   same way, and the throttling index moves to `(kind, subject)`.

2. **(Already decided by the operator, 2026-09-12.) The level vocabulary lives
   in `src/identity/assurance.ts`:** `none`,
   `link`, `email`, in that order. The database stores the word and knows no
   order (the `polls.method` rule, ADR-0021). A stored word the build does not
   know is refused on read, never guessed at. Every voter created in this slice
   is `email`.

3. **A credential's kind is the assurance word it confers** — not a third
   vocabulary. `CredentialKind` is the levels minus `none` and `link`, which
   are levels with no credential behind them. `VerificationMethod`
   (`allowlist.ts`) is a different question — which community, if any — and
   reads a credential already proved; its docstring now says so.

4. **The store seam.** `VoterStore.byEmail(email)` becomes
   `byCredential(kind, value)`; `ClaimStore.liveFor(email, now)` becomes
   `liveFor(kind, subject, now)`; `PendingClaim.email` becomes `kind` +
   `subject`. `VoterStore.create(voter, credential)` takes the voter and its
   first credential and writes **both or neither** — one transaction
   (`inTransaction`) in Postgres, both checks before either write in memory.
   Uniqueness moves to `voter_credential`'s primary key, and
   `VoterExistsError` becomes **`CredentialTakenError`**: "this credential
   already belongs to someone". `ClaimService.redeem`'s race-2 recovery (two
   links for one address clicked at once) catches the new name and is
   otherwise unchanged.

5. **A voter with no credential is deliberately allowed.** The foreign key
   runs from credential to voter and nothing runs the other way, and
   `Voter.email` is `string | null`. This is the plan's "decide it here": a
   public-link voter (P10) and an anonymous voter (decision 4) are voters with
   no credential, and the model must not assume otherwise. **Nothing in this
   slice creates one** — `create` still requires a credential, and the only
   writer is the email sign-in. P10 owns the path that creates one, and what
   happens to such a voter after sign-out.

6. **No API change.** `/api/me` keeps `{ id, email, community }`. The voter
   store reads `email` back from the voter's `email` credential onto `Voter`,
   and `publicVoter` (`server.ts`) passes it through. `proofEmailsOptIn` is
   unchanged. No `apps/pulse-web` change.

7. **Out of scope — slice 2, not built:** decision 5's upgrade path (a guest
   who verifies keeps their identity and gains the credential, or becomes the
   existing person whose credential it is; and what happens to the ballot
   cookie). Today `redeem` still mints a fresh voter for a new address and
   never touches the ballot cookie.

## Consequences

- The address is no longer what a voter _is_. A later kind (`in_person`,
  `scan`) is a new word in `assurance.ts` plus whatever writes its
  credential; `params` holds who vouched. No migration.
- `create` is now two inserts across two tables. Its failure mode — a voter
  left with no credential — is closed by the transaction and pinned by two
  tests (a credential refused because it is taken, and one refused by the
  database for an unrelated reason), and the race it used to lose by a unique
  index is pinned by a concurrent-create test behind a lock barrier.
- A voter's address is read with a subquery on `voter_credential`. Were a voter
  ever to hold two `email` credentials, the first proved is shown. Nothing
  creates a second today.
- The in-memory store keeps the address beside the voter rather than on it, so
  an `email` key on a written voter is ignored: the credential alone says what
  the address is.

### Documents reconciled

- `apps/pulse/API.md` — one sentence under `GET /api/me`: the shape is
  unchanged by P8.
- `apps/pulse/README.md` — the status list names the credential and the
  levels.
- `docs/plans/pulse.md` — the P8 section records slice 1 as built and slice 2
  (the upgrade path) as not built, and says its file and line references
  predate slice 1.
- ADR-0021 and ADR-0030 are not contradicted: the level words follow
  ADR-0021's words-with-order-in-code rule, and community stays a label
  decided at claim time.
- `memory/pulse.md` is updated at merge time, not on this branch.

## Charter check

**Pulse is charter-exempt** by the operator decision recorded in
`apps/pulse/CLAUDE.md`, so P1–P4 are not the standard applied here. The two
boundaries that survive the exemption:

- **"No reads or writes across into `services/` or `contracts/`."** Honoured.
  Every change is to pulse's own tables and code.
- **"The counting is never the subject."** Honoured. No user-visible string is
  added or changed.

## Numbering correction

This Pulse record was originally numbered 0032 in PR #213. Core PR #224 had
already assigned 0032 to anchor precedence and stored claims, so PR #215 moves
this record to **0033** without changing its decision or status. The comment
in checksum-protected migration `004_identity_is_a_credential.sql` retains its
original reference: its mention of ADR-0032 means this Pulse record, now 0033,
not the core anchor policy. That applied migration must not be edited merely
to change a comment.
