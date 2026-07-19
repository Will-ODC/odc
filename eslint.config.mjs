import js from "@eslint/js";

// Root flat config. Services add their own config that extends this once they
// exist; until then this lints any stray JS/TS at the root and in tooling.
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      // Go verifier is not JS; it has no business in eslint's graph.
      "services/verifier/**",
      // contracts/ carries byte-exact fixtures, not lintable source.
      "contracts/fixtures/**",
    ],
  },
  js.configs.recommended,
];
