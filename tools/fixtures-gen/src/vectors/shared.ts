// Shared scaffolding for the vector table: the record type, the base chains every
// vector is built from, and the constructors each category module uses.
//
// The vector table DECLARES every expected verdict; nothing here computes one.
// That is deliberate. If the generator ran a verifier to decide what a vector
// should produce, the fixtures would encode this tool's opinion, and T7's
// independent Go verifier would be checked against that opinion instead of
// against the contract. Every verdict is asserted by the author from the spec
// text, and every one is a claim a reviewer must check by hand against the cited
// sentence (odc-contracts: hand-review is the real gate).
//
// EV-17: a vector asserts the verdict token and line number(s) ONLY — never
// reason text, never a process exit code.

import { ChainBuilder, newChain } from "../chain.js";
import { keypairFromSeed, seedOf, type Event } from "../encode.js";
import { serializeEvent } from "../serialize.js";
import { frame, type FrameOptions } from "../tamper.js";

export type Expect =
  | { verdict: "VALID" }
  | { verdict: "INVALID"; line: number }
  | { verdict: "PARTIAL"; lines: number[] };

export interface Vector {
  id: string;
  bytes: Buffer;
  /** `--head` input, when the vector must be run with one (EX-15/EX-16). */
  head?: string;
  expect: Expect;
  /** Advisory: the normative sentences this vector exercises. NOT asserted. */
  cites: string[];
  /** Advisory prose for the reviewer. NOT asserted. */
  note: string;
}

export const lines = (events: readonly Event[]): string[] =>
  events.map(serializeEvent);

/** A wrong-but-well-formed key, for the signature-failure vectors. */
export const IMPOSTOR = keypairFromSeed(seedOf(0xee));
export const P3 = keypairFromSeed(seedOf(0x03));

/** A chain built by `f`, starting from a genesis identical to hashing.md §6. */
export function chain(f: (c: ChainBuilder) => void): Event[] {
  const c = newChain();
  f(c);
  return [...c.all];
}

/** A chain with NO genesis, for the vectors that need a bad first line. */
export function headless(f: (c: ChainBuilder) => void): Event[] {
  const c = new ChainBuilder();
  f(c);
  return [...c.all];
}

// --- base chains -----------------------------------------------------------

/** Genesis alone — byte-identical to hashing.md §6. */
export const G = chain(() => {});
export const Glines = lines(G);

/** The genesis event itself, so generate.ts can pin its preimage (hashing.md §6.2). */
export const GENESIS_EVENT: Event = G[0] as Event;

/** One event of each v1 type, in dependency order. */
export const A = chain((c) => {
  c.participant(0x03);
  const issue = c.issue("Adopt the charter", 3);
  c.vote(issue.hash, 1);
});
export const Alines = lines(A);

/** The event at a 1-based seq, so the vectors below can name field values exactly. */
export function at(events: readonly Event[], seq: number): Event {
  const e = events[seq - 1];
  if (e === undefined) throw new RangeError(`no event at seq ${String(seq)}`);
  return e;
}
export const a2 = at(A, 2);
export const a3 = at(A, 3);

/** Chain A plus a well-formed event of an unregistered type (EV-18). */
export const AX = chain((c) => {
  c.participant(0x03);
  const issue = c.issue("Adopt the charter", 3);
  c.vote(issue.hash, 1);
  c.custom("x_experimental", 1, { n: 7 });
});

/** Every EX-9 escaping branch in one payload string. */
export const ESC = chain((c) =>
  c.custom("x_esc", 1, { s: 'a\tb\ncd"e\\f/g\u001fé' }),
);

// --- helpers ---------------------------------------------------------------

export function v(
  id: string,
  bytes: Buffer,
  expect: Expect,
  cites: string[],
  note: string,
  head?: string,
): Vector {
  return head === undefined
    ? { id, bytes, expect, cites, note }
    : { id, bytes, expect, cites, note, head };
}

export const ok = (
  id: string,
  events: readonly Event[],
  cites: string[],
  note: string,
): Vector => v(id, frame(lines(events)), { verdict: "VALID" }, cites, note);

export const bad = (
  id: string,
  ls: readonly string[],
  line: number,
  cites: string[],
  note: string,
  framing?: FrameOptions,
): Vector =>
  v(id, frame(ls, framing ?? {}), { verdict: "INVALID", line }, cites, note);

export const partial = (
  id: string,
  events: readonly Event[],
  affected: number[],
  cites: string[],
  note: string,
): Vector =>
  v(
    id,
    frame(lines(events)),
    { verdict: "PARTIAL", lines: affected },
    cites,
    note,
  );
