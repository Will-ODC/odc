# Contracts Change Log

Every pull request that touches `contracts/**` MUST add an entry here, and any
touched **spec** file (`contracts/*.md` other than `README.md` and this file)
MUST also add or bump its own `Version:` line. The `contracts-guard` CI
workflow enforces both on every PR.

After the `contracts-v1` tag exists, `hashing.md` is immutable and `fixtures/`
is frozen under four rules, one per kind of file — golden data is add-only,
`index.json` may gain lines but never lose one, `MANIFEST.sha256` is regenerable
but not deletable, and `fixtures/README.md` is exempt (ADR-0008). All other
post-freeze changes stay additive-only, version-bumped, and logged here — never
retroactive.

Format (newest first, one entry per merged contracts change):

    ## <spec or scope> — <version> — <YYYY-MM-DD> — <PR>
    - what changed, and why (one or two lines)

---

## event-types.md v9 · event-schema.md v4 — 2026-08-20 — fork ancestry names a chain and a position (ADR-0019)

**A direct contradiction between two rules that both landed in #98.** ET-9e made
the optional `ancestor_head` carry "the **head** of the chain this one was forked
from", while ET-7a — seven lines apart in the same file — listed "a fork's
`ancestor_head`" among the places where **a chain must be named**, held that the
genesis hash is the name, and then held that a `head` does **not** name a chain
at all, because it names a position *on* one. Both readings are 64 lowercase hex
under a format-only check, so no verdict differs today and nothing failed; the
contradiction would simply have frozen. Found by the isolated TypeScript phase-2
verifier build, which had to decide what the value meant in order to implement it.

- **`ancestor_chain` added to the `genesis` payload (OPTIONAL, ET-9e)** — the
  parent chain's **genesis hash**, i.e. its identity under ET-7a. This is the key
  that **names** the parent; per ET-7a it is the only value that can.
- **`ancestor_head` retained (OPTIONAL, ET-9e)**, restated as what it actually is
  — the parent's **head at the fork** (EX-14), a **position on** the chain
  `ancestor_chain` names. It carries what the genesis hash cannot: a fork at
  `seq` 50 and a fork at `seq` 5000 are different claims about the same chain.
  Both keys keep the old format rule — `^[0-9a-f]{64}$`, the 64-zero anchor
  barred — and omitting **both** remains the one way to say "no ancestor".
- **`ET-9f` added: `ancestor_head` MUST NOT appear without `ancestor_chain`**;
  that form is `INVALID` at the `genesis` line. One key-presence test — no key
  material, no decoding, no hashing. **`ancestor_chain` MAY appear alone**, and
  that asymmetry is deliberate and stated in the rule so nobody later tidies it
  into both-or-neither: chain-alone is the weaker but coherent "forked from chain
  X, fork point unrecorded", while head-alone is a position on an unnamed chain —
  precisely the head-alone anchoring charter §4 rejects. Two faults on one line
  need no precedence: conformance is the verdict token and the line number only
  (EV-17).
- **The derivation is carried in the spec text, not only here.** Charter §8 grants
  the fork right as "re-declare genesis **anchored** to the old chain's head", and
  charter §4 defines an anchoring record as a chain's identity and its head
  published **together** — "both halves are load-bearing", because a head alone
  lets an operator run two chains and anchor only one. A fork's `genesis` **is**
  an anchoring record for its parent: a hash-committed fact about that chain at
  `seq` 1, where the parent's operator cannot rewrite it. The isolated verifier
  contexts are stripped of `docs/decisions/`, so ET-9e/ET-9f must be
  self-sufficient from `contracts/` alone; the ADR citations are provenance only.
- **Why two keys rather than one composite value.** A 128-hex concatenation is
  shape-identical to `sig` (ET-4) and tells a reader nothing about where one half
  ends. A delimited form would be the contract's **only** structured payload
  string, and would need its own normative text for the separator, the ordering,
  the empty-half case and case-folding — an unspecified field inside a field,
  which is the exact workaround ADR-0016 itself rejected when it declined to
  smuggle the head into the `contracts` string. Two keys reuse machinery that
  already exists: ES-18's key set, ES-34's optionality, HA-7's key count and
  HA-8's ordering.
- **`ES-34` extended** (`event-schema.md` v3 → v4). Its closing paragraph said v1
  defines exactly one optional key. It now defines two, both on `genesis`, and
  their presence is **not independent**. ES-34 now records the general shape: a
  type's payload table fixes **which** keys are optional, and that type's own
  numbered rules MAY further constrain **when** an optional key may appear — and
  such a conditional-presence rule MUST be a numbered RFC-2119 sentence in
  `event-types.md`, never a table row alone (the mistake that produced ET-9b).
- **The permanent claim is restated, not weakened.** "The only key `genesis` will
  ever gain" was a count; the real bar is the **tag**: ET-6 pins
  `genesis.version` at `1` and EV-1 bars altering a frozen `(type, version)`, so
  **nothing may be added to `genesis` after the tag**. No tag exists —
  `contracts/` is still DRAFTING (ADR-0007) — which is why this correction is
  addable at all, and it is the last kind of correction that will be.
- **No existing bytes move.** Neither key appears in any current vector, so every
  vector's payload, `hash`, verdict and line number is unchanged; confirmed by
  running the fixture suite. No hashing rule changes: HA-7 already encodes exactly
  the keys present and leads with the key count `U64(k)`, and HA-8 orders them by
  UTF-8 bytes, under which `ancestor_chain` sorts first and `ancestor_head`
  second, ahead of `chain_id`. `hashing.md`, `evolution.md`, `export-format.md`,
  `ids.md`, `read-api.md` and `contracts/README.md` need no change; ES-18 already
  delegates optionality to ES-34 and needs none either.
- **Owed fixtures (EV-5), not written in this pass** — these supersede ADR-0016's
  owed list for F4: a `genesis` with **both** keys well-formed (`VALID` — the
  first seven-key genesis payload, exercising HA-7's count and HA-8's ordering);
  `ancestor_chain` **alone** (`VALID` — the vector that pins the deliberate
  asymmetry against a future both-or-neither "tidy"); `ancestor_head` **alone**
  (`INVALID` line 1, ET-9f); either key = the 64-zero anchor (`INVALID` line 1);
  either key malformed — uppercase hex or wrong length (`INVALID` line 1); and a
  well-formed pair naming a chain **absent from the fixture set** (`VALID` —
  pinning that unresolvability is not a defect, the vector that stops a future
  verifier trying to resolve it).
