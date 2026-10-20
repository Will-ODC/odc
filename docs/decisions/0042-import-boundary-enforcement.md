# ADR-0042: Enforce source import boundaries through root lint

- **Status:** accepted — operator-approved repository cleanup plan, 2026-10-20
- **Date:** 2026-10-20
- **Phase:** 0

## Context

Contributor instructions separate the charter-governed core from Pulse and keep
Pulse's API and browser implementations behind their HTTP interface. ADR-0041
places the two implementation-aware Pulse integration suites in a dedicated
workspace. Documentation alone does not make a prohibited import fail a check.

The repository already runs root ESLint configuration from staged-file hooks and
package lint tasks. The required repository CI job runs root lint. Enforcement
belongs in those paths, with focused regression cases, rather than an optional
workflow or a rule that recognizes only one relative import spelling.

## Decision

1. Load a local import-boundary rule from
   `.github/scripts/import-boundaries.mjs` in `eslint.config.mjs`. Use the
   existing TypeScript resolver, workspace metadata, normalized paths and real
   paths to identify the destination of a module reference.
2. Treat `services/`, `tools/` and `contracts/` as core destinations for Pulse
   crossings. Reject app-to-core and core-to-app imports, and imports between
   the sibling Pulse implementations. App-local tests do not create a
   cross-application exception. Runtime packages may not import the integration
   runner as a bridge. Only the designated `tests/pulse-integration` workspace may import both Pulse
   implementations for integration tests; it may not import the core.
3. Check static imports, type imports, re-exports, literal dynamic imports and
   supported CommonJS/TypeScript module-reference forms. Diagnose computed
   module expressions in governed packages when their destination cannot be
   checked statically. Report the importing file and the forbidden destination.
4. Keep ordinary same-package imports and legitimate core contract imports
   working. This check does not change public HTTP interfaces, storage ownership
   or verifier implementations.
5. Run the focused regression suite with `pnpm test:boundaries` in the existing
   required repository workflow. Root lint checks the implementation and normal
   package lint applies the rule. Package lint runs without Turbo caching:
   resolution can depend on inherited configs, metadata and symlinks outside
   the importing package.

## Consequences

- A forbidden import fails staged-file ESLint and package lint before it can be
  accepted by required CI. Fixture tests cover rejected and permitted imports,
  including alternate relative paths, aliases and the integration exception.
- This is a static source check, not a security sandbox or a complete dependency
  proof. It does not police arbitrary filesystem/network access, code generated
  at runtime, `eval`, aliases of `require` or alternate runtime loaders. Bundler-only
  aliases must also be declared in TypeScript configuration to be resolved by
  this guard. Storage and API boundaries
  still require implementation review and behavior tests. Other core
  service-to-service ownership rules remain review requirements; this slice
  enforces the Pulse/core and sibling-app crossings described above.
- Go source is not checked by ESLint. The Go verifier's fresh-context isolation
  and independent implementation rules remain separate requirements.
- Regression tests use synthetic fixture trees for core import cases. Building
  or reviewing this guard does not require reading ledger or verifier source.
- Developers retain the existing package lint commands; the focused test script
  provides a quick way to check changes to the guard itself.

### Documents reconciled

- Root `README.md` and `CLAUDE.md`: identify the enforced boundaries and checks.
- Pulse API/browser contributor guides: distinguish public HTTP communication
  from the test-only integration import exception.
- `tests/pulse-integration/README.md`: documents the exception's exact scope.
- `odc-service-boundaries`, `odc-testing` and `odc-pipeline` skills: describe
  enforcement, regression commands and limits without replacing policy.
- `eslint.config.mjs`, root `package.json`, Turbo configuration and the required
  repository workflow: load and test the same check, with uncached package lint.
- `lefthook.yml`: existing staged-file ESLint already loads the root rule; no
  new hook is required.
- App READMEs already link to their contributor guides. No endpoint behavior
  changes require `API.md` edits.
- ADR-0041: its integration-test ownership and independent application builds
  remain unchanged; this ADR enforces those source boundaries.

## Charter check

The core's public-API and storage boundaries remain in force. Pulse's charter
exemption is preserved; its mutable voting model is not evaluated against core
charter requirements. No contracts, event data, serialization or verifier
implementation changes are introduced. The guard supplements fresh-context
review and does not relax verifier independence.
