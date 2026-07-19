import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Root flat config, and the ONLY one the hooks consult: flat config does not
// cascade, and lefthook runs `eslint` from the repo root, so a per-service
// eslint.config.mjs would be ignored. Services extend these rules by adding to
// THIS file (or a shared package it imports), never by dropping a nested config.
//
// Rules are the non-type-checked `recommended` sets on purpose: the pre-commit
// hook must stay well under 5s, and type-aware linting would need a tsconfig
// per file. TypeScript IS the service language, so it must be linted here — a
// JS-only net would wave every .ts file through unchecked.
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Go verifier is not JS; it has no business in eslint's graph.
      "services/verifier/**",
      // contracts/ is the frozen byte-exact track — never lint or rewrite it.
      // Matches .prettierignore so the two tools agree on the boundary.
      "contracts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
