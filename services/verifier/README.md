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

One case is carved out of that forward compatibility: a chain whose **`genesis`**
carries a `(type, version)` this verifier does not register is `INVALID` at line
1, never `PARTIAL` (EV-20). Such a genesis yields no operator or registrar key,
so nothing on the chain could be authenticated at all.

Tool-level failures (bad usage, unreadable file) exit `3` and are never a chain
verdict. The reason text after a verdict is **advisory only** and is not part of
conformance (EV-17); conformance is the verdict token and line number(s) alone.

See `API.md` for the full interface, and `docs/charter.md` §4 for the record
model this verifier enforces.

## Layout

```
main.go                     CLI: argument parsing, I/O, exit codes
internal/verify/
  parse.go                  strict byte-exact JSON parser (canonical line form)
  framing.go                NDJSON framing (EX-1..EX-6, EX-20)
  event.go                  envelope / Stage-A structural checks
  hashing.go                byte-exact preimage + SHA-256 (HA-1..HA-16)
  crypto.go                 Ed25519 canonical + prime-order key checks (ET-4a/b/c)
  verify.go                 two-stage driver, verdict + precedence
  verify_test.go            fixture-driven conformance tests
  rules_test.go             synthetic chains for rules no fixture pins yet
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

Test data is the golden vectors in `contracts/fixtures/` and nothing else. Each
vector asserts only its verdict token and line number(s). The suite also pins
the byte-exact preimage construction against `contracts/fixtures/preimages/`.
