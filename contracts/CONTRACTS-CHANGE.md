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

## evolution.md — v3 — 2026-07-27 — T5f (PR #28)

- **EV-19 added: a reserved `version` range.** No contracts version may ever
  register a `(type, version)` whose `version` is 1000000 or greater, and a
  fixture exercising the unregistered-**version** path MUST use one.
- **Why it was needed, found by the fresh-context review of this PR.** EV-18
  reserves a `type`-name prefix and requires every `PARTIAL` fixture to use it.
  But the unregistered-version path can only be exercised by a **registered**
  type name — precisely what EV-18 forbids — so under EV-18 alone that path is
  untestable by fixture without arming the exact time bomb EV-18 exists to
  defuse. Vector `009` sat in that gap: a frozen `PARTIAL` on
  `participant_registered` version 2 would be contradicted the day EV-1 adds
  that version for real, against a file `contracts-guard` makes uneditable.
- **Additive and non-retroactive.** EV-19 constrains only what future versions
  may register; no existing `(type, version)`, byte, or verdict changes. The
  range is bounded well inside ES-5's `2^53-1` and inside a signed 32-bit
  integer, so no `version` parser is strained by a conformance vector.
- **Not to be confused with the genesis question**, which stays open: an
  unregistered `genesis` version leaves a verifier unable to extract
  `operator_pk`/`registrar_pk` for Stage B at all. EV-19 makes the *version*
  namespace safe to use; it does not answer that, and `conformance.test.ts`
  still forbids any vector from freezing a verdict for it.

## fixtures/ — v2 — 2026-07-27 — T5f (PR #28)

- **35 vectors added: the 4 `PARTIAL` vectors (008–011) and 31 envelope
  `INVALID` vectors (012–042).** Additions only — no existing vector's bytes
  changed, and vector 001's preimage and digest are untouched.
- **The `PARTIAL` set is the EV-7/EV-8/EV-9 boundary.** A well-formed event of an
  unregistered type is `PARTIAL`, not `INVALID`: Stage A confirms its integrity
  and only its type-specific semantics go unchecked. This is what stops a frozen
  verifier declaring a chain broken because the community legally grew past it
  (charter §8). The paired `021-type-malformed` sits on the other side of that
  line — a malformed type is `INVALID`.
- **Every unregistered key in a `PARTIAL` vector is reserved**, so no future
  registration can contradict a frozen verdict. Both halves of the registry key
  are covered by their own reservation: unregistered **type names** use the `x_`
  prefix of EV-18 (008, 010, 011), and the one unregistered **version** uses the
  range EV-19 reserves (009). `009` deliberately does not use `genesis`: an
  unregistered `genesis` leaves a verifier unable to extract
  `operator_pk`/`registrar_pk` for Stage B at all, which is an open question a
  frozen fixture must not foreclose (`memory/OPEN-QUESTIONS.md`).
- **`023`–`028` carry payloads HA-7 cannot encode**, so they have no computable
  preimage. All six sit on registered types, so plain Stage A already condemns
  them; **`042` is the one that pins EV-16's distinctive clause** — the same
  failure on an *unregistered* type, where an implementation might reach for
  `PARTIAL` and must not, because EV-8's "integrity confirmed, semantics
  unchecked" does not hold when integrity is not confirmable.
- **The EV-17 assertion rule is now enforced by a test over the committed
  `index.json`**, not only by the `Expect` union at compile time — the follow-up
  the T5e entry below promised. `conformance.test.ts` also pins that every
  unregistered `(type, version)` in a `PARTIAL` vector is reserved under EV-18 or
  EV-19 — checked on the **full registry key**, since keying on the type name
  alone waves through exactly the `009` shape — that their line lists ascend, and
  that no vector anywhere freezes a verdict for an unregistered `genesis`
  version. The line scanner **fails closed**: a line it cannot read is a test
  failure, not a silent skip, because one EX-7 whitespace violation would
  otherwise make a line invisible to both checks.
- **README status line corrected** to say what the directory now holds. Prose
  only; no record-format change, no byte moved.

