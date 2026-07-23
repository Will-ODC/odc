# ADR-0005: Correction and retraction model

- **Status:** accepted — human-ratified 2026-07-23 (pre-freeze bit and full model)
- **Date:** 2026-07-21 (proposed) · 2026-07-23 (ratified)
- **Phase:** 0

## Context

The log is append-only (P1); nothing is ever updated or deleted. Yet the
charter requires things that _behave like_ corrections: delegation is
"explicit, revocable" (§6), consent grants and revocations are "logged,
revocable events" (§8), and moderation actions are themselves public events
(§9). The implementation plan already pins one resolution style for one case:
duplicate votes are "recorded, not rejected; interpretation belongs to tally"
— last-write-wins in a derived view. (That specific line is now partially
stale after ADR-0004 removed per-participant ballot keys, but the philosophy
— the log records, views resolve — stands.)

External design notes (unratified, from another session) flag the correction
model as a pre-freeze decision. They are right about exactly one part of it,
and the asymmetry is the whole point of this ADR:

- The envelope is seven fields (`event-schema.md` ES-1/ES-2), the hash
  preimage covers six of them (ES-27), and hashing rules never change
  retroactively (implementation plan §Phase-0 rule 7). **An envelope-level
  correction field can never be added after genesis.** If it is ever wanted,
  it must exist before the first real event.
- Everything else about corrections — new event types, payload keys,
  interpreter resolution rules — is additive and can ship in any later
  contracts version.

So the decision that must be made now is narrow: **does the envelope carry
correction machinery, or does it not?** The v1 registry itself contains no
correctable type (genesis, `participant_registered`, `issue_created`,
`vote_cast` — see the per-type notes below), so nothing else is urgent.

## Options

### Option A — generic envelope `supersedes` field

Every event carries an eighth envelope field, `supersedes`: empty string when
unused, otherwise the 64-lowercase-hex `hash` of a strictly-earlier event
(same backward-reference discipline as `ids.md` ID-8). A typed reason
(`mind_changed` / `typo` / `annulled_by_moderation` / per-type values) rides
in the payload. The preimage extends to seven content fields.

**For:**

- Uniform across all current and future types; a new type gets correction
  semantics "for free."
- The pathology fears in the notes (cycles, forks, dangling refs) are weaker
  than stated: in a single linear chain with backward-only references, cycles
  are _impossible_, a dangling reference is detectable at verify time, and
  competing supersedes of the same target have a total order (`seq`) — the
  resolution rule "highest-seq superseder wins, transitively" is executable
  and fixture-testable.
- The verifier can check referential integrity structurally even for types it
  does not otherwise understand.

**Against:**

- Permanent envelope and preimage complexity, paid by every event forever,
  for a mechanism no v1 type uses. The seven-field envelope is currently
  clean; this is the single most expensive kind of speculation the contracts
  can make.
- The uniformity is shallower than it looks. What "superseded" _means_ is
  per-type regardless (a revoked delegation, a replaced position, an annulled
  vote are three different semantics), so the interpreter needs per-type rules
  anyway. The envelope field buys only the pointer, not the semantics.
- Type-blind pointers create rule sprawl the envelope cannot answer: may an
  event supersede `genesis`? An event of a different type? A different
  actor's event? Each answer becomes another envelope-level normative rule.
- **Ballot-plane hazard (decisive):** a supersedes pointer on `vote_cast`
  re-links a voter's ballots to each other on-log and creates a
  voter-directed pattern channel ("cast, then supersede, in this sequence") —
  precisely the tagging/receipt surface ADR-0004 clause 3–4 closed.
  ADR-0004's permanent evolution constraint (no voter-chosen unbounded
  values, no voter-held binding artifacts) already forbids correction
  pointers on ballots. So the one high-volume v1 stream is _categorically
  excluded_ from the mechanism, gutting the "uniform" argument.

### Option B — aggregate-scoped last-write-wins

No envelope change. A correctable type defines a **scope key** in its payload
(e.g. `(actor, delegation_scope)`); the interpreter resolves each scope to
the highest-`seq` event in it. This is the implementation plan's existing
duplicate-vote philosophy generalized.

**For:**

- Zero pre-freeze cost; entirely additive; nothing to ratify beyond "the
  envelope stays as is."
