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

Two other suites sit alongside them and assert deliberately less:

- **`internal/verify/genesis_ancestry_test.go`** covers the two OPTIONAL
  `genesis` fork-ancestry keys (ET-9e/ET-9f) and the unregistered-`genesis` rule
  (EV-20), for which `contracts/fixtures/` ships no vector. Its chains are built
  by the same hashing and signing code they are checked against, so they are
  self-consistent by construction and pin no preimage shape. What each case
  demonstrates is differential: one edit to an otherwise identical chain moves
  the verdict in the direction the rule names.
- **`cli_extremes_test.go`** drives the CLI as a subprocess over structurally
  valid exports carrying extreme values — deep nesting, integers straddling
  2^63, huge and escape-heavy strings, very wide payloads, very large line
  counts. It asserts only that the process returns, prints exactly one
  well-formed verdict line, and exits with a status agreeing with that line. It
  never asserts *which* verdict: `contracts/fixtures/` is the sole oracle for
  that. A subprocess is required because a Go stack overflow is a runtime fatal
  error rather than a panic — `recover()` cannot turn it back into a verdict —
  and because its exit status is 2, which collides with `PARTIAL`; the suite
  judges stdout first for exactly that reason.
