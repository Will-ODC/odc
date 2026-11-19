/**
 * One in-memory request counter per client address, in fixed windows.
 *
 * `publicVotesRateLimit` (ADR-0048 decision 7) is one of these, consulted by
 * the HTTP list route and, from step 3, by MCP's `get_public_votes`, so one
 * address gets one allowance across both. Two `@fastify/rate-limit` route
 * configs would each keep their own count. Like every pulse limiter it is per
 * process, so a scaled-out deployment multiplies the allowance.
 */
export interface AddressLimitOptions {
  max: number;
  /** The window, in milliseconds. */
  timeWindow: number;
}

/** Above this many addresses, expired windows are swept, once per window. */
const SWEEP_AT = 1024;

/**
 * The most addresses held at once. Past it the oldest window is dropped, in
 * O(1) through the map's insertion order, so memory stays bounded however
 * many addresses a client controls (an IPv6 /64 is plenty).
 *
 * Evicting, not refusing new addresses: refusing once full would let one
 * client with many addresses lock every other address out of the route.
 * Evicting only gives a fresh window to an address that has gone longest
 * without a new one, and a client that can fill the map can already rotate
 * addresses for a fresh allowance each, so it loses nothing it did not have.
 */
export const DEFAULT_MAX_ADDRESSES = 10_000;

export class AddressLimit {
  readonly #max: number;
  readonly #window: number;
  readonly #capacity: number;
  readonly #clock: () => Date;
  readonly #windows = new Map<string, { count: number; resetAt: number }>();
  #nextSweep = 0;

  constructor(
    options: AddressLimitOptions,
    clock: () => Date,
    maxAddresses = DEFAULT_MAX_ADDRESSES,
  ) {
    if (!Number.isInteger(options.max) || options.max < 1)
      throw new RangeError("max is a whole number of requests, at least 1");
    if (!Number.isFinite(options.timeWindow) || options.timeWindow <= 0)
      throw new RangeError("timeWindow is a positive number of milliseconds");
    if (!Number.isInteger(maxAddresses) || maxAddresses < 1)
      throw new RangeError("maxAddresses is a whole number, at least 1");
    this.#max = options.max;
    this.#window = options.timeWindow;
    this.#capacity = maxAddresses;
    this.#clock = clock;
  }

  /** How many addresses are held now; for tests of the bound. */
  get size(): number {
    return this.#windows.size;
  }

  /**
   * Count one request from this address. Allowed, or refused with the whole
   * seconds until its window resets.
   */
  take(
    address: string,
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.#clock().getTime();
    let held = this.#windows.get(address);
    if (held === undefined || held.resetAt <= now) {
      // Re-inserted, so insertion order stays oldest window first.
      this.#windows.delete(address);
      if (this.#windows.size >= SWEEP_AT && now >= this.#nextSweep) {
        this.#nextSweep = now + this.#window;
        for (const [key, window] of this.#windows)
          if (window.resetAt <= now) this.#windows.delete(key);
      }
      while (this.#windows.size >= this.#capacity) {
        const oldest = this.#windows.keys().next();
        if (oldest.done) break;
        this.#windows.delete(oldest.value);
      }
      held = { count: 0, resetAt: now + this.#window };
      this.#windows.set(address, held);
    }
    if (held.count >= this.#max) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((held.resetAt - now) / 1000)),
      };
    }
    held.count++;
    return { allowed: true };
  }
}
