import { serverConfig } from "./config.js";
import { createPool } from "./db/events.js";
import { Ledger } from "./ledger.js";
import { buildServers } from "./server/index.js";

/**
 * Serving the ledger: config, pool, the replayed log, both ports. Migrations
 * are not run here; the runtime role cannot run them.
 */
async function main(): Promise<void> {
  const config = serverConfig();
  const pool = createPool(config.databaseUrl);
  const ledger = await Ledger.open(pool);
  if (ledger.notValid !== null) {
    // Reads still serve the log as stored; EV-26 bars every append.
    console.error(`ledger: ${ledger.notValid.message}; appends are refused`);
  }

  // ---------------------------------------------------------------------
  // BATCHING RECOVERY GOES HERE, before the internal port accepts appends.
  // A stored sign request must be replayed, unchanged, before anything else
  // is appended (API.md "Calls the ledger makes"; CLAUDE.md). The batching
  // module also supplies `closeIssue`; until then the close call answers 503.
  // ---------------------------------------------------------------------
  const closeIssue = undefined;

  const { publicApp, internalApp } = buildServers({
    ledger,
    pool,
    closeIssue,
    logger: true,
  });
  await publicApp.listen({ port: config.publicPort, host: config.publicHost });
  await internalApp.listen({
    port: config.internalPort,
    host: config.internalHost,
  });

  const stop = async (): Promise<void> => {
    await Promise.allSettled([publicApp.close(), internalApp.close()]);
    await pool.end();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