- **Owed verifier work (both verifiers, isolated passes):** accept both optional
  keys, check each one's format, enforce ET-9f's presence rule, resolve nothing.

## fixtures/ — 2026-08-15 — phase 1 review follow-up: `005-boundaries` cites ET-24

**Metadata only. No vector's bytes, verdict or line changed** — re-verified
against the previous corpus across all 83.

`005-boundaries` now cites **ET-24** alongside ET-14/ET-14a/ET-18a, and its note
records why: its two ballots on the short issue deliberately share one batch
instant, so that issue forms a single batch and is exempt under ET-24's
last-batch clause. Without that written down, the shared instant reads like an
accident, and a later author "tidying" the two ballots back onto separate minutes
would turn a VALID vector INVALID at line 5 — for a batching rule the vector was
never meant to be about. Raised by the phase-1 review.

## fixtures/ — 2026-08-15 — T9 fixture phase 1: ET-14b regeneration

**No spec text changed; no `Version:` line moves.** This is the golden corpus
catching up to `event-types.md` v8. ET-14b made
`ballot_batch_interval_ms` and `ballot_batch_min` required on `issue_created`, so
the **54 vectors carrying one** were no longer conforming. All 83 were
regenerated, keeping the set internally consistent.

- **Verdicts and line numbers are unchanged across all 83** — verified by diffing
  every `id / verdict / line / lines` against the previous corpus. Bytes, hashes
  and the two `head` inputs (`003`, `053`) moved; **nothing about what a vector
  asserts moved.** A regeneration that shifted a verdict would be silently
  rewriting what the suite tests, so this is the property the phase rests on.
- Defaults are the ET-14b floors, `60000` / `3`, and both were forced rather than
  convenient: ballots are minted on whole-minute boundaries, so any coarser
  interval would leave existing ballots non-quantized under ET-23 and flip VALID
  vectors to INVALID.
- **`005-boundaries` needed a real change, not a re-stamp.** Its two ballots sat
  on one issue at different minutes — under ET-24 that is two batches of one, the
  earlier under-size and not last, making a vector declared VALID actually
  INVALID. Both ballots now share a batch instant, so the issue has a single
  batch and ET-24's last-batch exemption applies. **The verdict was preserved by
  making the bytes conform, never by adjusting the expectation.**
- **`057-issue-sig-wrong-key`'s note is corrected.** It asserted the old ET-9a
  "separation is policy, not verifier-enforced" claim, which ADR-0018 reversed.
  Verdict untouched, prose was false, and fixture notes are immutable once tagged
  (ADR-0008) — so this was the last cheap moment. The same stale claim in the
  generator's module header went with it.
- Both verifiers were brought to ET-14b conformance in **separate isolated
  contexts**, neither able to read the other. `MANIFEST.sha256` regenerated.

**Owed and deliberately still open:** every one of the 55 `issue_created`
payloads declares exactly the floor values, so **no vector discriminates the
floor check** — a verifier that accepted the keys and skipped the floors passes
all 83 today. Both isolated verifier builds reported this independently, which is
the arrangement working as intended. The below-floor vectors listed under the
ADR-0014 subsection below close it.

## event-types.md v8 · evolution.md v4 · export-format.md v3 · event-schema.md v3 — 2026-08-15 — T9a: the six blocking T9 findings (ADR-0013–ADR-0018)

The operator's decisions on **F1–F6** of `docs/security/audit-phase-0.md`, one
ADR per finding. All six are pre-freeze tightenings: each is either unavailable
after the tag (ES-18/ET-6 close the `genesis` key set; EV-1/EV-4 bar retroactive
constraints) or shapes the ledger write path that Phase 1 builds first. **No
fixtures are written in this pass** — each subsection lists what it owes under
EV-5, and both verifiers are untouched by design.

### F1 — chain identity is the `genesis` hash (ADR-0013)

- **`ET-7` rewritten and `ET-7a` added** (`event-types.md` v7 → v8). ET-7 claimed
  `chain_id` "binds the chain's identity to its operator key with no free
  parameter"; that was **false as written** — it binds the _operator's_ identity,
  and every chain one operator starts carries the same `chain_id`. The audit built
  two chains with opposite outcomes, identical `chain_id`, both `VALID` under both
  verifiers. ET-7a states the identity: **the `hash` of the `genesis` event**. The
  payload table's "the chain's stable identifier" is corrected the same way. The
  derivation itself is unchanged — no byte, hash or existing verdict moves.
- **`EX-21`–`EX-24` added** (`export-format.md` v2 → v3, new §6): the genesis hash
  as defined on an export (EX-21); the optional `--chain <genesis-hash>` input,
  independent of `--head` (EX-22); its mismatch is `INVALID` at **line 1**,
  mirroring EX-19 (EX-23); and a verifier **MUST report the genesis hash and the
  head it computed on every run** (EX-24) — output only, deliberately not
  fixture-asserted per EV-17, because a tool that answers only `VALID` answers
  "is _some_ chain valid".
- **No new `genesis` field.** The `genesis_nonce` option was rejected: the genesis
  hash is already unique per chain and costs no schema change, and the one genesis
  change available before the freeze is spent on `ancestor_head` (ADR-0016).
- **Owed fixtures:** a `--chain` match (`VALID`) and mismatch (`INVALID` line 1)
  vector; and the two-chain pair under one operator key differing only in
  `genesis.ts` — both `VALID` unflagged, each `INVALID` under the other's
  `--chain`. **Owed verifier work (both verifiers, isolated passes):** the
  `--chain` flag, the line-1 mismatch verdict, and EX-24 reporting.

### F2 — ballot batching, with governable parameters (ADR-0014)

- **`ET-23`, `ET-24`, `ET-25` added** (`event-types.md`, new "Ballot publication
  discipline" subsection). A ballot's `ts` MUST be an exact multiple of its
  issue's declared batch interval (ET-23, epoch-ms on the proleptic Gregorian
  calendar, no leap seconds); a **batch** — the ballots sharing one `issue_id` and
  one `ts` — MUST hold at least the issue's declared minimum, except the batch
  holding that issue's highest-`seq` ballot (ET-24); and a batch's internal order
  MUST NOT be arrival order (ET-25). ET-24 pins the **blamed line**: an under-size
  batch is a violation only at the first later ballot of the same issue, which is
  where a verifier reports it. Without that sentence two verifiers agree the chain
  is bad and disagree about where.
