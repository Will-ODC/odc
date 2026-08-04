// T6's acceptance is that the builder ROUND-TRIPS: build → self-verify → the
// chain property test passes across multiple seeds against the builder's own
// export. Two things are asserted here, and the second is the load-bearing one.
//
// (1) A clean chain verifies. On its own that is satisfied by a function that
//     returns `{ok:true}` unconditionally.
// (2) Every case of T6c's tamper matrix is DETECTED, at the line T6c declares.
//     That is what makes each individual check killable — and it is checked
//     over a seed sweep × two shapes rather than pinned seeds, per T6b's
//     stream-drift lesson (a pinned seed stops testing the moment an upstream
//     draw count changes, silently).
//
// Each check also gets a targeted negative below, because the matrix does not
// reach all of them: nothing in it produces a bad signature with a correct
// hash, an unknown type, or a non-genesis line 1.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ChainBuilder,
  GENESIS_PREV_HASH,
  OPERATOR,
  REGISTRAR,
} from "@odc/fixtures-gen/chain";
import type { Event, EventContent } from "@odc/fixtures-gen/encode";
import { eventHash, keypairFromSeed, seedOf } from "@odc/fixtures-gen/encode";
import { head, serializeExport } from "@odc/fixtures-gen/serialize";

import { buildChain, type ChainShape } from "../src/build.js";
import { applyTamper, TAMPER_CASES } from "../src/tamper.js";
import { selfVerify } from "../src/verify.js";

const SHAPES: ChainShape[] = [
  { participants: 3, issues: 2, votes: 4 },
  { participants: 5, issues: 3, votes: 9 },
];

/** Seeds swept structurally. No seed is load-bearing; widen freely — but the
 * per-case totals below are LITERALS, so widening means updating them. */
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 3);

/** An export built directly from events, for the hand-made negatives below. */
const exportOf = (
  events: readonly Event[],
): { ndjson: Buffer; head: string } => ({
  ndjson: serializeExport(events),
  head: head(events),
});

/** Recomputes each event's `hash` after a field was edited, so the negative
 * below fails for the rule it names and not for HA-13 as well. */
const rehash = (events: readonly Event[]): Event[] =>
  events.map((e) => {
    const content: EventContent = {
      seq: e.seq,
      type: e.type,
      version: e.version,
      payload: e.payload,
      ts: e.ts,
      prev_hash: e.prev_hash,
    };
    return { ...content, hash: eventHash(content) };
  });

function failureOf(target: { ndjson: Buffer; head: string }): {
  line: number;
  rule: string;
} {
  const r = selfVerify(target);
  assert.equal(r.ok, false, "expected self-verify to fail");
  assert.equal(r.ok, false);
  return { line: r.line, rule: r.rule };
}

describe("selfVerify — a clean chain", () => {
  it("verifies every seed on every shape", () => {
    for (const shape of SHAPES) {
      for (const seed of SEEDS) {
        const chain = buildChain(seed, shape);
        const r = selfVerify(chain);
        assert.equal(
          r.ok,
          true,
          `seed ${String(seed)} failed: ${JSON.stringify(r)}`,
        );
      }
    }
  });

  it("verifies the default shape, which is the one the CLI builds", () => {
    assert.equal(selfVerify(buildChain(1)).ok, true);
  });
});

describe("selfVerify — the tamper matrix", () => {
  for (const kase of TAMPER_CASES) {
    it(`detects ${kase} at the line T6c declares`, () => {
      let checked = 0;
      for (const shape of SHAPES) {
        for (const seed of SEEDS) {
          const chain = buildChain(seed, shape);
          for (const tamperSeed of [seed, seed + 1, seed * 3 + 5]) {
            const t = applyTamper(chain, kase, tamperSeed);
            const r = selfVerify(t);
            assert.equal(
              r.ok,
              false,
              `${kase} undetected (chain ${String(seed)}, tamper ${String(tamperSeed)})`,
            );
            assert.equal(
              r.ok === false ? r.line : -1,
              t.line,
              `${kase} attributed to the wrong line (chain ${String(seed)}, tamper ${String(tamperSeed)})`,
            );
            checked += 1;
          }
        }
      }
      // The LITERAL, not `SHAPES.length * SEEDS.length * 3` — that expression
      // is derived from the arrays being swept, so shrinking SEEDS to 2 kept
      // the suite green while the sweep did 96 exports instead of 1,920.
      assert.equal(checked, 240);
    });
  }
});

