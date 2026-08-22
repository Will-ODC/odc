# ODC Implementation Plan

**Stack (locked):** TypeScript for all services, as a pnpm workspace with turborepo. One exception: the `verifier` is written in **Go** — sharing zero code, runtime, or serialization library with `ledger` makes its independence real, and forces `contracts/` to stay language-neutral. Dev entry point: a root `justfile` (`just up / test / smoke / verify`) over a root docker-compose.

Goal: independent services, buildable in parallel, communicating only through public APIs. MVP is the smallest thing that demonstrates the core loop: **register → create issue → vote → tally → export → verify**.

**Scope.** This plan covers the charter-governed core only: `contracts/`,
`services/`, and the `tools/` that support them. `apps/pulse` and
`apps/pulse-web` are a separate, deliberately **charter-exempt** product
workstream and appear nowhere below — see `memory/pulse.md` and
`apps/pulse/CLAUDE.md`. Nothing in `apps/**` may read or write into `services/**`
or `contracts/**`.

## Rules for every service

1. Owns its own storage. No shared databases, ever.
2. Its public API is its only interface. No service reads another's tables.
3. Complexity stays inside; the API speaks plain nouns and verbs.
4. Ships with its own README, API doc, and tests.
5. Can be rebuilt from scratch against its API doc without breaking its neighbors.

## Phase 0 — Contracts (write this before any code)

One short directory, `contracts/`, agreed and at **RELEASE CANDIDATE** before
Phase 1 (ADR-0007 — the `contracts-v1` freeze itself is deferred until real
operational use):

1. **Event schema:** `seq, type, version, payload, ts, prev_hash, hash`.
2. **Canonical hashing rule:** exactly which bytes are hashed and how. One page.
3. **Export format:** hash-chained NDJSON, one event per line.
4. **ID formats:** `participant_id`, `issue_id`.
5. **Event type registry.** v1 types: `participant_registered` (includes public key), `issue_created`, `vote_cast` (signed). **No free-text content in the log at MVP** — no arguments, no descriptions beyond a title. Keeps erasure obligations out of the permanent record until the off-log content pattern exists.
6. **Read API shape:** pagination and limits for `GET /events?since=` — consumed by `tally` and `mcp`, so it is a contract, not a ledger detail.
7. **Evolution rule:** event versions are additive-only; hashing rules never change retroactively; verifiers must accept all published versions.

**Phase 0 exit gate — genesis rehearsal:** build a throwaway chain against the draft contracts, export it, verify it, tamper-test it. Only then freeze the contracts and declare genesis. A hashing mistake found after real events exist is permanent.

Everything not in `contracts/` is a private detail of some service.

## Services

### 1. `ledger` — Phase 1

The append-only event log. The single writer of truth.

- API: `POST /events` · `GET /events?since={seq}` · `GET /head` · `GET /export`
- Inside: hash computed at insert; insert-only enforced at the storage layer; `seq` assigned here (timestamps are advisory).
- Validation is self-contained: a `vote_cast` is accepted only if its `sig` verifies under the `registrar_pk` its own `genesis` declares (`event-types.md` ET-17). No calls to other services.
- Duplicate votes are **recorded, not rejected**, and **cannot be de-duplicated on-log at all**: a ballot carries no voter field (ET-21), so there is nothing to group by and "latest per participant wins" is not computable. One-ballot-per-human is registrar policy, checked off-log before signing (ET-20). The log records what happened; views decide what it means, and `evolution.md` EV-13 permanently excludes the ballot plane from every correction mechanism.
- MVP authorization: `issue_created` requires the operator key; `participant_registered` requires the `identity` service's key (identity is the sole gate to personhood); `vote_cast` requires the **registrar** key, held by `identity`. The genesis MUST declare `registrar_pk != operator_pk` (`event-types.md` ET-9d) — one key in both roles would let a single holder mint the questions and forge every answer. Distinctness is verifier-enforced; **custody is not and cannot be** (two distinct keys can still sit in one pair of hands, ADR-0018), so `identity` holding the registrar key and never the operator key remains policy this service and `identity` must actually honour.
- Write path: `issue_created` and `participant_registered` are signed by their own keys and `POST`ed directly. **A ballot is not**: `identity` IS in the vote path — it checks eligibility off-log, signs the `vote_cast` as registrar, and submits it. The voter holds no on-log key, because a voter-held key is a demandable receipt (ADR-0004, charter §5/§8).
- **Ballots are appended in batches, never one at a time** (`event-types.md` ET-23–ET-25, ADR-0014). A ballot's `ts` is quantized to the issue's declared `ballot_batch_interval_ms`; a batch (one issue, one batch instant) is not published until it holds the issue's declared `ballot_batch_min` ballots, except as the issue's last batch; and its internal order MUST NOT be arrival order. Both parameters are declared on the `issue_created` event and are floored by contract (60000 ms / 3), so they are governable by vote but not down to nothing. The first two are verifiable from the export; **the shuffle is not**, and is implementation trust — which is why it is written down here as well as in `contracts/`. This lands before the code, not as a retrofit: an unbatched ledger is fully conformant to every other rule and fully coercible.

