import { createBatcher } from "./batching/batcher.js";
import { createSignerClient } from "./clients/signer.js";
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

  const batcher = createBatcher({
    ledger,
    pool,
    signer: createSignerClient({ baseUrl: config.signerUrl }),
    log: (line) => console.error(`ledger batching: ${line}`),
  });
  // A stored sign request is replayed, unchanged, before anything else is
  // appended (API.md "Calls the ledger makes"). If the signer is down this
  // leaves it pending, and /appends answers 503 until it is appended.
  // A log that is not VALID takes no appends, so no batcher runs at all.
  const valid = ledger.notValid === null;
  if (valid) await batcher.recover();

  const { publicApp, internalApp } = buildServers({
    ledger,
    pool,
    closeIssue: valid ? (id) => batcher.closeIssue(id) : undefined,
    batchPending: () => batcher.signPending(),
    logger: true,
  });
  await publicApp.listen({ port: config.publicPort, host: config.publicHost });
  await internalApp.listen({
    port: config.internalPort,
    host: config.internalHost,
  });

  if (valid) batcher.start();

  const stop = async (): Promise<void> => {
    // Stop taking requests first, then let the batcher finish its step.
    await Promise.allSettled([publicApp.close(), internalApp.close()]);
    await batcher.stop();
    await pool.end();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
