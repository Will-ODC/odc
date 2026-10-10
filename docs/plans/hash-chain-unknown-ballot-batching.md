# Proposal — mixed-version ballot batching

**Status: PROPOSED, not a normative contract or an implementation.** The operator
authorised preparing this proposal and regression cases on 2026-10-09. Approval
to prepare it does not ratify its detailed uncertainty algorithm.

**Base:** `f13c8cd` (includes #203/#219/#220/#221/#222). Claude completed #222;
its conflict resolution is merged. Pulse changes remain outside this proposal.
**Intended amendments after decision:** `event-types.md` v11 → v12 and
`evolution.md` v6 → v7, with an ADR and contracts change-log entry. Check final
version numbers at implementation time. This branch changes neither spec nor
golden fixtures. Merge after the approved anchor-policy amendment, and implement
verifiers independently before adding conformance vectors.

## Problem

ET-24/ET-24a currently see only `(vote_cast, 1)`. A newer ballot can fill or
close a batch without an older verifier understanding its payload. Two known
ballots at T1, an opaque ballot at T1 and three known ballots at T2 can be valid
to a newer reader, but an old reader rejects the first T2 because it counted
only two. EV-8 forbids INVALID solely because a version is unregistered.

Reading `issue_id` from the unknown payload is not a fix: EV-8 does not allow
assuming its schema. Disabling all later batch checks is also not a fix: it
would let one unknown ballot hide provable known-version violations.

## Proposed permanent constraint

Extend ET-22's evolution constraints to say:

> Every registered version of `vote_cast` MUST identify exactly one issue and
> represent exactly one ballot. It MUST carry `issue_id` under that name with
> the ID-8/ET-18 reference meaning, and MUST obey its issue's declared timestamp
> interval, minimum batch size and closed-instant discipline. No future version
> may remove these publication constraints or count a single event as multiple
> ballots for the minimum.

The one-ballot bound matters: it permits an old verifier to prove that one
known ballot plus one opaque event cannot fill a minimum-three batch. Without
this bound that proof is unavailable. This is a proposed evolution restriction,
not something the existing opaque payload promises today.

Replace ET-24/ET-24a's registered-v1 scope with every registered `vote_cast`
version. A verifier MUST NOT inspect an unregistered version's payload for
batch membership, even if it looks like the familiar schema.

## Proposed uncertainty rule

Extend EV-7/EV-8 and ET-24/ET-24a together:

1. Structural validation and hash/link checks still apply to every event.
   Quantization and other checks on registered ballots remain enforceable.
2. A structurally valid opaque `vote_cast` can belong to any issue compatible
   with its known envelope timestamp. Its payload and signature are not used
   to assign it to an issue or establish eligibility. This is uncertainty, not
   permission to accept an invalid known event.
3. Consider all possible membership assignments of opaque ballot events under
   the permanent one-event/one-ballot bound. A known ballot's batching failure
   is INVALID only if the failure occurs in every assignment. Attribute it to
   the first registered line whose failure is proved, not to an unchecked
   opaque event whose semantics are unknown.
4. If a registered line's batching result depends on an opaque assignment,
   its check is unresolved. The chain is PARTIAL unless an independently
   provable failure makes it INVALID. Preserve definite known batch history;
   uncertainty cannot erase a known closed instant or turn a known off-interval
   timestamp into a valid one.
5. PARTIAL enumerates the opaque lines and registered lines with unresolved
   batch checks, sorted and without duplicates. This requires an explicit
   amendment to EV-7/EV-17; current runners enumerate unknown lines only.
   An unknown line that cannot affect any known check still appears itself.

This defines a correctness oracle, not an instruction to enumerate exponentially
many assignments in production. Independent builders need a bounded, streaming
representation (for example timestamp-indexed unknown counts plus definite
per-issue run/closed-instant state). They must demonstrate equivalence to a
small exhaustive test oracle and avoid growing work quadratically per issue.
If the exact rule is too costly, choose a stated conservative PARTIAL policy
before implementation; never silently strengthen INVALID or claim more checked
semantics than the state supports.

## Proposed regression cases

Every case starts with genesis and two registered issues, so ballots start at
line 4. Minimum is three; T1/T2 are legal whole-minute instants. `U` is
`vote_cast` version **1000000**, reserved by EV-19, with an opaque payload.
Expectations below are declared, not produced by a verifier.

| Case                             | Registered/opaque ballot sequence       | Current verdict | Proposed verdict   |
| -------------------------------- | --------------------------------------- | --------------- | ------------------ |
| opaque member                    | A@T1, A@T1, U@T1, A@T2×3                | INVALID line 7  | PARTIAL lines 6, 7 |
| payload must stay opaque         | Same, but U's payload appears to name B | INVALID line 7  | PARTIAL lines 6, 7 |
| insufficient even optimistically | A@T1, U@T1, A@T2×3                      | INVALID line 6  | INVALID line 6     |
| opaque closure                   | A@T1×3, U@T2, A@T1                      | PARTIAL line 7  | PARTIAL lines 7, 8 |
| definite resumed instant         | A@T1×3, A@T2×3, U@T1, A@T1              | INVALID line 11 | INVALID line 11    |
| already full batch               | A@T1×3, U@T1, A@T2×3                    | PARTIAL line 7  | PARTIAL line 7     |
| known-only control               | A@T1×2, A@T2×3                          | INVALID line 6  | INVALID line 6     |
| definite quantization error      | U@T1, registered A at T1 + 1 ms         | INVALID line 5  | INVALID line 5     |

These cases cover membership, opacity, closure, provable failure, independent
quantization and PARTIAL attribution. Additional implementation-time cases must
cover multiple unknown events, unknown events before the first known member,
several issues sharing timestamps, coarser per-issue intervals, non-monotone
timestamps, malformed opaque events, and interactions with external anchors.

## Reproduce and distinguish current results from proposed failures

With the prepared tools, from the repository root:

```sh
pnpm --filter @odc/fixtures-gen build
node docs/security/attacks/generate-unknown-batching-proposal.mjs
```

The generator prints a fresh temporary directory containing eight exports and
a declared `index.json`. It uses only public deterministic test keys and writes
nothing to `contracts/fixtures/`. With that directory as `<cases>`:

```sh
python3 docs/security/attacks/check-unknown-batching-proposal.py current <cases> /tmp/odc-verify
python3 docs/security/attacks/check-unknown-batching-proposal.py current <cases> node tools/verifier-ts/dist/src/cli.js verify
```

Build the Go binary from `services/verifier` with
`go build -o /tmp/odc-verify .`; build TS with
`pnpm --filter @odc/verifier-ts build` from root. Use `proposed` instead of
`current` to exercise the proposed expectations. **Three cases are expected to
fail that mode today**, because no implementation of this proposal is merged.
That mode exits nonzero and reports all mismatches; it is deliberately excluded
from required CI until the decision and isolated implementations land.

## Review and sequence

Self-review must challenge both directions: rejecting a possibly conforming
mixed-version chain and accepting known violations after one unknown event.
The opaque-payload pair must have identical expected verdict/lines; proving
batch membership from those payload values would violate the proposed rule.
The definite-failure controls must stay INVALID.

Checkpoint self-review (2026-10-09): APPROVE as a proposal and reproducible
regression artifact; the detailed policy still needs a decision. Both current
CLIs pass all eight declared baseline cases and fail exactly the same three
proposed expectations. Two generations produce byte-identical exports and
indexes. The runner accepts both singular and plural PARTIAL line labels and
checks exit codes and a single verdict line. No verifier implementation was
opened or changed. These eight cases do not establish the completeness or
streaming complexity of a future uncertainty algorithm.

Order: #222 (merged) → core checkpoint → approved anchor-policy
amendment → decide this proposal/ADR → isolated Go and TS implementations →
new declared fixtures → fresh T9 re-audit → T9a RC. Ledger remains unstarted;
no freeze tag belongs in this proposal. Keep Pulse work independent.
