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

/** Above this many addresses, expired windows are swept before adding one. */
const SWEEP_AT = 1024;

export class AddressLimit {
  readonly #max: number;
  readonly #window: number;
  readonly #clock: () => Date;
  readonly #windows = new Map<string, { count: number; resetAt: number }>();

  constructor(options: AddressLimitOptions, clock: () => Date) {
    if (!Number.isInteger(options.max) || options.max < 1)
      throw new RangeError("max is a whole number of requests, at least 1");
    if (!Number.isFinite(options.timeWindow) || options.timeWindow <= 0)
      throw new RangeError("timeWindow is a positive number of milliseconds");
    this.#max = options.max;
    this.#window = options.timeWindow;
    this.#clock = clock;
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
      if (held === undefined && this.#windows.size >= SWEEP_AT)
        this.#sweep(now);
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

  #sweep(now: number): void {
    for (const [address, held] of this.#windows)
      if (held.resetAt <= now) this.#windows.delete(address);
  }
}