describe("selfVerify — each check fails on its own defect", () => {
  it("rejects a line that is not the canonical serialization", () => {
    const chain = buildChain(5, SHAPES[0] as ChainShape);
    const text = chain.ndjson.toString("utf8");
    // Two spaces inside the object: parses to the same event, wrong bytes.
    const broken = text.replace('{"seq":2,', '{"seq":2, ');
    assert.notEqual(broken, text);
    const f = failureOf({
      ndjson: Buffer.from(broken, "utf8"),
      head: chain.head,
    });
    assert.deepEqual(f, {
      line: 2,
      rule: "EX-7",
    });
  });

  it("rejects a seq that does not increment by one", () => {
    const c = new ChainBuilder();
    c.genesis({ operator: OPERATOR, registrar: REGISTRAR });
    c.participant(0x03);
    const events = c.all.map((e, i) =>
      i === 1 ? ({ ...e, seq: 3 } as Event) : e,
    );
    // `seq` is in the preimage, so re-hash to isolate ES-7 from HA-13.
    assert.equal(failureOf(exportOf(rehash(events))).rule, "ES-7");
  });

  it("rejects a prev_hash that does not name the previous line", () => {
    const c = new ChainBuilder();
    c.genesis();
    c.participant(0x03);
    const events = rehash(
      c.all.map((e, i) =>
        i === 1 ? ({ ...e, prev_hash: GENESIS_PREV_HASH } as Event) : e,
      ),
    );
    assert.deepEqual(failureOf(exportOf(events)), {
      line: 2,
      rule: "ES-25",
    });
  });

  it("rejects a hash that does not match its preimage", () => {
    const c = new ChainBuilder();
    c.genesis();
    const [g] = c.all;
    const bad = { ...(g as Event), hash: `${"0".repeat(63)}1` };
    assert.deepEqual(failureOf(exportOf([bad])), {
      line: 1,
      rule: "HA-13",
    });
  });

  it("rejects a signature by the wrong key, with the hash correct", () => {
    // The matrix never produces this: every byte mutation breaks the hash
    // first, so HA-16 would otherwise be unreachable and untested.
    const c = new ChainBuilder();
    c.genesis();
    const kp = keypairFromSeed(seedOf(0x03));
    const wrong = keypairFromSeed(seedOf(0x04));
    c.custom(
      "participant_registered",
      1,
      { pubkey: kp.publicKeyHex },
      {
        signer: wrong,
      },
    );
    assert.deepEqual(failureOf(exportOf(c.all)), {
      line: 2,
      rule: "HA-16",
    });
  });

  it("rejects a head that is not the last line's hash", () => {
    const chain = buildChain(9, SHAPES[0] as ChainShape);
    const lines = chain.ndjson.toString("utf8").trimEnd().split("\n").length;
    assert.deepEqual(
      failureOf({ ndjson: chain.ndjson, head: `${"0".repeat(63)}1` }),
      { line: lines, rule: "EX-15" },
    );
  });

  it("rejects a type it cannot name a signing key for", () => {
    const c = new ChainBuilder();
    c.genesis();
    c.custom("x_unregistered", 1, { n: 1 }, { signer: OPERATOR });
    assert.equal(failureOf(exportOf(c.all)).rule, "ET-1");
  });

  it("rejects an export whose first line is not genesis", () => {
    const c = new ChainBuilder();
    c.participant(0x03);
    assert.deepEqual(failureOf(exportOf(c.all)), { line: 1, rule: "ES-33" });
  });

  it("rejects a line that is not a seven-field envelope", () => {
    const ndjson = Buffer.from('{"seq":1}\n', "utf8");
    assert.deepEqual(failureOf({ ndjson, head: "0".repeat(64) }), {
      line: 1,
      rule: "ES-1",
    });
  });
});

