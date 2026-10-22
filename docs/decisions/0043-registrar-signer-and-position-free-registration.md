# ADR-0043: A separate registrar signer, and position-free registration

- **Status:** accepted (operator decisions, Will, 2026-10-21), all four
  decisions. Decision 4 needs charter §10 item 6 amended; Will approved that
  amendment on 2026-10-21, and it lands in a separate follow-up PR (see
  "Charter check").
- **Date:** 2026-10-21
- **Phase:** 1
- **Settles:** S-C and NS-2 (`memory/OPEN-QUESTIONS-archive.md`, "The registrar
  signs each ballot's final log position") and Q-F ("Q-F — What mitigates the
  registrar's signature…"). **Amends:** the registrar-key custody named in
  ET-9a, ADR-0004 and the archive's "Registrar-side ballot privacy".

## Context

`hashing.md` HA-15 builds every signing preimage over the event's final `seq`,
`ts` and `prev_hash`. Two consequences block the Phase 1 write path.

- **S-C** (`docs/security/t9-reaudit-2026-10-20.md`). ET-17 makes the registrar
  the signer of `vote_cast`, and ET-9a puts that key in identity. So identity
  signs each ballot at append, after the ET-25 shuffle, and learns each ballot's
  line as well as `{voter, issue, choice}`. Identity, which holds the linkage
  map, becomes a voter-to-log-line join, and the shuffle protects nothing
  against it. It also contradicts `services/ledger/CLAUDE.md`'s "no calls to
  other services".
- **NS-2** (`docs/security/t9-reaudit-2-2026-10-20.md`). A registrant's own
  `participant_registered` signature (ET-10) has the same binding, and EV-26
  refuses any event whose signature fails at its final line. A registrant can
  only sign once the ledger has fixed the tail, so the ledger must either hold
  a tail reservation across a client round trip or reject and retry.
- **Q-F** (first T9 audit, S2). Every ballot carries 64 published, permanent
  signature bytes the registrar chooses. A registrar that knows the voter can
  hide the voter's identity in them, and no reader can tell.

The position binding is not a mistake: it is what stops a captured ballot
being replayed at another line (`ballot-replayed.ndjson`, S-C). So ballots keep
it. `contracts/` is RELEASE CANDIDATE (ADR-0007): additive, version-bumped
changes are still allowed and Phase 1 services must tolerate them.

## Decision

### 1. S-C: admission and signing are split

The registrar role (ET-17, ET-20, ET-25) is carried by two components that
never share state:

- **Admission (identity).** Identity decides eligibility and one ballot per
  human per issue, off-log, before admission and final (ET-20, ET-25). It then
  pushes an **unattributed** entry `(issue_id, choice)` to the signer. Identity
  retains only "voter V has voted on issue I". It does not retain the choice,
  and it never learns the batch, line or signature of any ballot.
- **Signing (the signer).** A separate component holds the registrar private
  key and no linkage map. It keeps each issue's open batch as **counts per
  choice**, with no arrival order and no arrival time, and signs every ballot
  of a sealed batch at append, once its line is fixed. It sees positions but
  never voters.
- **No arrival time anywhere.** "No arrival time" covers request logs, metrics,
  traces and stored request ids, on identity and on the signer alike: neither
  may record when a given entry was pushed or received together with its
  issue or choice, because the two records together rebuild the join. Identity
  keeps a request id only while the push is unresolved. The signer keeps, per
  issue, the set of request ids it has admitted, with nothing beside them (no
  batch, choice, order or time), stored unordered: no auto-increment key, no
  `created_at` column, nothing that brings back arrival order. It answers any
  id in the set "accepted" without admitting again, including after the
  issue's last seal, so a push that timed out cannot become a second ballot
  (ET-20) or a counted ballot identity rolled back. It deletes an issue's set
  only when identity calls the signer's public "release issue" endpoint, which
  identity calls only after the issue's last seal and once every push for that
  issue has a definite answer; the signer refuses an earlier release.

No contract change for ballots: `vote_cast` v1 and HA-15 stay as they are.
ET-25 already says it "fixes when the decision is made, not which component
admits or signs".

**Stated residual.** The operator runs identity, the signer and the ledger.
Identity knows `{voter, issue, choice, time}` and the signer knows
`{issue, choice, time}` and every final line; together they can rebuild the
join. Identity alone also narrows a ballot: it knows the voter, the choice and
when it pushed, and it can read batch instants from the public log, so it can
place the ballot among that batch's lines with that choice. When the choice is
unique in the batch, including an under-size last batch of one, that is
exactly one line. Separation is custody, not mathematics, in the same register as ADR-0018:
the log cannot show that the parts are run apart. A signer can also stuff or
drop ballots, which is ET-20's existing trust-by-policy residual moved to a new
holder.

### 2. NS-2: a position-free registration signature

Add **`participant_registered` version 2**, same payload keys (`pubkey`,
`sig`), whose registrant signature does **not** cover `seq`, `ts` or
`prev_hash`. A device can then sign before the ledger fixes the line, and the
ledger appends it whenever it likes. The event's `hash` (HA-13) still covers
all six content fields, so the chain is unchanged. A replayed v2 registration
appended again is a duplicate, already `VALID` under ET-12; derived views
deduplicate by `participant_id` (ID-4), as they must already.

This is version-bumped and allowed under the release candidate, but it is not
purely additive: it needs two scoped exceptions, for `(participant_registered,
2)` only, to rules that today bind every signature. `event-schema.md` ES-32
says a signature covers the same six content fields as the hash preimage, and
`hashing.md` HA-16 says every `sig` is over `SIGN_PRE(E)`. Both gain an
exception naming this one pair. EV-3 and EV-4 still hold: the hash construction
(HA-1 to HA-14, the domain constant, every field encoding) is unchanged, so the
v2 line hashes exactly as any event does and an old verifier recomputes it;
only which bytes the registrant signs differs, and no existing `(type,
version)`, v1 included, changes. v1 stays registered, so every chain written so
far still verifies. T10 re-audits it.

**Possession is checked off-log.** A v2 signature is public and valid at any
line, so holding a copy of one proves nothing about holding the key: anyone
can copy a `pubkey` and `sig` from the log and submit them. Identity MUST link
a `pubkey` to a person only after a fresh challenge-response signed by that
key (`POST /challenge`). It MUST refuse a `pubkey` that is already linked. A
`pubkey` already registered on the log but not linked is accepted only when
identity's own durable record shows an unfinished submission for that same
challenge-verified key (recovery after a crash between append and link), and
refused otherwise.

### 3. Q-F: deterministic signing from an attested build

The signer MUST sign with deterministic Ed25519 exactly as RFC 8032 §5.1.6
specifies (the nonce derived from the key's prefix and the message; no random
or caller-supplied input), and MUST run from a reproducible build of published
source whose digest the operator publishes. The signature bytes are then a
function of the key and the preimage, so an honest signer has nothing to choose.

**Stated residual.** This cannot be checked from the export alone. Checking
that a signature is the deterministic one needs the private key, so readers
rely on trusting the build and the operator's statement that it is what runs.
Threshold signing (for example FROST) removes the single key holder and is the
stronger option. It is deferred and MUST be reconsidered before the T10
freeze. Blind-signature credentials stay on charter §11's deferred list.

Decision 1 narrows what identity can leak through the log: the pool is counts
only and the ledger chooses the order, so nothing identity sends changes any
byte of a ballot line except the tally.

### 4. The signer is its own service

**`services/signer`** is a new Phase 1 service with its own storage and the
registrar private key. It replaces identity as the registrar-key holder. It
never holds the operator key (ET-9a, ET-9d) and never any participant key.

### How the append is coordinated

All calls are to documented public APIs; no service reads another's tables.
Exact paths belong to each service's `API.md`; this ADR fixes who calls whom
and what crosses each boundary.

- **Client → identity, submit a ballot:** an authenticated voter, `issue_id`
  and `choice`. The reply is an unauthenticated "accepted" or "refused" and
  nothing else (ET-21a).
- **Identity → signer, add an entry:** `issue_id`, `choice`, and a fresh random
  request id used only to make retries idempotent. Never a `participant_id`,
  pubkey, session or anything derived from the voter. The reply is "accepted",
  or "refused" (unknown issue, choice out of range, issue closed), with no
  batch id, line or signature. A request id already in the issue's set is
  answered "accepted" without admitting again.
- **Identity → signer, release an issue:** `issue_id` only, sent only after
  the issue's last seal and once every push for that issue has a definite
  answer. The signer refuses a release before the last seal; otherwise it
  deletes the issue's request-id set.
- **Ledger → signer, seal:** `issue_id`, and whether this is the issue's last
  batch. The signer atomically closes the issue's open batch and returns its id
  and its counts per choice. After a last seal it refuses every further entry
  of that issue.
- **Ledger → signer, sign a batch:** one call carrying the batch id, the batch's
  unsigned `vote_cast` payloads in the ledger's chosen append order, the first
  `seq`, the batch's `ts`, and the `prev_hash` of the first ballot (the hash of
  the event the run follows). Each ballot's hash covers its own `sig` (HA-13,
  HA-15), so ballots 2..N cannot have a `prev_hash` until the ballot before them
  is signed; the ledger therefore cannot send them pre-chained. The signer
  checks that the `(issue, choice)` multiset equals that batch's sealed counts
  exactly, then, in order, assigns each ballot `seq` = first `seq` + its index,
  the shared `ts`, and the `prev_hash` of the ballot before it, signs it,
  computes its hash, and returns the complete signed run. The ledger checks that
  each returned payload equals the one it sent at that index, so the signer
  cannot change the order or swap choices (ET-25: the ledger chooses the order),
  and runs EV-26 on every returned line before appending the run whole. A batch
  is signed at exactly one position: the signer stores each batch's first call's
  inputs, returns identical events for a repeated call with identical inputs
  (decision 3), and refuses any call for that batch whose inputs differ in any
  way. _(Clarified 2026-10-21 at the ledger lead's request; Will chose this over
  one call per ballot.)_