- No references at all — no dangling pointers, no reference rules; the
  resolution rule (max `seq` per scope) is trivially executable in TS and Go.
- P3-aligned: the log records what happened; views decide what it means.

**Against:**

- Fails where no natural scope exists — above all _targeted moderation_:
  "annul that specific event" has no scope key.
- Scope keys are designed per type, so consistency depends on drafting
  discipline, not mechanism.
- Cannot distinguish "replaced" from "annulled" without further convention.

### The gap-filler both options need (payload-level targeted correction)

The notes rejected "per-type correction events" without argument. The
rejection does not hold in this repo's regime: with content-addressed ids
already established (`ids.md` ID-7/ID-8 — an event's `hash` is a stable,
verifier-checkable, backward-only reference), a future type that needs
_targeted_ correction can carry a payload key `supersedes` (64-hex event
hash, strictly-earlier, ID-8 discipline) plus a `reason` string from a
per-type enum. This is additive, needs no envelope change, gets verifier
referential-integrity checks in that type's own registry entry, and lets
moderation be its own public event type as §9 wants anyway. Uniformity is
preserved _by convention_ — `evolution.md` records the naming and reference
rules once, and every future correctable type follows them.

## Decision

_Ratified 2026-07-23 as proposed (no changes to items 1–4)._

1. **The envelope will never carry correction machinery.** Option A is
   rejected; the seven-field envelope and six-field preimage freeze as
   drafted. This was the pre-freeze bit; it is ratified — T4 may draft
   `hashing.md` with the six-field preimage and no `supersedes` envelope field.
2. **Corrections are additive, in two conventional forms**, recorded as a
   normative template in `contracts/evolution.md` (T4):
   - **Scoped streams** (Option B): a correctable type MAY define a scope key
     set; resolution is highest-`seq`-wins per scope, in the interpreter.
   - **Targeted corrections** (payload convention): a type needing them
     carries payload keys `supersedes` (64-lowercase-hex `hash` of a
     strictly-earlier event, ID-8 discipline) and `reason` (per-type string
     enum). Resolution: an event with a valid superseder is inert in derived
     views; competing superseders resolve by highest `seq`, transitively.
3. **The ballot plane is excluded from both mechanisms, permanently**, per
   ADR-0004's evolution constraint. v1 ballot finality is registrar policy:
   one ballot per human per issue, final — no re-vote path in v1 (Phase 1
   identity design; recorded in `memory/OPEN-QUESTIONS.md`).
4. **Executability gate:** whichever form a future type uses, its registry
   entry MUST ship golden fixtures for the pathological cases (supersede of a
   superseder; competing superseders; dangling target; scope collisions)
   before that type is published. No correctable type ships on prose alone.

## Consequences

- Nothing in the current T3 specs changes. `event-schema.md`, `ids.md`,
  `event-types.md` freeze without correction fields.
- T4 `evolution.md` gains a "correction conventions" section carrying items
  2–4 above — normative template for future registry entries, no effect on
  v1 types.
- The interpreter (tally core, Phase 2) implements resolution when the first
  correctable type ships (likely delegation or consent events), against the
  fixtures item 4 requires.
- If ratification _overturns_ item 1 (i.e. the human wants an envelope
  field), that decision must land before T4's `hashing.md` is drafted, since
  the preimage would grow a seventh content field. After freeze the door is
  closed for good.

## Charter check

- **P1 (log is the only truth):** corrections are themselves events;
  resolution is a computation over the log; nothing is mutated or deleted.
- **P2 / §5 / §8 (two planes, receipt-free):** honored by item 3 — no
  correction pointer or scope key may ever touch `vote_cast`; the
  receipt-freeness ADR-0004 restored is not re-opened by this mechanism.
- **P3 (characterize, never weigh):** resolution rules are published,
  deterministic, and executable; any reader can re-run them or define their
  own view. The platform does not silently pick winners — it publishes the
  rule.
- **P4 (floors, not ladders):** no effect; corrections grant no standing.
- **§6 / §8 / §9:** revocable delegation, revocable consent, and
  moderation-as-public-events are all expressible as typed events under the
  conventions in item 2 — which is how the charter phrases them in the first
  place.