- **`ET-14b` added and the `issue_created` table gains two required keys** —
  `ballot_batch_interval_ms` and `ballot_batch_min` — so the parameters live **on
  the log** and are votable per issue. The contract floors them permanently at
  **60000 ms** and **3**; without a floor an operator declares `1` and `1` and the
  mechanism is decorative while staying conformant. Permanent: the mechanism and
  *that a floor exists*. Provisional: the numbers, and the per-issue values above
  them — the same cut ET-14a draws for `choice_count`. Reasoning for both floor
  values is in ADR-0014. Adding keys to `issue_created` is legal now because only
  `genesis` is version-pinned (ET-6); after the freeze this would need an
  `issue_created` **v2**.
- **`ET-21`'s residuals rewritten.** ET-21 is correct about what it claims (the
  voter retains no artifact) and was incomplete about what receipt-freeness
  requires (the *coercer* must be unable to check). Timing correlation is now
  named as the residual ET-23–ET-25 address, and two residuals they do **not**
  close are named too: the registrar's 64 chosen signature bytes, and
  public-plane/ballot adjacency in `seq`.
- **`ES-21` amended** (`event-schema.md` v2 → v3): `ts` still MUST NOT order or
  select anything, but ET-23 constrains its **value**, which ES-21's old blanket
  wording forbade. **`EV-15` amended** (`evolution.md` v3 → v4): ET-25 is a
  producer obligation no verifier can check, so it belongs to neither stage; the
  boundary statements ET-20–ET-22 are placed outside the split for the same
  reason, correcting an exhaustiveness claim that swept them into Stage B.
- **Quorum is explicitly NOT this change.** A minimum turnout is an
  `issue_created` v2 concern; small-turnout exposure is arithmetic on the tally,
  not timing, and no batching rule touches it. ET-14b carries an informative note
  saying so, so a reader of `contracts/` alone cannot mistake one for the other.
- **Owed fixtures — the largest cost in this pass.** Two new required keys change
  `issue_created`'s bytes, hence its `hash`, hence every `prev_hash` after it:
  **54 of 83 vectors carry an `issue_created`** and must be regenerated together
  with `index.json`, `MANIFEST.sha256` and the `002-four-types-seq3.hex` preimage.
  No verdict should move, and the regeneration must assert that. `hashing.md` is
  untouched (its §6 worked example is a `genesis`). New vectors owed:
  non-quantized ballot `ts`; an under-size batch proven by a later ballot (pins
  ET-24's line attribution, so it needs a legal batch first); a legal under-size
  **final** batch; a below-floor interval and a below-floor minimum, one each; and
  a multi-batch `VALID` chain. **ET-25 gets no fixture, by construction.**

### F3 — an unregistered `genesis` version is `INVALID` at line 1 (ADR-0015)

- **`EV-20` added** (`evolution.md` v3 → v4, new §5). A chain's `genesis` MUST
  carry a `(type, version)` the verifier registers; a chain whose first line does
  not is **`INVALID` at line 1**. This is the **sole exception to EV-8** and a
  **Stage A promotion for `genesis` alone**, justified because `genesis` is the
  only event whose payload a verifier must read to check any other event — its
  payload holds `operator_pk`/`registrar_pk` (ET-9a) and reading it is itself
  Stage B. Without EV-20 a verifier could walk such a chain to `PARTIAL`
  ("integrity confirmed, some semantics unchecked") over a chain on which
  **nothing was ever authenticated**. Both current verifiers reach `INVALID` at
  line **2** by convergent reasoning that no sentence assigns — the divergence
  class ADR-0011 exists to eliminate.
- **`EV-21` added.** Guidance, not conformance (reason text is advisory per
  T4a/EV-17): a verifier SHOULD distinguish "this verifier may be out of date for
  this chain" from "this chain's genesis is corrupt", state that from the log
  alone the two are indistinguishable, and name the version it met and the
  versions it registers. Same verdict, honest explanation. Writing it as a MUST
  would have created by accident the reason-code registry EV-17 refused.
- **`EV-8`, `EV-15` and `ET-2a` reconciled** with the new exception: EV-8 gains
  the carve-out clause, EV-15's exhaustive stage split records that ES-9/ES-11 are
  Stage A at line 1, and ET-2a points a reader arriving from the type registry at
  EV-20 (the treatment EV-9 got in T4a).
- **Owed fixture:** a `genesis` at version **1000000** (EV-19's reserved value —
  EV-18's `x_` prefix cannot express this case, the type name must stay
  `genesis`), followed by a registered-version event, pinning `INVALID` at line 1.
  **And an owed guard inversion:** `tools/fixtures-gen/test/conformance.test.ts`
  currently asserts that *no* vector freezes a verdict here — written while the
  question was open, and now the thing that would block the fixture answering it.
  It must be replaced by its inverse, not deleted.

### F4 — an optional `ancestor_head` on `genesis` (ADR-0016)

- **`ET-9e` added and the `genesis` payload table gains `ancestor_head`**
  (OPTIONAL). It carries the head of the chain this one forked from, so charter
  §8's fork-and-exit **right** — "re-declare genesis anchored to the old chain's
  head" — is expressible in the contract, which it was not. That was the audit's
  one outright charter violation, and it was unaddable after the tag: ES-24 fixes
  `prev_hash` at seq 1, ES-18 closes the key set, ET-6 pins `genesis.version` at 1
  and EV-1 bars altering a frozen schema.
- **Format decisions.** 64 lowercase hex, or **absent**. The 64-zero anchor is
  **barred** as a value: two ways to say "no ancestor" would be two byte forms of
  one meaning (D5), and it would give the 64-zero string a second meaning
  alongside `prev_hash`'s anchor. A fork's own `seq` is still 1 and its
  `prev_hash` still 64 zeros — a fork is a **new chain with a new identity**
  (ET-7a), not a continuation.
- **A recorded claim, not a verified link.** A verifier checks format and nothing
  else, and ET-9e states as a MUST NOT that it reject or flag a value it cannot
  resolve: the ancestor is a different export the verifier does not hold, so
  otherwise the same chain would verify differently in two readers' hands. A
  reader holding both exports settles it in one comparison — a reader's act,
  outside this contract.
- **`ES-34` added** (`event-schema.md`, new §11): v1 had no notion of an optional
  payload key. Present with a legal value, or entirely absent; never `null`
  (ES-3), never a placeholder for absence. `hashing.md` is untouched — HA-7
  already encodes exactly the keys present, leading with `U64(k)` — and ES-18
  gains the cross-reference. Stating "optional" only in a payload table would have
  repeated the mistake that produced ET-9b.
- **This is the only key ever added to `genesis`; the door does not reopen.**
  ADR-0013 deliberately solved chain identity without spending it.
- **Owed fixtures:** a `genesis` **with** a well-formed `ancestor_head` (`VALID`
  — also the first six-key genesis payload, exercising HA-7's count and HA-8's
  ordering, since `ancestor_head` sorts first); `ancestor_head` = 64 zeros
  (`INVALID` line 1); a malformed `ancestor_head` (`INVALID` line 1); and one
  naming a chain **absent from the fixture set** (`VALID` — pinning that
  unresolvability is not a defect, which is the vector that stops a future
  verifier trying to resolve it). No existing vector's bytes or verdict move.

### F5 — the sentiment plane is permanently barred from this chain (ADR-0017)

- **`EV-22` added** (`evolution.md`, new §6), in the permanent register of ET-22
  and EV-13 and surviving any future community vote (charter §8). No contracts
  version may register here an event type whose payload carries a **response** —
  sentiment, survey, poll, rating, or any opt-in monetizable answer, or any value
  from which one can be recovered with material held outside this log. Four
  documents said the planes are separate; `evolution.md`, the rulebook that
  decides what may be added, did not, so a future `sentiment_response` was legal
  and would have shared the store, the export, the endpoint and the seq space with
  ballots through conforming additive evolution.
- **What stays permitted, stated in the same rule**, because the sentiment
  service "commits only anonymous hashes to `ledger`" by design: a value is
  admissible when it is (1) a **commitment** — a one-way digest over material held
  in the sentiment store; (2) **aggregate, never per-respondent** — one per
  instrument, batch or snapshot; and (3) free of any respondent identifier. Clause
  (2) is load-bearing: a digest of a single answer over a small answer space is
  invertible by enumeration, so a per-response commitment is a response in
  disguise. Values describing the commitment (instrument, time, count, licence
  event) are permitted — facts about the instrument, not answers.
- **Directional by design.** It blocks sentiment content reaching the ballot
  plane, the direction in which protection is lost. It does not try to stop a
  sentiment-shaped question run *as a ballot*, which gains ballot protection
  rather than losing it; the contract cannot tell "should we fund Y?" from "do you
  like Y?" and should not try (charter §9 makes that moderation, and a rule
  attempting it would collide with P3).
