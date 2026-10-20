# verifier

Standalone Go CLI that verifies an ODC export (hash-chained NDJSON) against the
normative specs in `contracts/`. It is built from `contracts/` **alone**, in a
fresh, isolated context — independence from the ledger is the entire point, so a
second independent verifier can agree with it by construction.

```
verify <export.ndjson> [--head <hash>] [--chain <genesis-hash>]
```

It reports exactly one of the three chain verdicts of `contracts/evolution.md`
EV-7/EV-17:

- `VALID` — every event passes the structural (Stage A) checks, and every
  event's `(type, version)` is registered and passes the semantic (Stage B)
  checks. Exit `0`.
- `INVALID at line N` — the first fatal line, scanning in file order. Exit `1`.
- `PARTIAL at lines …` — Stage A passed for the whole chain and no registered
  event failed Stage B, but one or more events carry a well-formed but
  unregistered `(type, version)` whose semantics could not be checked. The
  lines listed are those events plus every registered ballot whose batch or
  issue checks they leave unresolved (ET-18b, ET-24b). Exit `2`.

Tool-level failures (bad usage, unreadable file) exit `3`, and an internal
failure that reached no verdict exits `4` (EV-24); neither is ever a chain
verdict. Every line within the EV-23 minimums (65536 bytes, depth 64) reaches
its verdict; there is no limit on line length, line count or input size, and a
line deeper than 64 is `INVALID` at that line as EV-24 permits (`API.md`,
"Implementation limits"). The reason text after a verdict is **advisory
only** and is not part of conformance (EV-17); conformance is the verdict token and line number(s) alone.

`--chain` pins which chain (its genesis hash, EX-22; mismatch is `INVALID at
line 1`), `--head` pins how much of it (EX-15). Either mismatch can only turn a
`VALID` or `PARTIAL` into `INVALID`, never move an earlier `INVALID`; if both
mismatch, line 1 is blamed (EX-23).

On every run that reaches a verdict over non-empty input — whatever the
verdict, malformed input included — the verifier also writes the two endpoint
**stored claims** of EX-24 to stderr, one line each:

```
genesis hash (stored claim): <64 lowercase hex | unavailable>
head hash (stored claim): <64 lowercase hex | unavailable>
```

These are the decoded `hash` string values **stored** in the first and last
records of the file (no normalisation beyond JSON decoding), not recomputed or
verified hashes: on an `INVALID` verdict they prove
nothing, and they mean something only alongside the verdict and an
independently trusted anchor. A value is `unavailable` when that record does
not decode as a JSON object with a 64-lowercase-hex `hash` string. Nothing is
reported for an empty file or on a tool-level error. This is tool output, not
conformance (EV-17). Exact rules in `API.md`.

See `API.md` for the full interface, and `docs/charter.md` §4 for the record
model this verifier enforces.

## Layout

```
main.go                     CLI: argument parsing, I/O, exit codes
cli_extremes_test.go        extreme-value cases, driven as a subprocess
internal/verify/
  parse.go                  strict byte-exact JSON parser (canonical line form)
  framing.go                NDJSON framing (EX-1..EX-6, EX-20)
  event.go                  envelope / Stage-A structural checks
  hashing.go                byte-exact preimage + SHA-256 (HA-1..HA-16)
  crypto.go                 Ed25519 canonical + prime-order key checks (ET-4a/b/c)
  verify.go                 two-stage driver, verdict + precedence
  report.go                 EX-24 stored-claim report (candidates + claims)
  ballot.go                 ballot ts quantization + batch runs (ET-23/ET-24/ET-24a/ET-24b)
  verify_test.go            fixture-driven conformance tests
  genesis_ancestry_test.go  ET-9e/ET-9f/ES-34 key set, EV-20/EV-21 (synthetic)
  genesis_keys_test.go      ET-9d, the two genesis keys are distinct (synthetic)
  issue_title_test.go       ET-14 title bounds, counted in scalars (synthetic)
  limits_test.go            ET-9 contracts bound; EV-23/EV-24 length, depth, line count (synthetic)
  ballot_test.go            ET-23, ET-24, ET-24a + blamed lines (synthetic)
  ballot_opaque_test.go     ET-24b, ET-18b + a brute-force oracle (synthetic)
  parse_dupkeys_test.go     HA-6 duplicate keys across the parser's threshold
  report_test.go            EX-24 candidate-record splitting
chain_report_test.go        --chain/--head precedence and the EX-24 report (CLI)
limits_cli_test.go          EV-23/EV-24 at the CLI: long and deep lines, panic -> exit 4
```

