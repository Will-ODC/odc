# ODC Implementation Plan

**Stack (locked):** TypeScript for all services, as a pnpm workspace with turborepo. One exception: the `verifier` is written in **Go** — sharing zero code, runtime, or serialization library with `ledger` makes its independence real, and forces `contracts/` to stay language-neutral. Dev entry point: a root `justfile` (`just up / test / smoke / verify`) over a root docker-compose.

Goal: independent services, buildable in parallel, communicating only through public APIs. MVP is the smallest thing that demonstrates the core loop: **register → create issue → vote → tally → export → verify**.

## Rules for every service

1. Owns its own storage. No shared databases, ever.
2. Its public API is its only interface. No service reads another's tables.
3. Complexity stays inside; the API speaks plain nouns and verbs.
4. Ships with its own README, API doc, and tests.
5. Can be rebuilt from scratch against its API doc without breaking its neighbors.

## Phase 0 — Contracts (write this before any code)

One short directory, `contracts/`, agreed and frozen before Phase 1:

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
- Validation is self-contained: a `vote_cast` is accepted only if signed by a public key found in a prior `participant_registered` event *in its own log*. No calls to other services.
- Duplicate votes are **recorded, not rejected**; interpretation belongs to tally (latest per participant wins). The log records what happened; views decide what it means.
- MVP authorization: `issue_created` requires the operator key; `participant_registered` requires the `identity` service's key (identity is the sole gate to personhood); `vote_cast` requires a registered participant's signature.
- Write path: clients sign locally and `POST /events` directly. `identity` is not in the vote path.

### 2. `verifier` — Phase 1, independent
Standalone CLI, written **from `contracts/` alone in a fresh context** — an agent that has never seen `ledger` source or discussion. This independence is the test that the spec is real.

- `verify <export.ndjson> [--head <hash>]` → `VALID` or `INVALID at line N`.

### 3. `identity` — Phase 1
Human-facing registration; keeper of the private linkage map (own database, never exposed, physically separate from `ledger`).

- API: `POST /register` (new participant: generates/receives pubkey, emits `participant_registered` to ledger, records linkage privately) · `POST /challenge` (auth for clients).
- v1 = keypairs and pseudonyms. Blind signatures arrive later **behind this same API**.
- Ordering: emit `participant_registered` to `ledger` first; record the private linkage only on confirmed append; retries must be safe. A person must never exist in one store but not the other.

### 4. `tally` — Phase 2
All derived views. Holds no truth; rebuildable from the export at any time (and tested that way).

- Reads `ledger` via `GET /events?since=` polling.
- API: `GET /issues` · `GET /issues/{id}/tally`
- v1 = approval counting, latest-vote-per-participant. Parallel methods, reputation, and delegation views arrive later behind the same API shape.

### 5. `web` — Phase 2
The human client. Talks only to public APIs. Can start against mocks generated from `contracts/`.

- Key handling is encapsulated: the user sees "sign up" and "vote"; keys are generated and stored client-side invisibly, exportable for the curious.
- MVP pages: register · issue list · issue detail with vote button · results · a "verify this yourself" link that downloads the export and links the verifier.

### 6. `mcp` — Phase 3
Thin protocol wrapper. Resources = `tally` and `ledger` reads; tools = vote casting via `identity`-authenticated signatures. Contains no logic of its own.

### Deferred services (reserve event types in `contracts/` now; build later)
- `sentiment` — private encrypted response store; commits only anonymous hashes to `ledger`. Its separation from ballots is a Phase 0 schema decision even though the service comes much later. Roadmap within the service: encrypt on ingest from day one; canary entries per license/snapshot; threshold custody (k-of-n key shares, decryption gated on a recorded license-vote event) when real data accumulates — expert-tier, external review required.
- `treasury`, `reputation`, `briefing` — extensions of the derived-view and initiative patterns.

## Build order

| Phase | Work | Parallel? |
|---|---|---|
| 0 | `contracts/` — write, review, freeze | — |
| 1 | `ledger` · `verifier` · `identity` | yes — three agents |
| 2 | `tally` · `web` | yes — mocks until Phase 1 lands |
| 3 | `mcp`; first deferred service when needed | — |

## MVP acceptance test

In one sitting: a person registers, votes on an issue, sees the tally, downloads the export, runs the verifier, and gets `VALID`. Then flip one byte anywhere in the export and get `INVALID at line N`. Separately: a stranger writes a second verifier from `contracts/` alone and both verifiers agree on both outcomes.
