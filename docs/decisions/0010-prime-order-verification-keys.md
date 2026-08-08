# ADR-0010: Require prime-order verification keys (supersedes ADR-0009's prime-order exclusion)

- **Status:** accepted
- **Date:** 2026-08-08
- **Phase:** 0

## Context

ADR-0009 pinned the Ed25519 verification predicate at the **encoding** level
(ET-4a/ET-4b: canonical `S`, `R`, and `A`), making RFC 8032's underdetermination
unreachable for the two stdlib-only verifiers. In its "Why prime-order is
excluded" section it **deliberately did not require** a full prime-order subgroup
check on verification keys (`[L]A == 𝒪 ∧ [8]A ≠ 𝒪`), for exactly two reasons:

1. **No measured divergence.** Go `crypto/ed25519` (1.24.7) and Node
   `node:crypto` (v22/OpenSSL 3) returned the identical accept/reject verdict on
   every tested input, including small-order and cofactor cases, so a subgroup
   check appeared to close nothing.
2. **Stdlib-only.** A subgroup check needs curve scalar multiplication that is in
   neither language's standard library, conflicting with the T7/T7b stdlib-only
   constraint.

Both blockers turned on assumptions that a measurement could settle, and ADR-0009
itself flagged the result as **version-bound**. The deeper motivation to revisit
it is a charter one: with only encoding checks, a key's **legitimacy** — that it
is a real prime-order public key and not a small-order or mixed-order point that
happens to carry a verifying signature — is **trusted by policy**, not verifiable
from the log. A degenerate identity key accepts a degenerate self-signature, and
a mixed-order key `A = P + T` self-signed honestly under `P` (with the challenge
ground so `k ≡ 0 (mod 8)`, making `[k]T = 𝒪`) **verifies under `A`** in both
reference libraries. A verifier with only ET-4a/ET-4b **accepts** both. Full
log-verifiability of keys (charter §P1 — "everyone can verify") wants these
rejected on the bytes, not waved through.

## Decision

**Require that every verification key lie in the prime-order subgroup, as
`event-types.md` ET-4c, reversing ADR-0009's exclusion.** On the point `A`
decoded from its already-canonical encoding (after ET-4a/ET-4b pass), a verifier
MUST reject the event unless

> `[L]A == 𝒪` (the identity) **AND** `A != 𝒪` — equivalently `[L]A == 𝒪 AND [8]A != 𝒪`,

with `L = 2^252 + 27742317777372353535851937790883648493`. This rejects all
small-order keys (including the identity `0100…00`) and all mixed-order keys. It
binds the same three keys ET-4b covers: `operator_pk`/`registrar_pk`
(ET-8/ET-13/ET-17) and `participant_registered.pubkey` (ET-10).

**Relax the stdlib-only constraint to permit one audited curve library per
verifier, used ONLY for the ET-4c subgroup check** — `filippo.io/edwards25519`
for the Go verifier (T7), `@noble/curves` for the TypeScript verifier (T7b).
Everything else (parsing, framing, hashing, ET-4a/ET-4b integer comparisons, and
the Ed25519 verify primitive of ET-5) stays standard-library.

### What changed since ADR-0009 — the measurement

Per the standing "measure, do not reason from memory" direction, both allowed
curve libraries were run against 11 points: one normal (prime-order) key, all
eight small-order torsion points, and two mixed-order points (`P + T`).

- **The two libraries AGREE on the prime-order predicate for all 11 points,
  5/5 runs:** a normal key → accept; all eight small-order torsion points →
  reject; both mixed-order points → reject. The exclusion's premise "no
  divergence a subgroup check would close" measured the encoding cases, not this
  predicate; on the predicate itself the two audited libraries agree by
  construction, which is exactly the property two independent verifiers need. The
  derived torsion set matched `@noble/curves`' shipped `ED25519_TORSION_SUBGROUP`
  constant (independent second source).
- **Both isolating fixtures are constructible** and their self-signatures verify
  in **both** Go `crypto/ed25519` and Node `node:crypto` (so ET-10 passes and each
  fixture isolates ET-4c alone) — see Consequences.
- **The `isTorsionFree()` caveat.** `@noble/curves`' `isTorsionFree()` returns
  **true** for the identity key, which ET-4c must reject. So a noble-based
  verifier satisfies ET-4c with `A.isTorsionFree() && !A.is0()` and a
  filippo-based verifier with `[L]A == 𝒪 && A != 𝒪`; these compute the identical
  decision on every measured point **only** with the explicit non-identity
  clause. ET-4c is therefore worded as `[L]A == 𝒪 AND A != 𝒪`, never as bare
  "torsion-free". The `A != 𝒪` clause is load-bearing (fixture `081`).

