// Builders for the four v1 event types (contracts/event-types.md), plus an
// escape hatch for the synthetic types the PARTIAL vectors need.
//
// Every value is deterministic: keys come from fixed seeds and timestamps from a
// fixed clock, so the whole fixture set is reproducible from this source alone.

import {
  chainId,
  eventHash,
  keypairFromSeed,
  seedOf,
  signEvent,
  type Event,
  type EventContent,
  type Keypair,
  type Payload,
} from "./encode.js";

/** The 64-zero genesis anchor (ES-24). */
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * The operator and registrar keys of hashing.md §6, from seeds 0x01…01 and
 * 0x02…02. Fixture 001 reproduces that worked example verbatim, so these seeds
 * and the genesis `ts` below are load-bearing — changing them changes the one
 * golden value in the set that was derived independently of this generator.
 */
export const OPERATOR = keypairFromSeed(seedOf(0x01));
export const REGISTRAR = keypairFromSeed(seedOf(0x02));

/** The genesis timestamp of hashing.md §6. */
export const GENESIS_TS = "2026-07-21T00:00:00.000Z";

/** Later events advance the clock by whole minutes from genesis, deterministically. */
export function tsAt(minutesAfterGenesis: number): string {
  const base = Date.parse(GENESIS_TS);
  return new Date(base + minutesAfterGenesis * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, ".000Z");
}

/** ET-3: which key signs each type. `undefined` means the type carries no sig. */
type Signer = Keypair | undefined;

export class ChainBuilder {
  private readonly events: Event[] = [];

  /** Issue `hash` → `choice_count`, so vote vectors can honour ET-18a. */
  readonly issues = new Map<string, number>();

  get all(): readonly Event[] {
    return this.events;
  }

  private get nextSeq(): number {
    return this.events.length + 1;
  }

  private get prevHash(): string {
    const last = this.events[this.events.length - 1];
    return last ? last.hash : GENESIS_PREV_HASH;
  }

  /**
   * Seals an event: signs it if the type is signed (the sig covers the payload
   * without `sig`, HA-15), then computes `hash` over the payload including it
   * (ES-32 — sign first, then the signature becomes part of what `hash` covers).
   */
  private seal(
    type: string,
    version: number,
    payload: Payload,
    ts: string,
    signer: Signer,
  ): Event {
    const content: EventContent = {
      seq: this.nextSeq,
      type,
      version,
      payload,
      ts,
      prev_hash: this.prevHash,
    };
    const sealed: EventContent = signer
      ? { ...content, payload: { ...payload, sig: signEvent(content, signer) } }
      : content;
    const event: Event = { ...sealed, hash: eventHash(sealed) };
    this.events.push(event);
    return event;
  }

  /** `genesis`, self-signed by the operator key it declares (ET-6/ET-7/ET-8). */
  genesis(
    opts: { operator?: Keypair; registrar?: Keypair; contracts?: string } = {},
  ): Event {
    const operator = opts.operator ?? OPERATOR;
    const registrar = opts.registrar ?? REGISTRAR;
    return this.seal(
      "genesis",
      1,
      {
        chain_id: chainId(operator.publicKeyHex),
        contracts: opts.contracts ?? "contracts-v1",
        operator_pk: operator.publicKeyHex,
        registrar_pk: registrar.publicKeyHex,
      },
      GENESIS_TS,
      operator,
    );
  }

  /** `participant_registered`, self-signed by its own `pubkey` (ET-10). */
  participant(seedOctet: number, minutes = this.nextSeq): Event {
    const kp = keypairFromSeed(seedOf(seedOctet));
    return this.seal(
      "participant_registered",
      1,
      { pubkey: kp.publicKeyHex },
      tsAt(minutes),
      kp,
    );
  }

  /** `issue_created`, operator-signed (ET-13). Records choice_count for ET-18a. */
  issue(title: string, choiceCount: number, minutes = this.nextSeq): Event {
    const e = this.seal(
      "issue_created",
      1,
      { choice_count: choiceCount, title },
      tsAt(minutes),
      OPERATOR,
    );
    this.issues.set(e.hash, choiceCount);
    return e;
  }

  /** `vote_cast`, registrar-signed (ET-17). The ballot carries no voter field (ET-21). */
  vote(issueId: string, choice: number, minutes = this.nextSeq): Event {
    return this.seal(
      "vote_cast",
      1,
      { choice, issue_id: issueId },
      tsAt(minutes),
      REGISTRAR,
    );
  }

  /**
   * An event of an arbitrary `(type, version)` — used only for the PARTIAL
   * vectors, which need a well-formed event outside the v1 registry. Stage A
   * still applies to it, so the hash is computed the same generic way (HA-7).
   */
  custom(
    type: string,
    version: number,
    payload: Payload,
    opts: { signer?: Signer; minutes?: number } = {},
  ): Event {
    return this.seal(
      type,
      version,
      payload,
      tsAt(opts.minutes ?? this.nextSeq),
      opts.signer,
    );
  }
}

/** A fresh chain whose genesis is byte-identical to hashing.md §6. */
export function newChain(): ChainBuilder {
  const c = new ChainBuilder();
  c.genesis();
  return c;
}
