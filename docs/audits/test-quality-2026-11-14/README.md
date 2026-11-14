# Repository test-quality audit — 2026-11-14

This completes the operator-requested broader review of test accuracy,
correctness, usefulness and excess, following the earlier targeted Pulse audit.
Snapshot: `cf0707964a0c6f7c5295e18429a774f9638b5993`.

## Scope and result

Five fresh Codex contexts reviewed **218 active test/support files**. The two
verifiers were audited independently in separate sparse trees; neither context
read the ledger or the other verifier. The core auditor kept verifier source
closed. All temporary mutations and probes were restored or removed.

| Area                                            |                                                                   Files reviewed | Detailed inventory and evidence        |
| ----------------------------------------------- | -------------------------------------------------------------------------------: | -------------------------------------- |
| Pulse API                                       |                                               63 (including conformance/support) | [API report](pulse-api.md)             |
| Client and real-HTTP integration                |                                                       80 (1,018 collected cases) | [Client report](pulse-client.md)       |
| Ledger, fixture generator, rehearsal and guards | 45 conventional test files; historical/live audit scripts inventoried separately | [Core/tooling report](core-tooling.md) |
| Go verifier                                     |                                                                               13 | [Go report](verifier-go.md)            |
| TypeScript verifier                             |                                                  17 (15 suites and two builders) | [TS report](verifier-ts.md)            |

Each report maps promised behavior to existing coverage and assesses assertion
quality, fixture independence, mocks, failure paths, skips, layering, cost and
redundancy. This was an all-file review of the active suites, with targeted
executable experiments; it was not exhaustive mutation testing of every branch.
Historical diagnostics received the explicitly limited review recorded in the
core report. Passing baselines do not establish that every test is correct.

**Fourteen deliberately faulty variants survived existing tests:** three API,
two client, three core/tooling, three Go and three TS. Some variants deliberately
remove multiple related checks; this is a count of experiments, not a mutation
score. Independent probes show the wrong behavior behind important survivors.
Two client robustness defects were also reproduced on unchanged source:
malformed successful vote replies strand a send, and a stalled optional ballot
read hides available closed-poll results. Existing guards and historical fuzz
harnesses also have demonstrated false-green paths.

The six guards killed in the earlier targeted audit remain useful evidence.
The broader findings do not contradict that result: they examine different
properties, fixtures and seams. Existing #613/#614 timing gaps retain their
owners and are not counted again here.

## Findings and follow-ups

Twenty-two contained follow-ups were filed. The additional TS comment/duplicate
coverage finding is an optional maintenance note in its report, not a new
runtime refactor ticket. Reports distinguish present defects, executed
surviving mutations and static gaps; do not treat them all as production bugs.

