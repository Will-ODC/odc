// Seeded random chains for the property tests (here and tests/verifiers).
import assert from "node:assert/strict";
import type { Event } from "../../src/chain/index.js";
import { TestChain } from "../chain/support/builders.js";

/** mulberry32: small, seedable, good enough to pick test inputs. */
export function rng(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

// Multi-byte scalars, JSON escapes, and characters some encoders escape.
const ALPHABET = [
  ..."aZ 09-_.,",
  '"',
  "\\",
  "/",
  "é",
  "ß",
  "日本",
  "🌍",
  " ",
  " ",
  "<>&",
];

export function randomTitle(r: (n: number) => number): string {
  let s = "";
  const len = 1 + r(40);
  for (let i = 0; i < len; i++) s += ALPHABET[r(ALPHABET.length)];
  return [...s].slice(0, 200).join("");
}

/** Builds and appends, through POST /appends, a genesis and `n` issues. */
export async function randomChain(
  submit: (e: Event) => Promise<Response>,
  r: (n: number) => number,
  n: number,
): Promise<TestChain> {
  const chain = new TestChain();
  chain.add(chain.genesis());
  for (let i = 0; i < n; i++) {
    chain.add(
      chain.issue({
        title: randomTitle(r),
        choice_count: 2 + r(63),
        ballot_batch_interval_ms: 60000 * (1 + r(60)) + r(2) * r(1000),
        ballot_batch_min: 3 + r(50),
      }),
    );
  }
  for (const e of chain.events) {
    const res = await submit(e);
    assert.equal(res.status, 201, await res.clone().text());
  }
  return chain;
}

/** XOR one byte with a nonzero mask; returns the 1-based line it falls in. */
export function flipByte(
  bytes: Buffer,
  r: (n: number) => number,
): { tampered: Buffer; line: number } {
  const tampered = Buffer.from(bytes);
  const pos = r(bytes.length);
  tampered[pos] = (tampered[pos] as number) ^ (1 + r(255));
  let line = 1;
  for (let i = 0; i < pos; i++) if (bytes[i] === 0x0a) line++;
  return { tampered, line };
}
