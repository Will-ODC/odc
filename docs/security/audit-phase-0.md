# Phase 0 Security Audit — `contracts/`, fixtures, and the two verifiers

**Ticket:** T9 (phase gate: DRAFTING → RELEASE CANDIDATE)
**Date:** 2026-08-14
**Auditor context:** fresh. Never saw the design conversation, the ADRs, the
running open-questions list, or any implementation discussion.

---

## Verdict

# REQUEST CHANGES

Five blocking findings. None is a defect in what the spec _says_; all five are
things the spec does not say, in places where silence is load-bearing and where
the freeze makes the silence permanent. The specification itself is, on the axes
it addresses, the most disciplined I have audited — see "What is sound" below,
which is a result, not a courtesy.

The blockers cluster into three fixable decisions and two missing normative
sentences:

| #   | Finding                                                         | Why it gates RC rather than freeze                                               |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| F1  | `chain_id` does not identify a chain                            | Shapes `genesis`, which Phase 1 builds first; unfixable after freeze             |
| F2  | Ballot timing and ordering are an unmitigated linkage channel   | Shapes the ledger write path, the first Phase 1 deliverable                      |
| F3  | An unregistered `genesis` version yields an undefined verdict   | Shapes `evolution.md` and the verifier conformance suite                         |
| F4  | Charter §8's fork/exit right is not expressible in the contract | Charter violation; genesis is pinned at `version` 1, so it cannot be added later |
| F5  | Nothing bars a sentiment/monetizable event type from this chain | `evolution.md` is the rulebook that decides this, once                           |

---

## Scope and method

**Tree audited.** The T9 sandbox snapshot of the repo: `contracts/` (8 specs +
`CONTRACTS-CHANGE.md`), `contracts/fixtures/` (83 vectors, `index.json`,
`derivations.json`, `MANIFEST.sha256`, 2 preimages), `services/verifier/` (Go),
`tools/verifier-ts/` (TypeScript), `tools/fixtures-gen/`, `tools/rehearsal/`,
`docs/charter.md`, `docs/implementation-plan.md`, the service `CLAUDE.md`/
`README.md` files, and CI (`.github/workflows/`, `.github/scripts/`).

**What I did, beyond reading.**

1. Implemented `hashing.md` HA-1–HA-17 and `export-format.md` EX-7–EX-9 from
   the prose alone, in ~60 lines of Node, without looking at either verifier's
   encoder. It reproduced the §6 worked example's hash
   `78ed980bdd5f660fd54ddffa100f2302094678e8500188e8faacc8ac57f6409a` on the
   first run. This is the charter §4 claim ("a stranger can write an independent
   verifier in an afternoon") tested and passed.
2. Built the Go verifier and ran it against all 83 fixtures independently of the
   project's own test harness: **83/83 verdict tokens match `index.json`**, and
   all `INVALID` line numbers and `PARTIAL` line enumerations match. Built the
   TypeScript verifier and cross-checked it on every adversarial case I
   constructed. The stated factual context holds up.
3. Constructed four adversarial exports the fixture set does not cover and ran
   both verifiers on each (F1, F3, S4 below). Artifacts and generator are
   reproducible from the snippets in this document.

**What I could not see, and why.** `memory/STATE.md`, `memory/OPEN-QUESTIONS.md`,
`docs/decisions/` (all ADRs), and `docs/plans/` are absent from the sandbox by
design, so that this read is not anchored to conclusions the designers already
reached. Consequences to keep in mind when reading: where a finding below says
"undecided", it may in fact be an open question already filed — I would not know,
and the specs, which are the artifact a stranger gets, do not say. I read the
ADRs only through the citations `contracts/` and `CONTRACTS-CHANGE.md` carry.

**Prior work.** `_input/posture-audit-STALE-INPUT.md` (2026-07-26, `3bad0bc`)
was mined, not inherited. Its S1 (stale voter-signed-ballot text in
`implementation-plan.md` and `services/ledger/CLAUDE.md`) is **fixed** in this
tree — plan §41–44 and `services/ledger/CLAUDE.md:6` now state the ADR-0004
registrar model correctly. Where I disagree with it is marked inline (S2, S3).

---

## Findings

### [BLOCKING] F1 — `chain_id` names an operator, not a chain, so the operator can equivocate with two chains of identical identity

`event-types.md:168` (ET-7): _"`chain_id` MUST equal … `sha256(operator_pk_bytes)`
… This binds the chain's identity to its operator key with no free parameter."_

The absence of a free parameter is the defect. `chain_id` is a pure function of
`operator_pk`, so it is constant across **every** chain that operator will ever
start. Nothing in `contracts/` requires a chain to be unique per `chain_id`, and
no verifier input names a chain.

**Constructed attack (verified against both verifiers).** Using the published
test seeds from `hashing.md` §6, I built two complete chains that differ only in
the genesis `ts` — one millisecond apart — and then diverge into opposite
outcomes on the same question:

```
operator_pk 8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c
chain_id    34750f98bd59fcfc946da45aaabe933be154a4b5094e1c4abf42866505f3c97e   <- IDENTICAL

chain A: genesis(ts=…00.000Z) -> issue "Shall the treasury fund plan Y?" -> votes 1,1,1,0   (Y wins 3–1)
chain B: genesis(ts=…00.001Z) -> issue "Shall the treasury fund plan Y?" -> votes 0,0,0,1   (Y loses 1–3)

go verifier: chainA VALID   chainB VALID
ts verifier: chainA VALID   chainB VALID
```

Both genesis events are correctly self-signed under `operator_pk` (ET-8), both
derive `chain_id` correctly (ET-7), both pass ET-9b/ET-4b/ET-4c. Audience 1 is
shown chain A, audience 2 chain B. Each verifies. Each is told the chain's
identity is `34750f98…`, and each confirms it. The two audiences can compare
`chain_id` values all day and learn nothing.

`--head` does not close this. A head names a **position**, not a chain: audience
1's anchored head is a valid head _of chain A_, and the operator simply anchors
only chain A while showing chain B to audience 2 — or anchors both under the same
`chain_id` at different times. Charter §4 makes non-equivocation depend on
anchoring; anchoring depends on there being a thing to anchor _to_, and ET-7 does
not provide one.

**Why this cannot wait for the freeze.** The `genesis` payload key set is fixed
by ES-18, and ET-6 pins `genesis.version` to `1`. EV-1 forbids altering a frozen
`(type, version)`. After the freeze there is no legal way to add a nonce, an
ancestor, or any other distinguishing field to genesis — the type is closed.

**Fix (cheap now).** Either (a) add a `genesis_nonce` key (32 bytes hex,
operator-chosen, no other semantics) so distinct chains have distinct genesis
events by construction and `chain_id` can be redefined over it; or (b) far
simpler and requiring no new field: state normatively that **a chain's identity
is its `genesis` event's `hash`**, demote `chain_id` to what it actually is (a
redundant restatement of `operator_pk`), and give the verifier a `--chain
<genesis-hash>` input alongside `--head`. Option (b) is a definitional sentence
plus one CLI flag and one fixture. Under (b) my two chains have different
identities and the attack collapses.

