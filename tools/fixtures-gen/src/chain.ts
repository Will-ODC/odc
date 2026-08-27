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

/** The canonical shape this clock promises: a whole minute, zero milliseconds. */
const WHOLE_MINUTE = /T\d{2}:\d{2}:00\.000Z$/;

/**
 * Whole minutes after genesis. A non-integer or negative offset is REJECTED,
 * not rounded: this used to end `.replace(/\.\d{3}Z$/, ".000Z")`, a no-op for
 * every legal offset whose only reachable effect was to launder a fractional
 * one into a canonical-looking `ts` (which `hash` covers). Repair-instead-of-
 * reject, forbidden by D5 — the third instance here, after `encode.ts` (#22)
 * and `serialize.ts` (#26).
 */
export function tsAt(minutesAfterGenesis: number): string {
  if (!Number.isSafeInteger(minutesAfterGenesis) || minutesAfterGenesis < 0) {
    throw new RangeError(
      `tsAt needs a non-negative whole number of minutes, got ${String(minutesAfterGenesis)}`,
    );
  }
  return assertWholeMinute(
    new Date(
      Date.parse(GENESIS_TS) + minutesAfterGenesis * 60_000,
    ).toISOString(),
  );
}

/**
 * Asserts `tsAt`'s promised shape and returns `ts` untouched — a checkpoint,
 * never a transform. Named rather than inlined so the check is REACHABLE from a
 * test: behind `tsAt`'s whole-minute base it could never fire, and a check no
 * test can kill is not coverage (the T5a lesson). It takes the finished string
 * rather than a base + offset because `package.json` publishes `./chain` as a
 * whole-module barrel: a pure assertion cannot be misused by a future caller to
 * mint fixtures off a non-genesis clock.
 */
export function assertWholeMinute(ts: string): string {
  if (!WHOLE_MINUTE.test(ts)) {
    throw new Error(
      `${ts} is not a whole-minute instant: its seconds or milliseconds are non-zero`,
    );
  }
  return ts;
}

/** ET-3: which key signs each type. `undefined` means the type carries no sig. */
type Signer = Keypair | undefined;

/**
 * Rewrites a freshly-signed `sig` (128 lowercase hex) before it is inserted into
 * the payload and covered by `hash`. Used only by the Ed25519 canonical-encoding
 * vectors, which need a real signature over the correct preimage whose R or S is
 * then replaced with a non-canonical encoding.
 */
type SigTransform = (sigHex: string) => string;

/**
 * Produces the `sig` (128 lowercase hex) directly from the sealed content, in
 * place of a `Keypair` sign. Used only by the ET-4c subgroup vectors (082),
 * whose verification key is a mixed-order point with no `Keypair` discrete log:
 * the signature has to be crafted over the event's own signing preimage
 * (HA-15 — `content` still carries the `pubkey` this signs under, `sig` absent),
 * so the callback is handed the finished `content` rather than a private key.
 */
type RawSigner = (content: EventContent) => string;

// --- v1 payload rules the builder can check -------------------------------
//
// The builders used to accept anything, so a value that was illegal BY ACCIDENT
// was indistinguishable from the six that are illegal ON PURPOSE — and the
// accident still ships a declared verdict, so a conforming verifier "fails" the
// vector for a rule nobody meant to exercise. Legality is now checked and a
// deliberate breach must be DECLARED, reconciled for set equality in BOTH
// directions. Declaring a breach the payload does not commit is rejected just
// as firmly: that is canonical bytes under an INVALID declaration, the same
// shape `editLine`'s and `swapLines`'s no-op guards exist to stop.

/** The rule ids the builder knows how to check. */
export type BuilderRule =
  "ET-9d" | "ET-9e" | "ET-9f" | "ET-14" | "ET-14a" | "ET-18" | "ET-18a";

/** ET-14: the title ceiling, counted in the unit ET-14 names — scalar values. */
export const TITLE_MAX_SCALARS = 200;
/** ET-14a: the inclusive bounds on `choice_count`. */
export const CHOICE_COUNT_MIN = 2;
export const CHOICE_COUNT_MAX = 64;

/**
 * ET-14b: the permanent floors on the two ballot-batching parameters every
 * `issue_created` must declare (ADR-0014).
 */
export const BALLOT_BATCH_INTERVAL_MS_FLOOR = 60_000;
export const BALLOT_BATCH_MIN_FLOOR = 3;

