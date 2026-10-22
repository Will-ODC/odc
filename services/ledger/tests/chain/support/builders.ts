// Deterministic test keys and event builders. TEST KEYS ONLY: every seed is a
// repeated octet, so anyone can forge signatures under them.
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  ZERO_HASH,
  epochMsToTs,
  serializeLine,
  tsToEpochMs,
  type Event,
  type PayloadValue,
} from "../../../src/chain/canonical.js";
import {
  computeHash,
  sha256Hex,
  signingPreimage,
} from "../../../src/chain/hashing.js";

export interface TestKey {
  readonly seed: Uint8Array;
  readonly pk: string;
}

/** The Ed25519 keypair from a 32-octet seed of one repeated byte. */
export function testKey(octet: number): TestKey {
  const seed = new Uint8Array(32).fill(octet);
  return { seed, pk: Buffer.from(ed25519.getPublicKey(seed)).toString("hex") };
}

/** Deterministic RFC 8032 Ed25519 signature, as 128 lowercase hex. */
export function sign(seed: Uint8Array, message: Uint8Array): string {
  return Buffer.from(ed25519.sign(message, seed)).toString("hex");
}

export const OPERATOR = testKey(0x01); // hashing.md §6
export const REGISTRAR = testKey(0x02); // hashing.md §6
export const GENESIS_TS = "2026-07-21T00:00:00.000Z";

/** GENESIS_TS plus `n` minutes. */
export function minute(n: number): string {
  return epochMsToTs(tsToEpochMs(GENESIS_TS) + n * 60000);
}

export type RawPayload = Record<string, PayloadValue>;

export interface MakeOptions {
  readonly version?: number;
  readonly ts?: string;
  /** Who signs; `null` leaves the payload unsigned. */
  readonly signer?: TestKey | null;
  /** Replace the computed `sig` after signing (tamper cases). */
  readonly sig?: string;
  readonly seq?: number;
  readonly prevHash?: string;
}

/** Signs over SIGN_PRE (HA-15), inserts `sig`, then hashes (ES-32). */
export function finish(
  base: Omit<Event, "hash" | "payload"> & { payload: RawPayload },
  signer: TestKey | null,
  sigOverride?: string,
): Event {
  const payload: RawPayload = { ...base.payload };
  if (signer !== null) {
    payload.sig = sign(signer.seed, signingPreimage({ ...base, payload }));
  }
  if (sigOverride !== undefined) payload.sig = sigOverride;
  const unhashed = { ...base, payload };
  return { ...unhashed, hash: computeHash(unhashed) };
}

export function genesisPayload(over: RawPayload = {}): RawPayload {
  return {
    chain_id: sha256Hex(Buffer.from(OPERATOR.pk, "hex")),
    contracts: "contracts-v1",
    operator_pk: OPERATOR.pk,
    registrar_pk: REGISTRAR.pk,
    ...over,
  };
}

export function issuePayload(over: RawPayload = {}): RawPayload {
  return {
    title: "Adopt the charter",
    choice_count: 3,
    ballot_batch_interval_ms: 60000,
    ballot_batch_min: 3,
    ...over,
  };
}

/** A chain under construction: `make` builds the next event, `add` keeps it. */
export class TestChain {
  readonly events: Event[] = [];
  private clock = 0;

  get head(): string {
    return this.events.at(-1)?.hash ?? ZERO_HASH;
  }

  make(type: string, payload: RawPayload, opts: MakeOptions = {}): Event {
    const signer = opts.signer === undefined ? null : opts.signer;
    return finish(
      {
        seq: opts.seq ?? this.events.length + 1,
        type,
        version: opts.version ?? 1,
        payload,
        ts: opts.ts ?? minute(this.clock),
        prev_hash: opts.prevHash ?? this.head,
      },
      signer,
      opts.sig,
    );
  }

  add(event: Event): Event {
    this.events.push(event);
    this.clock++;
    return event;
  }

  genesis(over: RawPayload = {}, opts: MakeOptions = {}): Event {
    return this.make("genesis", genesisPayload(over), {
      signer: OPERATOR,
      ts: GENESIS_TS,
      ...opts,
    });
  }

  participant(key: TestKey, opts: MakeOptions = {}): Event {
    return this.make(
      "participant_registered",
      { pubkey: key.pk },
      { signer: key, ...opts },
    );
  }

  issue(over: RawPayload = {}, opts: MakeOptions = {}): Event {
    return this.make("issue_created", issuePayload(over), {
      signer: OPERATOR,
      ...opts,
    });
  }

  vote(
    issueId: string,
    choice: number,
    ts: string,
    opts: MakeOptions = {},
  ): Event {
    return this.make(
      "vote_cast",
      { issue_id: issueId, choice },
      { signer: REGISTRAR, ts, ...opts },
    );
  }

  lines(): Uint8Array[] {
    return this.events.map(serializeLine);
  }

  exportBytes(): Buffer {
    return Buffer.concat(this.lines().flatMap((l) => [l, Buffer.from("\n")]));
  }
}