---

### [BLOCKING] F2 — Ballot timing and chain position are an unmitigated linkage channel; the spec leaves receipt-freeness to implementer discretion

Charter §5: ballots are _"Secret, equal, unlinkable — always"_ and
_"Receipt-free by design. No one can prove how they voted, even voluntarily."_
`event-types.md:306–312` (ET-21) argues this holds structurally because the
ballot carries no voter fingerprint. **ET-21 is correct about what it claims and
incomplete about what receipt-freeness requires.** It proves the voter retains no
artifact. Coercion does not need the voter to retain an artifact — it needs the
_coercer_ to be able to check.

**What the spec publishes about every ballot.** From `chainA.ndjson` line 3, a
fully conformant ballot:

```json
{
  "seq": 3,
  "type": "vote_cast",
  "version": 1,
  "payload": { "choice": 1, "issue_id": "d17e3f82…", "sig": "86cfcd9a…" },
  "ts": "2026-08-01T10:03:00.000Z",
  "prev_hash": "…",
  "hash": "…"
}
```

`choice` is in the clear. `ts` is pinned by ES-20 to **exactly millisecond
precision**, mandatory, and hash-covered (ES-22). `seq` is arrival order (ES-8).

**Constructed attack.** A coercer needs no cooperation from the log and no
artifact from the voter:

1. The coercer tells the voter: _"vote for choice 1, from this room, and click
   at 10:03."_ (Or simply watches them, or shares a household, or is their
   employer, or supplied their device.)
2. The coercer polls `GET /events?since=N`. **RA-12 exists specifically to make
   tail-polling easy** — _"This lets a client poll the tail without
   special-casing 'caught up'."_ RA-13 makes the endpoint unauthenticated.
3. One new `vote_cast` line appears at `ts` 10:03:0x.xxx. Its `choice` is
   readable. If it is `1`, the voter complied; if `0`, they did not.

The voter cannot lie, cannot equivocate, and cannot point at a decoy — because
the coercer, not the voter, is holding the proof. Receipt-freeness has failed
without any voter-held key, which is precisely the failure mode ADR-0004 and
ET-22 were built to prevent by a different route.

**A second, sharper instance of the same channel.** `participant_registered`
(public plane, `pubkey` in the clear, publicly linkable to a named human) and
`vote_cast` (ballot plane) share **one chain, one seq space, one export, one
endpoint**. Fixture `002-four-types` is the canonical illustration: line 2 is a
registration, line 4 is a ballot. On a live chain a participant who registers and
then votes within the same minute is identifiable by adjacency alone. Charter P2
guarantees the two identities _"cannot be linked"_; the contract places them
2 lines apart with millisecond timestamps and no rule against it.

