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

## hashing.md · export-format.md · read-api.md · evolution.md — v1 — 2026-07-24 — T4

- First content for the four T4 specs (all v1). `hashing.md`: the byte-exact
  preimage — `DOMAIN "ODC1"` ‖ 8-byte-big-endian ints ‖ length-prefixed UTF-8
  strings ‖ a **generic, per-type-agnostic** payload rule (sorted keys, 1-octet
  int/string tag); SHA-256, lowercase hex; hex fields hashed as text; signing
  preimage = payload minus `sig`; strings hashed by decoded value (HA-2).
  Includes a real, valid, hand-verifiable `genesis` worked example (hash
  `78ed980b…f6409a`, operator self-sig verifies) — reused verbatim as fixture
  001 in T5. `export-format.md`: NDJSON (D7) plus the **canonical line form**
  D5 requires (fixed envelope order, byte-sorted payload keys, compact, minimal
  escaping) — a structural rule separate from the value-based `hash`, so an
  event has exactly one valid byte representation; `--head`, and end-truncation
  only detectable with `--head`. `read-api.md`: `GET /events`
  `since`/`limit`/`next`/`head`, ordering + pagination stability, error codes.
  `evolution.md`: additive-only versioning, hashing never retroactive, and the
  authoritative cross-version verifier rule.
- **Two ADRs land with this ticket.** ADR-0005 (correction/retraction) is
  **ratified** (operator, 2026-07-24): the envelope never carries correction
  machinery; corrections are additive payload conventions (`evolution.md`
  EV-11–EV-14), ballot plane permanently excluded (ET-22). ADR-0006 (verifier
  scope & forward compatibility) is **accepted**: two-stage verification and a
  third verdict `PARTIAL` for well-formed-but-unregistered types, plus the
  requirement that the payload preimage be generic — both realized in
  `hashing.md` (HA-7) and `evolution.md` (EV-6–EV-10).
- **No T3 spec edited.** `evolution.md` EV-9 refines what ES-9/ES-11/ET-1/ET-2's
  "reject" means for a well-formed unregistered `(type, version)` (→ `PARTIAL`,
  not structural `INVALID`) as the authoritative cross-version rule. ADR-0006
  makes adding an inline EV-9 cross-reference to those T3 sentences a **MUST
  pre-freeze gate** (T9/T10 confirm it), rather than editing them mid-T4.
- **Fresh-context review applied (REQUEST CHANGES → resolved).** The [BLOCKING]
  finding — `export-format.md` asserted both value-based hashing and raw-line-
  byte verification at once — is fixed by the canonical line form above (honoring
  D5, per ADR-0003, rather than relaxing it). Also applied: HA-2 pinned to the
  decoded string value; the "identical bytes" claim is now backed by the
  canonical form; read-api resume-cursor clarified (RA-9→RA-10). The worked
  example hash and signature were independently reproduced from the spec text
  alone and are unchanged by these edits.
- `contracts/` stays DRAFTING. Freeze remains gated on the genesis rehearsal
  (T6–T8) and security audit (T9).

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
