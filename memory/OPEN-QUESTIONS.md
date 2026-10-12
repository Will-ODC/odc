# Open Questions

Unresolved design questions for the **ODC core** (plus one pulse entry #315
asked for, marked as such). Move each one to an ADR when it
is decided, and delete it when it becomes moot. Pulse's open decisions are in
`memory/pulse.md` and `memory/pulse-development.md`.

> Entries are addressed by their **bold title**, which is stable. Grep for the
> title, not a line number. Settled entries live in
> `memory/OPEN-QUESTIONS-archive.md`.

## Index

**Still open:**

| Question                                                                                            | Where                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Q-F**: the registrar's signature as a subliminal channel                                          | "Q-F — What mitigates the registrar's signature…"            |
| **Anchor contents and cadence** (Q-A item 4, which ADR-0013 and ADR-0032 left open)                 | "Anchor contents and cadence"                                |
| **EX-24 claim decoding**: invalid UTF-8, BOM, `\u` escapes, nesting depth (2026-10-10)              | "EX-24 claim decoding (2026-10-10)"                          |
| **Pulse: how long `pending_claim` rows are kept** (2026-10-11, #315)                                | "Pulse sign-in data: retention and logging (2026-10-11)"     |
| **Pulse: what an email-provider error may write to logs** (2026-10-11, #315)                        | "Pulse sign-in data: retention and logging (2026-10-11)"     |
| Does `read-api.md` (RA-1 to RA-13, **zero** conformance coverage) need vectors before Phase 1?      | "Read-API conformance coverage"                              |
| **⚠️ Ballot expressiveness vs receipt-freeness**: a live contradiction between charter §5 and ET-22 | **Archive file**. Read it before writing ceiling ADR part B. |
| Registrar key custody and the no-receipt discipline in Phase 1 identity                             | Archive file: "Registrar-side ballot privacy"                |
| `RETIRED.md` valve; EV-5's fixture breadth; an HA-2 fixture                                         | Archive file, three adjacent bullets                         |
| Sanction/negative events; money/attestation/capability events (Phase 2+)                            | Archive file, deferred, and **not** freeze blockers          |

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
up past 10,000 levels, JS differs). Both verifiers (#241) chose: strict
UTF-8, BOM → `unavailable`, escapes decode (an escape decoding to uppercase
stays `unavailable`). If `contracts/` pins this, both must follow.

## Pulse sign-in data: retention and logging (2026-10-11)

Pulse is charter-exempt; these sit here because #315 asked for them here. Both
are operator decisions, not confirmed leaks. Source:
`docs/security/scans-2026-10-11.md`, items 5 and 6.

- **How long are `pending_claim` rows kept?** Each row holds a `subject` (today,
  an email address) and a token digest. Server code deletes a row only when an unused link is
  discarded (`apps/pulse/src/identity/pg-store.ts`, `discard`). Spent and
  expired rows stay forever. Options: purge on a schedule after expiry, purge
  spent rows at once, or keep them and say why in the README.
- **What may an email-provider error write to logs?**
  `apps/pulse/src/identity/resend-mailer.ts` puts up to 500 characters of the
  provider's error body into the error that reaches the operator log. If the
  provider echoes the recipient or the message, the address or sign-in link
  lands in the log. Options: log status code only, log a redacted body, or
  keep it and treat the log as personal data.

## Archive

Settled questions, and a few deferred-but-open ones, are in
**`memory/OPEN-QUESTIONS-archive.md`**. The index above names those that are
still open.
