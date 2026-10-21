# Second T9 re-audit generators (2026-10-20)

Written from the spec text by the second T9 re-auditor
(`docs/security/t9-reaudit-2-2026-10-20.md`). Run them from the repository
root after `pnpm install`.

- `node docs/security/attacks/t9-reaudit-2-2026-10-20/attacks2.mjs <out-dir>`
  writes the seven attack chains and `cases.json`. It imports the first
  re-audit's encoder (`../t9-reaudit-2026-10-20/odc.mjs`), which Node resolves
  from the script's own folder.
- `node docs/security/attacks/t9-reaudit-2-2026-10-20/corpus.mjs <out-dir> . <go-binary> <ts-cli>`
  runs both verifiers over every vector and compares them with
  `contracts/fixtures/index.json`. Build the verifiers first:
  - Go: `(cd services/verifier && go build -o /tmp/odcv .)`, then pass
    `/tmp/odcv`.
  - TS: `pnpm --filter @odc/verifier-ts build`, then pass
    `tools/verifier-ts/dist/src/cli.js`.

  A verifier that cannot be started shows up as a `TOOL` mismatch.
