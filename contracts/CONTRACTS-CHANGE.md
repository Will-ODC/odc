# Contracts Change Log

Every pull request that touches `contracts/**` MUST add an entry here, and any
touched **spec** file (`contracts/*.md` other than `README.md` and this file)
MUST also add or bump its own `Version:` line. The `contracts-guard` CI
workflow enforces both on every PR.

After the `contracts-v1` tag exists, `hashing.md` and `fixtures/` are frozen:
CI hard-fails any edit to them. All other post-freeze changes stay
additive-only, version-bumped, and logged here — never retroactive.

Format (newest first, one entry per merged contracts change):

    ## <spec or scope> — <version> — <YYYY-MM-DD> — <PR>
    - what changed, and why (one or two lines)

---

## event-schema.md · ids.md · event-types.md — v1 — 2026-07-21 — T3

- First spec content. Drafted the event envelope (seven fields, strict
  reject-don't-repair, genesis = seq 1 / prev_hash 64 zeros), content-addressed
  `participant_id` = sha256(pubkey bytes) and `issue_id` = creating event hash,
  and the v1 type registry (`genesis`, `participant_registered`, `issue_created`,
  `vote_cast`). Preimage byte layout deferred to T4 (`hashing.md`). ADRs 0002
  (SHA-256 + Ed25519) and 0003 (explicit-byte preimage, strict rejection) added.
- **Ballots are receipt-free (ADR-0004).** `vote_cast` is registrar-signed with
  NO voter-held key (a voter-held key is a demandable receipt, charter §5/§8):
  payload `{issue_id, choice, sig}`, `sig` verifies under `registrar_pk` (new
  `genesis` field). `issue_created` gains `choice_count` (2–64); `choice` MUST be
  in `[0, choice_count)`. ET-22 permanently bars any future `vote_cast` version
  from reintroducing a voter-held key or unbounded voter value.
- Review fixes: `ts` pinned to regex + real-calendar-instant, leap seconds
  rejected (ES-20); canonical integer form + 2^53 bound generalized to all
  integers (ES-5); MUST-NOT wording (ES-3, ES-33); ES-9/ES-19 cross-refs fixed.
- `contracts/` stays DRAFTING. Correction/retraction (ADR-0005) and verifier
  forward-compatibility (ADR-0006) remain proposed, pending ratification.

## tooling — n/a — 2026-07-19 — T2

- Introduced this changelog and the `contracts-guard` CI workflow. No spec
  content yet; `contracts/` stays in DRAFTING status (see `contracts/README.md`).
  Spec drafting begins in T3.