### 2. `verifier` — Phase 1, independent

Standalone CLI, written **from `contracts/` alone in a fresh context** — an agent that has never seen `ledger` source or discussion. This independence is the test that the spec is real.

- `verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]` → one of **three** verdicts (ADR-0006, `evolution.md` EV-7/EV-17): `VALID`, `INVALID at line N`, or `PARTIAL` naming the affected lines — the last for a well-formed event whose `(type, version)` this verifier does not register, so a frozen verifier does not condemn a chain that has legally grown past it. Exit codes 0/1/2, ≥3 for tool-level errors. Reason text is advisory and is NOT conformance-checked; there is no reason-code registry. `--chain` names **which chain** (the genesis hash — a chain's identity, ET-7a/EX-22) as `--head` names **how much of it**; on every run the verifier MUST print the genesis hash and the head it computed, so a reader has something to compare against an anchor (EX-24, ADR-0013).

### 3. `identity` — Phase 1

Human-facing registration; keeper of the private linkage map (own database, never exposed, physically separate from `ledger`).

- API: `POST /register` (new participant: generates/receives pubkey, emits `participant_registered` to ledger, records linkage privately) · `POST /challenge` (auth for clients).
- v1 = keypairs and pseudonyms. Blind signatures arrive later **behind this same API**.
- Ordering: emit `participant_registered` to `ledger` first; record the private linkage only on confirmed append; retries must be safe. A person must never exist in one store but not the other.

### 4. `tally` — Phase 2

All derived views. Holds no truth; rebuildable from the export at any time (and tested that way).

- Reads `ledger` via `GET /events?since=` polling.
- API: `GET /issues` · `GET /issues/{id}/tally`
- v1 = **plurality counting over ballots as recorded**. NOT approval (a v1 ballot carries one `choice`, not a set) and NOT latest-vote-per-participant, which is **not computable**: a ballot carries no voter field (`event-types.md` ET-21), so there is nothing to group or supersede by. One-ballot-per-human is registrar policy enforced off-log before signing (ET-20). Parallel methods, reputation and delegation views arrive later behind the same API shape — see `charter.md` §5, where the richer aggregation methods are marked roadmap and constrained by receipt-freeness.

### 5. `web` — Phase 2

The human client. Talks only to public APIs. Can start against mocks generated from `contracts/`.

- Key handling is encapsulated: the user sees "sign up" and "vote"; keys are generated and stored client-side invisibly, exportable for the curious.
- MVP pages: register · issue list · issue detail with vote button · results · a "verify this yourself" link that downloads the export and links the verifier.

### 6. `mcp` — Phase 3

Thin protocol wrapper. Resources = `tally` and `ledger` reads; tools = vote casting via `identity`-authenticated signatures. Contains no logic of its own.

### Deferred services (reserve event types in `contracts/` now; build later)

- `sentiment` — private encrypted response store; commits only anonymous hashes to `ledger`. Its separation from ballots is a Phase 0 schema decision even though the service comes much later, and that decision is now written down: `evolution.md` **EV-22** permanently bars registering any response-carrying type on the governance chain, and states exactly which anonymous commitments remain permitted — aggregate, never per-respondent, carrying no respondent identifier (ADR-0017). Roadmap within the service: encrypt on ingest from day one; canary entries per license/snapshot; threshold custody (k-of-n key shares, decryption gated on a recorded license-vote event) when real data accumulates — expert-tier, external review required.
- `treasury`, `reputation`, `briefing` — extensions of the derived-view and initiative patterns.

## Build order

| Phase | Work                                      | Parallel?                       |
| ----- | ----------------------------------------- | ------------------------------- |
| 0     | `contracts/` — write, review, freeze      | —                               |
| 1     | `ledger` · `verifier` · `identity`        | yes — three agents              |
| 2     | `tally` · `web`                           | yes — mocks until Phase 1 lands |
| 3     | `mcp`; first deferred service when needed | —                               |

## MVP acceptance test

In one sitting: a person registers, votes on an issue, sees the tally, downloads the export, runs the verifier, and gets `VALID`. Then flip one byte anywhere in the export and get `INVALID at line N`. Separately: a stranger writes a second verifier from `contracts/` alone and both verifiers agree on both outcomes.