## Dependencies

Go standard library only, with a single exception permitted by
`event-types.md` ET-4c (ADR-0010): `filippo.io/edwards25519` is used **only** for
the ET-4c prime-order subgroup check on verification keys — curve scalar
multiplication that is not in the standard library. Everything else — framing,
parsing, hashing, the ET-4a/ET-4b integer comparisons, and the Ed25519 verify
primitive (ET-5, via `crypto/ed25519`) — is stdlib.

## Testing

```
go test ./...
```

Conformance test data is the golden vectors in `contracts/fixtures/` and nothing
else. Each vector asserts only its verdict token and line number(s). The suite
also pins the byte-exact preimage construction against
`contracts/fixtures/preimages/`.

Ten other suites sit alongside them and assert deliberately less. The first
six are **synthetic**: `contracts/fixtures/` ships no vector for the rules they
cover, their chains are built by the same hashing and signing code the assertions
run against, and they are therefore self-consistent by construction and pin no
preimage shape. What each case demonstrates is differential — one edit to an
otherwise identical chain moves the verdict in the direction the rule names.

- **`internal/verify/genesis_ancestry_test.go`** (synthetic) covers the two
  OPTIONAL `genesis` fork-ancestry keys (ET-9e, and ET-9f's both-or-neither
  rule of `event-types.md` v13), the REQUIRED half of the
  ES-18/ES-34 key set, and the unregistered-`genesis` rule (EV-20/EV-21). Every
  rejection case asserts the advisory reason as well as the verdict and line —
  not as conformance (EV-17 forbids that), but because "INVALID at line 1" is
  satisfied by any genesis fault at all, so without it a case rejected for an
  unrelated reason would still be counted as coverage of its rule.
- **`internal/verify/genesis_keys_test.go`** (synthetic) covers ET-9d, that a
  `genesis` MUST declare two distinct keys, and the boundary of that rule: it is
  necessary, not sufficient, and two distinct keys held by one party are
  accepted because no export can tell.
- **`internal/verify/issue_title_test.go`** (synthetic) covers ET-14's title
  bounds over a real two-line chain, which is what it takes to reach them: the
  1–200 bound is in Unicode SCALARS while HA-2/HA-3 length-prefix the same
  string in BYTES, so the accept cases are titles of 200 three-byte and 200
  four-byte scalars, which a byte-length bound would reject.
- **`internal/verify/ballot_test.go`** (synthetic) covers ET-23, ET-24 and
  ET-24a (`contracts/event-types.md` v12), alongside vectors `099`-`108`
  (ADR-0029) and the ADR-0034 vectors from `116`. It asserts the blamed line on
  every rejection: a batch (a maximal run of one issue's registered ballots
  sharing a `ts`) exactly at the minimum, the one legal under-size batch, an
  under-size batch ended by a later ballot of its issue — including the
  contract's own T1, T1, T2, T2, T2, T1 example, fatal at the first T2 — interleaved
  issues and other events between one batch's members, a ballot returning to a
  left instant (mid-chain, at the end, past several batches, after an
  under-size batch), unregistered `vote_cast` versions in between, `ts` one
  millisecond off, lastness by `seq` rather than `ts`, the interaction with
  other faults, the truncation residual with `--head`, and the CLI's exit
  status and single output line on a built binary.
