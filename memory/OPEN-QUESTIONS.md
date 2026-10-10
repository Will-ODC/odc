# Open Questions

Unresolved design questions for the **ODC core**. Move each one to an ADR when it
is decided, and delete it when it becomes moot. Pulse's open decisions are in
`memory/pulse.md` and `memory/pulse-development.md`.

> Entries are addressed by their **bold title**, which is stable. Grep for the
> title, not a line number. Settled entries live in
> `memory/OPEN-QUESTIONS-archive.md`.

## Index

**Still open:**

| Question                                                                                            | Where                                                          |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Future `vote_cast` versions and ballot batching**: settle before the RC freezes ET-24's wording   | "Future `vote_cast` versions and ballot batching (2026-10-09)" |
| **Q-F**: the registrar's signature as a subliminal channel                                          | "Q-F — What mitigates the registrar's signature…"              |
| **Anchor contents and cadence** (Q-A item 4, which ADR-0013 and ADR-0032 left open)                 | "Anchor contents and cadence"                                  |
| **EX-24 claim decoding**: invalid UTF-8, BOM, `\u` escapes, nesting depth (2026-10-10)              | "EX-24 claim decoding (2026-10-10)"                            |
| Does `read-api.md` (RA-1 to RA-13, **zero** conformance coverage) need vectors before Phase 1?      | "Read-API conformance coverage"                                |
| **⚠️ Ballot expressiveness vs receipt-freeness**: a live contradiction between charter §5 and ET-22 | **Archive file**. Read it before writing ceiling ADR part B.   |
| Registrar key custody and the no-receipt discipline in Phase 1 identity                             | Archive file: "Registrar-side ballot privacy"                  |
| `RETIRED.md` valve; EV-5's fixture breadth; an HA-2 fixture                                         | Archive file, three adjacent bullets                           |
| Sanction/negative events; money/attestation/capability events (Phase 2+)                            | Archive file, deferred, and **not** freeze blockers            |

The four `contracts/` contradictions awaiting an operator decision are listed in
`memory/STATE.md` → Blockers.

**Settled, kept for the reasoning (archive file):** the six T9 findings F1-F6,
which became ADR-0013 to ADR-0018. Also archived: the operator-confirmed batch
floors, the charter §4 anchoring edit (ratified 2026-08-15), and the traps left
by the ADR pass and by fixture phase 1. All of those traps are now closed. Look
in the archive under "T9 findings F1-F6 (settled; moved 2026-10-10)". ADRs
and specs that cite "`memory/OPEN-QUESTIONS.md` Q-A" (or Q-B, Q-D, Q-E or Q-H)
mean that archive section. Q-F is still here.

**Where a new question goes:** a new bullet in this file, with a bold title and a
date, or its own `##` section if it needs one. Once it is settled, move it to the
archive with a one-line pointer to the ADR or PR that settled it.

## Open entries from the T9 audit

- **Q-F — What mitigates the registrar's signature as a subliminal channel?**
  (from S2.) Every ballot carries 64 registrar-chosen, published, permanent
  signature bytes, into which the registrar can encode the voter's identity
  undetectably. The audit explicitly **disagrees with the prior posture audit**
  here: that document called the registrar's admission-time knowledge the only
  artifact connecting a human to a ballot, but that knowledge is transient and
  deletable, whereas this one is written to the permanent public record. Options:
  attested builds, threshold/split registrar signing, published nonce derivation.
  Also asks whether this moves blind-signature credentials off charter §11's
  deferred list.

- **Anchor contents and cadence** (split out of Q-A, 2026-10-10). ADR-0013
  settled chain identity, and ADR-0032 settled anchor-comparison precedence.
  Neither settled what an anchor _is_. The recorded proposal is
  `(genesis_hash, seq, head_hash, timestamp, operator signature)` as a signed
  checkpoint, ideally in C2SP signed-note format so witness tooling can be
  inherited later. It also has a fixed cadence, and **a normative rule that a gap
  or regression in `seq` is itself an alarm**. The anchoring layer is a new
  artifact, not an event schema, so it can be added after the freeze. Full
  reasoning: the archive's Q-A entry.

- **Read-API conformance coverage** (T9 orchestration inventory, 2026-08-15).
  At T9, 73 of 143 rule ids were cited by no vector. The uncovered half includes
  **RA-1 to RA-13, the whole of `read-api.md`**. That is the public read
  surface, where identity leakage would show, and F2 depends on RA-12/RA-13.
  Open: does the read API need conformance vectors before Phase 1 builds against
  it, or is it out of scope for a fixture suite whose unit is an export line? An
  HTTP surface probably needs a different instrument from NDJSON vectors.

## EX-24 claim decoding (2026-10-10)

**Open; report output only, not conformance.** EX-24 says a claim is available
if the candidate "decodes as a JSON object" but does not settle: bytes that are
not valid UTF-8; a leading BOM (RFC 8259 lets parsers ignore it, EX-24 forbids
normalising); `\u` escapes in the `hash` value or key; nesting depth (Go gives
up past 10,000 levels, JS differs). Both verifiers (#241, #242) chose: strict
UTF-8, BOM → `unavailable`, escapes decode (an escape decoding to uppercase
stays `unavailable`). If `contracts/` pins this, both must follow.

## Future `vote_cast` versions and ballot batching (2026-10-09)

**Open. Settle before T9a (RC).** It was raised as finding 2 of the
fresh-context review of #176 (ADR-0029). The operator chose on 2026-10-09 to log
it here rather than decide it in #176/#180.

`event-types.md` ET-24/ET-24a (v11) count only the registered `(vote_cast, 1)`:
"Which ballots count" says an unregistered version's payload is not read (EV-8),
so it joins no batch, ends none, and proves none not-last. That is coherent today,
but it would freeze two problems once a `vote_cast` v2 exists:

- **The EV-8 problem.** A chain has v1, v1 and a registered v2 ballot at T1, then
  three v1 ballots at T2. A verifier that registers v2 (and counts it) says
  `VALID`. A v11 verifier says `INVALID` at the first T2, solely because it cannot
  see the v2 ballot. EV-8 forbids `INVALID` solely for an unregistered event.
- **The permanence problem.** If a future contract does not also amend ET-24, v2
  ballots escape the minimum batch size entirely, yet ET-14b and ADR-0014 call
  the batching mechanism permanent (it is in ET-22's register).

Options the review named:

- **(a)** Reword to "every registered `vote_cast` version (in v11: only version
  1)", and add an ET-22-style permanent constraint that every future `vote_cast`
  version carries `issue_id` and is batched.
- **(b)** Make an old verifier report `PARTIAL`, not `INVALID`, for an ET-24
  finding when an unregistered `vote_cast` falls between the under-size run and
  the ballot that ends it. Its `issue_id` is unknown, so it may belong to that
  issue.

These are not exclusive: (a) fixes permanence, and (b) fixes what an old verifier
says.

**Update 2026-10-10:** #225 merged a proposal,
`docs/plans/hash-chain-unknown-ballot-batching.md`, which is **PROPOSED, not
ratified**. Its one-event/one-ballot evolution constraint, its uncertainty
algorithm and its wider PARTIAL attribution all still need an operator decision.
Merging the proposal settled nothing. Whatever is chosen needs both verifiers updated in isolation and vectors
with an unregistered `vote_cast` inside a batch.

## Archive

Settled questions, and a few deferred-but-open ones, are in
**`memory/OPEN-QUESTIONS-archive.md`**. The index above names those that are
still open.
