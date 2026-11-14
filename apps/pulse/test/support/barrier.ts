import type { Pool } from "pg";

/**
 * Force concurrent work to overlap at a real database lock.
 *
 * A barrier transaction takes `lockSql` and holds it. `run` then starts the
 * concurrent work, and the barrier is released only once `waiters` backends
 * are waiting on it, directly or behind one another (a row lock queue makes
 * the second waiter wait on the first). `Promise.all` alone can serialize by
 * chance, so a missing lock would go unnoticed; here every waiter has
 * provably reached the lock before anyone may pass it.
 *
 * Throws if the waiters never arrive, which is itself a failure: the work did
 * not take the lock the test is about.
 */
export async function atBarrier<T>(
  pool: Pool,
  lockSql: string,
  params: unknown[],
  waiters: number,
  run: () => Promise<T>,
): Promise<T> {
  const barrier = await pool.connect();
  try {
    await barrier.query("begin");
    await barrier.query(lockSql, params);
    const pid = (
      await barrier.query<{ pid: number }>("select pg_backend_pid() as pid")
    ).rows[0]?.pid;
    const pending = run();
    // Mark it handled now; it is awaited after the release below.
    pending.catch(() => undefined);
    const deadline = Date.now() + 5000;
    for (;;) {
      const { rows } = await pool.query<{ pid: number; blockers: number[] }>(
        "select pid, pg_blocking_pids(pid) as blockers from pg_stat_activity" +
          " where cardinality(pg_blocking_pids(pid)) > 0",
      );
      // Everyone blocked by the barrier, or by someone already counted.
      const held = new Set<number>([pid as number]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const row of rows)
          if (!held.has(row.pid) && row.blockers.some((b) => held.has(b))) {
            held.add(row.pid);
            grew = true;
          }
      }
      if (held.size - 1 >= waiters) break;
      if (Date.now() > deadline) {
        await barrier.query("rollback");
        await pending.catch(() => undefined);
        throw new Error("the concurrent work never waited at the barrier");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await barrier.query("commit");
    return await pending;
  } finally {
    await barrier.query("rollback").catch(() => undefined);
    barrier.release();
  }
}
