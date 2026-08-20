# ADR-0019: Fork ancestry names a chain **and** a position

- **Status:** accepted
- **Date:** 2026-08-20
- **Phase:** 0

## Context

ADR-0016 added an optional `ancestor_head` to the `genesis` payload so charter
§8's fork right — "re-declare genesis anchored to the old chain's head" — would
be expressible before the freeze. ADR-0013 established, in the same pass, that a
chain's identity is its **genesis hash**, and that a **head** identifies no chain
at all. Both landed together in #98.

They contradict each other, in one file, seven lines apart.

- **ET-9e** (`contracts/event-types.md`) made `ancestor_head` carry "the **head**
  of the chain this one was forked from — that chain's last event `hash` at the
  moment of the fork (EX-14)".
- **ET-7a** listed "a fork's `ancestor_head` (ET-9e)" among the places where "a
  chain must be **named**", held that "the genesis hash is the name", and then
  held that "a `head` does **not** identify a chain either: it names a position…
  which is why anchoring the head alone cannot deliver charter §4's
  non-equivocation (ADR-0013)".

So one rule used `ancestor_head` as a chain **name** while the other said the
value it carries cannot be one. Read either way, the value is 64 lowercase hex
and the check is format-only, so **no verdict, hash, fixture or line number
differs today**. That is precisely why it survived review: nothing failed, and
nothing would have failed until the contradiction was frozen into a permanent
artifact and a forked community discovered its ancestry record named nothing
checkable. It was found by the isolated TypeScript phase-2 verifier build, which
had to decide what the value _meant_ in order to implement it.

Underneath the wording is a real defect. A fork's `genesis` carrying only a head
records a position on an unnamed chain: a reader holding it does not know which
export to open, and an operator running two chains can point the record at
whichever one suits. That is the exact failure charter §4 was amended to close
for anchors.

## Decision

**A fork's `genesis` records its parent with two optional keys — a name and a
position.**

- **`ancestor_chain`** (OPTIONAL, `^[0-9a-f]{64}$`, never the 64-zero anchor) —
  the parent chain's **genesis hash**, its identity under ET-7a. This is the key
  that **names** the parent; per ET-7a it is the only value that can.
- **`ancestor_head`** (OPTIONAL, same format) — the parent's **head at the fork**
  (`export-format.md` EX-14): a position **on** the chain `ancestor_chain` names.
  It carries what the genesis hash cannot — a fork taken at `seq` 50 and one taken
  at `seq` 5000 are different claims about the same chain.
- **`ET-9f`** — `ancestor_head` MUST NOT appear without `ancestor_chain`; a
  `genesis` carrying it alone is `INVALID` at the `genesis` line. It is one
  key-presence test: no key material, no decoding, no hashing, no curve
  arithmetic. Two faults on one line need no precedence, because conformance is
  the verdict token and the line number only (`evolution.md` EV-17).
- **`ancestor_chain` MAY appear alone, and that asymmetry is deliberate.** It is
  stated in the rule text so a later reader does not "tidy" it into
  both-or-neither. Chain-alone is the weaker but coherent claim _"forked from
  chain X, fork point unrecorded"_ — a named chain with no position, checkable as
  far as it goes. Head-alone is the defective form: a position on an unnamed
  chain. ET-9f bars exactly that one form and permits the other.
- Omitting **both** remains the single way to say "no ancestor" (ES-34), and the
  64-zero string keeps its one meaning as `prev_hash`'s anchor (ES-24). Absence
  is still not a claim that no ancestor exists.
- Everything ADR-0016 decided about **verification** stands unchanged: format and
  nothing else; a **recorded claim, not a verified link**; a verifier MUST NOT
  report `INVALID` because it cannot resolve either value and MUST NOT treat an
  unresolvable value as a defect; a fork's own `seq` is `1` and `prev_hash` the
  64-zero anchor; a fork is a **new chain with a new identity**.

### The derivation, and where it must live

Charter §8 grants the fork right in the words "re-declare genesis **anchored** to
the old chain's head". Charter §4 defines what an anchoring record **is**: a
chain's identity and its head, published **together**, "both halves are
load-bearing", because a head alone lets an operator run two chains and anchor
only one.