- **Owed fixtures: effectively none, deliberately.** EV-22 binds the authors of
  future contracts versions, not any v1 verifier — a barred type would be
  unregistered and reach `PARTIAL` on its own merits, which has nothing to do with
  this rule. The fixture pass should instead record EV-22 as **deliberately
  unpinned, with the reason**, in the rule-to-vector coverage report. (This is a
  live instance of the open question about narrowing EV-5 to byte-changing
  changes.)

### F6 — `registrar_pk` MUST differ from `operator_pk` (ADR-0018)

- **`ET-9d` added and `ET-9a` amended** (`event-types.md`). ET-9a said "the
  contract imposes no relation between `registrar_pk` and `operator_pk` … this
  separation is policy, not verifier-enforced"; that sentence is gone. A `genesis`
  declaring the same key twice is now `INVALID` at the genesis line — one string
  comparison on the two 64-hex values after ET-9b, no decoding, no curve
  arithmetic. A chain declaring one key twice hands one holder the power to mint
  issues **and** forge every ballot on them, with `VALID` reported and nothing on
  the line to signal it.
- **Necessary, not sufficient, and ET-9d says so.** Two distinct keys can still be
  held by one party and the log cannot tell; ET-9d blocks only the blatant,
  declared collapse. Custody stays policy (ET-9a; charter §10 v1). This spec
  adopts necessary-not-sufficient checks on exactly this reasoning elsewhere
  (ET-9b, ET-4b).
- **Timing is the whole reason it is blocking.** Adding this MUST after the tag
  would retroactively condemn chains that were conforming when written, which EV-1
  and EV-4 bar. It is not merely cheaper now — it is unavailable later.
- **Owed fixture:** a `genesis` declaring one key in both roles, otherwise
  entirely well-formed and correctly self-signed under it, with no `vote_cast` on
  the chain, pinning `INVALID` at line 1. It must be clean in every other respect
  or it pins ET-9b or ET-8 instead. **No existing vector changes verdict** — all
  83 were checked, none declares the two keys equal (the corpus uses the
  `hashing.md` §6 seeds `0x01…`/`0x02…`).
- **One existing fixture `note` is now false.** `index.json` vector
  `057-issue-sig-wrong-key` states that ET-9a means "a verifier MUST NOT reject a
  chain merely because `operator_pk` and `registrar_pk` coincide". ET-9d reverses
  that. The vector's **verdict is unaffected** (it fails ET-13, and its genesis
  declares distinct keys) — only the prose is wrong, and it must be corrected in
  the fixture pass, before the tag makes `note` prose immutable (ADR-0008).

## fixtures/ README v11 — 2026-08-09 — record fixture 083 (ET-9c) and the new count

- Doc-only: `contracts/fixtures/README.md` v10 → **v11**. Updates the count to
  **83 vectors (10 VALID, 4 PARTIAL, 69 INVALID)** and the appended range to
  `071`–`083`, and adds a paragraph for `083-genesis-registrar-pk-smallorder`
  (ET-9c / ADR-0011 — the `registrar_pk` genesis-timing vector) alongside the
  081/082 ET-4c description. No vector bytes, `index.json`, or `MANIFEST` change;
  this is the prose reconciliation the ET-9c change (v7, previous entry) should
  have carried.

## event-types.md v7 — 2026-08-09 — registrar_pk key-validation timing at genesis (ADR-0011)

