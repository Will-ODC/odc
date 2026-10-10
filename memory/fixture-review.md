# Fixture consistency review — 2026-10-10

Status: independently confirmed corrections, awaiting operator merge on
`contracts/fixture-consistency-review`. This is an audit handoff, not a record
of a merged change. Pulse is being changed in another session; no Pulse files
were edited here.

## Confirmed findings

- README anchor precedence was stale after export-format v5. File failures keep
  their original attribution; eligible chain mismatches precede head mismatches.
  The absent golden cases remain coverage gaps, not unspecified behavior.
- Chain A/B have matching unsigned payload fields, but the timestamp change also
  changes the signature and hash (HA-15/HA-16).
- The hashed genesis payload contains five strings, including `sig`; vector 095
  also incorrectly assigned ES-10's type rule to the payload.
- Vector 033 is not a format-only failure: uppercase `prev_hash` also changes
  the text-based hashing preimage. Vector 036 does isolate stored-hash format.
- Vector 011's claim that no v1 payload permits controls was false: ET-9 allows
  them in a nonempty genesis `contracts` string. Its x_ type still validly pins
  string escaping without registered-type semantics.
- T7/T8 reproduction is completed historical work, not an outstanding initial
  step. New vectors still need independent confirmation.

README becomes v15; the changelog records the corrections. Three generator
advisory notes are synchronized with index.json and its manifest digest.
No export, preimage, derivation, anchor input, expected verdict, or normative
rule changes. Intentional overlap and the three byte-identical export groups
are retained: each full invocation has distinct inputs.

## Evidence

An independent context read the contracts and fixtures without the generator
or verifier implementations. It checked 115 unique IDs and their export files, counts
(21 VALID, 4 PARTIAL, 90 INVALID), expectation shapes and line bounds,
duplicate JSON keys, and citation existence. It independently reproduced
both preimages (607 and 443 bytes), both seed/key and identifier derivations,
335 event digests (deliberate invalid mutations account for mismatches), and
77 registered-event signatures in VALID/PARTIAL vectors. Curve arithmetic
confirmed 081's identity key and 082's mixed-order key. No concrete verdict or
line-attribution defect was found; this is not a claim of exhaustive coverage.

Current-instance validation used Node 20.20.2, pnpm 9.0.0, Go 1.24.13 and the
repository's disposable Postgres 17 container. All 1,411 workspace tests
passed (141 fixture generator, 404 Pulse with database required, 372 web,
268 TypeScript verifier, 226 rehearsal), with no skipped Node suites.
Go packages passed; build, lint, typecheck, format, manifest and the nine
rehearsal scenarios through both verifiers passed. Both CLIs also passed all
16 anchor/report policy checks. The Pulse API and seeded poll/community picker
worked through the web proxy after restarting the API with the saved command.
Repeated installation and fixture regeneration passed. Node 24 initially failed
two library-behavior isolation assertions; CI's Node 20 resolves that mismatch.

## Review

A separate fresh-context reviewer returned **APPROVE WITH NITS**, confirming
the corrections against the normative contracts and actual bytes. Its wording
nit about unique IDs/files versus unique byte sequences was fixed. Neither
audit nor review context read verifier/ledger implementation. Review used the
available Codex model; this environment does not offer the repository's named
Opus model.

## Handoff

Do not delete or deduplicate vectors by export hash: anchor inputs are part of
the test case. Golden coverage for simultaneous wrong anchors and for invalid
files with wrong anchors remains absent, although CLI policy tests exercise
those cases. EX-24 presentation is explicitly outside golden conformance.
The citation inventory is not a coverage metric. T9 remains closed, and no
operator-owned normative decision was taken in this prose correction.

Environment setup/start instructions are saved as a draft; the operator must
review/save and publish in environment settings. Processes do not survive a
fresh task. Activate `/workspace/.odc-tools/env.sh` before commands. Local setup
scripts and logs reside outside the checkout, under `/workspace/.odc-tools`
and `/tmp/odc-*.log`; they are not part of this branch.