A fork's `genesis` **is** an anchoring record for its parent. It publishes a fact
about the parent chain, hash-committed, at `seq` 1, in a place the parent's
operator cannot rewrite. So it carries what §4 requires an anchor to carry. The
two keys are not a new invention; they are §4's pair, applied where the charter
already said the anchor belongs.

**This reasoning is carried inline in `event-types.md` ET-9e and ET-9f, not only
here.** The isolated verifier-builder contexts are stripped of
`docs/decisions/`, so a builder must be able to derive "two keys, both
format-checked, head requires chain, resolve nothing" from `contracts/` alone.
ADR citations in the spec are provenance, never load-bearing.

### Why two keys and not one composite value

A single value carrying both halves was considered and rejected.

- A **128-hex concatenation** is shape-identical to `sig` under ET-4, and nothing
  in the string says where one half ends.
- A **delimited form** (`<genesis-hash>:<head>`) would be the contract's only
  structured payload string. It would need its own normative text for the
  separator, the ordering of the halves, the empty-half case, and case-folding —
  an unspecified field inside a field, which is the exact workaround ADR-0016
  itself rejected when it declined to smuggle the head into the `contracts`
  string.

Two keys reuse machinery that already exists and needs no new text: ES-18's key
set, ES-34's optionality, HA-7's key count, HA-8's byte ordering.

### The permanent claim, restated rather than weakened

ADR-0016 said `ancestor_head` was "the only key ever added to `genesis`". That
framing was a **count**, and a count is the wrong bar — as this ADR demonstrates
by adding a second key while the door is still open. The real bar is the **tag**:
ET-6 pins `genesis.version` at `1` and EV-1 bars altering a frozen
`(type, version)`, so **nothing may be added to the `genesis` payload after the
`contracts-v1` tag exists**. No tag exists — `contracts/` is still DRAFTING
(ADR-0007) — which is why this correction is addable at all, and it is the last
kind of correction that will be.

## Consequences

- **`contracts/`** — `event-types.md` (v8 → **v9**): `ancestor_chain` row added
  to the `genesis` table and the `ancestor_head` row restated, ET-7a's naming
  sentence and closing sentence repointed, ET-9e rewritten for both keys, **ET-9f
  added**, rule index and acid-test walkthrough updated. `event-schema.md`
  (v3 → **v4**): ES-34's closing paragraph now records two optional keys whose
  presence is **not independent**, and the general rule that a payload table fixes
  _which_ keys are optional while a type's numbered rules may constrain _when_ one
  may appear — such a rule being a numbered sentence in `event-types.md`, never a
  table row alone.
- **No existing bytes move.** Neither key appears in any current vector, so all 83
  vectors' payloads, hashes, verdicts and line numbers are unchanged; confirmed by
  running the fixture suite.
- **No other spec changes.** `hashing.md` needs none — HA-7 encodes exactly the
  keys present and leads with the key count `U64(k)`; HA-8 orders by UTF-8 bytes,
  under which `ancestor_chain` sorts first and `ancestor_head` second, ahead of
  `chain_id`; §6's worked example is a genesis carrying neither key. `ES-18` needs
  none — "a key that type's table marks OPTIONAL may be absent without being
  missing (ES-34)" already delegates correctly. `evolution.md`,
  `export-format.md`, `ids.md`, `read-api.md` and `contracts/README.md` never
  mention either key.
- **Owed fixtures (EV-5), not written in this pass** — these **supersede**
  ADR-0016's F4 list: both keys well-formed (`VALID`, and the first seven-key
  genesis payload); `ancestor_chain` alone (`VALID` — the vector that pins the
  deliberate asymmetry); `ancestor_head` alone (`INVALID` line 1, ET-9f); either
  key = the 64-zero anchor (`INVALID` line 1); either key malformed (`INVALID`
  line 1); a well-formed pair naming a chain absent from the fixture set
  (`VALID` — unresolvability is not a defect).
- **Owed verifier work (both verifiers, isolated passes):** accept both optional
  keys, check each format, enforce ET-9f, resolve nothing.

### What the three non-reconciliations were, because the pattern is the lesson

