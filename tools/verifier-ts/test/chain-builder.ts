// Shared synthetic-chain builder for the ballot suites (ballot-batching,
// opaque-ballots, opaque-bruteforce). Not a suite.
//
// Every chain it builds is SYNTHETIC AND SELF-CONSISTENT: hashed and signed by
// `genesis-builder.ts`'s `signedEventLine`, i.e. by the functions under test.
// It is a harness, not an oracle (see genesis-builder.ts); a fixture for the
// rules it reaches supersedes any verdict asserted over it.

import { createHash } from "node:crypto";
import { verifyExport } from "../src/verify.js";
import {
  ZERO64,
  distinctKeypair,
  keypair,
  signedEventLine,
  tokenAndLine,
  type KeyPair,
} from "./genesis-builder.js";

// Batch instants used throughout: whole minutes of one day, so each is a
// multiple of the 60000 ms floor interval.
export const T0 = "2026-07-21T00:00:00.000Z";
export const T1 = "2026-07-21T00:01:00.000Z";
export const T2 = "2026-07-21T00:02:00.000Z";
export const T3 = "2026-07-21T00:03:00.000Z";
export const T4 = "2026-07-21T00:04:00.000Z";

/** EV-19's reserved version: the one value a test may use as "unregistered". */
export const UNREG = 1000000;

/**
 * Builds a v1 chain line by line. `lines.length` after an append is that
 * event's 1-based LINE number, which is what every assertion names.
 */
export class Chain {
  readonly op: KeyPair = keypair();
  readonly reg: KeyPair = distinctKeypair(this.op.hex);
  private readonly lines: string[] = [];
  private prev = ZERO64;

  constructor() {
    this.push("genesis", {
      strings: {
        chain_id: createHash("sha256").update(this.op.rawPub).digest("hex"),
        contracts: "contracts-v1",
        operator_pk: this.op.hex,
        registrar_pk: this.reg.hex,
      },
      ints: {},
      ts: T0,
      signer: this.op,
    });
  }

  private push(
    type: string,
    e: {
      strings: Record<string, string>;
      ints: Record<string, number>;
      ts: string;
      signer: KeyPair | null;
      version?: number;
    },
  ): { line: number; hash: string } {
    const built = signedEventLine({
      seq: this.lines.length + 1,
      type,
      prevHash: this.prev,
      ...e,
    });
    this.lines.push(built.line);
    this.prev = built.hash;
    return { line: this.lines.length, hash: built.hash };
  }

  /** Line number of the most recently appended event. */
  get lastLine(): number {
    return this.lines.length;
  }

  /**
   * Append an issue_created; returns its issue_id (its hash, ID-7). A
   * `version` other than 1 is unregistered: Stage B never runs on it, so it
   * carries the placeholder signature.
   */
  issue(
    opts: { intervalMs?: number; min?: number; version?: number } = {},
  ): string {
    const version = opts.version ?? 1;
    return this.push("issue_created", {
      version,
      strings: { title: "Issue" },
      ints: {
        ballot_batch_interval_ms: opts.intervalMs ?? 60000,
        ballot_batch_min: opts.min ?? 3,
        choice_count: 2,
      },
      ts: T0,
      signer: version === 1 ? this.op : null,
    }).hash;
  }

  /** Append one registrar-signed ballot; returns its line number. */
  vote(issueId: string, ts: string, version = 1, signer?: KeyPair): number {
    return this.push("vote_cast", {
      version,
      strings: { issue_id: issueId },
      ints: { choice: 0 },
      ts,
      // An unregistered version never reaches Stage B, so it needs no signature.
      signer: signer ?? (version === 1 ? this.reg : null),
    }).line;
  }

  /**
   * Append a `vote_cast` with an arbitrary payload (strings quoted, `ints`
   * written as `String(n)`, so `1.5` becomes a float token). Returns its line.
   */
  voteRaw(e: {
    version: number;
    strings: Record<string, string>;
    ints: Record<string, number>;
    ts: string;
  }): number {
    return this.push("vote_cast", {
      ...e,
      signer: e.version === 1 ? this.reg : null,
    }).line;
  }

  /**
   * Append a well-formed event at an unregistered `(type, version)` that is
   * NOT a `vote_cast` (e.g. an `x_` type, or `participant_registered` at
   * EV-19's reserved version). Stage B never runs on it, so it is unsigned.
   * Its payload deliberately names `issueId`, as a ballot's would. Returns
   * its line.
   */
  unregistered(
    type: string,
    version: number,
    ts: string,
    issueId: string,
  ): number {
    return this.push(type, {
      version,
      strings: { issue_id: issueId },
      ints: { choice: 0 },
      ts,
      signer: null,
    }).line;
  }

  /** `n` ballots of one issue at one instant; returns their line numbers. */
  votes(issueId: string, ts: string, n: number, version = 1): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.vote(issueId, ts, version));
    return out;
  }

  /** A non-ballot line between ballots (a self-signed participant). */
  participant(): number {
    const p = keypair();
    return this.push("participant_registered", {
      strings: { pubkey: p.hex },
      ints: {},
      ts: T0,
      signer: p,
    }).line;
  }

  /** A line that fails Stage A: its stored hash is wrong (HA-14). */
  corruptLine(): number {
    const { line } = this.push("participant_registered", {
      strings: { pubkey: keypair().hex },
      ints: {},
      ts: T0,
      signer: null,
    });
    // Rewrite the stored hash; prev stays the real one, so only this line fails.
    const idx = line - 1;
    this.lines[idx] = (this.lines[idx] as string).replace(
      /"hash":"[0-9a-f]{64}"/,
      `"hash":"${"e".repeat(64)}"`,
    );
    return line;
  }

  /** The export cut after its first `n` lines (end-truncation, EX-16). */
  prefixBytes(n: number): Buffer {
    return Buffer.from(
      this.lines
        .slice(0, n)
        .map((l) => l + "\n")
        .join(""),
      "utf8",
    );
  }

  head(): string {
    return this.prev;
  }

  bytes(): Buffer {
    return Buffer.from(this.lines.map((l) => l + "\n").join(""), "utf8");
  }

  verdict(head?: string): string {
    return tokenAndLine(verifyExport(this.bytes(), head));
  }
}
