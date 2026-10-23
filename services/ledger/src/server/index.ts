import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { Ledger } from "../ledger.js";
import type { ServerLogger } from "./http.js";
import { buildInternalApp, type CloseIssue } from "./internal.js";
import { buildPublicApp } from "./public.js";

export { buildInternalApp, closeMessage, type CloseIssue } from "./internal.js";
export { buildPublicApp } from "./public.js";

export interface ServerDeps {
  ledger: Ledger;
  pool: Pool;
  closeIssue?: CloseIssue | undefined;
  clock?: () => number;
  logger?: ServerLogger;
}

/** The ledger's two ports (API.md): public reads, internal writes. */
export function buildServers(deps: ServerDeps): {
  publicApp: FastifyInstance;
  internalApp: FastifyInstance;
} {
  const logger = deps.logger;
  return {
    publicApp: buildPublicApp({ pool: deps.pool, logger }),
    internalApp: buildInternalApp({
      ledger: deps.ledger,
      closeIssue: deps.closeIssue,
      clock: deps.clock ?? Date.now,
      logger,
    }),
  };
}
