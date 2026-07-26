# Security Posture — Secret Inventory, Attack Surface, Concealment Timeline

**Date:** 2026-07-26 · **Tree audited:** `master` @ `3bad0bc` (T5a hardening, PR #22)
**Phase:** 0 (contracts DRAFTING, pre-release-candidate) · **Repo:** public,
`github.com/Will-ODC/odc`

> **This is not the T9 audit.** T9 (`docs/plans/phase-0.md`) is an adversarial
> audit of `contracts/` + fixtures + rehearsal results, run by a fresh context
> that did not design them, and it gates the release candidate. This document is
> a posture review: what secrets exist, what an open repo legitimately exposes,
> and when operational concealment starts earning its keep. It does not
> substitute for T9 and does not clear its gate.

**Framing.** Verifiability-first. Kerckhoffs's principle holds throughout: the
system must stay secure when an attacker knows every detail of how it works.
Nothing below recommends closing source. The question is never "what code should
we hide" — it is "what secrets exist, and are they held correctly."

---

## 0. Immediate attention

**No secret is currently exposed.** The repo, its full git history, and its CI
config are clean:

- No `.env`, `.pem`, `.key`, or credential file, tracked or in history.
- No secret-shaped string in any blob across `--all` history (AWS, GitHub PAT,
  OpenAI, Slack, PEM private-key blocks, inline `password=`/`api_key=`).
- No workflow references any GitHub secret. Both workflows trigger on
  `pull_request` (not `pull_request_target`) and grant only read access to
  repository contents. PR-controlled values reach scripts via `env:` rather
  than inline `${{ }}` shell interpolation — the script-injection-safe form.
- The only key material in the tree is **deliberately published test vectors**
  (Ed25519 seeds `0x01…01`, `0x02…02`, `0x03…03`, `0xee…ee`). These are spec
  material, like RFC 8032's vectors. They must stay public.

Two items nonetheless need attention before Phase 1 opens, neither of which is
an exposed secret:

| #                    | Item                                                                                                                                                                                                                                                                                                                 | Why now                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **A-1** (see **S1**) | `docs/implementation-plan.md` §Services→`ledger` and `services/ledger/CLAUDE.md` still describe **voter-signed ballots**, which ADR-0004 removed and `event-types.md` ET-22 permanently bars. The context protocol in root `CLAUDE.md` _requires_ a Phase 1 implementer to read both files before touching `ledger`. | T9a opens Phase 1. The stale text points the first ledger implementer at a charter §5/§8 violation. |
| **A-2** (see **S7**) | The published test genesis keys have **no mechanical guard** against production reuse. The "never use on a real chain" warning exists only in `contracts/fixtures/derivations.json` — not in `hashing.md` §6, where an implementer first meets the seeds, and not in `fixtures/README.md`.                           | T6's rehearsal chain builder is the code most likely to be copied into a real genesis.              |

---

## 1. Secret inventory

**A correction to the threat model as commonly stated.** The linkage between the
anonymous ballot plane and the persistent public plane is **not verifier-held**.
The verifier holds nothing — it is a stateless CLI that reads an export and
emits a verdict, and it must never acquire a secret; that is the whole point of
its independence (`services/verifier/CLAUDE.md`). The linkage lives in two
places, both inside the **identity** service:

1. the **private linkage map** (personhood credential ↔ public-plane pubkey), and
2. the **registrar's admission knowledge** — `{voter, issue, choice}`, which in
   v1 the identity service necessarily observes when it checks eligibility
   before signing a ballot (ET-21, ADR-0004 "honest limits").

(2) is the sharper secret. The linkage map bridges credential to _public_
identity — by design that side is public-facing. The admission knowledge is the
only artifact in the entire v1 system that connects a human to a ballot, and it
is the thing blind-signature credentials (identity v2) exist to destroy.

| Secret                                                        | What its confidentiality protects                                                                                                                     | Where it lives today                                                                                | Where it must live                                                                                                | Exposed?                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **Operator signing key** (private half of `operator_pk`)      | Authorship of `genesis` and every `issue_created`; `chain_id` is `sha256(operator_pk)`, so it _is_ the chain's identity (ET-7)                        | **Does not exist.** Test analogue = seed `0x01`×32, published in `hashing.md` §6                    | Undecided — `OPEN-QUESTIONS.md`: "file, env, or KMS?" Must **never** be held by identity (ET-9a)                  | No                      |
| **Registrar signing key** (private half of `registrar_pk`)    | Every ballot's admission. A holder can forge unlimited ballots on any issue, **undetectably from the log** — ballots carry no other identifying field | **Does not exist.** Test analogue = seed `0x02`×32, published                                       | identity service only, on separate custody from the operator key (ET-9a, ADR-0004 §2)                             | No                      |
| **Private linkage map** (credential ↔ public pubkey)          | Charter P2's two-plane guarantee                                                                                                                      | **Does not exist** — identity is unbuilt. Rules exist in `services/identity/CLAUDE.md`              | Identity's own DB, physically separate from ledger. Never in an API response, log line, or export — no exceptions | No                      |
| **Registrar admission knowledge** `{voter, issue, choice}`    | Ballot secrecy in v1. **The actual ballot↔public bridge.**                                                                                            | **Does not exist.** Acknowledged as a residual in ET-21, ADR-0004, `OPEN-QUESTIONS.md`              | Transient in identity, **never persisted**. Removed structurally by blind signatures in identity v2               | No                      |
| **Participant private keys** (public-plane authorship)        | A named participant's ability to sign `participant_registered` and future position statements                                                         | **Does not exist.** `services/web/CLAUDE.md`: generated and stored client-side, exportable          | Client-side only. Never server-side, never escrowed                                                               | No                      |
| **Sentiment store encryption key**                            | The monetizable data stream (charter §8)                                                                                                              | **Does not exist** — service deferred (implementation-plan "Deferred services")                     | v1: policy + encryption at rest. v2: k-of-n threshold custody, decryption gated on a recorded license-vote event  | No                      |
| **CI / deploy credentials**                                   | —                                                                                                                                                     | **None exist.** No workflow references a secret                                                     | When they arrive: GitHub Actions secrets, least-privilege, never in `pull_request`-triggered workflows            | No                      |
| **Test vector seeds & keys** (`0x01`, `0x02`, `0x03`, `0xee`) | **Nothing.** Confidentiality is not wanted                                                                                                            | `contracts/hashing.md` §6, `fixtures/derivations.json`, `fixtures/vectors/*`, `tools/fixtures-gen/` | **Stay public permanently.** A test vector nobody can reproduce is not a test vector                              | Published on purpose ✅ |
| **Verifier**                                                  | Holds no secret, by construction                                                                                                                      | `services/verifier/` (unbuilt)                                                                      | Must remain secret-free. If it ever needs a secret, the design is wrong                                           | n/a                     |

**Net:** the confidentiality burden of this system is four items — two chain
signing keys, one linkage map, one admission record — and **none of them exist
yet**. That is the most favourable possible moment to fix how they will be held.

---

## 2. Attack surface

Ranked by severity. Explicitly _not_ listed as findings: "the hashing rule is
public", "the verifier logic is public", "the schemas are public". Those are the
product working as designed.

### S1 — Ledger ballot authorization contradicts ADR-0004 · **High**

Three sentences in `docs/implementation-plan.md` §Services→`ledger` and one in
`services/ledger/CLAUDE.md` still describe the pre-ADR-0004 ballot model:

- plan: "a `vote_cast` is accepted only if signed by a public key found in a
  prior `participant_registered` event _in its own log_"
- plan: "`vote_cast` requires a registered participant's signature"
- plan: "Write path: clients sign locally and `POST /events` directly.
  `identity` is not in the vote path."
- `services/ledger/CLAUDE.md`: "Auth: … `vote_cast` → registered participant
  signature"

All four are false as of ADR-0004 (accepted 2026-07-21) and `event-types.md`
ET-17/ET-21: `vote_cast` is **registrar-signed** under the chain's
`registrar_pk`, the voter holds no key, and identity **is** the ballot admission
gate. ADR-0004's Consequences section says "No plan amendment needed" — but that
sentence addresses only the T3 ticket phrase "`vote_cast` (signed)". It did not
reach the `ledger` service section, which still carries the superseded model.

**Impact.** A voter-held ballot signing key is a demandable receipt — the exact
finding that produced ADR-0004, a charter §5/§8 violation, and the construction
ET-22 permanently bars against any future community vote. Root `CLAUDE.md`
mandates reading `services/<svc>/README.md`, `API.md`, and `CLAUDE.md` before
touching a service, so a Phase 1 ledger implementer is _routed into_ the stale
text. Phase 1 opens at T9a.

**Fix.** Amend both files to the ADR-0004 model before T9a. Add to T9's checklist:
grep every doc outside `contracts/` for ballot-authorization claims and check
each against ET-17/ET-20/ET-21.

### S2 — Personhood gate has no on-log representation · **High**

`participant_registered`'s payload is exactly `{pubkey, sig}`, self-signed under
its own `pubkey` (ET-10). No field carries any identity-service authorization.
Meanwhile `implementation-plan.md` claims "`participant_registered` requires the
`identity` service's key (identity is the sole gate to personhood)" — there is no
such key in the event, so the ledger cannot enforce this from event content.
`read-api.md` RA-13 explicitly puts write authentication "outside `contracts/`",
so it is specified nowhere.

**Impact.** Two distinct problems:

1. **Unverifiable from the export.** A verifier — and therefore any member of the
   public — cannot distinguish an identity-gated registration from a self-minted
   one. Sybil resistance is invisible in the artifact whose whole purpose is
   public checkability. ET-12 states this honestly ("structural validity does not
   imply uniqueness of the human behind the key"), so it is a _known_ property,
   not a hidden one.
2. **Unspecified in implementation.** Whatever gates `POST /events` is the entire
   Sybil defense, and it is currently undesigned. Anyone who can reach that
   endpoint mints participants.

**Fix.** Two independent decisions, both before Phase 1: (a) decide whether the
personhood gate should become on-log evidence (an identity-service
countersignature on `participant_registered`, or an attestation event) — this is
additive and therefore legal post-freeze, but the _shape_ should be reasoned
about now, while the fixtures are still cheap; (b) specify ledger write
authentication in the ledger ticket regardless.

Note the asymmetry worth resolving: ballots have a named signing key
(`registrar_pk`) and registrations do not, even though the plan's intent is that
identity gates both.

### S3 — No key rotation or revocation path anywhere · **High**

`genesis` declares `operator_pk` and `registrar_pk` once, immutably, in the first
event. The v1 registry has four types and none of them rotates or revokes a key.
No ADR, no open question, and no `evolution.md` sentence covers key compromise.

**Impact.** Compounds with the ballot design. Because `vote_cast` carries _only_
`{issue_id, choice, sig}` — no participant reference, no voter key, nothing else
(ET-21) — a leaked registrar key produces forged ballots that are **byte-for-byte
indistinguishable** from genuine ones, for every issue, retroactively. The
verifier will call them `VALID`, correctly. Today the only remedy is to abandon
the chain and fork.

A rotation type is additively reachable post-freeze, but the semantics are
awkward in a way worth confronting before the freeze, not after: a frozen
verifier gives `PARTIAL` on an unregistered type (EV-7/EV-9), so it would keep
honoring the compromised key while reporting the rotation as merely unchecked.
`OPEN-QUESTIONS.md` already flags a neighbouring hole — an unregistered `genesis`
version leaves a verifier unable to extract keys at all.

**Fix.** Design the compromise story before real keys exist. It need not ship in
v1, but the _verifier's_ forward behaviour toward a future rotation event should
be settled while `evolution.md` is still editable — that is the part that cannot
be fixed additively later.

### S4 — CI guards are self-guarding · **Medium**

`repo.yml` and `contracts-guard.yml` check out the PR head and execute
`.github/scripts/*.sh` **from that checkout**. A single PR that modifies both
`.github/scripts/contracts-guard.sh` and `contracts/hashing.md` runs the modified
guard against the frozen file and passes. The same holds for
`fixtures-manifest.sh` (golden-vector integrity) and `diff-size.sh`.
`guards.test.sh` does not close this — it is also the PR's copy.

Separately, the freeze branch triggers on `git rev-parse refs/tags/contracts-v1`
merely _existing_. If tag protection is not configured, deleting the tag silently
disables the freeze, and nothing reports it.

**Impact.** The freeze is the mechanism that makes "golden values never
regenerate" real. Today it is enforced by a script the same PR can edit. The
compensating control is human review — but `memory/STATE.md` records the ruleset
as "PR required, four status checks strict, linear history, no bypass" without
mentioning required _approvals_.

**Fix.** Three cheap steps: require at least one approving review on `master`;
add a repository ruleset protecting `refs/tags/contracts-v1` against deletion and
update; and add a CODEOWNERS entry on `.github/` and `contracts/` so guard edits
cannot ride along unnoticed. Optionally, have the guard job fetch its script from
the merge base rather than the head.

### S5 — No security policy, no private disclosure channel · **Medium**

There is no `SECURITY.md` (root or `.github/`), and no documented way to report a
vulnerability privately. The repo is public with issues enabled, so the only
available path is a **public issue** — which is precisely the opposite of a
coordinated-disclosure window.

**Impact.** This blocks the entire disclosure-timing question. You cannot embargo
a finding you have no private channel to receive. It is also the single cheapest
item in this document.

**Fix.** Add `SECURITY.md` now, before there is anything to disclose: enable
GitHub Private Vulnerability Reporting, name a contact, and state the policy
explicitly — _pre-pilot, we disclose immediately and publicly; once a live chain
carries real participants, we embargo_. Publishing that the policy changes at a
milestone is itself a verifiability act.

### S6 — No dependency vulnerability automation · **Medium**

No `dependabot.yml`, no `pnpm audit` step, no lockfile-integrity gate beyond
`--frozen-lockfile`.

**Impact.** Currently near zero: there are **no runtime dependencies at all**.
Root has six dev dependencies (eslint, prettier, turbo, typescript,
typescript-eslint, lefthook) and `tools/fixtures-gen` has one (`@types/node`).
The Go verifier will use stdlib crypto only. So the exposure today is confined to
build tooling.

That is exactly why this is the right moment: the control costs nothing to add
now and will be load-bearing the moment `ledger` pulls in a Postgres driver and
an HTTP framework. Note the specific relevance to an open repo — the lockfile is
public, so an attacker enumerates your exact dependency versions for free. That
is fine and expected under Kerckhoffs, but it means the window between a public
CVE and your patch is a window in which your exposure is _precisely known_.

**Fix.** Add Dependabot (npm + github-actions ecosystems) and a `pnpm audit
--audit-level=high` CI step before the first service lands.

### S7 — Test genesis keys have no production guard · **Medium**

Vector `001` and `hashing.md` §6 use an operator key from seed `0x01`×32 and a
registrar key from seed `0x02`×32. Anyone holding this repo can sign anything
under them. Publishing them is correct. The gap is that nothing _mechanically_
prevents their reuse: the "TEST KEYS — never use on a real chain" warning lives
only in `fixtures/derivations.json`, not in `hashing.md` §6 where an implementer
first encounters the seeds, and not in `fixtures/README.md`.

T6 builds a rehearsal chain generator with these keys wired in. That generator is
the most likely ancestor of real genesis tooling.

**Fix.** (a) Repeat the warning inline in `hashing.md` §6 and
`fixtures/README.md`. (b) Make it mechanical: the ledger, and the rehearsal
tooling, must refuse a `genesis` whose `operator_pk` or `registrar_pk` matches any
published test key. A four-entry deny-list, checked at genesis, costs nothing and
converts a catastrophic mistake into a startup error.

### S8 — Write-path abuse limits unspecified · **Low**

`read-api.md` bounds the read surface carefully (RA-3/RA-6: `limit` defaults and
clamps at 1000, malformed input rejected with `400`). `POST /events` has no
contract, no rate limit, and no size bound.

**Impact.** An append-only log is a permanent, monotonically growing storage
commitment. Unbounded writes are a permanent-cost DoS, not a transient one, and
the log by design cannot be pruned. Sequencing also matters: cheap forged writes
that are _rejected_ still consume verification effort (an Ed25519 verify per
attempt).

Not a Phase 0 blocker — write auth is legitimately outside `contracts/` per
RA-13. It belongs in the Phase 1 ledger ticket's acceptance criteria.

### S9 — v1 anchoring does not constrain the operator · **Low/Medium**

Charter §4 makes non-equivocation depend on publishing the chain head "where the
operator cannot rewrite it". `read-api.md` RA-8 is careful to say `GET /head` is
**not** that anchor. The v1 plan says a "manual anchor of head hash in the GitHub
repo README is fine at genesis."

**Impact.** The repo is owned by the operator — sole admin, zero collaborators.
An anchor the operator controls does not deliver the property. `OPEN-QUESTIONS.md`
correctly lists cadence and venue as open; the missing word is **independence**.
This is not urgent — there is nothing to equivocate about on an empty chain — but
it must resolve before the head means anything.

**Fix.** Before the pilot chain, pick a venue outside operator control (a second
organization's repo, a mailing list archive, a timestamping service, or the v2
blockchain anchor brought forward). State the cadence publicly so a _missing_
anchor is itself detectable.

### S10 — Repo wiki enabled · **Low**

`has_wiki: true`. A public wiki is a writable surface outside branch protection,
outside CI, and outside the entire `contracts/` discipline; wiki content is not
covered by any guard or review. Nothing depends on it.

**Fix.** Disable it, or state that it is unused.

---

## 3. Concealment timeline

Keyed to milestones, not dates. The rule throughout: **conceal keys and identity
linkage; never conceal rules, formats, or logic.**

### M0 — Now → release candidate (T9a). Pre-pilot, no secret exists.

Nothing to conceal. Everything below is _building the machinery_ while it is
free.

| Trigger                               | Action                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Immediately** — S5                  | `SECURITY.md` + enable Private Vulnerability Reporting. **State plainly that the disclosure policy is immediate-and-public until a live chain exists, and becomes embargoed after.** You cannot start an embargo without a private channel already in place. |
| **Before T9a** — S1, A-1              | Reconcile `implementation-plan.md` and `services/ledger/CLAUDE.md` with ADR-0004.                                                                                                                                                                            |
| **Before T9a** — S2, S3               | Decide the personhood-gate shape and the verifier's forward behaviour toward key rotation. Both are additively fixable _later_; the verifier's response to them is not.                                                                                      |
| **Before T6** — S7, A-2               | Test-key deny-list + inline warnings.                                                                                                                                                                                                                        |
| **Before the first service** — S4, S6 | Required reviews, tag protection, CODEOWNERS, Dependabot, `pnpm audit`.                                                                                                                                                                                      |
| **Disclosure posture at M0**          | **Disclose everything immediately and publicly.** A hashing bug found now is free to fix and worth advertising — it demonstrates the review process works. There are no votes to protect and no users to warn.                                               |

### M1 — First real key material (Phase 1: `ledger` + `identity` built, before any live chain).

The operator and registrar private keys come into existence. **This is where
concealment begins, and for these two objects it is absolute.**

- Resolve `OPEN-QUESTIONS.md`'s "file, env, or KMS?" — KMS or an equivalent
  non-exportable store, at minimum separate secret stores on separate hosts.
- Enforce ET-9a **operationally**: identity holds `registrar_pk`'s private half
  and never `operator_pk`'s. The contract cannot check this; deployment must.
- Design the identity service so registrar admission knowledge
  `{voter, issue, choice}` is **never written to disk**. Retrofitting
  non-persistence is far harder than building it.
- Key rotation design lands **before** the keys it protects (S3).
- Still disclose publicly and immediately — no real participant exists yet.

### M2 — Pilot chain, real humans, non-binding votes (before first real votes).

The linkage map now holds real people. Three things change at once:

- **Linkage map → full concealment.** Encryption at rest; no export path; no log
  line; no API response. `services/identity/CLAUDE.md` already states the rule —
  here it becomes enforceable, testable code, with a test that _asserts_ the
  linkage cannot appear in any response.
- **Coordinated disclosure windows activate.** From the first real participant, a
  vulnerability in hashing, the verifier, or the ballot path gets an embargo:
  fix, anchor, then full public disclosure including the original report.
  Suggested window: 90 days or fix-plus-one-anchor-cycle, whichever comes first,
  with the clock and the policy public even while the finding is not. **Note what
  is being concealed — the timing of a specific unpatched defect, never the
  design.** Every embargoed finding is published in full afterward.
- **Anchor venue becomes operator-independent (S9).** Before the head means
  anything, it must be published where you cannot rewrite it.

### M3 — First binding outcome (a vote that moves money or authority).

The economics change: someone now has a reason to buy a ballot or forge one.

- **Registrar key custody escalates.** A single holder of `registrar_pk` can
  forge every ballot undetectably (S3). At binding stakes this warrants an HSM,
  split custody, or threshold signing — the same trajectory charter §8 sets for
  the sentiment store, applied to the registrar.
- **The off-log one-human-one-issue audit trail becomes the primary
  deanonymization target.** It is the durable record of who voted on what.
  Minimize it aggressively: retain the minimum that supports duplicate detection,
  for the minimum time, and treat its retention window as a security parameter.
- **Blind-signature credentials (identity v2) stop being a nice-to-have.** They
  are the structural fix for the residual ADR-0004 honestly admits. Charter §11
  defers them; a binding outcome is the event that un-defers them.
- Disclosure: shortest embargo consistent with a fix. Binding outcomes mean a
  live exploit has a live payoff.

### M4 — Monetized sentiment data exists.

- Sentiment store key: charter §8's v1-policy → v2-threshold-custody roadmap
  (k-of-n shares, decryption gated on a recorded license-vote event).
- Conceal **the key**. Never the licensing rules, the decryption-gating logic, or
  the k-anonymity floors — those must be public precisely so buyers and members
  can check them.

---

## 4. What must stay open regardless

These are public permanently. Concealing any of them would not reduce attack
surface — an attacker reads the export either way — it would only remove the
public's ability to detect operator misbehaviour, which is the exact threat the
log exists to address. Hiding them would not be a security measure; it would be
the failure mode.

| Component                                                                                                                                 | Why it can never close                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`contracts/` in full** — `event-schema.md`, `hashing.md`, `ids.md`, `event-types.md`, `export-format.md`, `read-api.md`, `evolution.md` | A stranger must be able to write an independent verifier from these alone in an afternoon (charter §4). That is the trust root. |
| **The hashing rule and canonical preimage**                                                                                               | Secrecy here would mean "trust us that the chain is intact" — the precise claim the project exists to eliminate.                |
| **The verifier source, in both languages**                                                                                                | Its independence _is_ the security property. It holds no secret by construction; a verifier needing one is a design error.      |
| **Golden fixtures, and the test keys and seeds behind them**                                                                              | An unreproducible test vector proves nothing. The seeds must stay public for conformance to be checkable.                       |
| **Interpreter / tally semantics and every parallel aggregation**                                                                          | P1: anything the platform can compute, anyone must be able to recompute. A private tally rule is a private thumb on the scale.  |
| **The export format, every published head, and the anchor record**                                                                        | The artifact and its non-equivocation evidence. Both worthless if private.                                                      |
| **Event schemas and the type registry, including future additions**                                                                       | EV-5 requires every additive change to ship golden fixtures — public by construction.                                           |
| **Moderation actions, ADRs, and audits like this one**                                                                                    | Charter §9: no hidden authority. Transparency about the _process_ is part of the claim.                                         |

**The line, stated once:** conceal private keys and identity linkage data.
Everything that describes _how the system decides_ stays open. The security of
this system does not rest on anyone not knowing how it works — it rests on four
secrets, none of which exists yet, and all of which should be built to be held
correctly from the first line of Phase 1.