- **`ET-9c` added** to `event-types.md` (v6 → v7): the canonical-encoding check
  ET-4b and the prime-order check ET-4c apply to `operator_pk` and `registrar_pk`
  **at the `genesis` line where each is declared** (ET-9a), not deferred to a
  key's first use to verify a signature (`registrar_pk` first used at `vote_cast`,
  ET-17). A `genesis` whose `registrar_pk` is non-canonical (ET-4b) or small/
  mixed-order (ET-4c) is `INVALID` at the genesis line on **any** chain, including
  one with no `vote_cast`. Resolves the one `registrar_pk`-timing divergence the
  fresh-context T7 review surfaced (`memory/OPEN-QUESTIONS.md`): without this, a
  verifier could defer the checks and report a different verdict — or the same
  verdict at a different line — than a conforming peer, the sole point they could
  diverge by construction.
- The ET-4b and ET-4c parentheticals for `registrar_pk`, the rule-index, and the
  acid-test walkthrough were updated to point at ET-9c. Recorded in **ADR-0011**.
- **Fixture `083-genesis-registrar-pk-smallorder`** (INVALID at line 1) pins it: a
  well-formed operator-self-signed `genesis` whose `registrar_pk` is the canonical
  identity encoding (small-order), on a chain with no `vote_cast`. Reuses `081`'s
  small-order key; 82 → **83 vectors** (VALID 10, PARTIAL 4, INVALID 69). Verdict
  is DECLARED, per Option A of the divergence analysis; the Go verifier (T7) is
  brought into conformance separately (it currently defers, so it would report
  VALID here — a queued follow-up, surfaced at the T8 rehearsal).

## event-types.md v6 · fixtures/ README v10 — 2026-08-08 — Ed25519 prime-order verification keys (ADR-0010)

- **`ET-4c` added** to `event-types.md` (v5 → v6): a verifier MUST reject any
  verification key not in the Ed25519 **prime-order subgroup** — on the point `A`
  decoded from the already-canonical encoding (after ET-4a/ET-4b), **`[L]A == 𝒪`
  (identity) AND `A != 𝒪`** (equivalently `[L]A == 𝒪 AND [8]A != 𝒪`). This rejects
  all small-order keys (including the identity `0100…00`) and all mixed-order
  keys, for the same three keys ET-4b covers — `operator_pk`/`registrar_pk`
  (ET-8/ET-13/ET-17) and `participant_registered.pubkey` (ET-10). ET-4c runs
  **after** ET-4a/ET-4b (on the canonical point) and is **additional** to ET-4b:
  a canonically-encoded mixed-order key passes ET-4b and is caught only here. It
  is also additional to ET-5: a small-order/mixed-order key can carry a `sig` that
  **verifies** under it, so a verifier omitting ET-4c wrongly accepts. **This
  REVERSES ADR-0009's prime-order exclusion** (ADR-0009 is now superseded in part;
  its ET-4a/ET-4b canonical-encoding decision stands). The ET-4b informative note,
  rule-index and acid-test were updated to match.
- **Load-bearing caveat (measured).** ET-4c is worded `[L]A == 𝒪 AND A != 𝒪`,
  **not** bare "torsion-free": `@noble/curves`' `isTorsionFree()` returns **true**
  for the identity key, which ET-4c must reject. A noble-based verifier satisfies
  ET-4c with `A.isTorsionFree() && !A.is0()`, a `filippo.io/edwards25519`-based one
  with `[L]A == 𝒪 && A != 𝒪`; these compute the identical decision on every
  measured point only with the explicit non-identity clause.
- **Measurement basis (empirical, GO).** Using the two audited curve libraries
  the spec now allows one-of per verifier — `filippo.io/edwards25519 v1.2.0` (Go)
  and `@noble/curves` `ed25519` (TS): the two AGREE on the prime-order predicate
  for all 11 points tested (normal key → accept; all 8 small-order torsion points
  → reject; 2 mixed-order points → reject), 5/5 runs; the derived torsion set
  matched noble's shipped `ED25519_TORSION_SUBGROUP` constant. Both isolating
  fixtures verify in **both** Go `crypto/ed25519` and Node `node:crypto` (so ET-10
  passes and they isolate ET-4c alone). ET-4c is exact curve arithmetic (not
  RFC-8032-underdetermined), so it is more version-stable than ET-4a/ET-4b — but
  it needs curve scalar multiplication outside both stdlibs, so the T7/T7b
  **stdlib-only constraint is relaxed to permit one named audited curve library
  used ONLY for the ET-4c check** (`filippo.io/edwards25519` for Go,
  `@noble/curves` for TS). The result is version-bound; the T10 re-audit
  re-measures.
- **Two vectors, `081`/`082`** (`INVALID` at line 2; `INVALID` 66 → 68, total
  80 → 82), each isolating ET-4c and each **DISCRIMINATING** today (a verifier
  omitting ET-4c reports `VALID`). `081-smallorder-key` is a `participant_registered`
  whose `pubkey` is the canonical identity `0100…00` with the degenerate identity
  self-sig `R = 0100…00`, `S = 0`; canonical (ET-4a/ET-4b pass), 64 lowercase hex
  (ID-3), self-sig verifies in both libraries (ET-10). `082-mixedorder-key` carries
  a canonically-encoded MIXED-order `pubkey` `A = P + T` (T order-8 torsion),
  self-signed honestly under `P` with the nonce ground so `k ≡ 0 (mod 8)` (then
  `[k]T = 𝒪`, so the signature verifies under `A`); it additionally distinguishes
  a full prime-order check from a small-order-blocklist-only verifier, which a
  small-order fixture cannot. Isolation was confirmed by feeding each committed
  line-2 signing preimage through **both** Go `crypto/ed25519` and Node
  `node:crypto` (both verify), and by a from-spec reimplementation of ET-4a/ET-4b
  plus an ET-4c curve check in `test/canonical-ed25519.test.ts` (each vector fails
  exactly ET-4c and passes ET-4a/ET-4b/ID-3/ET-10). The `082` construction is
  **deterministic** (fixed seed for `s` and the nonce grind), verified by
  regenerating twice with byte-identical output. Built via the existing `custom(…)`
  mechanism plus a new `signRaw` generator option for the crafted mixed-order
  signature (the `sigTransform`/`custom` lineage of the ET-4a/ET-4b work); the
  generator gains `@noble/curves` as a devDependency (build tooling only — never
  shipped, and not the stdlib-constrained verifier).
