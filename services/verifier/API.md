# verifier — interface

The verifier is a command-line tool, not a network service. Its "API" is the CLI
surface and the verdict contract of `contracts/evolution.md` EV-7/EV-17.

## Invocation

```
verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]
```

- `<export.ndjson>` — path to the export file, read as **raw bytes**. Framing
  and canonical-form rules operate on the exact bytes; the file is never
  re-encoded or normalized.
- `--head <hash>` — optional expected chain head, 64 lowercase hex characters
  (`--head=<hash>` is also accepted). When given, after all link checks pass the
  last line's `hash` must equal it (EX-15); otherwise the chain is `INVALID` at
  its last line (EX-19). Without `--head`, clean end-truncation is undetectable
  (EX-16) and reports `VALID`.
- `--chain <genesis-hash>` — optional expected chain identity, 64 lowercase hex
  characters (`--chain=<hash>` is also accepted). When given, the first line's
  `hash` — the genesis hash, the chain's name (EX-21, ET-7a) — must equal it
  (EX-22); otherwise the chain is `INVALID` at line 1 (EX-23). Independent of
  `--head`; both may be given: `--chain` fixes **which chain**, `--head` fixes
  **how much of it**.

A malformed `--head` or `--chain` value (wrong length, uppercase, non-hex,
missing) is a tool-level error, exit 3, never a chain verdict.

### When `--chain` and `--head` apply, and their precedence

Both comparisons run at the same point: after every per-line check has passed,
that is, only when the export would otherwise be `VALID` or `PARTIAL`. So a
mismatch of either one turns `VALID` or `PARTIAL` into `INVALID`, and **never
overrides an earlier `INVALID`**. A file already `INVALID` at line N stays
`INVALID` at line N, whatever the flags.

When both are given and **both** mismatch, the verdict is `INVALID at line 1`
(the `--chain` mismatch). EX-22 requires the chain mismatch to be reported
"even when every link check passes" but does not order it against `--head`.
EV-17 blames the first fatal line in file order, and EX-23/EX-19 attribute each
mismatch to the line whose `hash` was compared (line 1 for `--chain`, the last
line for `--head`), so the lower line, line 1, is blamed.

## Output

One verdict line on stdout:

- `VALID`
- `INVALID at line N: <advisory reason>`
- `PARTIAL at lines N, M, …`

The reason text and the specific normative-sentence identifiers in it are
**advisory** (EV-17). Conformance is judged on the verdict token and the line
number(s) alone.

### Genesis hash and head on stderr (EX-24)

On every run over a **non-empty** export, whatever the verdict, after the
verdict line, the verifier writes exactly two lines to **stderr**, in this
order:

```
genesis: <hex>
head: <hex>
```

- `genesis` is the stored `hash` field of the first line (EX-21);
- `head` is the stored `hash` field of the last line (EX-14).

Each value is printed when that line, taken as-is, parses as JSON and has a
string `hash` field matching `^[0-9a-f]{64}$`; otherwise that one value is the
literal `unavailable` (for example, line 1 carries a byte-order mark or is not
JSON, or the last line has no `hash`). These are the values the file
**states**, reported even when the verdict is `INVALID`, so a reader can compare
them against an anchor, publish them, or forward them.

Nothing is reported for an empty (zero-byte) export, nor on a tool-level error
where no verification ran. stdout is always exactly the one verdict line.

These two lines are **tool output, not conformance surface**: per EV-17
conformance is the verdict token and line number(s) alone, and EX-24 leaves
labels, order and formatting free. No fixture asserts them.

## Exit codes

| Verdict / condition            | Exit |
| ------------------------------ | ---- |
| `VALID`                        | 0    |
| `INVALID`                      | 1    |
| `PARTIAL`                      | 2    |
| Tool-level error (usage, I/O)  | ≥ 3  |

Exit codes follow the non-normative CLI note of EV-17; they are pinned for
cross-implementation consistency but are not themselves conformance-checked. A
tool-level error (bad usage, unreadable file, malformed `--head` or `--chain`) is never a
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
  recomputation (HA-14), genesis position (ES-33), the `--chain` and
  `--head` checks (EX-22, EX-15), and — at line 1 only — the `genesis` registration check promoted
  from Stage B (EV-20).
- **Stage B (semantic, per registered `(type, version)`)** — signatures and
  their Ed25519 canonical/prime-order gates (ET-3..ET-5, ET-4a/ET-4b/ET-4c),
  payload key sets (ES-18) including the two OPTIONAL `genesis` fork-ancestry
  keys and their presence rule (ES-34, ET-9e/ET-9f), key formats (ET-9b, ID-3),
  the distinctness of the two `genesis` keys (ET-9d),
  `chain_id` derivation
  (ET-7), title bounds and forbidden characters (ET-14), `choice_count` range
  (ET-14a), the ballot batching parameters and their floors (ET-14b),
  `issue_id` back-reference (ET-18/ID-8), `choice` range (ET-18a), and the
  ballot publication discipline of `contracts/event-types.md` v11: ballot `ts`
  quantized to the issue's declared interval (ET-23), a minimum batch size
  (ET-24), and no return to a batch instant already left (ET-24a). ET-25
  (order within a batch) is unverifiable by the contract's own statement and
  is not checked.

### Ballot batches (ET-23, ET-24, ET-24a — event-types.md v11)

A `vote_cast`'s `ts`, as milliseconds since `1970-01-01T00:00:00.000Z`
(proleptic Gregorian, no leap seconds), must be an exact multiple of its issue's
`ballot_batch_interval_ms`; zero and negative multiples (instants at or before
the epoch) count. Otherwise the ballot's own line is `INVALID` (ET-23).

Take one issue's registered `(vote_cast, 1)` events in `seq` order. A batch is
a **maximal run** of them sharing one `ts` (ET-24); other events, including
other issues' ballots, may sit between its members. A ballot whose `ts` differs
from its issue's previous registered ballot ends that batch and starts a new
one, and then:

- if the batch it ends holds fewer than the issue's `ballot_batch_min` ballots,
  the chain is `INVALID` at this ballot's line (ET-24: the ballot that ends the
  under-size batch);
- if this ballot's `ts` equals that of any earlier batch of the issue, the
  chain is `INVALID` at this ballot's line (ET-24a: the returning ballot, which
  starts a new batch and never rejoins the old one).

Both can name the same line; either reason is correct (ET-24a, "One line, two
rules"). So with `ballot_batch_min` 3 and one issue's ballots at T1, T1, T2,
T2, T2, T1, the chain is `INVALID` at the first T2, where the under-size run of
two T1 ballots ends. The batch still open at the end of the chain holds the
issue's highest-`seq` registered ballot and may be under-size (ET-24). `ts`
values are compared for equality only, never ordered (ES-21 v5). A `vote_cast`
at an unregistered version joins no batch, ends none and proves none not-last
(ET-24a, "Which ballots count").
Each ballot costs one map lookup and at most one insert: linear. End-truncation
can hide an ET-24 violation (EX-16); run with `--head`.

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
