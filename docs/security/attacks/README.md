# Phase 0 audit — adversarial exports

Retained inputs for the T9 security audit (`../audit-phase-0.md`), kept so a
fresh-context re-auditor can re-run every demonstration the audit makes rather
than take its word for them.

> **These are NOT conformance fixtures.** They are not in `contracts/fixtures/`,
> they are not in `contracts/fixtures/index.json` or `MANIFEST.sha256`, no
> verifier's test suite consumes them, and no freeze rule (ADR-0008,
> `contracts-guard`) covers them. `contracts/fixtures/` pins what conforming
> implementations MUST do; these files demonstrate what the spec currently
> **permits** — which is the audit's point. Do not confuse the two, and do not
> promote a file here into `contracts/fixtures/` without giving it a rule id, an
> `index.json` entry, and a declared verdict of its own.

## Running

```
node docs/security/attacks/generate-phase-0-attacks.mjs
```

Regenerates all six files deterministically. The generator implements
`contracts/hashing.md` (HA-1–HA-17) and the canonical line form of
`contracts/export-format.md` (EX-7–EX-9) from the spec prose alone, and it
**asserts on every run** that its genesis reproduces the `hashing.md` §6
worked-example digest `78ed980b…f6409a`. If that self-check fails, the encoder
has drifted from the spec and nothing else in the directory is evidence.

Key material is exclusively the published test seeds — `0x01…01` (operator),
`0x02…02` (registrar) from `hashing.md` §6, and `0xee…ee` (wrong key) from
`contracts/fixtures/derivations.json`. **TEST KEYS — never use on a real chain**
(see finding S5).

## Verifying

```
go build -o /tmp/odcverify ./services/verifier
/tmp/odcverify docs/security/attacks/chainA.ndjson

pnpm --filter @odc/verifier-ts build
node tools/verifier-ts/dist/src/cli.js docs/security/attacks/chainA.ndjson
```

## The artifacts

| File               | Finding | Demonstrates                                                                                                                                                                                                                                                                                                                                                                                       | Both verifiers   |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `chainA.ndjson`    | F1      | Two complete chains bearing the **identical** `chain_id` `34750f98…`, differing only in a one-millisecond genesis `ts`, reaching opposite outcomes on the same question (plan Y wins 3–1 here, loses 1–3 in `chainB`). Both correctly self-signed under `operator_pk` (ET-8), both deriving `chain_id` correctly (ET-7). The operator shows one to each audience.                                  | `VALID`          |
| `chainB.ndjson`    | F1      | The contradicting twin of `chainA`.                                                                                                                                                                                                                                                                                                                                                                | `VALID`          |
| `fork1.ndjson`     | F1      | Common-prefix fork: same genesis, same issue, same first ballot; the second ballot differs. Nothing in `contracts/` lets a verifier detect that a sibling exists.                                                                                                                                                                                                                                  | `VALID`          |
| `fork2.ndjson`     | F1      | The diverging branch of `fork1`.                                                                                                                                                                                                                                                                                                                                                                   | `VALID`          |
| `downgrade.ndjson` | F3      | `genesis` at `version` 1000000 (reserved by EV-19), so Stage B never runs on it and `operator_pk`/`registrar_pk` are never extracted; the following `issue_created` and `vote_cast` are at the **registered** version 1 and signed by an unauthorised key. Both verifiers reject — but no normative sentence requires them to, and `PARTIAL` at line 1 is a defensible reading of EV-7/EV-8/EV-15. | `INVALID` line 2 |
| `illutf8.ndjson`   | S4      | An `issue_created` whose stored `title` carries the raw ill-formed octets `ED A0 80` (unpaired surrogate) while its `hash` was computed over the U+FFFD replacement — the substitution Go's `encoding/json` performs silently. HA-2's closing MUST covers this; no vector in `contracts/fixtures/` exercises it.                                                                                   | `INVALID` line 2 |

Cross-check for F1, showing that `--head` names a position and not a chain:

```
$ /tmp/odcverify docs/security/attacks/chainA.ndjson \
    --head 05efa44b3a4be841d3c47228a413cb40fb380759e366c9d6f4c50a3a903100ca
INVALID at line 6: head mismatch (EX-15/EX-19)
```

`chainA` fails against `chainB`'s head, as it should — but each audience holds
only its own chain's head, each verifies, and the two `chain_id` values they
compare are equal. That is the finding.