## fixtures/ — v1 — 2026-07-26 — T5e

- **`contracts/fixtures/` now exists.** The first 7 golden vectors, all `VALID`,
  plus `index.json`, `derivations.json`, the 607-octet hash preimage of vector
  001, `MANIFEST.sha256`, and a `README.md` documenting the record format. The
  README lives inside `fixtures/` deliberately — T7 may read only `contracts/`,
  so anything T7 needs has to be here. The `PARTIAL` and `INVALID` vectors follow
  in the next two slices; the record format they use is already fixed.
- **No spec text changed.** This is an addition under `contracts/`; every spec's
  `Version:` line is untouched and no existing byte moved.
- **Vector 001 is the calibration point.** It reproduces the `hashing.md` §6
  worked example verbatim — the one golden value in the set derived by hand
  before the generator existed. Its full 607-octet preimage is committed as
  `preimages/001-genesis-only.hex`, which §6.2 asks for, so an implementer can
  diff their own preimage against the spec's before ever reaching a digest.
- **Verdicts are declared, never computed.** The generator contains no verifier.
  One that computed its own expectations would encode this tool's reading of the
  spec, and T7 would then be checked against that instead of against the
  contract.
- **Vectors assert verdict token + line number(s) only** (EV-17). In this slice
  the shape is guaranteed at compile time by the `Expect` union, not by a test
  over the committed `index.json` — that test ships with the conformance slice.
  `cites` and `note` are advisory and MUST NOT be asserted.
- **Two constraints will be enforced by test when the vectors that need them
  land:** unregistered-type vectors must use the `x_` prefix EV-18 reserves, and
  no vector may carry a `genesis` at a version other than 1 — an unregistered
  `genesis` version leaves a verifier unable to extract
  `operator_pk`/`registrar_pk`, an open question a frozen fixture would
  foreclose.
- **Protection:** `contracts/fixtures/** -text` in `.gitattributes` stops git
  rewriting a line ending (vector `042-crlf`, arriving later, deliberately
  contains a CR), and `.github/scripts/fixtures-manifest.sh` verifies every
  recorded digest plus the absence of unlisted files. `contracts/fixtures/**` is
  exempt from `diff-size` for the same reason markdown is: generated artifacts
  reviewed by hand, not code competing for a line budget.
- **Deferred to the next slice, from the fresh-context review:** a second pinned
  preimage exercising the INTEGER payload tag. Vector 001's payload is entirely
  strings, so every entry in the one committed preimage carries the `s` tag
  (0x73) — a wrong `ENC_INT` or a swapped tag (HA-9) would surface only as a
  digest mismatch with no reference bytes to diff against. Deferred only because
  it pushed this slice past the 600-line ceiling, and it is safe to defer: adding
  a fixture is legal even post-freeze, unlike the other five findings, which
  corrected things that would otherwise have frozen wrong.
- **Reviewed by a fresh context: APPROVE WITH NITS**, no blocking findings. All
  six `[SHOULD]`s fixed pre-merge except the deferral above; two `[NIT]`s fixed.
  The reviewer independently reimplemented the preimage construction and Ed25519
  from the spec text and confirmed vector 001 byte for byte.

## README.md — n/a — 2026-07-25 — T4b (ADR-0007)

- **`contracts/` now has three states, not two:** DRAFTING → **RELEASE
  CANDIDATE** → FROZEN. Release candidate is entered when the T9 audit passes;
  Phase 1 may build against it; no tag exists, so `contracts-guard`'s freeze
  branch stays dormant and specs remain fixable. FROZEN still means exactly what
  it meant: the `contracts-v1` tag exists and `hashing.md` + `fixtures/` are
  permanently immutable.
- **The freeze is deferred and gated on operational experience**, not on T9
  approval alone. T5–T9 keep their schedule; only the tag waits. Rationale in
  ADR-0007: the irreversibility of the freeze argues for waiting, since the
  operator currently holds the least information he will ever hold about what
  events need to carry.