- **Documents reconciled:** `docs/decisions/0009-*` gains a "Superseded in part by
  ADR-0010" note (its ET-4a/ET-4b decision stands). `docs/plans/phase-0.md` T7/T7b
  relaxed to permit the one audited curve library for ET-4c only, with the stale
  "75 vectors"/"75 declared fixture verdicts" counts corrected. `memory/OPEN-QUESTIONS.md`'s
  DECIDED Ed25519 stub updated from prime-order EXCLUDED to REQUIRED. `memory/STATE.md`
  is intentionally **not** touched (post-merge protocol). No other document
  outside `contracts/` stated the exclusion.

## event-types.md v5 · fixtures/ README v9 — 2026-08-08 — Ed25519 canonical-encoding predicate (ADR-0009)

- **`ET-4a` and `ET-4b` added** to `event-types.md` (v4 → v5), pinning the
  Ed25519 verification predicate at the **encoding** level, checked on the raw
  decoded bytes **before** the verify primitive (ET-5) and rejected, never
  reduced or repaired (D5). Three MUST checks: **(ET-4a)** the `sig`'s trailing
  32 bytes (`S`) little-endian MUST be `< L` (`L = 2^252 + 27742317777372353535851937790883648493`),
  and the leading 32 bytes (`R`) with bit 255 masked MUST be `< p`
  (`p = 2^255 − 19`); **(ET-4b)** every verification key `A` — `operator_pk`,
  `registrar_pk` (ET-8/ET-13/ET-17), and `participant_registered.pubkey` (ET-10)
  — with bit 255 masked MUST be `< p`. This makes RFC 8032's underdetermination
  **unreachable** for both the Go (T7) and TypeScript (T7b) stdlib-only verifiers
  (same move as ET-14a capping `choice_count`). The new checks are **additional**
  to the hex-format rules of ES-31/ET-9b/ID-3: a canonical hex string can still
  decode to a non-canonical point encoding, so hex-format is necessary but not
  sufficient. An **informative** note records that the assumed predicate is
  **cofactorless** (`[S]B == R + [k]A`, satisfied by both reference stdlibs) and
  that a full prime-order subgroup check is **deliberately excluded** in v1.
- **Measurement basis (empirical, not reasoned).** Go 1.24.7 and Node 22.22.2 /
  OpenSSL 3, both installed in the session container, were fed the constructed
  edge cases the fixtures rest on plus the ed25519-speccheck classes. The two
  libraries returned the **identical accept/reject verdict on every input** across
  non-canonical `S`, non-canonical `R`, non-canonical `A`, small-order `A`,
  small-order `R`, and the cofactor discriminator. The one case where both
  **proceed to verify and accept** is a non-canonical verification key `A` (the
  identity point `y = 1 + p` with a degenerate self-signature) — the case fixture
  `078` exercises and the only one where the encoding checks change a verdict on
  current libraries. `S ≥ L` and non-canonical `R` are already rejected by both
  primitives, so `079`/`080` are non-discriminating today.
- **Prime-order exclusion (rationale).** A full prime-order check
  (`[L]A == 𝒪 ∧ [8]A ≠ 𝒪`) (a) closes **no measured divergence** — the two
  libraries never disagree on current versions — and (b) requires curve scalar
  multiplication that is **not** in either language's standard library,
  conflicting with T7/T7b's stdlib-only constraint. The canonical-encoding checks
  1–3 are cheap stdlib integer comparisons and are kept as defense-in-depth
  against future library drift (RFC 8032 is underdetermined and the wider
  ecosystem does split on these inputs). The result is **version-bound**; the T10
  re-audit MUST re-measure. A prime-order check stays additively addable
  pre-freeze if the operator later wants it.
- **Three vectors, `078`/`079`/`080`** (`INVALID` 63 → 66, total 77 → 80), each
  isolating one rule (T5j-style). `078-noncanonical-a` (`INVALID` line 2, ET-4b)
  is the discriminating vector: its degenerate self-sig **verifies** in both
  libraries, so ET-10 passes and only ET-4b rejects — a verifier lacking ET-4b
  wrongly accepts. `079-noncanonical-s` (`S + L`) and `080-noncanonical-r`
  (non-canonical `R`) recompute the `hash` over the mutated `sig` to isolate the
  encoding fault; both are non-discriminating on current libraries and pin the
  verdict against drift. Isolation was confirmed by feeding each committed line-2
  event's signing preimage through **both** Go and Node: `078` verifies in both,
  `079`/`080` verify in neither, and a from-spec reimplementation of the three
  checks (in `test/canonical-ed25519.test.ts`) fails exactly one check per vector
  over the committed bytes. Built via a minimal `custom(...)` + `sigTransform`
  option on the generator (the `059`/`076` mechanism), not by hand.
- **Documents reconciled:** `memory/OPEN-QUESTIONS.md`'s live ⚠️ Ed25519 entry is
  converted to a DECIDED stub pointing at ADR-0009 and ET-4a/ET-4b.
  `memory/STATE.md` is intentionally **not** touched (it updates post-merge on its
  own PR). No other document outside `contracts/` stated the predicate.

## event-types.md v4 · hashing.md v2 · fixtures/ README v8 — 2026-08-07 — T5j (ET-9b + HA-9)

- **`ET-9b` added** to `event-types.md` (v3 → v4). `genesis`'s `operator_pk` and
  `registrar_pk` were pinned to `^[0-9a-f]{64}$` **only in the payload table**,
  cited by no numbered sentence — the sole-source case `CONTRACTS-CHANGE.md`
  (T5i) named and `OPEN-QUESTIONS.md` tracked. ET-9b gives that constraint a
  numbered home, worded to mirror `ids.md` ID-3 (32-byte raw Ed25519 key as 64
  lowercase hex, rejected and never lowercased to conform, D5). It states the
  check is **distinct from ET-7/ET-8**: an uppercase key decodes to the same 32
  bytes, so `chain_id` still derives and the self-signature still verifies — a
  verifier omitting the format check has no other signal on the line. No byte,
  preimage or existing verdict changes; nothing regenerates from the sentence.
  **Deadline:** `evolution.md` EV-1 forbids altering a frozen `(type, version)`
  schema, so ET-9b is **unaddable after the `contracts-v1` tag** — it had to land
  pre-freeze, and before T7 so the Go verifier is built against it.