Blocker 1 is resolved (the predicate is agreed, and the value is verifiability
from the log rather than closing a divergence); blocker 2 is resolved by the
narrow stdlib relaxation above. ET-4c is exact curve arithmetic, not an
RFC-8032-underdetermined case, so it is more version-stable than ET-4a/ET-4b —
but the assessment remains **version-bound** and the T10 re-audit re-measures.

## Consequences

- `event-types.md` v5 → v6: **ET-4c** added after ET-4b; the informative note
  under ET-4b (which recorded the prime-order exclusion) rewritten to point at
  ET-4c and mark the exclusion superseded; rule-index and acid-test updated.
- **ADR-0009 is superseded in part**, not wholly: its canonical-encoding decision
  (ET-4a/ET-4b) STANDS unchanged. Only its "prime-order deliberately excluded"
  stance is reversed. ADR-0009 carries a "Superseded in part by ADR-0010" note.
- Two golden fixtures under EV-5 (`081`, `082`), each `INVALID` at line 2 and
  each isolating ET-4c alone (canonical encoding passes ET-4a/ET-4b, 64 lowercase
  hex passes ID-3, and the self-signature verifies in both libraries so ET-10
  passes). `081-smallorder-key` is the identity key with the degenerate identity
  self-signature; `082-mixedorder-key` is `A = P + T` (T order-8 torsion),
  self-signed honestly under `P` with the nonce ground so `k ≡ 0 (mod 8)`. `082`
  additionally discriminates a full prime-order check from a small-order-blocklist
  verifier, which a small-order key cannot. Both are DISCRIMINATING today: a
  verifier omitting ET-4c wrongly reports `VALID`. Total 80 → 82, INVALID 66 → 68.
- **T7 and T7b MUST implement ET-4c**, and MAY use the one named audited curve
  library above for it (only). ET-4a/ET-4b stay stdlib integer comparisons; the
  fresh-context isolation rules for T7/T7b are unchanged.
- The `082` construction is DETERMINISTIC in the generator (fixed seed for `s`
  and the nonce grind), so a fresh regenerate produces byte-identical goldens, as
  `odc-testing` requires.
- No `hashing.md` change: ET-4c governs a property of the decoded key, not what
  `sig`/`hash` cover.
- **T10 re-audit obligation:** re-measure the two libraries' prime-order predicate
  and the cofactorless assumption; this decision is correct for the measured
  versions only.
- Landing pre-freeze is required: `evolution.md` EV-1 forbids altering a frozen
  `(type, version)` schema, and ET-4c binds `genesis`, `participant_registered`,
  `issue_created`, and `vote_cast` v1, so it is unaddable after the `contracts-v1`
  tag.

### Documents reconciled

Every document outside `contracts/` that stated the thing this ADR changes, and
its disposition in this PR:

- `docs/decisions/0009-ed25519-canonical-encoding-predicate.md` — stated the
  prime-order exclusion (Decision, "Why prime-order is excluded", Consequences).
  **Updated in this PR** with a "Superseded in part by ADR-0010" status note; its
  body and history are left intact, and its ET-4a/ET-4b decision still stands.
- `docs/plans/phase-0.md` — the T7 and T7b tickets stated "Go, stdlib only" /
  "Node stdlib only". **Updated in this PR** to permit the one named audited curve
  library for the ET-4c check only. Their stale "75 vectors" / "the 75 declared
  fixture verdicts" counts were also corrected to the current total (pre-existing
  drift). The fresh-context isolation rules are unchanged.
- `memory/OPEN-QUESTIONS.md` — its DECIDED Ed25519 stub recorded prime-order as
  EXCLUDED. **Updated in this PR** to record it as REQUIRED via ET-4c / ADR-0010.
- `memory/STATE.md` — **deliberately not edited here:** per the context protocol
  it is updated on master at merge time on its own follow-up PR, so feature
  branches do not conflict.
- No other document outside `contracts/` stated the exclusion.

## Charter check

- **P1 (an append-only public record everyone can verify):** strengthened, and
  this is the point of the change. Key **legitimacy** is now verifiable from the
  log — a small-order or mixed-order key is rejected on its bytes rather than
  trusted-by-policy to be a real public key. Two independent verifiers reach the
  same verdict on it by construction (exact curve arithmetic, agreed libraries).
  No rule, format, or logic is concealed (charter §9): the check is stated in the
  open, and the one non-stdlib dependency is a **named, audited** library scoped
  to this check.
- **P2 (one verified human, one voice):** untouched. This is a key-validity rule;
  eligibility and uniqueness remain registrar policy (ET-20).
- **P3 (the platform characterizes, never weighs):** untouched. No interpretation
  of ballots is added.
- **P4 (equal access):** neutral. The rule rejects illegitimate key material
  identically for all keys and all event types.
