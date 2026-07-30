// A deterministic PRNG, so a rehearsal chain is reproducible from its seed alone.
//
// Determinism is the whole point: T8 runs `build → export → Go verifier` and, on
// any disagreement, has to hand the exact failing chain to a fresh context. A
// chain that cannot be rebuilt byte for byte from a printed seed turns every
// cross-language mismatch into an unreproducible bug report.
//
// This is NOT a cryptographic generator and must never be used to produce keys
// or anything else a participant's privacy depends on. It picks how many issues
// a throwaway chain has. `node:crypto` produces every key material value here
// (via `fixtures-gen`'s `keypairFromSeed`, which takes a fixed seed).

/** 2^32, as the modulus every draw is reduced under. */
const TWO_32 = 0x1_0000_0000;

/**
 * SplitMix32. Chosen because it is a pure integer function of its state — the
 * whole generator is eight lines of `Math.imul` and shifts, with no floating
 * point anywhere, so it produces identical draws on every platform and is
 * re-implementable in Go from this source if T8 ever needs the same sequence on
 * both sides.
 */
export class Rng {
  private state: number;

  /**
   * `seed` must fit in a signed or unsigned 32-bit range, i.e. `[-2^31, 2^32)`.
   * A negative seed is reinterpreted as its unsigned 32-bit twin (`-1` and
   * `0xffffffff` agree) — that conventional signed/unsigned reading is kept
   * deliberately, not an oversight. What the range check rejects is a seed
   * that would wrap *unrecognizably*: `2**32 + 7` silently becoming `7`, or
   * `2**53` becoming `0`. The seed is the reproducibility mechanism a T8 bug
   * report is rebuilt from, so a printed seed must map to the state its own
   * digits denote — even though, within the accepted range, that mapping is
   * intentionally 2-to-1.
   */
  constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new TypeError(`seed must be an integer, got ${String(seed)}`);
    }
    if (seed < -0x8000_0000 || seed >= TWO_32) {
      throw new RangeError(
        `seed must be within [-2^31, 2^32), got ${String(seed)}`,
      );
    }
    this.state = seed >>> 0;
  }

  /** The next draw, uniform over 0 … 2^32-1. */
  nextUint32(): number {
    this.state = (this.state + 0x9e37_79b9) | 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0_aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a_2d97);
    return (z ^ (z >>> 15)) >>> 0;
  }

  /**
   * A uniform integer in `[0, maxExclusive)`.
   *
   * Rejection-sampled rather than `next % max`. Plain modulo is biased whenever
   * `max` does not divide 2^32, which is every value this builder actually uses
   * (`choice_count` of 2…64, participant counts, title lengths). The bias is
   * small and would be invisible in output — and invisible skew in the generator
   * is exactly what makes a "randomized" chain quietly stop covering the range
   * it claims to. Discarding the short final block costs one extra draw with
   * probability under 2^-26 at these magnitudes.
   */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError(
        `maxExclusive must be a positive integer, got ${String(maxExclusive)}`,
      );
    }
    if (maxExclusive > TWO_32) {
      // TWO_32 % maxExclusive === TWO_32 here, so limit would be 0 and the
      // rejection loop below would never terminate — every draw is < TWO_32
      // and thus always >= limit.
      throw new RangeError(
        `maxExclusive must be <= 2^32, got ${String(maxExclusive)}`,
      );
    }
    const limit = TWO_32 - (TWO_32 % maxExclusive);
    let draw = this.nextUint32();
    while (draw >= limit) draw = this.nextUint32();
    return draw % maxExclusive;
  }

  /** A uniform integer in `[min, max]`, both inclusive. */
  intBetween(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(
        `need integers with min <= max, got ${String(min)}…${String(max)}`,
      );
    }
    return min + this.int(max - min + 1);
  }

  /** A uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0)
      throw new RangeError("cannot pick from an empty array");
    return items[this.int(items.length)] as T;
  }
}