/**
 * What an ordinary vector's `issue_created` declares. Both sit exactly ON the
 * ET-14b floors, and that is a decision, not laziness:
 *
 * - `ballot_batch_interval_ms = 60000` is the only value that leaves the
 *   existing corpus's verdicts intact. ET-23 requires every ballot's `ts` to be
 *   an exact multiple of its issue's interval in milliseconds since the epoch;
 *   `tsAt` mints only whole minutes measured from a midnight-UTC genesis, so
 *   every ballot already sits on a 60000 ms boundary and nothing has to move.
 *   Any coarser interval (3600000, say) would make minute-offset ballots
 *   non-quantized and turn VALID vectors INVALID for a rule they were never
 *   written to exercise.
 * - `ballot_batch_min = 3` is the floor because ET-24's floor is what an
 *   ordinary vector should show. Every vector here carries at most two ballots
 *   per issue, so a higher value would only widen the gap between the declared
 *   minimum and what the vector actually publishes, with nothing gained: ET-24
 *   exempts the batch holding an issue's highest-`seq` ballot at any value of
 *   this parameter (see `valid.ts` 005 for the one vector where that matters).
 *
 * The floor values also read as the least remarkable thing on the line, which is
 * what a vector about titles, `choice_count` or seq gaps needs them to be. A
 * vector that means to exercise ET-14b or ET-23–ET-25 must state its own values
 * rather than inherit these — that work is the later F2 pass, not this one.
 */
export const DEFAULT_BALLOT_BATCH_INTERVAL_MS = BALLOT_BATCH_INTERVAL_MS_FLOOR;
export const DEFAULT_BALLOT_BATCH_MIN = BALLOT_BATCH_MIN_FLOOR;

/**
 * ET-14's forbidden characters: the C0 block (U+0000-U+001F) plus U+007F. The
 * C1 block (U+0080-U+009F) is deliberately NOT included — ET-14 names C0 and
 * U+007F and stops there, so a C1 title is legal, and Go's `unicode.IsControl`
 * (true across U+007F-U+009F) over-rejects it; vector `075` catches that.
 * Scanned by code point, not regex: literal control characters in a character
 * class trip `no-control-regex`, and this keeps the unit consistent with the
 * scalar-value count above.
 */