- **This unblocks a deadlock.** Three documents said no service code until
  `contracts/` is frozen, while the new freeze condition requires real votes —
  which require services. `contracts/README.md`, `memory/STATE.md` and
  `docs/implementation-plan.md` now say "until RELEASE CANDIDATE" instead.
- No spec file touched; no version bumps. `hashing.md` untouched.

## evolution.md · export-format.md · event-schema.md · event-types.md — v2 — 2026-07-25 — T4a

- **The verifier report surface, so T7 can be built from `contracts/` alone.**
  ADR-0006 deferred exit codes to "decided in T7", but that session may read only
  `contracts/`, its ticket, and charter §4 — it cannot see the ADR. The surface
  therefore has to live in a spec. `evolution.md` v2 adds:
  - **EV-15** — Stage A is *exactly* the checks that do not consult the type
    registry, enumerated exhaustively. EV-6's list was illustrative and omitted
    ES-12, ES-15–ES-17, ES-19, ES-26 and the whole `export-format.md` layer; the
    boundary is verdict-determining, so an incomplete list is a real ambiguity.
  - **EV-16** — a payload-shape failure (ES-15/ES-16/ES-17) is `INVALID` even on
    an *unregistered* type. HA-7 encodes only flat int/string values, so such an
    event has no computable preimage and EV-8's "integrity confirmed" rationale
    for `PARTIAL` does not hold.
  - **EV-17** — verdict precedence (INVALID > PARTIAL > VALID), 1-based line
    attribution, ascending `PARTIAL` line enumeration, exit codes 0/1/2 with ≥3
    reserved for tool errors, and **reason text as advisory only**. Conformance is
    judged on verdict token + line number alone; fixtures MUST NOT assert reason
    text or exit codes. This deliberately keeps the diagnostic vocabulary and the
    CLI surface revisable while the verdict itself is fixed — no reason-code
    registry is defined, and none is needed for T5/T7/T8.
  - **EV-18** — the `x_` type-name prefix is reserved permanently and may never be
    registered, so `PARTIAL` conformance vectors have a placeholder type that
    cannot later become real. Without it a frozen `PARTIAL` fixture is a time
    bomb: registering its placeholder for real would make a newer verifier
    contradict a vector `contracts-guard` has made uneditable.
- **Line attribution for whole-file failures** (`export-format.md` v2). EV-17
  requires every `INVALID` to name a line, and three failures had none: **EX-18**
  an empty export verified as a chain is `INVALID` at line 1 (EX-6 made it a
  well-formed *export* but never said what the verdict is); **EX-19** a `--head`
  mismatch is attributed to the last line; **EX-20** framing violations (CR,
  missing final LF, blank line, BOM) each get a defined line, with a
  lowest-consistent-line rule where framing makes boundaries ambiguous.
- **EV-9 cross-references land now, not at T9/T10** (`event-schema.md` ES-11,
  `event-types.md` new **ET-2a**). ADR-0006 made these a pre-freeze gate, but T7
  runs *before* the freeze review and is the session most likely to be misled by a
  flat "MUST reject". The sentences are unchanged in meaning and keep their
  numbers; each now points at EV-9.
- **Ticket text reconciled in the same PR**, per ADR-0006's explicit MUST. The
  T5 and T7 tickets in `docs/plans/phase-0.md` and the deliverable line in
  `.claude/agents/odc-verifier-builder.md` still described two verdicts, exit
  codes 0/1, and a required reason code. T7 reads its ticket **and**
  `contracts/` but cannot see the ADR that would arbitrate, so leaving them
  stale would have been worse than not touching `contracts/` at all: a verifier
  built to its ticket cannot emit `PARTIAL`, while T5 must ship `PARTIAL`
  fixtures — T8 would then fail on a documentation conflict, not a spec one.
- No `hashing.md` change, no renumbering of any existing sentence, no fixture
  change (`contracts/fixtures/` does not exist yet — T5 creates it).
- `contracts/` stays DRAFTING. Per the 2026-07-25 direction decision the freeze is
  now gated on operational experience, not only on T9 approval — T5–T9 proceed on
  schedule, the `contracts-v1` tag waits.

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