- **Identity → ledger, append a registration:** a client's
  `participant_registered` v2. Linkage is recorded only on confirmed append; a
  retry that appends twice is a harmless duplicate.
- **Identity and signer → ledger, read:** `GET /events?since=` (`read-api.md`)
  for issue existence, `choice_count` and batch parameters. Reads only.

Rules that follow:

- **Identity orders its own write around the push.** It marks the voter
  pending, pushes the entry, and records "voted" only on accepted; on refused
  it rolls back. So a ballot refused after a last seal is refused before the
  registrar records the voter (ET-25). On a timeout or any other indefinite
  outcome the signer may already hold the entry, so identity never rolls back:
  the voter stays pending and identity retries with the same request id until
  it gets a definite answer. Rolling back there could admit a second ballot for
  the same voter (ET-20). Identity discards the request id once the answer is
  definite.
- **Admission is the signer accepting an entry.** The signer runs every
  position-independent EV-26 check first (issue exists and is readable, choice
  in range), so ET-25's admission rule holds. It refuses a non-last seal below
  the issue's `ballot_batch_min` as a second check on the ledger.
- **The ledger stays the producer.** It decides when to seal, the batch instant
  (ET-23, ET-24a), the order (ET-25: not arrival, and the signer holds no
  arrival order to leak), seal-order appends, and one open batch per issue. It
  holds its tail from the sign call until the run is appended, so the signed
  positions stay valid. That lock spans a call to an operator-run service, never
  a client round trip. Before the sign call it persists the sign request,
  exactly that call's inputs (batch id, payloads in order, first `seq`, `ts`,
  first `prev_hash`), and on recovery from a crash it replays that request
  before appending anything else; since the signer signs a batch at one position
  only, losing the request would strand admitted ballots. It verifies every line
  before appending (EV-26).