**The spec is silent, so two conforming ledgers differ on whether this system is
receipt-free.** Nothing in `contracts/` requires or forbids: quantizing ballot
`ts`, batching ballots, shuffling within a batch, delaying ballot publication, or
segregating ballot lines from public-plane lines. A ledger that appends each
ballot the instant the registrar signs it is fully conformant and fully coercible.
A ledger that publishes ballots in shuffled hourly batches with `ts` quantized to
the batch is _also_ fully conformant. That is a security-relevant divergence
between two conforming implementations, and it is the exact failure class this
project has already been bitten by once.

**Fix (cheap now, and it does not touch the wire format).** Add a normative
producer rule — ES-20's format is unchanged, only the _value_ is constrained:
ballot `ts` MUST be quantized to a published batch interval, ballots MUST be
appended in a batch whose internal order is independent of arrival order, and a
batch MUST NOT be published until it contains at least _k_ ballots or the issue
closes. Say plainly in ET-21's residuals that timing correlation is the residual
this rule addresses. `k`, the interval, and the liveness cost are the design work
(see Q-B).

---

### [BLOCKING] F3 — A chain whose `genesis` carries an unregistered version can be verified without a single signature ever being checked, and the spec does not say what verdict that gets

`evolution.md:68–97` (EV-7/EV-8/EV-9) and `evolution.md:141–169` (EV-15) define
the two-stage model. Stage B — every signature check (ET-8/ET-10/ET-13/ET-17)
— runs only for `(type, version)` pairs in the verifier's registry. The chain's
**verification keys live in the genesis payload**, and reading them is itself
Stage B (ES-18 payload key set, and every ET-\* rule, are Stage B per EV-15).

So: put the genesis at an unregistered `version`, and the verifier cannot extract
`operator_pk` or `registrar_pk` at all. Every later signature becomes uncheckable.
EV-7's `PARTIAL` definition — _"Stage A passes for the whole chain and no
registered event fails Stage B"_ — does not say whether an event whose key is
_unavailable_ has "failed" Stage B or merely gone unchecked. Both readings are
defensible from the text.

**Constructed attack.** A chain whose genesis is at `version` 1000000 (the value
EV-19 reserves), signed by an attacker key, followed by an `issue_created` and a
`vote_cast` at the **registered** version 1, also signed by the attacker:

```
go verifier: INVALID at line 2: issue_created before usable genesis keys
ts verifier: INVALID at line 2
```

