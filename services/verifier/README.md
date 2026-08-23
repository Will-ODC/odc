# verifier

Standalone Go CLI that verifies an ODC export (hash-chained NDJSON) against the
normative specs in `contracts/`. It is built from `contracts/` **alone**, in a
fresh, isolated context — independence from the ledger is the entire point, so a
second independent verifier can agree with it by construction.

```
verify <export.ndjson> [--head <hash>]
```

It reports exactly one of the three chain verdicts of `contracts/evolution.md`
EV-7/EV-17:

- `VALID` — every event passes the structural (Stage A) checks, and every
  event's `(type, version)` is registered and passes the semantic (Stage B)
  checks. Exit `0`.
- `INVALID at line N` — the first fatal line, scanning in file order. Exit `1`.
- `PARTIAL at lines …` — Stage A passed for the whole chain and no registered
  event failed Stage B, but one or more events carry a well-formed but
  unregistered `(type, version)` whose semantics could not be checked. Exit `2`.

Tool-level failures (bad usage, unreadable file) exit `3` and are never a chain
verdict. The reason text after a verdict is **advisory only** and is not part of
conformance (EV-17); conformance is the verdict token and line number(s) alone.

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
  verify_test.go            fixture-driven conformance tests
  genesis_ancestry_test.go  ET-9e/ET-9f/ES-34 key set, EV-20/EV-21 (synthetic)
  genesis_keys_test.go      ET-9d, the two genesis keys are distinct (synthetic)
  issue_title_test.go       ET-14 title bounds, counted in scalars (synthetic)
  parse_dupkeys_test.go     HA-6 duplicate keys across the parser's threshold
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

Five other suites sit alongside them and assert deliberately less. The first
three are **synthetic**: `contracts/fixtures/` ships no vector for the rules they
cover, their chains are built by the same hashing and signing code the assertions
run against, and they are therefore self-consistent by construction and pin no
preimage shape. What each case demonstrates is differential — one edit to an
otherwise identical chain moves the verdict in the direction the rule names.

- **`internal/verify/genesis_ancestry_test.go`** (synthetic) covers the two
  OPTIONAL `genesis` fork-ancestry keys (ET-9e/ET-9f), the REQUIRED half of the
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
- **`internal/verify/parse_dupkeys_test.go`** covers HA-6 duplicate-key
  detection across the parser's linear-scan/set threshold, with the duplicate
  placed both before and after the crossing. It is not synthetic in the sense
  above: it drives the parser directly rather than building chains.
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
