# Open Questions

Unresolved design questions. Move each to an ADR when decided; delete when moot.

- Canonical JSON serialization for hashing: JCS (RFC 8785) vs. fixed field
  order? Must be trivially implementable in Go and TypeScript. (Phase 0)
- Operator key + identity service key management for MVP: file, env, or KMS?
- Anchoring cadence and venue for the chain head in v1 (which public repo, how often)?
- Signature scheme for participant keys (Ed25519 assumed — confirm in contracts/).