The two verifiers agree — and **no normative sentence produces that agreement.**
The Go reason string "issue_created before usable genesis keys" cites no rule id,
because there is no rule to cite. A third implementation, written by the stranger
charter §4 invites, reading EV-8 (_"a verifier MUST NOT report `INVALID` solely
because a well-formed event has an unregistered `(type, version)`"_) and EV-15's
Stage A/B split literally, can conclude: Stage A passes on all three lines, the
genesis is merely unregistered, the later events' signatures could not be
checked, therefore `PARTIAL` at line 1. That verdict means _"integrity confirmed,
some semantics unchecked"_ — announced over a chain on which nothing was ever
authenticated.

**There is no fixture for this.** Vectors 008–011 exercise unregistered types and
versions only on non-genesis events; 009 and 070 use a `participant_registered`
at version 1000000. The one position where an unregistered version destroys the
whole trust chain is untested.

**Fix.** One normative sentence in `evolution.md` — the `genesis` event's
`(type, version)` MUST be registered by the verifier, and a chain whose genesis
is unregistered is `INVALID` at line 1 (Stage A promotion for genesis alone,
justified because genesis is the only event whose payload the verifier must read
to check any other event) — plus a fixture pinning `INVALID` line 1. Note this is
the general form of the neighbouring hole the prior posture audit's S3 alludes to
("an unregistered `genesis` version leaves a verifier unable to extract keys at
all"); it is sharper than S3 framed it, because the failure is not "cannot check"
but "may report success".

---

### [BLOCKING] F4 — Charter §8's fork-and-exit right is not expressible in the contract (charter violation)

Charter §8, "Exit is a right": _"the community can fork — the export, the
software, the rules, and keys-as-identity mean a community can **re-declare
genesis anchored to the old chain's head** and continue elsewhere without
anyone's permission."_ Charter §12 and §8 mark exit as the discipline on the
operator, i.e. load-bearing whether or not it is ever used.

The contract makes the anchored re-declaration impossible:

- `event-schema.md:135–138` (ES-24) — the first event's `prev_hash` **MUST** be
  64 zeros. There is no slot for the ancestor head.
- `event-types.md:158–164` — the `genesis` payload is exactly
  `{chain_id, contracts, operator_pk, registrar_pk, sig}`, and ES-18 makes that
  key set closed.
- `event-types.md:166` (ET-6) — `genesis.version` **MUST** be `1`. So the usual
  additive escape (define version 2 with an extra key) is barred for this one
  type, and EV-1 forbids altering the frozen v1 schema.

After the freeze there is no conforming way for a forked community to record
what it forked from, at the point where it matters.

**The two available workarounds, and why neither is adequate.** (a) Smuggle the
ancestor head into the `contracts` string — ET-9 requires only "non-empty" and
assigns it no structure, so two implementations would parse it differently and no
verifier would check it; that is inventing an unspecified field inside a field.
(b) Record ancestry in a new additive event type at `seq` 2 — legal under EV-1,
but it is not _genesis_ anchoring: the fork's first event is then unanchored, and
a verifier has no rule tying the ancestry claim to the chain's start.

**Fix.** Decide now, before genesis is frozen: add an optional `ancestor_head`
key (64 lowercase hex, or the 64-zero anchor for an original chain) to `genesis`
v1 — free today, impossible after the tag — **or** amend the charter sentence to
describe what the contract actually supports. Either is acceptable; leaving the
charter promising something the frozen artifact cannot do is not.

---

### [BLOCKING] F5 — `evolution.md` permits a sentiment or monetizable event type on this chain, which the charter and the repo's non-negotiable rules forbid

Charter §6: _"Votes and sentiment stay separate primitives … They are never
conflated."_ Charter §8: _"Monetizable data is a separate, labeled stream … an
application of the existing votes-vs-sentiment separation"_, and _"Ballots are
outside commerce, by construction and forever … guaranteed structurally, not by
policy."_ Repo non-negotiable rule 7: _"Ballot events and sentiment events never
share a store or a pipe."_ `implementation-plan.md:81` says the sentiment
service's _"separation from ballots is a Phase 0 schema decision even though the
service comes much later."_

`evolution.md` is where that Phase 0 schema decision would live, and it is not
there. EV-1 permits **any** new event type additively. ET-22 and EV-13 already
demonstrate the project knows how to write a permanent bar — they do it for
receipt-bearing ballot changes and for ballot corrections, in language that
explicitly _"survives any future community vote"_. The mirror rule for the
sentiment plane is simply absent. As written, a future `sentiment_response` type
is legal on this chain, and it would then share the store (one log), the pipe
(one export, one `GET /events`), and the seq space with ballots — a rule-7
violation reached entirely through conforming, additive evolution.

Worse, it would be a violation with the F2 correlation channel already present:
sentiment events are opt-in, labeled, and monetizable, therefore plausibly
identity-attributed, and they would sit adjacent to ballots in the same seq space
with millisecond timestamps.

**Fix.** One `EV-` sentence mirroring EV-13: no contracts version may register on
the governance chain any event type carrying sentiment, survey, poll, or other
opt-in monetizable response data; that plane has its own store and its own
commitment path (`implementation-plan.md:81`: _"commits only anonymous hashes to
`ledger`"_), and only those anonymous commitments may appear here. State it as
permanent, in the ET-22/EV-13 register.

---

### [SHOULD] S1 — The contract permits `registrar_pk == operator_pk`, collapsing "who sets the questions" and "who may vote" into one key, undetectably

`event-types.md:179–184` (ET-9a): _"The contract imposes no relation between
`registrar_pk` and `operator_pk`. Operationally they SHOULD be distinct keys …
This separation is policy, not verifier-enforced."_

A conforming chain may declare the same key twice. The holder can then mint
issues _and_ forge every ballot on them, and the verifier reports `VALID` with
nothing on the line to signal it — the same argument ET-9b makes for the
lowercase-hex check ("A verifier that omits this format check therefore accepts a
`genesis` that ET-9b requires it to reject, with nothing else on the line to
signal the fault"), applied to a much larger fault.

Requiring `registrar_pk != operator_pk` is one comparison, verifier-checkable
from the export, and free before freeze. It is necessary-not-sufficient — one
party can still hold both distinct keys — but this spec has repeatedly adopted
necessary-not-sufficient checks (ET-9b, ET-4b) on exactly that reasoning, and the
sufficient version is undecidable from the log. Charter P2/P3 are the stakes.

### [SHOULD] S2 — The registrar's signature is a 64-byte, registrar-chosen, permanent public field on every ballot: a subliminal channel that can carry the voter's identity forever

`hashing.md:140` (HA-16) requires _"the Ed25519 signature over `SIGN_PRE(E)`"_.
RFC 8032 Ed25519 is nonce-deterministic by _definition_, but **the verification
equation does not check determinism** — a signature with an attacker-chosen `R`
verifies exactly as well. ET-4a constrains `R` and `S` to canonical _encodings_;
it constrains nothing about their _content_. `R` is 32 bytes the registrar picks.

A compromised, compelled, or merely curious registrar can therefore encode, in
every ballot's `sig`, a value derived from the voter's identity — e.g. the low
bits of an encryption of `participant_id` under a key the registrar keeps. Every
verifier reports `VALID`. Every fixture passes. The linkage is then **published,
permanent, unerasable, and offline-decryptable at any future date** by anyone who
obtains that key.

**This is where I disagree with the prior posture audit.** Its §1 states that the
registrar's admission knowledge `{voter, issue, choice}` is _"the only artifact in
the entire v1 system that connects a human to a ballot"_. That is not right. The
admission knowledge is transient, private, minimizable, and deletable — its M1/M3
mitigations are exactly that. The subliminal channel is none of those: it lives in
the append-only public record the whole project exists to make permanent, and no
retention policy, key rotation, or identity-v2 migration can remove it after the
fact. It should be ranked at least alongside the admission knowledge, and it is
the one ballot-secrecy risk that gets _worse_ with time rather than better.

There is no clean v1 fix — you cannot verify a nonce you cannot recompute. What
is owed now is (a) an honest entry in ET-21's residuals, and (b) the design
question in Q-F.

### [SHOULD] S3 — `--head` is optional, no verifier is required to report the head it computed, and the anchoring artifact is specified nowhere

`export-format.md:100` (EX-15): _"A verifier **MAY** be given an expected head."_
EX-16 then rests the entire anti-truncation story on it: _"Detecting that lines
were dropped from the end REQUIRES an out-of-band expected head."_ Truncation is
deletion — the one mutation the format cannot self-detect — and the defence is
optional and specified in another document (charter §4) as an operational
practice, with no contract for what is published, in what format, at what
cadence, or where.

Compounding it: neither CLI prints the head it computed (I checked — both emit
only the verdict token), and no rule requires it. A member of the public who does
_not_ already hold an anchor therefore gets nothing they can compare, publish, or
gossip. Requiring the verifier to print the computed head on every run is one line
of output and turns every verifier user into a witness — which is the actual
mechanism by which transparency logs resist equivocation.

I would raise this above the prior audit's S9 ("Low/Medium"), for the reason F1
gives: with `chain_id` non-identifying, the anchored head is not one defence among
several, it is the _only_ thing standing between the operator and the two-chain
attack demonstrated above.

### [SHOULD] S4 — No fixture pins the ill-formed-UTF-8 rejection, and the reference stdlib silently does the wrong thing

`hashing.md:45` (HA-2): _"An implementation MUST reject a string whose decoded
value is not well-formed UTF-8."_ EX-9 forbids `\u` escapes above U+001F, so an
unpaired surrogate cannot even be written. The rule is correct and complete.
**No vector exercises it** — 83 fixtures, none for an unpaired surrogate escape or
raw ill-formed UTF-8 octets.

This matters because Go's `encoding/json` silently substitutes U+FFFD for
ill-formed input, which collapses distinct strings onto identical preimages —
`tools/fixtures-gen/src/encode.ts:66-67` documents exactly this hazard, so the
project knows about it in the generator but never pinned it in the conformance
set. I constructed the case (an `issue_created` whose stored `title` carries the
raw octets `ED A0 80` while the hash was computed over the U+FFFD replacement):

```
go verifier: INVALID at line 2: non-canonical line form (EX-7..EX-10)
ts verifier: INVALID at line 2
```

Both currently reject, so this is a coverage gap rather than a live divergence.
But `CONTRACTS-CHANGE.md:302` records that a surrogate-encoding assumption bit
this project once already, and `fixtures/` becomes immutable at the tag —
after which the vector cannot be added as a _golden_ case, only appended.
Add two vectors now: an unpaired surrogate escape, and raw ill-formed octets.

### [SHOULD] S5 — No key-compromise story, and the published test keys remain the path of least resistance

Two items, one carried forward from the prior audit and one extended.

_Rotation (extends prior S3)._ The v1 registry has no rotation or revocation
type, and `evolution.md` says nothing about what a frozen verifier should do when
it meets one. Because a ballot carries nothing but `{issue_id, choice, sig}`, a
leaked `registrar_pk` yields forged ballots byte-indistinguishable from genuine
ones, retroactively, for every issue — and the verifier will correctly call them
`VALID`. F3 is the sharp edge of this: a rotation event at an unregistered
`(type, version)` today lands in exactly the undefined region F3 describes.

_Test keys (prior A-2/S7, still open)._ The seeds `0x01…01` and `0x02…02` in
`hashing.md` §6 have no mechanical guard against production reuse, and the
warning still lives only in `fixtures/derivations.json`. Concretely: **I signed
the entire F1 equivocation demo with them in about a minute**, straight from the
spec text. Publishing them is right; a genesis-time deny-list costs nothing and
converts a catastrophic mistake into a startup error.

### [NIT] N1 — The ET-4a/ET-4b/ET-4c rejections are reported as generic signature failures

Fixtures 078–082 pass (verdict + line are what conformance judges, EV-17), but
both verifiers report them as `"signature invalid under pubkey (ET-10)"` rather
than naming the canonical-encoding or prime-order rule. EV-17 makes reason text
advisory, so this is conformant — but these are precisely the checks ADR-0009 and
ADR-0010 were written to add, and the diagnostic that would tell an operator
_which_ one fired is absent.

### [NIT] N2 — `contracts` is advisory to the point of being inert

ET-9 makes the `contracts` string carry no verification weight. A chain may
declare `contracts-v1` while running any rules at all, and no verifier is asked to
compare it against its own registry. Consider a SHOULD-warn when the declared
version is unknown to the verifier — useful precisely in the F3 scenario.

### [NIT] N3 — 200 scalars of arbitrary operator text, permanent, with no erasure path

ET-14 is charter-compliant ("titles only", charter §5 MVP), and
`implementation-plan.md:25` says the no-free-text rule _"keeps erasure obligations
out of the permanent record"_. A 200-character operator-chosen title on an
append-only log is still an erasure-obligation surface — a name fits in it easily.
Worth one sentence acknowledging the residual.

### [NIT] N4 — EX-14 states a computational property as an identity

_"any two valid exports with the same head are identical up to that point"_ is
true under SHA-256 collision resistance, not unconditionally. Worth the four
words, since this sentence is the one a reader leans on when reasoning about
anchoring.

---

## The three gate questions, answered

### 1. Identity leakage — _does any field, id derivation, hash preimage, export artifact, or read surface reveal or narrow who cast a ballot?_

**Direct leakage: none found, and I looked hard.** What I checked and cleared:

- Every payload key of all four v1 types. `vote_cast` is `{issue_id, choice, sig}`
  — no `participant_id`, no pubkey, no voter-derived value. ET-21's claim is
  accurate as stated.
- Both id derivations. `participant_id = sha256(pubkey_bytes)` (ID-4/ID-5) is over
  material that is already public by design; `issue_id` is an event hash (ID-7).
  Neither takes voter input.
- The hash preimage (HA-11) — six content fields, no hidden inputs, no salt, no
  identity-derived material; I reimplemented it and confirmed byte-for-byte.
- The export (EX-1–EX-20) — carries exactly the event objects, nothing more.
- The read API surface, including its **error** surface: RA-11 defines exactly two
  codes, `bad_since` and `bad_limit`, neither parameterized by content. RA-5's
  envelope adds only `next` and `head`. No metric, log-line, or diagnostic field
  is defined anywhere in `contracts/` that could carry a linkage-map field. The
  linkage map is correctly absent from the contract surface entirely.
- The verifier output surface (EV-17): verdict token, line numbers, advisory text.
  Nothing derived from ballot content.

**Correlation and side channels: one serious failure — F2.** `ts` at mandatory
millisecond precision, `seq` as arrival order, `choice` in the clear, both planes
in one chain, and an unauthenticated tail-pollable endpoint together let anyone
who knows _when_ a person voted read _what_ they voted. Chain position and event
counts leak turnout in real time, which is intended and public, but they leak it
at a resolution fine enough to single out individuals. Nothing joins ballot data
to identity data _inside_ the log; the join is made outside it, against any
separately observable fact about timing — which is exactly what the question asks
about.

### 2. Receipt-freeness — _can anyone construct proof to a third party of how a specific ballot was cast, using only artifacts the spec defines or permits?_

**Against a voter acting alone with only spec-defined artifacts: no. ET-21 holds,
and I tried to break it.** What I attempted:

- _Retained artifact._ The voter holds no key, contributes no payload field, and
  cannot predict the ballot's `hash` (it covers `seq`, `ts`, and `prev_hash`,
  all assigned after submission). ADR-0004's design is sound here.
- _Reproducing the signature._ `sig` is registrar-produced over `SIGN_PRE(E)`;
  the voter cannot recompute or forge it, so "here is my ballot's signature" is
  not a claim they can make.
- _Pointing at a line._ Uncorroborated and unfalsifiable — the voter can name any
  line carrying the demanded `choice`, which is ET-21's argument and it is correct.
- _Ballot-to-ballot linkage._ Two ballots by one voter share no field. Confirmed
  against the schema.
- _Inclusion proof._ Deliberately absent (ET-21). Correct call, correctly reasoned.

**Against a coercer who observes the voter: yes — see F2.** The proof is not
constructed by the voter; it is read off the public log by the coercer, using the
ballot's timestamp and the fact that `choice` is public. Charter §5's standard is
_"No one can prove how they voted, even voluntarily"_, and the _"only impossible
proof protects the coercible"_ argument applies with full force to a proof the
coercer assembles.

Two secondary channels, both bounded but real: `choice_count ≤ 64` (ET-14a)
bounds but does not eliminate the marker attack when an issue has few voters —
with 64 buckets and a small electorate a coercer can partition and check
(open question Q-B covers the k-anonymity floor); and the registrar's subliminal
signature channel (S2), which is a proof to a third party _about_ the voter,
constructible by the registrar, permanent.

### 3. Operator equivocation — _can the operator, fully conformant, show two different valid chains to two audiences without detection?_

**Yes. Demonstrated, end to end, against both verifiers — see F1.**

Two chains, identical `chain_id`, opposite outcomes, both `VALID`, differing only
in a one-millisecond genesis timestamp. The operator needs only their own
`operator_pk` and `registrar_pk` — no forgery, no non-conformance, no verifier bug.

What I checked on each of the sub-cases the question names:

- _Genesis re-issuance._ Unlimited. `chain_id` is a function of `operator_pk`
  alone (ET-7), so every re-issuance carries the same identity. This is the
  attack above.
- _`chain_id` collision or reuse._ Reuse is not merely possible, it is
  **mandatory** — every chain that operator starts has the same one. No rule
  anywhere requires uniqueness.
- _Forks._ A common-prefix fork diverging at any later `seq` also verifies on both
  branches (I built `fork1`/`fork2`, same genesis and same first ballot, opposite
  second ballot: both `VALID`). Nothing in the contract detects a sibling.
- _Re-signing._ An operator holding both keys can rebuild any suffix of the chain
  from any point. S1 notes the contract does not even require the two keys to be
  distinct.
- _What a verifier must check about chain identity and head continuity:_ **nothing
  and nothing.** There is no chain-identity input at all; `--head` is optional
  (EX-15) and names a position, not a chain; and RA-8 correctly warns that the
  API's own `head` is not the anchor — but no spec then says what _is_.

The contract's only counter is the out-of-band anchored head, which lives entirely
in charter §4 prose. F1 and S3 are the two halves of closing this.

**Standard checklist items, for completeness.** _Does the spec permit mutation or
deletion semantics anywhere?_ Not directly: EV-1 forbids removing a type or
altering a frozen schema; EV-11/EV-12 corrections are explicitly derived-view only
with no envelope machinery; EV-13 excludes ballots permanently; RA-13 forbids
`POST`/`PUT`/`DELETE` on the read endpoint; there is no `supersedes` in the
envelope and ADR-0005 says there never will be. The one deletion the format
tolerates is end-truncation (EX-16), honestly documented and left to an optional
flag — S3. _Are ballot and sentiment planes kept separate by contract or by
convention?_ By convention only, and F5 is that finding.

---

## Findings that need design work rather than a fix

Stated as questions, for filing in `memory/OPEN-QUESTIONS.md`:

- **Q-A (from F1, S3).** What is a chain's identity — the genesis event hash, a
  nonce-bearing `chain_id`, or something else — and what exactly does an anchor
  publish (identity, head, seq, at what cadence, in what venue outside operator
  control) so that a missing anchor is itself detectable?
- **Q-B (from F2).** What batch interval, timestamp quantization, and minimum
  batch size _k_ make ballot publication receipt-free against an observer who
  knows when a voter voted — and what is the acceptable liveness cost of the
  resulting delay between casting and appearing?
- **Q-C (from F3).** What verdict must a verifier return for a chain whose
  `genesis` `(type, version)` it does not register, and therefore whose keys it
  cannot extract? Is genesis registration a Stage A requirement?
- **Q-D (from F4).** How does a forked community record its ancestor head, given
  that `prev_hash` at seq 1 is fixed at 64 zeros and `genesis` is pinned to
  `version` 1 — an optional `ancestor_head` key added before freeze, or a charter
  amendment?
- **Q-E (from F5).** May a sentiment or monetizable-response event type ever share
  the governance chain, and what permanent `evolution.md` rule makes the answer
  survive a future community vote, as ET-22 and EV-13 do for ballots?
- **Q-F (from S2).** The registrar chooses 64 bytes of published, permanent
  signature per ballot and can encode voter identity in them undetectably. What,
  if anything, mitigates this in v1 (attested builds, threshold/split registrar
  signing, published nonce derivation), and does it move blind-signature
  credentials off the charter §11 deferred list?
- **Q-G (from S5).** What is the key-compromise story for `operator_pk` and
  `registrar_pk`, and what must a verifier frozen at `contracts-v1` do when it
  encounters a future rotation or revocation event?

---

## Where the spec is silent and two conforming implementations could diverge

The project has been bitten by this class once already
(`CONTRACTS-CHANGE.md:302`, the astral surrogate-escape case). Ranked by
consequence:

1. **Verdict for an unregistered `genesis` version (F3).** Verdict-level
   divergence — `INVALID` at line 2 versus `PARTIAL` at line 1 — over a chain on
   which no signature was verified. Both current verifiers agree by convergent
   reasoning, not by rule. No fixture.
2. **Ballot publication timing (F2).** Not a verifier divergence but a _producer_
   divergence, and the property that differs is receipt-freeness itself. Two
   conforming ledgers, one coercible and one not.
3. **Whether `--head` is supplied, and whether the head is reported (S3).** EX-15
   is `MAY`; EX-16's "MUST be run with `--head`" binds a procedure, not a tool.
   Two conforming deployments differ on whether end-truncation is detectable at
   all, and neither CLI emits the head a user would need to notice.
4. **Ill-formed UTF-8 (S4).** Specified by HA-2 but unfixtured, over a stdlib
   behaviour (U+FFFD substitution) that silently collapses distinct values onto
   one preimage.
5. **`contracts` version mismatch (N2).** No verifier is required to notice or
   report that a chain declares a contracts version it does not implement.

---

## What is sound

Stated plainly, because a clean result at a gate is a deliverable and because
four of the five blockers above are omissions rather than errors.

- **The hashing construction is right and it is reproducible from the prose
  alone.** Explicit byte-string construction over length-prefixed fields with a
  domain separator (HA-3, HA-10), a type tag closing the `0`/`""` equal-length
  collision (HA-9, with the collision spelled out octet by octet), key ordering
  fixed to UTF-8 byte order (HA-8), integers fixed to `U64` big-endian over a
  range that round-trips in both target languages (HA-1, ES-5), no normalization
  of any form (HA-2), and the signing preimage defined as an exact deletion that
  perturbs nothing else (HA-15, HA-17). I built it from the text and hit the §6
  digest first try.
- **The strict-rejection stance (D5) is applied without exception,** and
  export-format §2 correctly separates the value-based `hash` from the byte-based
  canonical line, with EX-11 explaining precisely why both are needed. That is a
  distinction most specs get wrong.
- **The Ed25519 hardening exceeds normal production practice.** ET-4a
  (canonical `R`/`S`), ET-4b (canonical `A`), ET-4c (prime-order subgroup, with
  the `A != 𝒪` clause called out as load-bearing because
  `isTorsionFree()` alone returns true for the identity), and ET-9c (validation at
  the declaration site, not at first use) close real, exploitable gaps —
  including the degenerate identity self-signature. Fixtures 078–083 pin all of
  them. ET-9c in particular closes a genuine two-verifier divergence.
- **The two-stage verification model (EV-6/EV-15) is the right shape,** and
  EV-15's exhaustive stage assignment — with the explicit note that the `sig`
  clause of EX-11 is Stage B — is the kind of precision that prevents
  verdict-determining drift. EV-16's reasoning (a payload with no computable
  preimage cannot be `PARTIAL`) is exactly correct. F3 is a hole in this model,
  not a refutation of it.
- **EV-18/EV-19's reserved `x_` prefix and reserved version 1000000** are a
  genuinely clever defusing of the frozen-fixture time bomb, and the rationale is
  written down.
- **ET-21/ET-22 and EV-13** get the ballot-plane design right on the axis they
  address: no voter-held key, no voter-produced signature, no unbounded
  voter-chosen value, no correction pointer, ever. The residuals are stated
  honestly rather than argued away. F2 and S2 are channels ET-21 does not
  consider, not errors in what it does consider.
- **RA-8** correctly refuses to let the API's own `head` masquerade as the
  anchor — a discipline that is easy to get wrong and consequential.
- **The 83 fixtures** are well-chosen, cite their rules, and both verifiers pass
  all of them on verdict and line. I verified this independently of the project's
  own harness.

---

## Reproducing the constructed attacks

All four exports were produced by a ~60-line Node implementation of `hashing.md`
and `export-format.md` written from the specs, and verified with both CLIs:

| Artifact                          | Demonstrates                                             | Go                | TS                |
| --------------------------------- | -------------------------------------------------------- | ----------------- | ----------------- |
| `chainA.ndjson` / `chainB.ndjson` | F1 — two chains, one `chain_id`, opposite outcomes       | `VALID` / `VALID` | `VALID` / `VALID` |
| `fork1.ndjson` / `fork2.ndjson`   | F1 — common-prefix fork, undetectable                    | `VALID` / `VALID` | `VALID` / `VALID` |
| `downgrade.ndjson`                | F3 — unregistered genesis version, nothing authenticated | `INVALID` line 2  | `INVALID` line 2  |
| `illutf8.ndjson`                  | S4 — raw ill-formed UTF-8 in a title                     | `INVALID` line 2  | `INVALID` line 2  |

The generator uses only the published test seeds `0x01…01`, `0x02…02`,
`0x03…03`, `0xee…ee` from `hashing.md` §6 and `fixtures/derivations.json`.