- **Two vectors, `076`/`077`** (`INVALID` at line 1; `INVALID` 61 → 63, total
  75 → 77). Each is a `genesis` carrying an uppercase `operator_pk` (`076`) or
  `registrar_pk` (`077`); every other property is valid, so the case is the only
  fault. Built with the `custom("genesis", …)` mechanism of `059`: the payload
  holds the uppercase string (so `hash` covers it and matches) while `chainId()`
  derives from the decoded lowercase key. `test/genesis-keys.test.ts` asserts, over
  the committed bytes, that `hash`, signature and `chain_id` all verify — so the
  vector isolates ET-9b alone. Appended after `075` (ids never change), a pure
  insertion into `index.json`.
- **HA-9's worked example corrected** in `hashing.md` (v1 → v2). HA-9 claimed the
  1-octet type tag is load-bearing "because integer `1` and string `"1"` encode
  to different bytes" — but those differ by **length** (`ENC_INT(1)` is 8 octets,
  `ENC_STR("1")` is 9), so they separate with no tag at all and the example proved
  nothing about the tag. The case that does is **integer `0` vs string `""`**:
  both are the 8 octets `00…00`, byte-identical, so **only the tag** distinguishes
  them. Verified empirically. Changes no byte, digest or fixture — but `hashing.md`
  is immutable once tagged, so it had to land pre-freeze.
- **Scope note: the Ed25519 verification-predicate decision is deliberately NOT
  in this PR.** `memory/OPEN-QUESTIONS.md` scoped it "before or inside T5j"; it is
  kept as its own ticket because it is empirical (measure Go vs Node, then prefer
  making the divergence unreachable) and permanent, and bundling it would produce
  an oversized contracts change. The ⚠️ OPEN-QUESTIONS item stays OPEN and still
  gates T7 — **the pre-T7 Ed25519 gate is not cleared by this merge.**

## fixtures/ — README v7 — 2026-08-02 — T5 follow-up, ET-14's control-character clause

- **Two vectors added, 73 → 75** (`VALID` 9 → 10, `INVALID` 60 → 61). No
  existing vector's bytes, id or declared verdict changes; `074`/`075` are
  appended, per the ids-never-change rule in `fixtures/README.md`.
- **`074-title-del` (`INVALID` at line 2, ET-14).** ET-14 forbids "any C0
  control character (U+0000–U+001F) **or U+007F**" — two clauses, of which only
  the first had a vector. `060` is the sole other control-character vector and
  it carries U+0001, so **a verifier implementing the rule as `c < 0x20` alone
  passed all 73 preceding vectors with no signal.** Same shape as the `ET-9b`
  gap recorded in `memory/OPEN-QUESTIONS.md`: a stated constraint that no
  fixture exercises is a constraint T7 can silently omit.
- **`075-title-c1` (`VALID`, ET-14/EX-9).** The over-rejection counterpart, and
  the reason `074` alone is not enough. ET-14 stops after U+007F, so the C1
  block (U+0080–U+009F) is **legal** — but Go's `unicode.IsControl` reports true
  across U+007F–U+009F, so the obvious one-call implementation passes `074` and
  still rejects this conforming title. No earlier vector carries a C1
  character, so that error was undetectable.
- **Both are stored as literal UTF-8 octets** (`7f`, and `c2 85`), never as a
  `\u` escape: EX-9 escapes only U+0000–U+001F. Asserted over the committed
  bytes in `fixtures.test.ts`, because an escaped form parses back to the same
  string and hashes to the same preimage — invisible to every other check.
- No spec `.md` changed: this adds fixtures for ET-14 as already written, and
  narrows no reading. `hashing.md` and every existing preimage are untouched.

## fixtures/ — README v6 — 2026-08-02 — freeze rules split by file kind (ADR-0008)

- **No vector, verdict or byte changes.** This edits only the README prose that
  describes the freeze, because the freeze itself changed shape.
- **The blanket "nothing under `fixtures/` may be modified" rule made adding a
  vector impossible** — an addition also rewrites `index.json`,
  `MANIFEST.sha256` and this README, so `evolution.md` EV-5/EV-14 were
  unsatisfiable after the tag and no post-freeze event type could ever ship.
  Second instance of this deadlock; PR #9 fixed the vector-files half and missed
  the aggregate files. Invisible in CI, because the whole branch is gated on a
  tag that does not exist yet.
- **Now four rules, one per kind of file:** golden data add-only; `index.json`
  may gain lines but never lose one, with ids unique and no object repeating a
  key; `MANIFEST.sha256` regenerable but not deletable, its correctness checked
  instead of its diff; this README exempt.
- **Note prose is frozen with everything else.** `cites`/`note` are advisory
  under EV-17, but the rule is deliberately a line rule with almost no logic —
  it is the only thing holding the freeze up, and a cleverer comparator would
  fail open. **Fix a wrong note before the tag; afterwards it is permanent.**
- Also freezes `index.json`'s formatting. Safe: `.prettierignore` excludes
  `contracts/`, so no formatter can reach it.

## event-types.md — v3 — 2026-07-28 — T5i, ET-14 counting unit

- The `issue_created` payload table said `title` is "1–200 **UTF-8
  characters**"; ET-14's normative sentence says "1–200 Unicode **scalar
  values**". A Go implementer reads the table as `len()` (bytes), a JS one as
  `.length` (UTF-16 code units) — a factor-of-4 disagreement on astral titles,
  which `072-title-200-astral` and `073-title-201-astral` (T5h) made
  load-bearing. Table corrected to match the sentence.
- **Which text governs, precisely:** where a payload table and a numbered
  `ET-n` sentence disagree, the numbered sentence governs. **Payload tables are
  otherwise normative, and in places are the sole source of a constraint** —
  `genesis`'s `operator_pk` and `registrar_pk` are pinned to `^[0-9a-f]{64}$`
  only in the table, by no `ET-n` sentence. `event-types.md` names the third
  table column **constraint**, and the `title` cell itself carries "MUST NOT
  contain U+0000–U+001F or U+007F": a table containing an RFC-2119 keyword is
  not a summary. Do not read this entry as licence to discount tables.
- **It does narrow the admissible readings.** A verifier that implemented the
  table's byte reading rejected a 200-astral-scalar title and is non-conforming
  after this edit. That is legal because `contracts/` is still `DRAFTING`:
  `evolution.md` EV-1 binds changes made *after* freeze, and no `contracts-v1`
  tag exists. EV-4 is untouched — `hashing.md`, every preimage and every
  fixture verdict are unchanged, and no regeneration is required.