- **`internal/verify/ballot_opaque_test.go`** (synthetic) covers ET-24b and
  ET-18b (ADR-0034): ADR-0034's eight-case table, candidacy by interval and by
  `seq`, issues sharing instants, malformed opaque payloads (EV-16), and
  `--head` on an unresolved chain. A brute-force test compares the verifier
  with a separately written, deliberately quadratic reading of ET-24b over
  thousands of random small chains and logs the verdict distribution; a
  second test checks that reading against the exact all-assignments meaning
  ET-24b's informative paragraph states (a definite failure fails under every
  assignment; a resolved check passes under every one). A cost test verifies
  hostile chains (3000 issues, 3000 opaque ballots at distinct instants; one
  shared interval, and 3000 distinct intervals) and
  bounds its allocation to a small multiple of the export size.
- **`internal/verify/limits_test.go`** (synthetic) covers ADR-0038 as the specs
  state it. ET-9's `contracts` bound on both sides of 64 bytes: ASCII, three-
  and four-byte characters (16 four-byte characters are accepted, 65 bytes in
  20 characters are not, so the count is bytes, not scalars), and escapes
  counted once after decoding (`\u0001` plus 63 bytes is accepted though 69
  bytes on the line; 64 `\u001f` escapes, 384 bytes on the line, are
  accepted). EV-23/EV-24: a conforming unregistered line of 65535, 65536,
  65537 bytes, 1 MiB and 4 MiB each reaches `PARTIAL`, and a fatal line after
  it is still found; the parser parses depth 64 in full and stops at 65, with
  depth measured by a separate transcription of EV-23's byte scan; brackets
  inside strings are not depth; the depth limit never displaces an earlier
  fatal line; and a 200000-line chain reaches its verdict.
- **`internal/verify/parse_dupkeys_test.go`** covers HA-6 duplicate-key
  detection across the parser's linear-scan/set threshold, with the duplicate
  placed both before and after the crossing. It is not synthetic in the sense
  above: it drives the parser directly rather than building chains.
- **`chain_report_test.go`** drives the CLI as a subprocess over committed
  vectors (and edits of them) to pin the `--chain`/`--head` precedence of
  EX-15/EX-22/EX-23 — an earlier file-check `INVALID`, structural or semantic,
  keeps its line; `PARTIAL` does not block either comparison; both anchors
  wrong blames line 1 — and every EX-24 candidate and claim rule against the
  exact stderr report: terminal LF vs. trailing blank record, missing final LF,
  CRLF, last-occurrence duplicate `hash`, no normalisation, one endpoint
  `unavailable` without suppressing the other, and no report on empty input
  or tool errors. Verdicts there are those `contracts/fixtures/` fixes; the
  report lines are this tool's interface, not conformance.
- **`cli_extremes_test.go`** drives the CLI as a subprocess over structurally
  valid exports carrying extreme values — deep nesting, integers straddling
  2^63, huge and escape-heavy strings, very wide payloads, very large line
  counts. It asserts only that the process returns, prints exactly one
  well-formed verdict line, and exits with a status agreeing with that line. It
  never asserts *which* verdict: `contracts/fixtures/` is the sole oracle for
  that. No case in it reaches Stage B: every line is rejected in Stage A, most
  of them at the hash recomputation, and that is the point of them — the parser
  must survive input the verifier is about to throw away. ET-14's scalar bound
  is therefore not exercised here but in `issue_title_test.go`, which is where
  it is reachable. A subprocess is required because a Go stack overflow is a
  runtime fatal error rather than a panic — `recover()` cannot turn it back
  into a verdict — and because its exit status is 2, which collides with
  `PARTIAL`; the suite judges stdout first for exactly that reason.
- **`limits_cli_test.go`** drives the same limits through the CLI, so a line
  buffer in the read path (a `bufio.Scanner` at its 64 KiB default is the
  classic one) would be caught: vector `001` plus a fatal line 2 of 65535,
  65536, 65537 bytes and 1 MiB must print `INVALID at line 2`, exit `1`; lines
  at depth 64, 65 and 1000000 print the same; and a panic injected into the
  verdict or the EX-24 report exits `4` with empty stdout and no report.
