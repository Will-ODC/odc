# ADR-0001: Locked stack

- **Status:** accepted
- **Date:** 2026-07-18
- **Phase:** 0

## Context
Carried over from the implementation plan ("Stack (locked)").

## Decision
TypeScript for all services in a pnpm workspace with turborepo. Exception: the
verifier is Go — sharing zero code, runtime, or serialization library with
ledger makes its independence real and forces contracts/ to stay
language-neutral. Dev entry: root justfile over root docker-compose. Storage:
Postgres per service (own DB, append-only grants for event tables).

## Consequences
contracts/ must be implementable from spec alone in both languages; anything
that only works in one is a spec bug.

## Charter check
P1: verifier independence makes "anyone can recompute" real from day one.
