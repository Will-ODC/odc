# ADR-0038: Verifier limits, honest `genesis` advice, and both ancestry keys

- **Status:** accepted (operator decisions, 2026-10-11/12; the line-length value
  of 65536 bytes confirmed by the operator 2026-10-12). Decision 5 (the
  64-byte cap on `genesis.contracts`) was added by the operator on 2026-10-12
  after the first four merged in PR #359; it lands as `event-types.md` v14 and
  `evolution.md` v9.
- **Date:** 2026-10-12
- **Phase:** 0
- **Supersedes:** in part ADR-0019 (the `ancestor_chain`-alone asymmetry).
  **Amends:** in part ADR-0015 (EV-21's advice).

## Context

`memory/STATE.md` recorded four contradictions in `contracts/`. None changed a
committed verdict, so no automated check could catch them. The T9 re-audit is
waiting on them (`docs/security/hash-chain-checkpoint-2026-10-09.md`, finding 4).

1. **`contracts/` bounded nothing.** No sentence limited line length, nesting
   depth or key count, or said what a verifier does past its own limits. The Go
   verifier has a depth-64 bound that no spec backs. RFC 8259 §9 lets a parser
   set limits, so two conforming verifiers could disagree on a hostile input,
   and one could crash on it.
2. **EV-21's advice was impossible for `genesis`.** It told a verifier to say
   that it "may be out of date for this chain". ET-6 pins `genesis.version` at 1
   and ADR-0016/ADR-0019 keep it there for good, so no newer verifier can ever
   register another `genesis` version. The TypeScript verifier tells users to
   "fetch a newer verifier", which cannot help.
3. **ET-7a read as both-or-neither.** It said a fork records the same identity
   and head pair a charter §4 anchor publishes. ET-9f permitted `ancestor_chain`
   alone and said the pair must not be "tidied" into both-or-neither.
4. **ET-9f's reason did not select its rule.** It argued from charter §4's pair
   ("both halves are load-bearing"), which supports requiring both. The rule it
   adopted barred only `ancestor_head` alone. The real reason given was about
   naming: a position without a name refers to nothing. That argument bars
   head-alone, but does not explain why chain-alone is worth permitting.

## Decision

### 1. Cap the writer, set a floor for every verifier (`evolution.md` §7)

ODC has one writer and many verifiers. Consensus systems pin their limits, and
here the cheap way to pin them is to cap the one writer and set a floor that
every verifier must meet.

- **EV-23, the minimums.** Line length (bytes, not counting the `LF`)
  **65536**. Nesting depth **64**, defined over the line's bytes so it is
  defined for malformed lines too: the most `{` or `[` bytes open at once,
  outside strings, where an unescaped `"` starts or ends a string, `\` inside a
  string skips the next byte, and a string left open at the end of the line
  ends the scan. On a parseable line this equals the usual JSON depth (the
  outermost value is depth 1; a conforming event's line is depth 2). An input
  is within the minimums when every `LF`-separated line meets both, however
  many lines it has. Exceeding a minimum is **not** a validity rule:
  a verifier MUST NOT report `INVALID` for it.
- **EV-24, verifier limits.** A verifier MAY set any limit on things inside one
  line (length, depth, key count, string or number-token length) as long as no
  input within the minimums can reach it. On every such input it MUST reach the
  verdict the specs require. A verifier MUST NOT impose a fixed limit on the
  number of lines or the size of the input. The only exemption is running out
  of a host resource it does not choose (memory, time), which is treated as a
  reached limit. When a verifier reaches a limit before it has
  established the verdict, it MUST report a tool-level failure (exit 3 or above
  under EV-17's CLI note), MUST NOT report any verdict, and MUST NOT crash. A
  verifier that establishes the required verdict first (for example, ES-17 at
  depth 3) has reached no limit. Reaching a nesting-depth limit above 2
  establishes an ES-17 failure on that line, so a verifier MAY report `INVALID`
  there, which makes the Go verifier's existing depth bound checkable. A limit
  reached only while recovering an EX-24 endpoint claim makes that claim
  `unavailable`, not a tool-level failure. Golden fixtures MUST stay within the
  minimums.
- **EV-25, the ledger's cap.** A ledger MUST NOT append an event whose canonical
  line exceeds either value. Later `(type, version)`s MUST bound their values
  so that no conforming line exceeds either. **Neither value may ever change**: lowering one lets a conforming
  verifier refuse a line the ledger was allowed to write, and raising one lets a
  chain outgrow the old verifiers EV-8 promises still work.

**Line length 65536 bytes, confirmed by the operator 2026-10-12.** The longest
line any v1 event can produce is **1302 bytes**: an `issue_created` with `seq`, the batch interval and
the batch minimum all at 2^53 − 1, `choice_count` 64, and a 200-character title
of four-byte characters (worked out by serializing that event; the longest line
in the committed corpus is 1264 bytes, `073`). 65536 is about 50 times that. A
large ballot batch does not make a line longer, because every ballot is its own
line. The implementation plan's "titles only, no free text" rule means no
planned type comes near 64 KiB. 65536 is also small enough that any verifier
can hold a whole line in memory, and a hostile file cannot force a large
allocation per line. Because EV-25 makes the value permanent, it should be
generous: being too small cannot be fixed later, and being too large costs only
memory.

**Depth 64** is the operator's number. A conforming line is depth 2, so 64 is
far more than any valid input needs. It matches the Go verifier's existing
bound, which now has a spec behind it.

**No separate key-count bound.** The line-length minimum already bounds it. A
verifier must parse duplicates before EX-10 can reject them, so the bound is
whatever 65536 bytes can hold, duplicates included: about 13,107 object
members (`"":0,` is 5 bytes) or about 32,767 array elements (`0,`). No verifier
finds that expensive. A separate number would add a third permanent value with nothing to
protect. EV-24 already covers a verifier's own key-count limit: like any
within-line limit, it must not bite within the minimums.

**The `contracts` string** was the one v1 value with no bound of its own (ET-9
required only that it be non-empty). Decision 5 closes that gap.

**EX-24 needs no change.** It already says a claim the verifier "cannot recover"
is reported `unavailable`, and that a tool-level failure with no verdict has no
report obligation. EV-24 states the link explicitly: a limit reached only while
recovering a claim makes that claim `unavailable`.

### 2. EV-21: `genesis` has no version but 1

EV-21 is still advisory. It now says the only `genesis` version is 1, in this
contracts version and every later one (ET-6; ET-9e records that the `genesis`
payload never reopens after the tag). A `genesis` at any other version is never
a legitimate newer chain. The reason text SHOULD name the version found, SHOULD
say the chain is corrupt, hostile, or not an ODC chain, citing ET-6, and SHOULD
NOT advise fetching a newer verifier. The verdict is unchanged: `INVALID` at
line 1 (EV-20).

### 3 and 4. Both ancestry keys, or neither (ET-9f)

A `genesis` that carries either `ancestor_chain` or `ancestor_head` MUST carry
both. Either one alone is `INVALID` at the `genesis` line. Carrying neither is
still a plain, non-fork `genesis`. The format rules (64 lowercase hex, never the
64-zero anchor), the rule that a verifier resolves nothing, and the rule that a
fork is a new chain all stand unchanged from ADR-0019.

Why, in the operator's reasoning:

- **A real fork always knows the head.** A fork is made from the parent's
  export, and whoever holds an export holds its head (EX-14). A parent that holds
  only its `genesis` has its genesis hash as its head, which is the legal
  `ancestor_chain == ancestor_head` case (`087`). No legitimate fork produces
  chain-alone. Chain-alone records less than the forker knows.
- **Every ancestry claim becomes checkable in full.** With both keys, a reader
  holding the parent export settles the name and the position in two
  comparisons. With chain-alone, the position could never be checked.
- **It matches charter §4.** An anchoring record publishes identity and head
  "together", and ADR-0019 itself argued that a fork's `genesis` is an anchoring
  record for its parent. Requiring both makes the rule follow from that argument,
  which dissolves contradiction 4. ET-7a's "same pair" sentence is now simply
  true, which dissolves contradiction 3.

ADR-0019's main finding stands: ancestry needs a name and a position, as two
keys, checked by format only. Only its permission for `ancestor_chain` alone is
reversed, along with its warning not to tidy the rule into both-or-neither. The
contract is still DRAFTING (ADR-0007), so changing a rule is allowed, and the
`genesis` key set is unchanged, so ADR-0019's bar on additions after the tag is
untouched.

### 5. `genesis.contracts` is at most 64 bytes (ET-9; operator, 2026-10-12)

ET-9 now requires `contracts` to be a non-empty string of at most 64 bytes,
counted as the UTF-8 encoding of the decoded string: the value after JSON
unescaping, the same value `hashing.md` HA-2 hashes, never the escaped bytes on
the line. An empty or longer value is `INVALID` at line 1.

**Why.** Before this rule, `contracts` was the only v1 value with no bound. A
`genesis` longer than 65536 bytes was `VALID` by the type rules, yet EV-25
forbade a ledger to write it, and EV-24 let a verifier refuse it with a
tool-level failure. That was consistent but untidy: a verdict the type rules
promised that no ledger could produce, and no verifier had to reach. With the
cap, every v1 value is bounded by its own type rule, and EV-25 can say no
conforming v1 event can reach the line cap.

**Why bytes, not scalar values.** ET-14 counts `title` in Unicode scalar values,
because a title is text for people to read. This bound exists to bound the line,
and decoded UTF-8 bytes are what every implementation counts without a Unicode
table. Counting the decoded value, not the escaped line bytes, matches HA-2 and
EX-9's decoded-value stance. A control character escaped as `\u0001` counts as
one byte. In the worst case the escaped value is at most 6 × 64 = 384 bytes,
and the longest `genesis` line, with both ancestry keys, is 1179 bytes, under 1302.

**64** leaves plenty of room for a version label: `contracts-v1` is 12 bytes,
and that is the longest `contracts` value in the committed corpus. **No
committed vector exceeds 64 bytes**, so no committed verdict changes.

## Consequences

**Spec versions:** `event-types.md` v12 → **v13** (ET-7a, ET-9, ET-9e, ET-9f,
three `genesis` table rows, the rule index, the acid-test walkthrough), then
**v14** for ET-9's cap (decision 5, added after PR #359 merged, with its own
`CONTRACTS-CHANGE.md` entry);
`event-schema.md` v6 → **v7** (ES-34's presence sentence); `evolution.md` v7 →
**v8** (EV-21 rewritten; EV-23, EV-24, EV-25 added in a new §7; EV-15 places
them outside the stage split; EV-17's CLI note; rule index; acid-test
walkthrough), then **v9** (EV-25 names ET-9's cap). `export-format.md`, `hashing.md`, `ids.md` and `read-api.md` are
unchanged. `contracts/CONTRACTS-CHANGE.md` has an entry for each.

**Committed vectors whose verdict changes:** exactly one.

- **`086-ancestor-chain-alone`** goes from `VALID` to **`INVALID` at line 1**.

**Committed vectors with one ancestry key whose verdict does not change but
which stop isolating their fault:**

- `084-ancestor-head-without-chain`: still `INVALID` line 1 under the new ET-9f.
  Its note ("the one presence combination ET-9f bars") is now wrong.
- `088-ancestor-chain-zero` and `090-ancestor-chain-uppercase` carry
  `ancestor_chain` alone. They are still `INVALID` at line 1, but now each has
  **two** faults: the bad value and the missing `ancestor_head`. A verifier that
  skipped the 64-zero check or the case check on `ancestor_chain` would still
  pass them through ET-9f. They no longer test what their notes say they test.

All other ancestry vectors (`085`, `087`, `089`, `091`, `092`, `093`) carry both
keys and are unaffected. `097` carries neither key. **The limits change no
committed verdict**: the longest committed line is 1264 bytes and the deepest
is depth 3 (`027`, already `INVALID` under ES-17). **The EV-21 change is reason
text only**, so `095` and `096` are unaffected. **The ET-9 cap changes no
committed verdict**: the longest committed `contracts` is 12 bytes.

**The rehearsal chain** (`tools/rehearsal`) carries no ancestry key, so it has
no fork with one key, and ET-9f cannot change its verdict. Its lines are far
under 65536 bytes.

### Owed, in order (coupling rule: fixtures never come before verifiers)

1. **Go verifier** (`services/verifier`), built in an isolated sparse worktree
   with `odc-verifier-builder`: ET-9f both-or-neither; EV-23/EV-24 (accept up to
   65536 bytes and depth 64; past its own limits, a tool-level failure with exit
   3 or above, never a verdict, never a panic; confirm the existing depth-64
   bound meets this); ET-9's 64-byte cap on decoded `contracts`, `INVALID` at
   line 1; EV-21 reason text if Go prints the old advice.
2. **TypeScript verifier** (`tools/verifier-ts`), separately and in isolation:
   the same four changes. The EV-21 message fix is known to be owed here.
3. **ET-9f makes a committed vector flip, so (1), (2) and the vector fix (4)
   must land together**, or required CI goes red in between. A verifier that
   enforces both-or-neither fails `086` as it stands, and `086` flipped first
   fails both current verifiers. This is the deadlock the coupling rule in
   `memory/STATE.md` describes. The limits and EV-21 parts are no-ops on the
   corpus and can land alone, and so can the ET-9 cap, since no committed
   vector's `contracts` exceeds 64 bytes.
4. **Fixtures** (`tools/fixtures-gen`, after or alongside the verifiers):
   - **`086`**: change its declared verdict to `INVALID` line 1 in place, and
     rewrite its note and `cites`. `contracts/` is DRAFTING, so a pre-tag
     correction to `expect` is allowed (ADR-0008: "corrections must land before
     the tag"). No `RETIRED.md` mechanism exists, and none is needed before the
     tag. Ids never change, and the name still describes the vector.
   - **Rewrite the notes of `084`, `088`, `090`, `089` and `091`** (the last two
     rely on 088/090 to isolate the `ancestor_chain` faults), and add replacements that
     isolate one fault each: `ancestor_chain` as the 64-zero anchor with a legal
     `ancestor_head`, and `ancestor_chain` in uppercase with a legal
     `ancestor_head`. Without them, nothing tests the zero bar or the
     lowercase rule on `ancestor_chain`.
   - Both-keys `VALID` is already pinned (`085`, `087`, `092`, `093`), and
     head-alone `INVALID` already exists (`084`).
   - **ET-9 vectors:** `contracts` of exactly 64 bytes (`VALID`), of 65 bytes
     (`INVALID` at line 1), and a multi-byte case at the boundary: for example
     64 bytes made of 16 four-byte characters (`VALID`, though only 16 scalar
     values), and one more multi-byte character pushing it over (`INVALID` at
     line 1). An escaped control character case also pins that the count is
     taken after unescaping.
   - **Limits vectors, within the minimums only** (EV-24): a line of exactly
     65536 bytes, which must be `PARTIAL` (an `x_` type with a long string
     value), because ET-9 now makes every registered v1 line far shorter; and a
     line at depth 64 that is `INVALID` at its own line (ES-17, EV-16). No vector may go beyond a minimum, because beyond them no
     verdict is required.
   - `tools/fixtures-gen/src/chain.ts` has a presence guard that declares
     head-without-chain a violation (around its line 241). It must also treat
     chain-without-head as an ET-9f violation, or the generator will refuse or
     mislabel the new vectors. Also update the declared `violates` of `088` and
     `090` in `src/vectors/fork-ancestry.ts`; they will compute as
     `["ET-9e", "ET-9f"]`.
5. **Rehearsal judge check.** EV-21 changes verifier stderr. `conformanceVerdict`
   in `tools/rehearsal` matches with a regex and has aborted on unexpected
   output four times. The rehearsal chain is `VALID`, so the EV-21 message never
   prints there, but run the rehearsal after each verifier change anyway (per
   `memory/STATE.md`). A tool-level failure message for limits must not be
   parsed by the judge as a verdict.

### Documents reconciled

- **`docs/decisions/0019-fork-ancestry-names-a-chain-and-a-position.md`**:
  status line amended **in this PR** to "superseded in part by ADR-0038". The
  body is left as written (the convention ADR-0019 itself used for ADR-0013 and
  ADR-0016).
- **`docs/decisions/0015-unregistered-genesis-version.md`**: status line
  amended **in this PR** to "amended in part by ADR-0038". Its body quotes the
  old "may be out of date" message and is left as written.
- **`docs/decisions/0016-genesis-ancestor-head.md`**: **checked, no change.**
  Its status line already points to ADR-0019, which now points here.
- **`contracts/CONTRACTS-CHANGE.md`**: new entry **in this PR**. The ADR-0019
  entries (F4 owed list, phase-2 list) are history and not edited.
- **`contracts/fixtures/README.md`** and `index.json` notes for `084`, `086`,
  `088`, `090`: **not edited here.** Fixtures follow the verifiers (owed item 4).
- **`tools/fixtures-gen/src/chain.ts`** and **`src/vectors/fork-ancestry.ts`**
  (the source of the vector notes): **not edited here**, owed item 4.
- **`memory/STATE.md`**: **not touched, by rule** (memory is updated on master
  at merge time). Two lines become stale: "Standing decisions: ADR-0016/0019 …
  The `ancestor_chain`-alone asymmetry (ET-9f) is deliberate", and the
  "Four `contracts/` contradictions need an operator decision" blocker.
- **`memory/OPEN-QUESTIONS-archive.md`**: **checked, no change.** Its F4 and
  phase-2 entries record the old asymmetry as history. The "EX-24 claim
  decoding" entry in `memory/OPEN-QUESTIONS.md` mentions nesting depth for
  report output only. EV-24 now settles that a limit reached while recovering
  a claim makes it `unavailable`, so the depth part of that entry can be closed
  at merge.
- **`docs/security/hash-chain-checkpoint-2026-10-09.md`**: **checked, no
  change.** It is the dated report that listed these four issues as open.
- **`docs/charter.md`**: **checked, no change.** §4's "together" and §8's fork
  right are what this ADR now follows more closely.
- **`docs/implementation-plan.md`, `services/ledger/CLAUDE.md`**: **checked, no
  change.** Neither describes the `genesis` keys or line limits. The ledger is
  unstarted; EV-25 is its obligation when it is built.
- **`services/verifier/` and `tools/verifier-ts/` docs**: **not opened**
  (verifier independence). Their builders check them under owed items 1 and 2.

## Charter check

- **Charter §4 (anchoring).** Directly served: a fork's record of its parent is
  now always §4's identity and head, together.
- **Charter §8 (exit is a right).** Served: every recorded ancestry claim can be
  checked in full by anyone holding the parent export. EV-25's permanence keeps
  EV-8's promise that an old verifier still checks a newer chain, and that
  promise is what the fork right relies on.
- **P1 (the log is the only truth).** Served: limits can no longer turn a
  verifier crash or a guessed verdict into a claim about the log. Past its
  limits a verifier says it could not decide.
- **P2/P3/P4.** Untouched. No ballot, plane, tally or participation rule moves.