describe("selfVerify — a malformed line is named, never thrown", () => {
  // Every case below once CRASHED: the value passed a `typeof` shape test,
  // reached serializeEvent/eventHash/publicKeyFromHex, and threw. A tool whose
  // job is to name the bad line must not die on one.
  const shape = { participants: 3, issues: 2, votes: 4 };
  const edited = (f: (l: string) => string) => {
    const chain = buildChain(11, shape);
    const lines = chain.ndjson.toString("utf8").trimEnd().split("\n");
    lines[1] = f(lines[1] as string);
    return {
      ndjson: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
      head: chain.head,
    };
  };

  for (const [name, f] of [
    [
      "a fractional seq (ES-5)",
      (l: string) => l.replace('"seq":2', '"seq":2.5'),
    ],
    [
      "a negative version (ES-5)",
      (l: string) => l.replace('"version":1', '"version":-1'),
    ],
    [
      "a boolean payload value (ES-16)",
      (l: string) => l.replace('"payload":{', '"payload":{"x":true,'),
    ],
    [
      "a null payload value (ES-16)",
      (l: string) => l.replace('"payload":{', '"payload":{"x":null,'),
    ],
    [
      "a nested payload object (ES-17)",
      (l: string) => l.replace('"payload":{', '"payload":{"x":{"b":1},'),
    ],
    [
      "an array payload value (ES-16)",
      (l: string) => l.replace('"payload":{', '"payload":{"x":[1],'),
    ],
    [
      // ES-5's UPPER bound. Without it the value reaches U64/jsonInteger and
      // the backstop reports `ES-5` instead of `ES-1` — same line, different
      // path. That is why this asserts the rule: the bound was deletable with
      // all 176 tests green until this case existed.
      "an integer past 2^53-1 (ES-5)",
      (l: string) => l.replace('"seq":2', '"seq":9007199254740992'),
    ],
    [
      "a payload that is itself an array (ES-17)",
      (l: string) => l.replace(/"payload":\{[^}]*\}/, '"payload":[]'),
    ],
  ] as [string, (l: string) => string][]) {
    it(`names the line for ${name}`, () => {
      // The RULE matters as much as the line. `ES-1` proves `parseLine`
      // rejected the value. Delete any of those guards and the line is STILL
      // 2 — the backstop catches the encoder's throw — but the rule becomes
      // the thrower's (`ES-5`, `ES-16`). Asserting the line alone let every
      // one of these guards be removed with the suite still green.
      assert.deepEqual(failureOf(edited(f)), { line: 2, rule: "ES-1" });
    });
  }

  it("names the line when an encoder throws past the parser", () => {
    // An uppercase pubkey is legal JSON and legal ES-16, so it reaches
    // publicKeyFromHex, which throws ID-3. Re-hashed, so HA-13 passes first
    // and the ID-3 path is what actually runs.
    const c = new ChainBuilder();
    c.genesis();
    c.participant(0x03);
    const events = rehash(
      c.all.map((e, i) =>
        i === 1
          ? ({
              ...e,
              payload: {
                ...e.payload,
                pubkey: (e.payload["pubkey"] as string).toUpperCase(),
              },
            } as Event)
          : e,
      ),
    );
    // The rule is lifted from the thrower's own message, not invented here.
    assert.deepEqual(failureOf(exportOf(events)), { line: 2, rule: "ID-3" });
  });

  it("rejects a payload whose sig is an integer rather than a string", () => {
    // ES-30's branch: reachable, and previously covered by nothing — mutating
    // its rule string survived the whole suite.
    const c = new ChainBuilder();
    c.genesis();
    c.participant(0x03);
    const events = rehash(
      c.all.map((e, i) =>
        i === 1 ? ({ ...e, payload: { ...e.payload, sig: 7 } } as Event) : e,
      ),
    );
    assert.deepEqual(failureOf(exportOf(events)), { line: 2, rule: "ES-30" });
  });

  it("attributes an unparseable line to ITS line, not to line 1", () => {
    const chain = buildChain(11, shape);
    const lines = chain.ndjson.toString("utf8").trimEnd().split("\n");
    lines[2] = "{}";
    assert.deepEqual(
      failureOf({
        ndjson: Buffer.from(`${lines.join("\n")}\n`, "utf8"),
        head: chain.head,
      }),
      { line: 3, rule: "ES-1" },
    );
  });

  it("rejects a genesis that declares no operator_pk/registrar_pk", () => {
    const c = new ChainBuilder();
    c.genesis();
    const events = rehash(
      c.all.map((e) => {
        const payload = { ...e.payload };
        delete payload["operator_pk"];
        return { ...e, payload } as Event;
      }),
    );
    assert.deepEqual(failureOf(exportOf(events)), { line: 1, rule: "ES-18" });
  });
});
