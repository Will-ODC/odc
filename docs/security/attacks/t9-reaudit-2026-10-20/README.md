# T9 re-audit generators (2026-10-20)

Written from the spec text alone by the T9 re-auditor
(`docs/security/t9-reaudit-2026-10-20.md`). Run them from the repository root.

- `odc.mjs`: the spec-only encoder the others import.
- `node selfcheck.mjs .`: checks the encoder against `hashing.md` §6 and
  fixture `001`.
- `node attacks.mjs <out-dir>` and `node utf8.mjs <out-dir>`: write the
  adversarial chains the report cites.
- `node fuzz.mjs` and `node fuzz2.mjs`, each with `<out-dir> <go-binary> <ts-cli.js> <n> <seed>`:
  the Go-against-TS differential fuzz (seeds 7, 11 and 12 in the report).
