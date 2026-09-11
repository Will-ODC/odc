import type { TestContext } from "node:test";

/**
 * How a conformance suite gets a fresh, empty store for one test.
 *
 * Every implementation of a store runs the same suite, so the in-memory stores
 * and the Postgres ones cannot drift: a behaviour one has and the other lacks
 * is a red test, not a surprise after deploy.
 *
 * `clock` is the time the store must stamp things with. Every suite runs on a
 * frozen clock, because stores take their time by injection and never from the
 * database (ADR-0021). `t` is for an implementation that has to clean up after
 * a test — a throwaway Postgres schema, say — which it registers with
 * `t.after`. The in-memory stores need neither and leave both out.
 */
export type MakeStore<S> = (clock: () => Date, t: TestContext) => Promise<S>;

export interface SuiteOptions {
  /**
   * Handed to the suite's `describe`: a reason skips it whole. A Postgres
   * implementation passes `databaseSkip` from `test/support/database.ts`, so
   * it skips with no database configured and fails when one is required.
   */
  skip?: string | false;
}