| Finding                                                                          | Follow-up                                          | Evidence report                    |
| -------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| A1: test: isolate malformed Pulse session cookie fields                          | [#621](https://github.com/Will-ODC/odc/issues/621) | [pulse-api.md](pulse-api.md)       |
| A2: test: protect the last available contribution record slot                    | [#622](https://github.com/Will-ODC/odc/issues/622) | [pulse-api.md](pulse-api.md)       |
| A3: test: verify image crop and orientation with asymmetric pixels               | [#623](https://github.com/Will-ODC/odc/issues/623) | [pulse-api.md](pulse-api.md)       |
| A4: test: accept exact upper image-processing limits                             | [#624](https://github.com/Will-ODC/odc/issues/624) | [pulse-api.md](pulse-api.md)       |
| A5: test: observe the mailer default timeout actually used                       | [#625](https://github.com/Will-ODC/odc/issues/625) | [pulse-api.md](pulse-api.md)       |
| CQ1: pulse-web: recover from malformed successful vote responses                 | [#626](https://github.com/Will-ODC/odc/issues/626) | [pulse-client.md](pulse-client.md) |
| CQ2: test: protect profile owner preconditions at the HTTP seam                  | [#627](https://github.com/Will-ODC/odc/issues/627) | [pulse-client.md](pulse-client.md) |
| CQ3: test: protect query-safe nginx sign-in access logging                       | [#628](https://github.com/Will-ODC/odc/issues/628) | [pulse-client.md](pulse-client.md) |
| CQ4: pulse-web: show closed results when an optional ballot read stalls          | [#629](https://github.com/Will-ODC/odc/issues/629) | [pulse-client.md](pulse-client.md) |
| C1: ci: fail PR guards when Git comparison discovery fails                       | [#630](https://github.com/Will-ODC/odc/issues/630) | [core-tooling.md](core-tooling.md) |
| C2: test: exercise production ledger startup and batcher wiring                  | [#631](https://github.com/Will-ODC/odc/issues/631) | [core-tooling.md](core-tooling.md) |
| C3: test: reject signer runs that differ from saved ledger positions             | [#632](https://github.com/Will-ODC/odc/issues/632) | [core-tooling.md](core-tooling.md) |
| C4: test: detect rehearsal verdict and exit-code disagreement                    | [#633](https://github.com/Will-ODC/odc/issues/633) | [core-tooling.md](core-tooling.md) |
| C5: tools: reject nonverdict output in historical differential probes            | [#634](https://github.com/Will-ODC/odc/issues/634) | [core-tooling.md](core-tooling.md) |
| G1: test(verifier-go): isolate malformed timestamp rejection                     | [#635](https://github.com/Will-ODC/odc/issues/635) | [verifier-go.md](verifier-go.md)   |
| G2: test(verifier-go): independently verify large legal integer hashing          | [#636](https://github.com/Will-ODC/odc/issues/636) | [verifier-go.md](verifier-go.md)   |
| G3: test(verifier-go): isolate malformed non-genesis type names                  | [#637](https://github.com/Will-ODC/odc/issues/637) | [verifier-go.md](verifier-go.md)   |
| G4: test(verifier-go): cover documented CLI argument boundaries                  | [#638](https://github.com/Will-ODC/odc/issues/638) | [verifier-go.md](verifier-go.md)   |
| G5: test(verifier-go): correct early-rejection stress coverage claims            | [#639](https://github.com/Will-ODC/odc/issues/639) | [verifier-go.md](verifier-go.md)   |
| T1: test(verifier-ts): isolate invalid hour and minute rejection                 | [#640](https://github.com/Will-ODC/odc/issues/640) | [verifier-ts.md](verifier-ts.md)   |
| T2: test(verifier-ts): independently protect canonical crypto gates              | [#641](https://github.com/Will-ODC/odc/issues/641) | [verifier-ts.md](verifier-ts.md)   |
| T3: test(verifier-ts): make extreme and Unicode cases prove their named behavior | [#642](https://github.com/Will-ODC/odc/issues/642) | [verifier-ts.md](verifier-ts.md)   |

## Useful coverage and excess

Keep the shared memory/Postgres conformance suites, independent public response
schemas, forced writer-lock interleavings, privacy projection assertions,
unknown-write recovery tests and independent hashing/batching oracles. These
cover different responsibilities; their overlap is usually useful.

Trim only demonstrated excess: rename or reduce giant early-rejection stress
inputs that do not walk the chain they claim to walk; refresh obsolete fixture
supersession comments and consolidate exact duplicates while retaining distinct
boundaries. Static CSS checks and route-wide state matrices have limited proof
and can be brittle; retain high-value regressions and move future detailed
shared-state coverage to its owner. No broad test rewrite or mass deletion was
justified. Existing structural tickets retain their scopes.

## Execution and limits

The reports record commands, counts, fault substitutions, independent probes
and restoration checks. Core baselines include ledger 362, fixture generator 157
and import-boundary 42 tests plus 39 guard scenarios. Go's complete original suite
passed; each of its three mutants also passed the complete suite. TS baseline
and each of its three mutants passed 404 tests; restored fixtures passed 151
checks (150 vectors plus index validation). Client focused baselines passed 139
and real-HTTP checks 16. API focused image/capacity runs passed 17/55 respectively.
The earlier full API/client baselines 919/967 are explicitly supplementary,
not new full reruns by these auditors.

One optional default-mail-timeout mutation was rejected by automatic approval
review because its review usage limit had been reached. It was not run or
retried; that finding is static analysis only. Initial sandbox subprocess/socket
failures and the environment restart are separated from valid evidence. No
claim of a current cryptographic acceptance bug follows from masked guard
mutations. Browser geometry, native dialogs and cookie-policy enforcement were
not established by jsdom or mock-cookie tests.

## CI implementation and validation

[#619](https://github.com/Will-ODC/odc/pull/619) implements package/dependent
selection, documentation-only skips, core conformance routing, conservative
full fallbacks and weekly/manual full-suite runs. The pipeline skill is its
operational documentation. It changes no application or verifier source and
requires operator merge.

Its 14 selector/real-graph regression tests pass. The implementation PR's full
path passed all six CI checks, including ledger exports through both verifiers.
Temporary draft [#620](https://github.com/Will-ODC/odc/pull/620) passed every
check while skipping package/core tests and image builds/scans for a genuine
documentation-only diff; it was closed without merging. This live validation
supplements the local selector tests. Image-check always-presence addresses
part of #612; its real processing smoke test and operator ruleset update remain
separate work.