## fixtures/ — README v5 — 2026-07-27 — T5h, T7 preflight (PR A)

Additive only. **No existing vector, preimage, verdict or `index.json` entry
changed**; `001` and its 607-octet preimage remain byte-identical to
`hashing.md` §6. Everything here is test data T7 cannot author for itself — it
runs under hard isolation and may read only `contracts/`, so material that is
missing when T7 starts stays missing.

- **`preimages/002-four-types-seq3.hex`** — the hash preimage of the
  `issue_created` at seq 3 of vector `002`. `001`'s payload is four strings, so
  no committed preimage exercised the **integer** payload tag. This one carries
  the `0x69` tag, an `ENC_INT` payload value and the `0x69`/`0x73` adjacency in
  HA-8 key order (HA-4, HA-7, HA-9). Without it a swapped tag constant or a
  wrong integer width surfaces only as a digest mismatch with nothing to diff.
- **`071-title-astral`** (`VALID`) — a title containing U+1D11E. No string
  anywhere under `contracts/` previously held a code point above U+FFFF, so an
  implementation escaping astral scalar values as surrogate pairs produced bytes
  that parse to the same event and hash to the same preimage, and no vector
  could see it. EX-9 requires the literal four octets; Go emits them, so this
  was an unguarded cross-language divergence. `006` does not reach it — its
  non-ASCII characters are all BMP.
- **`072-title-200-astral`** (`VALID`) and **`073-title-201-astral`**
  (`INVALID`, line 2) — ET-14's "1–200 Unicode **scalar values**" had no vector
  distinguishing scalar values from UTF-16 code units (JS `.length`) or bytes
  (Go `len()`). `061` is 201 ASCII `t`, where all three agree. 200 × U+1D11E is
  200 scalar values, 400 code units and 800 octets: one reading accepts it, two
  reject a legal title. `073` pins the ceiling from above in the same multi-byte
  regime, where an ASCII fast path cannot stand in for counting.

---

## fixtures/ — README v4 — 2026-07-27 — T5g review fixes (PR #31)

- **`070` rebuilt, and renamed** `070-unregistered-type-bad-payload` →
  `070-unregistered-version-bad-payload`. As shipped in #30 it duplicated `042`:
  same construction, a float payload on an unregistered **type**. It now puts a
  float on a **registered type name at version 1000000** — EV-19's reserved
  value — so the set covers both halves of the `(type, version)` key. That is
  the seam where an implementation checking only the type name resolves the
  event to `participant_registered` v1 and validates against the wrong shape.
  **Done now because it is still possible:** `contracts-v1` is not tagged, so
  fixtures remain editable; after the tag this vector would be permanently
  frozen as a redundant copy of `042`.
- **No other vector's bytes changed.** `001` and its 607-octet preimage remain
  byte-identical to `hashing.md` §6.
- **README v4** corrects the id ranges: v3 enumerated the categories but omitted
  `VALID` and `PARTIAL` while claiming vectors are "numbered in that order",
  which was false from the first id.

---

## fixtures/ — README v3 — 2026-07-27 — T5g (PR #30)

- **The golden vector set is complete: 42 → 70 vectors** (7 `VALID`, 4
  `PARTIAL`, 59 `INVALID`). This slice adds the framing and canonical-line-form
  vectors (`043`–`052`), the `--head` pair (`053`–`054`), the Stage B type
  semantics (`055`–`068`), and verdict precedence (`069`–`070`).
- **Additive only.** No existing vector, preimage, `index.json` entry or verdict
  changed; vector `001` and its 607-octet preimage remain byte-identical to
  `hashing.md` §6. Only `index.json` and `MANIFEST.sha256` gained entries.
- **`fixtures/README.md` → v3.** Drops the slice-transient prose ("currently
  holds…", "arrives in a later ticket") now that the set is complete, and names
  `053` as the `--head` partner of `004` — the pair that makes end-truncation
  detectable at all (EX-16).
- **No spec file changed**, so no `Version:` bump beyond the fixtures README:
  this slice encodes rules that `export-format.md`, `event-types.md` and
  `evolution.md` already state.

---

## evolution.md — v3 — 2026-07-26 — T5f (PR #28)

- **EV-19 added: a reserved `version` range.** No contracts version may ever
  register a `(type, version)` whose `version` is 1000000 or greater, and a
  fixture exercising the unregistered-**version** path MUST use **1000000
  exactly**. The two bounds differ on purpose: the reservation is open-ended so
  nothing future can reach it, while the fixture obligation names a single value
  so no vector can carry a `version` near ES-5's `2^53-1` ceiling and strain an
  implementation's `version` parser. **EV-18 was narrowed in the same edit** to
  say its `x_` obligation binds the unregistered-*type* path only, and to point
  at EV-19 for the other — otherwise the two MUSTs read as being in tension at
  exactly this seam.
- **Why it was needed, found by the fresh-context review of this PR.** EV-18
  reserves a `type`-name prefix and requires every `PARTIAL` fixture to use it.
  But the unregistered-version path can only be exercised by a **registered**
  type name — precisely what EV-18 forbids — so under EV-18 alone that path is
  untestable by fixture without arming the exact time bomb EV-18 exists to
  defuse. Vector `009` sat in that gap: a frozen `PARTIAL` on
  `participant_registered` version 2 would be contradicted the day EV-1 adds
  that version for real, against a file `contracts-guard` makes uneditable.
- **Additive and non-retroactive.** EV-19 constrains only what future versions
  may register; no existing `(type, version)`, byte, or verdict changes. v1
  registers version 1 only, so nothing in the current registry moves.
- **Not to be confused with the genesis question**, which stays open: an
  unregistered `genesis` version leaves a verifier unable to extract
  `operator_pk`/`registrar_pk` for Stage B at all. EV-19 makes the *version*
  namespace safe to use; it does not answer that, and `conformance.test.ts`
  still forbids any vector from freezing a verdict for it.

## fixtures/ — v2 — 2026-07-26 — T5f (PR #28)

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
- **Numbering note for T5g.** The T5e entry below predicted a `042-crlf` framing
  vector. Id `042` is now `042-payload-float-unregistered-type`, so the framing,
  `--head`, Stage B and precedence vectors start at **043**. Ids are frozen once
  a vector ships, so the prediction is stale, not the vector.

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
