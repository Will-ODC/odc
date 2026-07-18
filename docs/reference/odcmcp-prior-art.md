# Prior art: ODCMCP prototype (~/IdeaProjects/ODCMCP)

A pre-charter standalone MCP prototype (~1.3k lines TS, tested). Its
architecture is NOT transferable — it owns mutable CRUD tables as truth
(violates P1: cascade deletes, no event log), uses session-cookie auth
(replaced by identity-signed events), and stores free-text arguments
(banned in the v1 log). Do not port its substrate.

Worth mining when the relevant ticket comes up:

- **Phase 3 `services/mcp`:** the MCP layer skeleton — official
  `@modelcontextprotocol/sdk` (v1.29) stateless Streamable HTTP `McpServer`;
  resource/tool/prompt registration structure (`src/mcp/*.ts`); zod input
  schemas; structured never-throw tool results; `lastModified` cache hints
  on resources. Re-point reads at tally/ledger public APIs instead of a pool.
- **Phase 3 prompts:** two registered reasoning-aid prompts
  (`src/mcp/prompts.ts`) — charter §9 ships these; carry over nearly verbatim.
- **Phase 2 `services/tally`:** the tally payload shape (`src/db/tally.repo.ts`)
  — parallel aggregations in one response, each row carrying
  `weight`/`member_count` so community participants slot in without a
  breaking change. Good design input for `GET /issues/{id}/tally`.
- **Testing:** Testcontainers real-Postgres harness (`tests/`,
  `vitest.config.ts`) fits odc-testing's API-test tier; `client/thin-client.ts`
  is a ready smoke-test pattern.