- **No receipt anywhere on the path (ET-21a).** The signer is now on the
  submission path. It MUST NOT return anything to identity, or to anyone, that
  singles out a ballot's line or batch or attests to it. Identity has nothing
  to leak because it never receives it.
- **Ballots and sentiment stay apart.** The signer accepts `vote_cast` entries
  only and shares no store or pipe with any sentiment component.
- **The linkage map never leaves identity.** Nothing identity sends the signer
  or the ledger about a ballot is derived from the voter.

## Alternatives rejected

- **S-C: identity keeps signing at append** (today's text). It is the
  voter-to-line join S-C names.
- **S-C: identity appends whole batches.** The same join, and the ledger stops
  being the single writer.
- **S-C: ballots signed position-free**, like registrations. A captured ballot
  could then be replayed at any line (`ballot-replayed.ndjson`), and that would
  be ballot stuffing the log cannot see. Ballots keep HA-15.
- **S-C: the signer inside the ledger.** The single writer could then mint
  ballots alone, with no second component to check it.
- **S-C: blind-signature credentials now.** Identity v2 work, deferred by
  charter §11.
- **NS-2: a tail reservation with a timeout.** A slow or hostile registrant
  stalls the whole log, ballots included.
- **NS-2: reject and retry.** Livelocks under load.
- **NS-2: change HA-15 for every type.** Retroactive, which `evolution.md`
  forbids, and it would drop the binding ballots need.
- **Q-F: random nonces with a published derivation.** Deterministic RFC 8032
  signing already is a published derivation, with no extra input to trust.
- **Q-F: threshold signing (FROST) now.** Stronger, deferred for cost and
  maturity; reconsidered before the T10 freeze.
- **Decision 4: the signer as a separately stored part of identity.** Not
  chosen, because one service boundary would hold both halves. This would have
  kept the charter's old wording; Will chose to amend the charter instead.

## Consequences

- Phase 1 has four core services: ledger, verifier, identity and signer. The
  ledger now calls the signer; the "no calls to other services" rule becomes
  "calls only the signer's public API, on the ballot write path".
- A signer outage before the ledger holds a batch's signatures stalls ledger
  appends from the sign call until the signer answers; once the ledger
  holds them, a signer outage stalls nothing. An outage before sealing only
  delays ballots.
- The web client signs registrations without waiting for the ledger, but must
  first read the chain's genesis hash (below).
- An auditor with access to identity can compare its per-issue count of voters
  marked "voted" with the ballot count on the log; a mismatch shows stuffing or
  dropping. Whether to publish that count is a later decision.
- Still open, not settled here: key rotation and compromise (S-G), anchor
  contents (S-D), and the threshold-signing question above.

### Contract work this implies (a later PR; nothing in `contracts/` changes here)

1. **`participant_registered` v2 in `event-types.md`.** Payload as v1. New rule
   (call it ET-10a): `sig` MUST verify under `pubkey` over the registration
   preimage below. ET-4 to ET-4c, ET-11 and ET-12 apply unchanged. Bump the
   file version and add a `CONTRACTS-CHANGE.md` entry.
2. **A new HA rule in `hashing.md`** (call it HA-15a), applying only to
   `(participant_registered, 2)`, plus scoped exceptions in ES-32 and HA-16
   naming this pair (decision 2). HA-15 and every hashing rule stay as they
   are. The registration
   preimage MUST: start with its own fixed ASCII domain tag, distinct from
   `DOMAIN`, so it can never equal any `SIGN_PRE`; cover `type` and `version`;
   cover the chain's identity, the genesis hash (ET-7a), as 64 lowercase-hex
   characters, so a registration cannot be replayed onto another chain or a
   fork (Will's decision, 2026-10-21: keep chain binding); cover every payload key except `sig` (today only `pubkey`); and
   exclude `seq`, `ts` and `prev_hash`. Encodings reuse `ENC_STR` and `ENC_INT`.
   The exact tag bytes and a worked hand-verifiable example are the contracts
   PR's to pin.
3. **Informative and custody text:** ET-9a and the `vote_cast` introduction
   (registrar key held by the signer, not identity); ET-21's residuals restated
   for the split; a normative, log-unverifiable obligation beside ET-21a that
   the registrar signs deterministically per RFC 8032 (it belongs to neither
   verification stage, EV-15).
4. **Verifiers, then vectors (coupling rule, `memory/STATE.md`).** Both
   verifiers register `(participant_registered, 2)`, each built separately by
   `odc-verifier-builder` from the edited `contracts/` alone. The change is a
   no-op on the committed corpus (no v2 lines), so each may land alone. Vectors
   land with or after both, never before: today's verifiers report a v2 line
   `PARTIAL`, so a `VALID` v2 vector would turn CI red. Vectors needed: a valid
   v2; the NS-2 case (signed, then appended one line later) `VALID`; a v2
   appended twice `VALID`; a v2 signed with the v1 preimage `INVALID`; a v1
   signed with the v2 preimage `INVALID`; a v2 signed for another genesis hash
   `INVALID`; a v2 with an extra payload key `INVALID`; and the ET-4a/4b/4c
   non-canonical cases on v2.
5. **The ledger** writes only v2 registrations, and only after its embedded
   verifier registers v2 (EV-26 forbids appending an unregistered pair).
6. **T10** re-audits the v2 preimage and this split before the freeze.

### Documents reconciled

- `docs/implementation-plan.md`: updated in this PR (ledger and identity
  bullets; new signer service; build order).
- `memory/OPEN-QUESTIONS.md` and `-archive.md`: S-C, NS-2 and Q-F moved to
  the archive with pointers here; the "Registrar-side ballot privacy" entry
  notes that custody is settled here. Updated in this PR.
- `docs/charter.md` §10 item 6: **owed.** The amendment is approved by Will
  (Charter check) and lands in the follow-up PR below, not here.
- **Not updated here, owed:** `contracts/event-types.md` ET-9a, the
  `vote_cast` introduction and ET-21, plus `hashing.md` (the contracts PR
  above); `services/ledger/CLAUDE.md` (write-path bullet, `vote_cast` key
  "held by identity", custody bullet), `services/identity/CLAUDE.md`
  (registration and registrar bullets), `services/mcp/CLAUDE.md` and
  `services/web/CLAUDE.md` (who signs; v2 registration), and the root
  `CLAUDE.md` repo map (`services/signer`). Will decided (2026-10-21) that
  these land in **one follow-up PR together with the charter amendment**
  (branch `docs/charter-registrar-split`), and
  that it merges **before any ledger or identity lead starts**. `memory/STATE.md` is updated at merge time, by its owner.

## Charter check

- **P1 (the log is the only truth).** Unchanged: verifiers still check every
  ballot under `registrar_pk` and every registration under its `pubkey` from the
  log alone. Duplicate registrations are recorded, as ET-12 already allows.
- **P2 (one human, two planes).** Strengthened, not closed: no component is
  handed both a voter's identity and a ballot's line, but identity can narrow a
  ballot to the lines of one batch with its choice, sometimes to one line
  (decision 1's residual). Ballots and sentiment stay apart.
- **P3, P4.** Untouched.
- **§5 receipt-freeness.** Holds "against everyone but the registrar", now two
  components; ET-21a now binds the signer too.
- **§10 item 6 is amended, by Will's decision.** The charter says of the
  identity service: "It is also the ballot registrar: it decides who may vote,
  signs every accepted ballot, and in v1 is trusted by policy not to add, drop
  or link ballots". Decision 4 contradicts that. Will approved amending it on
  2026-10-21: the registrar role is split; identity decides who may vote; a
  separate signer service, holding no linkage map, signs every admitted
  ballot. This PR does not edit the charter. The amended wording is owed and
  lands in the follow-up PR with the CLAUDE.md files, before any ledger or
  identity lead starts. Until that PR merges, the charter's current wording
  stands and no code may be built against decision 4.
