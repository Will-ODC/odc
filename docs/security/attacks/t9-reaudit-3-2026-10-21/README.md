# Third T9 re-audit generators (2026-10-21)

Written from the spec text by the third T9 re-auditor
(`docs/security/t9-reaudit-3-2026-10-21.md`). Run them from the repository
root after `pnpm install`.

## Build the two verifiers

- Go: `(cd services/verifier && go build -o <bin-dir>/odcv .)`, then use
  `<bin-dir>/odcv`.
- TS: `pnpm --filter @odc/verifier-ts build`, then use
  `node tools/verifier-ts/dist/src/cli.js`.

## Generators

- `node docs/security/attacks/t9-reaudit-3-2026-10-21/attacks3.mjs <out-dir>`
  writes four chains and `cases.json`, which holds each expected
  verdict. It imports the first re-audit's encoder
  (`../t9-reaudit-2026-10-20/odc.mjs`), which Node resolves from the script's
  own folder. Run each chain through both verifiers:

  ```
  <bin-dir>/odcv <out-dir>/registrar-refuses-then-next-batch.ndjson
  node tools/verifier-ts/dist/src/cli.js <out-dir>/registrar-refuses-then-next-batch.ndjson
  ```

This audit also re-ran, unchanged, the earlier rounds' generators:
`../t9-reaudit-2026-10-20/` (`selfcheck.mjs`, `attacks.mjs`, `utf8.mjs`,
`fuzz.mjs`, `fuzz2.mjs`) and `../t9-reaudit-2-2026-10-20/` (`attacks2.mjs`,
`corpus.mjs`). Their READMEs give their arguments.
