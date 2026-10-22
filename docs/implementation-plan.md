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
5. **Event type registry.** v1 types: `genesis` (declares the operator and registrar keys), `participant_registered` (includes public key), `issue_created`, `vote_cast` — all four signed (`event-types.md` ET-1). **No free-text content in the log at MVP** — no arguments, no descriptions beyond a title. Keeps erasure obligations out of the permanent record until the off-log content pattern exists.
6. **Read API shape:** pagination and limits for `GET /events?since=` — consumed by `tally` and `mcp`, so it is a contract, not a ledger detail.
7. **Evolution rule:** event versions are additive-only; hashing rules never change retroactively; a verifier never condemns a chain for a version it does not register — that is `PARTIAL`, not `INVALID` (`evolution.md` EV-8).

**Phase 0 exit gate — genesis rehearsal:** build a throwaway chain against the draft contracts, export it, verify it, tamper-test it. Only then, after the T9 security audit, do the contracts move to **RELEASE CANDIDATE** — not to a freeze, which ADR-0007 defers until real operational use (the gate's checklist is in `.claude/skills/odc-contracts`). A hashing mistake found after real events exist is permanent.

Everything not in `contracts/` is a private detail of some service.

## Services

### 1. `ledger` — Phase 1

The append-only event log. The single writer of truth.

- API: `GET /events?since={seq}` (`read-api.md`; read-only, it MUST NOT accept `POST`/`PUT`/`DELETE`, RA-13) · `GET /head` · `GET /export`. Write path: service-defined (RA-13), within EV-25, EV-26, ET-21a and ET-23–ET-25.
- Inside: hash computed at insert; insert-only enforced at the storage layer; `seq` assigned here (`ts` never orders anything, ES-21; a ballot's `ts` is quantized, ET-23).
- **Verify before append** (`evolution.md` EV-26): an event is appended only if the export with it as the last line verifies `VALID` under a verifier of exactly this ledger's contracts version. A chain not already `VALID` takes no further appends, and no line may exceed the EV-25 cap (65536 bytes, depth 64).
- Validation needs nothing outside the log: a `vote_cast` is accepted only if its `sig` verifies under the `registrar_pk` its own `genesis` declares (`event-types.md` ET-17). The **write path is not self-contained**, though: a ballot's signature covers its final `seq`, `ts` and `prev_hash` (`hashing.md` HA-15), so `signer` signs each ballot at append, once its line is fixed (ET-25). The ledger seals an issue's open batch at `signer`, orders it, and asks `signer` to sign that run before appending it (ADR-0043; waits on the charter amendment, §3a). Registrations use `participant_registered` v2, whose signature is position-free and can be appended at any line (ADR-0043, once `contracts/` carries it).
- Duplicate votes are **recorded, not rejected**, and **cannot be de-duplicated on-log at all**: a ballot carries no voter field (ET-21), so there is nothing to group by and "latest per participant wins" is not computable. One-ballot-per-human is registrar policy, decided off-log before the ballot is admitted (ET-20). The log records what happened; views decide what it means, and `evolution.md` EV-13 permanently excludes the ballot plane from every correction mechanism.
- MVP authorization: `issue_created` requires the operator key; `participant_registered` is **self-signed** under its own `pubkey` (ET-10, proof of possession) — one-human-per-key is `identity`'s off-log policy, not a property of the event (ET-12); `vote_cast` requires the **registrar** key, held by `signer` (ADR-0043). The genesis MUST declare `registrar_pk != operator_pk` (`event-types.md` ET-9d) — one key in both roles would let a single holder mint the questions and forge every answer. Distinctness is verifier-enforced; **custody is not and cannot be** (two distinct keys can still sit in one pair of hands, ADR-0018), so `signer` holding the registrar key and never the operator key remains policy this service and `signer` must actually honour.
- Write path: `issue_created` and `participant_registered` are signed by their own keys (operator, registrant). **A ballot is not**: the registrar is in the vote path, split in two (ADR-0043) — `identity` decides eligibility off-log, before admission and final (ET-20, ET-25), and passes `signer` an unattributed `(issue, choice)`; `signer` signs every ballot of a sealed batch at append. The voter holds no on-log key, because a voter-held key is a demandable receipt (ADR-0004, charter §5/§8). No component on the submission path gives a receipt: not which line or batch is the ballot's, and not any third-party-verifiable statement about it (ET-21a).
- **Ballots are appended in batches, never one at a time** (`event-types.md` ET-23–ET-25, ADR-0014). A ballot's `ts` is quantized to the issue's declared `ballot_batch_interval_ms`; every batch (one issue, one batch instant) holds at least the issue's declared `ballot_batch_min` ballots, except the issue's last; an issue never returns to a batch instant it has left, so a clock that steps backwards must hold or advance the instant (ET-24a, ADR-0029); and its internal order MUST NOT be arrival order. ET-25 also fixes how a batch is released: a ballot is admitted only after passing every position-independent EV-26 check; a batch is **sealed** before any of it is appended, then appended whole, as one run; an issue has at most one unsealed batch, and sealed batches are appended in seal order; an under-size batch may be sealed only as the issue's last, after which every further ballot of that issue is refused before the registrar records or signs it. Both parameters are declared on the `issue_created` event and are floored by contract (60000 ms / 3), so they are governable by vote but not down to nothing. The quantization, minimum and closed-instant rules are verifiable from the export; **ET-25 is not** — the shuffle, the seal and the one-open-batch rules are implementation trust — which is why it is written down here as well as in `contracts/`. This lands before the code, not as a retrofit: an unbatched ledger is fully conformant to every other rule and fully coercible.

### 2. `verifier` — Phase 1, independent

Standalone CLI, written **from `contracts/` alone in a fresh context** — an agent that has never seen `ledger` source or discussion. This independence is the test that the spec is real. A second verifier, in TypeScript (`tools/verifier-ts`), is built the same way and never shares a context with this one; ADR-0007's freeze signal needs the two to agree on a real chain.

- `verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]` → one of **three** verdicts (ADR-0006, `evolution.md` EV-7/EV-17): `VALID`, `INVALID at line N`, or `PARTIAL` naming the affected lines — the last for a well-formed event whose `(type, version)` this verifier does not register, so a frozen verifier does not condemn a chain that has legally grown past it. Exit codes 0/1/2, ≥3 for tool-level errors. Reason text is advisory and is NOT conformance-checked; there is no reason-code registry. `--chain` names **which chain** (the genesis hash — a chain's identity, ET-7a/EX-22) as `--head` names **how much of it**; on every run that reaches a chain verdict over non-empty input, the verifier MUST report the export's **stored claims** — the `hash` fields of its first and last records (claimed genesis and claimed head), or `unavailable` — described as stored claims, not as recomputed hashes, so a reader has something to compare against an anchor (EX-24, ADR-0013).

### 3. `identity` — Phase 1

Human-facing registration; keeper of the private linkage map (own database, never exposed, physically separate from `ledger`).

- API: `POST /register` (new participant: receives the registrant's pubkey and self-signed `participant_registered` (ET-10); identity never holds the participant's private key; records linkage privately once the event is appended; the signature is `participant_registered` v2's position-free one, ADR-0043, so it proves nothing about possession: identity links a `pubkey` only after a fresh challenge-response from that key, and refuses a `pubkey` already linked; one already on the log but not linked is accepted only when identity's own durable record shows an unfinished submission for that same challenge-verified key, and refused otherwise) · `POST /challenge` (auth for clients).
- Admission half of the registrar (ADR-0043; waits on the charter amendment, §3a): its eligibility and one-ballot-per-human decision is made before admission and final (ET-20, ET-25); it then pushes an unattributed `(issue, choice)` to `signer` and keeps only "voter V has voted on issue I". It holds no registrar key, never learns a ballot's batch or line, and gives no receipt (ET-21a).
- v1 = keypairs and pseudonyms. Blind signatures arrive later **behind this same API**.
- Ordering: the registrant's `participant_registered` is appended to `ledger` first; record the private linkage only on confirmed append; retries must be safe. A person must never exist in one store but not the other.

### 3a. `signer` — Phase 1

> **Waits on the charter.** Do not build `signer`, or the signer parts of `ledger` and `identity`, before the charter §10 item 6 amendment merges (follow-up PR `docs/charter-registrar-split`, approved by Will 2026-10-21).

The signing half of the registrar (ADR-0043). Own storage; holds the registrar private key, never the operator key or any participant key, and no linkage map.

- API: add an unattributed `(issue, choice)` entry (from `identity`) · release an issue's request ids (from `identity`) · seal an issue's open batch, returning counts per choice (from `ledger`) · sign a sealed batch's run at its fixed positions, exactly once (from `ledger`).
- Keeps each open batch as counts per choice, with no arrival order or time — none in request logs, metrics or stored request ids either, on `signer` or `identity`; per issue, `signer` keeps the set of admitted request ids, unordered and with nothing beside them (no batch, choice, order or time), answers any known id "accepted" without admitting again (even after the last seal), and deletes the set only when `identity` calls "release issue", after the issue's last seal and once every push for that issue has a definite answer (an earlier release is refused). Signs with deterministic RFC 8032 Ed25519, from a reproducible, published build (Q-F). On the submission path, so no receipt (ET-21a).

### 4. `tally` — Phase 2

All derived views. Holds no truth; rebuildable from the export at any time (and tested that way).

- Reads `ledger` via `GET /events?since=` polling.
- API: `GET /issues` · `GET /issues/{id}/tally`
- v1 = **plurality counting over ballots as recorded**. NOT approval (a v1 ballot carries one `choice`, not a set) and NOT latest-vote-per-participant, which is **not computable**: a ballot carries no voter field (`event-types.md` ET-21), so there is nothing to group or supersede by. One-ballot-per-human is registrar policy, decided off-log before admission (ET-20). Parallel methods, reputation and delegation views arrive later behind the same API shape — see `charter.md` §5, where the richer aggregation methods are marked roadmap and constrained by receipt-freeness.

### 5. `web` — Phase 2

The human client. Talks only to public APIs. Can start against mocks generated from `contracts/`.

- Key handling is encapsulated: the user sees "sign up" and "vote"; keys are generated and stored client-side invisibly, exportable for the curious. That key signs the registrant's `participant_registered` (ET-10), never a ballot (ET-22).
- MVP pages: register · issue list · issue detail with vote button · results · a "verify this yourself" link that downloads the export and links the verifier.

### 6. `mcp` — Phase 3

Thin protocol wrapper. Resources = `tally` and `ledger` reads; tools = vote casting, submitted to `identity`, which admits the ballot for `signer` to sign as registrar (ET-17, ADR-0043). Contains no logic of its own. Like `web`, it is on the submission path, so it gives no receipt (ET-21a).

### Deferred services (reserve event types in `contracts/` now; build later)

- `sentiment` — private encrypted response store; commits only anonymous hashes to `ledger`. Its separation from ballots is a Phase 0 schema decision even though the service comes much later, and that decision is now written down: `evolution.md` **EV-22** permanently bars registering any response-carrying type on the governance chain, and states exactly which anonymous commitments remain permitted — aggregate, never per-respondent, carrying no respondent identifier (ADR-0017). Roadmap within the service: encrypt on ingest from day one; canary entries per license/snapshot; threshold custody (k-of-n key shares, decryption gated on a recorded license-vote event) when real data accumulates — expert-tier, external review required.
- `treasury`, `reputation`, `briefing` — extensions of the derived-view and initiative patterns.

## Build order

| Phase | Work                                          | Parallel?                                               |
| ----- | --------------------------------------------- | ------------------------------------------------------- |
| 0     | `contracts/` — write, review, RC              | —                                                       |
| 1     | `ledger` · `verifier` · `identity` · `signer` | yes — four agents; `signer` after the charter amendment |
| 2     | `tally` · `web`                               | yes — mocks until Phase 1 lands                         |
| 3     | `mcp`; first deferred service when needed     | —                                                       |

## MVP acceptance test

In one sitting: a person registers, votes on an issue, sees the tally, downloads the export, runs the verifier, and gets `VALID`. Then flip one byte anywhere in the export and get `INVALID at line N`. Separately: a stranger writes a second verifier from `contracts/` alone and both verifiers agree on both outcomes.
