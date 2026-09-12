import type { Pool, PoolClient } from "pg";

/**
 * Run `work` in one transaction on one connection: commit if it returns, roll
 * back and rethrow if it throws.
 *
 * The error reported is always the one that caused the rollback. A rollback
 * that fails in turn — the connection died, say — must not replace it: that
 * error only says the connection is gone, while the original says why the
 * work failed. (The migration runner's review caught exactly that masking.)
 * A connection whose rollback failed is thrown away rather than handed on.
 *
 * A COMMIT is not trusted to have committed. Work that catches a SQL error
 * and carries on leaves the transaction aborted, and Postgres answers its
 * COMMIT with a rollback — every write lost, and nothing said. Here that is
 * an error.
 *
 * `begin` is the statement that opens the transaction, so a reader can ask for
 * `begin isolation level repeatable read read only` and see one snapshot.
 */
export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  begin = "begin",
): Promise<T> {
  const client = await pool.connect();
  // A checked-out client whose backend dies emits "error". The pool listens
  // only on idle clients, so without a listener here the event is an uncaught
  // exception that takes the whole process down. The listener only has to
  // exist: pg already discards a connection that can no longer take queries.
  const onError = () => undefined;
  client.on("error", onError);
  let broken = false;
  try {
    await client.query(begin);
    const result = await work(client);
    const committed = await client.query("commit");
    if (committed.command !== "COMMIT") {
      throw new Error(
        "the database rolled this transaction back instead of committing it:" +
          " an error inside it was caught and not rethrown",
      );
    }
    return result;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.off("error", onError);
    client.release(broken);
  }
}
