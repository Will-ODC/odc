// Collections with no entry cap, for state that grows with the number of lines.
//
// evolution.md EV-24 forbids a fixed limit on the number of lines. V8's
// built-ins have fixed caps: a Map or Set holds at most 2^23 = 8,388,608
// entries ("Map maximum size exceeded"), and an array grown by `push` stops at
// 2^26 = 67,108,864 elements ("Invalid array length"). Any per-line state kept
// in one of them is therefore a line-count limit. These wrappers split the
// entries across several built-ins, each kept under its cap, so only memory
// (EV-24's host-resource exemption) bounds them.
//
// Behaviour is the built-ins' for every operation used here. Iteration order
// is insertion order, as for a Map/Set/array: a new key always goes to the
// newest shard, and an existing key is updated where it lives.

/** Entries per Map/Set shard: half of V8's 2^23 cap. */
export const SHARD_CAP = 1 << 22;

/** Elements per list chunk: far under V8's array cap; a power of two. */
export const CHUNK_SHIFT = 20;

/** A Map with no entry cap. `shardCap` is a parameter for tests only. */
export class ShardedMap<K, V> {
  private readonly shards: Map<K, V>[] = [new Map()];

  constructor(private readonly shardCap: number = SHARD_CAP) {}

  private shardOf(key: K): Map<K, V> | undefined {
    // Newest first: recently added keys are the likeliest lookups.
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i] as Map<K, V>;
      if (s.has(key)) return s;
    }
    return undefined;
  }

  get(key: K): V | undefined {
    return this.shardOf(key)?.get(key);
  }

  has(key: K): boolean {
    return this.shardOf(key) !== undefined;
  }

  set(key: K, value: V): this {
    const existing = this.shardOf(key);
    if (existing !== undefined) {
      existing.set(key, value);
      return this;
    }
    let last = this.shards[this.shards.length - 1] as Map<K, V>;
    if (last.size >= this.shardCap) {
      last = new Map();
      this.shards.push(last);
    }
    last.set(key, value);
    return this;
  }

  get size(): number {
    let n = 0;
    for (const s of this.shards) n += s.size;
    return n;
  }

  /** How many built-in Maps hold the entries (for tests). */
  get shardCount(): number {
    return this.shards.length;
  }

  *values(): IterableIterator<V> {
    for (const s of this.shards) yield* s.values();
  }
}

/** A Set with no entry cap. `shardCap` is a parameter for tests only. */
export class ShardedSet<T> {
  private readonly map: ShardedMap<T, true>;

  constructor(shardCap: number = SHARD_CAP) {
    this.map = new ShardedMap(shardCap);
  }

  has(value: T): boolean {
    return this.map.has(value);
  }

  add(value: T): this {
    if (!this.map.has(value)) this.map.set(value, true);
    return this;
  }

  get size(): number {
    return this.map.size;
  }

  get shardCount(): number {
    return this.map.shardCount;
  }
}

/**
 * An append-only list of numbers with no length cap, stored in fixed-size
 * chunks. It offers what the verifier and its report need — `push`, `length`,
 * `at`, `slice`, iteration, and `join` (for tests and short lists; a joined
 * string is itself capped by V8, which is why the CLI renders by `slice`).
 * `chunkShift` is a parameter for tests only.
 */
export class ChunkedList {
  private readonly chunks: number[][] = [];
  private n = 0;
  private readonly chunkSize: number;

  constructor(chunkShift: number = CHUNK_SHIFT) {
    this.chunkSize = 2 ** chunkShift;
  }

  static of(values: readonly number[]): ChunkedList {
    const l = new ChunkedList();
    for (const v of values) l.push(v);
    return l;
  }

  get length(): number {
    return this.n;
  }

  /** How many arrays hold the elements (for tests). */
  get chunkCount(): number {
    return this.chunks.length;
  }

  push(v: number): void {
    if (this.n === this.chunks.length * this.chunkSize) this.chunks.push([]);
    (this.chunks[this.chunks.length - 1] as number[]).push(v);
    this.n++;
  }

  /** Element `i` (0-based), or undefined out of range. */
  at(i: number): number | undefined {
    if (i < 0 || i >= this.n) return undefined;
    const c = Math.floor(i / this.chunkSize);
    return (this.chunks[c] as number[])[i - c * this.chunkSize];
  }

  /** Elements [start, end) as a plain array; for bounded ranges. */
  slice(start: number, end: number): number[] {
    const out: number[] = [];
    const stop = Math.min(end, this.n);
    for (let i = Math.max(0, start); i < stop; i++)
      out.push(this.at(i) as number);
    return out;
  }

  join(sep: string): string {
    return this.slice(0, this.n).join(sep);
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (const c of this.chunks) yield* c;
  }
}