function hasForbiddenChar(title: string): boolean {
  for (const ch of title) {
    const c = ch.codePointAt(0) as number;
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** ET-9b/ET-9e: 64 lowercase hex. The one shape every key-ish genesis value takes. */
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Which of ET-9d / ET-9e / ET-9f a `genesis` payload actually breaks.
 *
 * The ancestry keys are OPTIONAL (ES-34), so absence is never a fault here —
 * only a present value with an illegal shape, and the one presence combination
 * ET-9f bars. ET-9d is a string equality on the two declared keys, which is all
 * the rule asks for: the comparison is on the 64-character lowercase-hex
 * strings, no decoding and no curve arithmetic.
 */
function genesisViolations(
  operatorPk: string,
  registrarPk: string,
  ancestorChain: string | undefined,
  ancestorHead: string | undefined,
): BuilderRule[] {
  const out: BuilderRule[] = [];
  if (operatorPk === registrarPk) out.push("ET-9d");
  // One ET-9e for the whole payload however many ancestry values are malformed:
  // both faults sit on the same line, and conformance is the verdict token and
  // the line number only (EV-17), so a per-key breakdown would be a distinction
  // no vector can assert.
  const illegal = (value: string | undefined): boolean =>
    value !== undefined && (!HEX64.test(value) || value === GENESIS_PREV_HASH);
  if (illegal(ancestorChain) || illegal(ancestorHead)) out.push("ET-9e");
  if (ancestorHead !== undefined && ancestorChain === undefined) {
    out.push("ET-9f");
  }
  return out;
}

/** Which of ET-14 / ET-14a an `issue_created` payload actually breaks. */
function issueViolations(title: string, choiceCount: number): BuilderRule[] {
  const out: BuilderRule[] = [];
  const scalars = [...title].length; // scalar values, not UTF-16 code units
  if (scalars < 1 || scalars > TITLE_MAX_SCALARS || hasForbiddenChar(title)) {
    out.push("ET-14");
  }
  if (
    !Number.isInteger(choiceCount) ||
    choiceCount < CHOICE_COUNT_MIN ||
    choiceCount > CHOICE_COUNT_MAX
  ) {
    out.push("ET-14a");
  }
  return out;
}

/** Which of ET-18 / ET-18a a `vote_cast` payload actually breaks. */
function voteViolations(
  issues: ReadonlyMap<string, number>,
  issueId: string,
  choice: number,
): BuilderRule[] {
  const choiceCount = issues.get(issueId);
  // ET-18 first: with no referenced issue there is no choice_count, so ET-18a
  // is not merely unviolated, it is uncheckable. Reporting both would make the
  // declared set unsatisfiable for 066.
  if (choiceCount === undefined) return ["ET-18"];
  return !Number.isInteger(choice) || choice < 0 || choice >= choiceCount
    ? ["ET-18a"]
    : [];
}

const fmt = (rules: readonly BuilderRule[]): string =>
  rules.length === 0 ? "(none)" : [...rules].sort().join(", ");

/**
 * Reconciles what a payload actually violates against what the caller declared.
 * Throws unless the two sets are equal.
 */
function reconcile(
  what: string,
  actual: readonly BuilderRule[],
  declared: readonly BuilderRule[] | undefined,
): void {
  if (declared === undefined) {
    if (actual.length > 0) {
      throw new Error(
        `${what} violates ${fmt(actual)}. If deliberate, declare it: ` +
          `{ violates: [${actual.map((r) => `"${r}"`).join(", ")}] }. ` +
          `An undeclared breach is an accident, and it still ships a declared ` +
          `verdict — a verifier then fails the vector for a rule nobody meant to test.`,
      );
    }
    return;
  }
  if (actual.length === 0) {
    throw new Error(
      `${what} declares it violates ${fmt(declared)}, but the payload is LEGAL. ` +
        `A vector declaring INVALID over conforming bytes is this tool's worst ` +
        `failure: every correct verifier fails it, for the right reason, on the wrong file.`,
    );
  }
  if (fmt(actual) !== fmt(declared)) {
    throw new Error(
      `${what} declares it violates ${fmt(declared)}, but it actually violates ` +
        `${fmt(actual)}. Declare exactly what breaks — a vector tripping an extra ` +
        `rule is not testing the rule its note claims.`,
    );
  }
}

/** Per-event options: when the event is timed, and which rules it breaks on purpose. */
export interface EventOpts {
  /** Minutes after genesis. Defaults to the event's own `seq`. */
  minutes?: number;
  /** Rules this payload breaks DELIBERATELY. Must match exactly what it breaks. */
  violates?: readonly BuilderRule[];
}

export class ChainBuilder {
  private readonly events: Event[] = [];

  /** Issue `hash` → `choice_count`, so vote vectors can honour ET-18a. */
  readonly issues = new Map<string, number>();

  /**
   * The keys this chain's genesis DECLARED (ET-6). `issue()` and `vote()` sign
   * from these, not from the module constants: a chain whose genesis names one
   * operator while its `issue_created` is signed by another is well-formed and
   * self-consistently hashed but does not verify under its own `operator_pk`
   * (ET-13/ET-17/ET-9a) — a wrong-but-plausible vector, which surfaces at T7 as
   * a mysterious verifier bug rather than a fixture bug. Until `genesis()` runs
   * nothing has been declared, so the §6 keys stand in for the headless chains.
   */
  private operatorKey: Keypair = OPERATOR;
  private registrarKey: Keypair = REGISTRAR;

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
    sigTransform?: SigTransform,
    signRaw?: RawSigner,
  ): Event {
    const content: EventContent = {
      seq: this.nextSeq,
      type,
      version,
      payload,
      ts,
      prev_hash: this.prevHash,
    };
    let sealed: EventContent = content;
    if (signRaw) {
      // A crafted signature over content's own signing preimage (HA-15), for a
      // key with no Keypair (082's mixed-order A). `hash` still covers the sig.
      sealed = { ...content, payload: { ...payload, sig: signRaw(content) } };
    } else if (signer) {
      // Sign over the correct signing preimage first (HA-15), THEN mutate the
      // resulting sig if asked, THEN compute `hash` over the mutated sig — so the
      // signing preimage and the `hash` are both correct and the ONLY defect is
      // the sig bytes. The canonical-S / non-canonical-R vectors need exactly
      // this: a real signature whose S or R is replaced, with the hash relinked
      // so the vector fails for the encoding alone and not for a stale digest.
      let sig = signEvent(content, signer);
      if (sigTransform) sig = sigTransform(sig);
      sealed = { ...content, payload: { ...payload, sig } };
    }
    const event: Event = { ...sealed, hash: eventHash(sealed) };
    this.events.push(event);
    return event;
  }

  /**
   * `genesis`, self-signed by the operator key it declares (ET-6/ET-7/ET-8).
   *
   * `ancestorChain` / `ancestorHead` are the two OPTIONAL fork-ancestry keys
   * (ET-9e, ES-34). Omitted, they do not appear in the payload at all — which
   * is the ONLY way to say "no recorded ancestor", and is why they are absent
   * from the signature rather than present and empty: presence and absence
   * produce different preimages, because HA-7 leads with the key count.
   *
   * Enforces ET-9d / ET-9e / ET-9f unless `opts.violates` declares the breach,
   * the same reconcile discipline `issue()` and `vote()` use. The point is that
   * a genesis illegal BY ACCIDENT cannot ship a declared verdict: the ancestry
   * values are 64-character hex strings that no reader eyeballs, so a typo in
   * one is exactly the mistake that would otherwise pass review.
   *
   * A deliberate breach is still built the whole way — signed over the faulty
   * payload and hashed over the signature — because a vector that merely mutates
   * a value and re-derives `hash` is satisfied by a verifier that checks only
   * the genesis self-signature: it would freeze a verdict while catching nothing.
   */
  genesis(
    opts: {
      operator?: Keypair;
      registrar?: Keypair;
      contracts?: string;
      ancestorChain?: string;
      ancestorHead?: string;
      violates?: readonly BuilderRule[];
    } = {},
  ): Event {
    const operator = opts.operator ?? OPERATOR;
    const registrar = opts.registrar ?? REGISTRAR;
    reconcile(
      "genesis(...)",
      genesisViolations(
        operator.publicKeyHex,
        registrar.publicKeyHex,
        opts.ancestorChain,
        opts.ancestorHead,
      ),
      opts.violates,
    );
    this.operatorKey = operator;
    this.registrarKey = registrar;
    const payload: Payload = {
      chain_id: chainId(operator.publicKeyHex),
      contracts: opts.contracts ?? "contracts-v1",
      operator_pk: operator.publicKeyHex,
      registrar_pk: registrar.publicKeyHex,
    };
    if (opts.ancestorChain !== undefined) {
      payload.ancestor_chain = opts.ancestorChain;
    }
    if (opts.ancestorHead !== undefined) {
      payload.ancestor_head = opts.ancestorHead;
    }
    return this.seal("genesis", 1, payload, GENESIS_TS, operator);
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

  /**
   * `issue_created`, signed by the genesis-declared operator (ET-13). Records
   * choice_count for ET-18a. Enforces ET-14/ET-14a unless `opts.violates`
   * declares the breach.
   *
   * The two ET-14b batching parameters are required payload keys, so they are
   * emitted unconditionally at the defaults above; no vector in this set means
   * to exercise them, and none may omit them.
   */
  issue(title: string, choiceCount: number, opts: EventOpts = {}): Event {
    reconcile(
      `issue_created(title=${JSON.stringify(title.length > 40 ? `${title.slice(0, 40)}…` : title)}, choice_count=${String(choiceCount)})`,
      issueViolations(title, choiceCount),
      opts.violates,
    );
    const e = this.seal(
      "issue_created",
      1,
      {
        ballot_batch_interval_ms: DEFAULT_BALLOT_BATCH_INTERVAL_MS,
        ballot_batch_min: DEFAULT_BALLOT_BATCH_MIN,
        choice_count: choiceCount,
        title,
      },
      tsAt(opts.minutes ?? this.nextSeq),
      this.operatorKey,
    );
    this.issues.set(e.hash, choiceCount);
    return e;
  }

  /**
   * `vote_cast`, signed by the genesis-declared registrar (ET-17). The ballot
   * carries no voter field (ET-21). Enforces ET-18/ET-18a unless
   * `opts.violates` declares the breach.
   *
   * `ts` defaults to the ballot's own `seq` in whole minutes, which is already a
   * multiple of the default batch interval, so ET-23 holds without thought. What
   * does NOT hold without thought is ET-24: two ballots on the SAME issue at
   * different minutes are two batches of one, and only the batch holding that
   * issue's highest-`seq` ballot may be under-size. A vector with several
   * ballots on one issue must therefore pass them a shared `minutes` — one batch
   * instant — or declare a `ballot_batch_min` it can actually fill.
   */
  vote(issueId: string, choice: number, opts: EventOpts = {}): Event {
    reconcile(
      `vote_cast(issue_id=${issueId.slice(0, 8)}…, choice=${String(choice)})`,
      voteViolations(this.issues, issueId, choice),
      opts.violates,
    );
    return this.seal(
      "vote_cast",
      1,
      { choice, issue_id: issueId },
      tsAt(opts.minutes ?? this.nextSeq),
      this.registrarKey,
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
    opts: {
      signer?: Signer;
      minutes?: number;
      sigTransform?: SigTransform;
      signRaw?: RawSigner;
    } = {},
  ): Event {
    return this.seal(
      type,
      version,
      payload,
      tsAt(opts.minutes ?? this.nextSeq),
      opts.signer,
      opts.sigTransform,
      opts.signRaw,
    );
  }
}

/** A fresh chain whose genesis is byte-identical to hashing.md §6. */
export function newChain(): ChainBuilder {
  const c = new ChainBuilder();
  c.genesis();
  return c;
}