This contradiction was not carelessness in one sentence; it is the same omission
made three times, and each instance is a shape worth recognising again.

1. **ADR-0013's holding was applied downstream but never upstream.** It
   established that a head names no chain, and that holding was correctly applied
   to the fork's **own** identity — a fork is a new chain with a new identity, not
   a continuation. It was never applied to the fork's reference to its **parent**,
   which is the other chain in the same sentence. A holding about what identifies
   a chain has to be checked against _every_ chain a rule mentions, not just the
   one the rule is about.
2. **ADR-0016's format section reasons about shape, never about reference
   semantics.** Its justification for the format is "an event `hash`, the same
   shape as every other hash reference in the contract" — a statement about bytes
   that says nothing about what the reference _denotes_. That is the tell: where a
   field's justification argues only shape, the question of what the value refers
   to has not been asked, and a reviewer reading it will not notice the gap
   because the shape argument is true.
3. **ADR-0016 already had the right form in hand and did not apply it one
   paragraph up.** Its closing "anchoring interaction" note observes that an
   anchor publishing `(genesis_hash, head)` per ADR-0013 shows a fork as a visibly
   distinct chain — the identity-and-position pair, correctly stated, applied to
   the fork's identity. The ancestry reference, one paragraph above, got the head
   alone. The pair was present in the author's mind and simply was not carried
   across the paragraph break.

### Documents reconciled

- **`docs/decisions/0016-genesis-ancestor-head.md`** — **status line amended in
  this PR** to "accepted — amended in part by ADR-0019". **The body is
  deliberately left untouched.** An ADR is a record of what was decided and why;
  erasing the head-alone decision would erase the reasoning a future reader needs
  before they consider trimming `ancestor_chain` back out.
- **`memory/OPEN-QUESTIONS.md`** — **updated in this PR.** Three places stated the
  single-key outcome: Q-D's answer, the F4 decision row, and the phase-2 fixture
  list. All three now state two keys, ET-9f, and the restated permanent claim
  (nothing after the tag, rather than a count of keys).
- **`memory/STATE.md`** — **not touched here, by rule.** `CLAUDE.md` requires
  STATE.md to be updated on master at merge time, never on a feature branch where
  parallel agents conflict. The phase-2 line naming the F4 `ancestor_head` vectors
  is what needs amending there.
- **`docs/charter.md`** — **checked, no change needed.** §4 already requires an
  anchoring record to publish identity and head together, and §8 already grants
  the fork right; this ADR makes the contract match both, which is the same
  posture ADR-0016 took deliberately.
- **`docs/security/audit-phase-0.md`** — **checked, no change needed.** It is the
  audit as delivered, a historical record of finding F4; its text describes the
  gap, not the shape of the fix.
- **`docs/implementation-plan.md`, `services/ledger/CLAUDE.md`,
  `services/verifier/CLAUDE.md`, `tools/verifier-ts/`** — **checked, no change
  needed for this ADR.** None describes the `genesis` payload keys. The verifier
  documents' stale CLI surface is ADR-0013's outstanding item and is unaffected
  here.
- No fixture, generator or verifier source is touched by this PR; the owed work
  is listed above and lands with T9 conformance phase 2.

## Charter check

- **Charter §8 (exit is a right).** The reason this ADR exists. ADR-0016 made the
  fork right expressible; this makes what it expresses **checkable**. A recorded
  ancestry that names no chain is a record a reader cannot act on, so the right
  would have been nominally present and practically empty.
- **Charter §4 (non-equivocation by anchoring).** Directly honored: the pair §4
  requires of an anchor — identity **and** head, both halves load-bearing — is now
  the pair a fork records about its parent, and ET-9f makes the defective
  head-alone form `INVALID` rather than merely discouraged.
- **P1 (the log is the only truth).** Served, with the same caveat ADR-0016 stated
  rather than hid: the ancestry claim is _recorded_ in the log; its
  _confirmation_ needs the parent export. The pair is what makes that confirmation
  possible at all — with a head alone the reader does not know which export to
  open, so the claim was unconfirmable in principle, not merely in the verifier.
- **P2/P3/P4.** Untouched. Both keys are operator-declared chain metadata; they
  touch no ballot, no plane, no tally, and no participation floor.
