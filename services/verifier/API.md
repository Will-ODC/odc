# verifier — interface

The verifier is a command-line tool, not a network service. Its "API" is the CLI
surface and the verdict contract of `contracts/evolution.md` EV-7/EV-17.

## Invocation

```
verify <export.ndjson> [--head <hash>]
```

- `<export.ndjson>` — path to the export file, read as **raw bytes**. Framing
  and canonical-form rules operate on the exact bytes; the file is never
  re-encoded or normalized.
- `--head <hash>` — optional expected chain head, 64 lowercase hex characters
  (`--head=<hash>` is also accepted). When given, after all link checks pass the
  last line's `hash` must equal it (EX-15); otherwise the chain is `INVALID` at
  its last line (EX-19). Without `--head`, clean end-truncation is undetectable
  (EX-16) and reports `VALID`.

## Output

One verdict line on stdout:

- `VALID`
- `INVALID at line N: <advisory reason>`
- `PARTIAL at lines N, M, …`

The reason text and the specific normative-sentence identifiers in it are
**advisory** (EV-17). Conformance is judged on the verdict token and the line
number(s) alone.

## Exit codes

| Verdict / condition            | Exit |
| ------------------------------ | ---- |
| `VALID`                        | 0    |
| `INVALID`                      | 1    |
| `PARTIAL`                      | 2    |
| Tool-level error (usage, I/O)  | ≥ 3  |

Exit codes follow the non-normative CLI note of EV-17; they are pinned for
cross-implementation consistency but are not themselves conformance-checked. A
tool-level error (bad usage, unreadable file, malformed `--head`) is never a
chain verdict.

## What is checked

Two stages (EV-6):

- **Stage A (structural, type-agnostic)** — applies to every event: NDJSON
  framing (EX-1..EX-6, EX-20), the canonical compact line form and minimal
  string escaping (EX-7..EX-10), envelope well-formedness and strict rejection
  (ES-1..ES-4), `seq` form/range/contiguity (ES-5..ES-8), `type` character set
  (ES-10), `version ≥ 1` (ES-12), payload flatness of int/string values
  (ES-15..ES-17, EV-16) with keys sorted and unique (EX-8, HA-6), `ts` syntax +
  calendar (ES-20), `prev_hash`/`hash` linkage and format (ES-23..ES-26), hash
  recomputation (HA-14), genesis position (ES-33), the `--head` check
  (EX-15), and — at line 1 only — the `genesis` registration check promoted
  from Stage B (EV-20).
- **Stage B (semantic, per registered `(type, version)`)** — signatures and
  their Ed25519 canonical/prime-order gates (ET-3..ET-5, ET-4a/ET-4b/ET-4c),
  payload key sets (ES-18) including the two OPTIONAL `genesis` fork-ancestry
  keys and their presence rule (ES-34, ET-9e/ET-9f), key formats (ET-9b, ID-3),
  the distinctness of the two `genesis` keys (ET-9d),
  `chain_id` derivation
  (ET-7), title bounds and forbidden characters (ET-14), `choice_count` range
  (ET-14a), the ballot batching parameters and their floors (ET-14b),
  `issue_id` back-reference (ET-18/ID-8), and `choice` range (ET-18a).

The v1 registry is the four types `genesis`, `participant_registered`,
`issue_created`, `vote_cast`, each at `version` 1 (ET-1/ET-2). A well-formed but
unregistered `(type, version)` yields `PARTIAL` for that line, never `INVALID`
(EV-8/EV-9) — with the single exception of `genesis`, which MUST be registered:
a chain whose first line carries a `(genesis, version)` this verifier does not
register is `INVALID` at line 1 (EV-20). The reason text there names the version
seen and the `genesis` versions registered, and says plainly that "this verifier
is out of date" and "this genesis is corrupt or hostile" are indistinguishable
from the log alone — advisory guidance (EV-21), not conformance.

### Fork ancestry on `genesis` (ET-9e/ET-9f)

The `genesis` payload may carry two OPTIONAL keys (ES-34): `ancestor_chain`, the
parent chain's genesis hash — the value that **names** a chain (ET-7a) — and
`ancestor_head`, the parent's head at the fork, a **position on** the chain that
name identifies. The verifier checks the format of each key present
(`^[0-9a-f]{64}$`, never the 64-zero anchor) and one presence rule:
`ancestor_head` MUST NOT appear without `ancestor_chain`, while `ancestor_chain`
MAY appear alone. That asymmetry is deliberate. The two values may be equal —
that is what a fork from a parent holding only its genesis produces — and
neither is resolved: both are a recorded claim, not a verified link, and being
unable to resolve one is never a defect.
