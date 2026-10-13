# ADR-0040: Pulse confirmed votes are stored with a one-way keyed code

- **Status:** accepted (operator decisions, 2026-10-12: show both numbers;
  option C for the link; one confirmed vote per person per poll, the most
  recent). Two rules were proposed by the implementer and **confirmed by
  the operator on 2026-10-12**: what "most recent" is measured by
  (decision 5), and that closed polls are not confirmed at sign-in
  (decision 3).
- **Date:** 2026-10-12
- **Phase:** 0 (pulse workstream, charter-exempt; issue #352)

## Context

A pulse vote is filed under the browser's `pulse_ballot` cookie and nothing
else. Anyone may vote without signing in, so the totals count browsers, not
people. People reading results need a second number: how many votes come from
someone who confirmed by email, counted once per person (#352).

Counting once per person means the stored vote has to say something about the
person. Until now `API.md` promised "No stored record connects an address to an
answer, because the vote was never written down beside one." Three ways to keep
a confirmation were weighed by the operator:

| Option                                   | What a stolen database shows                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| A. Store the account id on the vote      | Who voted what, directly.                                                         |
| B. Store a plain hash of the account id  | Who voted what, by hashing every account id in the `voter` table and matching.    |
| C. Store a keyed code (HMAC, server key) | Nothing about who voted what, unless the server key is also taken.                |
| (Full separation)                        | Nothing even with the key. That is the core ledger's design (identity + linkage). |

## Decision

1. **Option C.** A confirmed vote stores
   `HMAC-SHA256(key, JSON.stringify(["pulse-vote-confirmation/v1", accountId, pollId]))`,
   as 64 lowercase hex digits, in a new nullable column `vote.confirmation`
   (migration `007_confirmed_votes.sql`). The JSON array is the
   length-unambiguous encoding: no two (account, poll) pairs encode alike. The
   account id and the address are never stored on the vote. The code is made
   in one place, `src/voting/confirmation.ts` (`ConfirmationKey.codeFor`); the
   stores only ever receive codes, and refuse anything not shaped like one —
   in code, and in Postgres by the check constraint
   `vote_confirmation_is_a_code`.
2. **The key** is `PULSE_CONFIRMATION_KEY`, at least 32 characters. The served
   API (`src/main.ts`) refuses to start without it, naming it in the same
   single missing-settings message as the others, and refuses it equal to
   `PULSE_SESSION_SECRET`. It is never derived from the session secret.
   `dev-server.ts` invents one per run from its own random bytes, as it does
   the session secret, and warns when it does so against a database.
3. **When a vote becomes confirmed:** when it is cast by someone signed in
   (the cast route reads the session for this, and only this), or when the
   browser holding its ballot cookie signs in afterwards
   (`POST /api/sign-in/redeem` confirms every vote under that ballot on a poll
   still open). **Confirmed by the operator, 2026-10-12:** a
   closed poll's votes are not confirmed afterwards, so its results stop
   changing when it closes.
4. **Changing an answer keeps the confirmation**, signed in or not. A cast
   while signed in as a different person replaces the code with theirs.
   **Signing out does not remove it.** Nothing ever clears the column.
5. **One confirmed vote per person per poll, the most recently cast.** Every
   vote one person confirmed carries the same code. Of the votes on a poll
   that share a code, the one with the latest `cast_at` is that person's
   confirmed vote; a tie in the same millisecond goes to the greater ballot
   identity (byte order), the same in both stores. The others still count in
   the totals. **Confirmed by the operator, 2026-10-12:**
   "most recent" is measured by when the vote was _cast_, not when it was
   confirmed. Confirming an older vote by signing in later does not make it
   the most recent: the cast time decides, so the confirmed vote is the
   person's latest expressed answer.
6. **"Most recent wins" is derived when results are read, not stored.** There
   is no "this is the confirmed one" flag and no uniqueness constraint to
   maintain. `results()` picks one vote per code with
   `distinct on (confirmation) … order by confirmation, cast_at desc, voter_id collate "C" desc`
   inside the existing repeatable-read snapshot. With no flag there is no
   state for two confirmations racing for one person to leave wrong: however
   concurrent writes commit, the rows decide, and the count is one. The race
   test (`confirmations_racing_for_one_person_and_poll_are_one_confirmed_vote`)
   holds three such writes at a lock barrier and checks all three rows carry
   the code while one counts. A partial index on `(poll_id, confirmation)`
   serves the grouping.
7. **Results** gain `confirmedVoters` and, per choice, `confirmedCount` and
   `confirmedShare`, always present, zero when nobody has confirmed. The MCP
   `get_results` passes them through as optional fields.

## Consequences

- **What a copy of the database alone shows:** which votes were confirmed, and
  that two ballots on the same poll were confirmed by the same unnamed person
  (equal codes). Not who that person is. Codes differ per poll, so one
  person's votes are not linked across polls.
- **What the key holder can do:** compute the code for every account id in
  `voter` and every poll, and so work out who voted what. This is the
  accepted limit of option C. The key must be kept like the database
  credentials; anyone with both has the whole picture. Full separation is the
  core ledger's job (identity service and private linkage map), which is
  where pulse votes are headed.
- **Rotating the key** makes every earlier code unrecognisable: a person who
  confirms again after a rotation counts as a second confirmed voter until
  their earlier votes are re-confirmed. No re-keying exists; it would need the
  old key and the account ids, which is the linkage this design avoids
  holding in one place.
- **Unchanged weaknesses, stated plainly.** One person is one account, which
  today is one email address: two addresses are two confirmed people. Someone
  who signs in on a browser another person voted on confirms that person's
  vote as their own (the ballot cookie is per browser, ADR-0030's trade).
- The cast route now reads the session, which it deliberately did not before.
  It reads it only to make the code; the ballot is still filed under the
  ballot cookie, and a vote still counts without any session.
- `ServerDeps.confirmationKey` is optional so that test clients embedding the
  server need not care; without it nothing is confirmed. Every entry point
  that serves people passes one.

### Documents reconciled

- `apps/pulse/API.md` — updated in this PR: the "No stored record connects an
  address to an answer" passage now says exactly what is stored; redeem,
  cast, sign-out and results document confirmation; MCP `get_results` notes
  the pass-through.
- `apps/pulse/README.md` — updated in this PR: built list, both variable
  tables, the upgrade note for 007.
- `apps/pulse/docker-compose.yml` — passes `PULSE_CONFIRMATION_KEY` through.
- **Not updated, flagged for whoever owns them:**
  - `docs/plans/pulse.md` P9 quotes the old `API.md` sentence and says the
    cast route reads no session; both are now stale. Out of this ticket's
    paths (another session holds uncommitted edits there).
  - `docs/decisions/0028-…` lists the four required settings as of its date;
    `apps/pulse/README.md` is the live list and now has five.
  - `docs/decisions/0036-…` (proposed) plans an account-scoped AI ballot. When
    that lands it would store a ballot associated with an account, which the
    new `API.md` passage would have to except; ADR-0036's implementer should
    reconcile it with this decision.

## Charter check

Pulse is charter-exempt (`apps/pulse/CLAUDE.md`); P1–P4 do not apply. Nothing
here reads or writes `services/` or `contracts/`. The design deliberately
stops short of the core's separation and says so, rather than presenting a
keyed code as anonymity.
