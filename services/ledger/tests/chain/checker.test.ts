import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeLine, type Event } from "../../src/chain/canonical.js";
import {
  checkLine,
  initialState,
  replay,
  verifyExport,
  type ChainState,
  type LineResult,
} from "../../src/chain/checker.js";
import {
  GENESIS_TS,
  OPERATOR,
  REGISTRAR,
  finish,
  genesisPayload,
  TestChain,
  minute,
  testKey,
  type RawPayload,
} from "./support/builders.js";

const ALICE = testKey(0x11);
const IDENTITY_KEY = "01" + "00".repeat(31);
const T = (n: number): string => minute(n); // a batch instant, n minutes in

/** Accept every event of `chain`, then check `last` against the result. */
function check(chain: TestChain, last: Event): LineResult {
  const base = replay(chain.lines());
  assert.ok(
    base.ok,
    base.ok ? "" : `prefix refused at ${base.line}: ${base.refusal.reason}`,
  );
  return checkLine(base.state, serializeLine(last));
}

function accepts(chain: TestChain, last: Event): ChainState {
  const r = check(chain, last);
  assert.ok(r.ok, r.ok ? "" : `${r.refusal.rule}: ${r.refusal.reason}`);
  chain.add(last);
  return r.state;
}

function refuses(chain: TestChain, last: Event, rule?: string): void {
  const r = check(chain, last);
  assert.equal(r.ok, false, "expected a refusal");
  if (!r.ok && rule !== undefined)
    assert.equal(r.refusal.rule, rule, r.refusal.reason);
}

/** genesis + one issue (min 3, interval 60000); returns the issue id. */
function withIssue(over: RawPayload = {}): { chain: TestChain; issue: string } {
  const chain = new TestChain();
  chain.add(chain.genesis());
  const issue = chain.add(chain.issue(over));
  return { chain, issue: issue.hash };
}

/** Append votes for `issue` at the given instants; return the last state. */
function votes(
  chain: TestChain,
  issue: string,
  instants: string[],
): ChainState {
  let state = initialState();
  for (const ts of instants) state = accepts(chain, chain.vote(issue, 0, ts));
  return state;
}

describe("checker: state and purity", () => {
  it("exposes head, next seq, genesis keys and per-issue batch state", () => {
    const { chain, issue } = withIssue({
      ballot_batch_interval_ms: 120000,
      ballot_batch_min: 4,
    });
    const state = votes(chain, issue, [T(2), T(2), T(2), T(2), T(4)]);
    assert.equal(state.nextSeq, 8);
    assert.equal(state.headHash, chain.head);
    assert.equal(state.genesis?.operator.hex, OPERATOR.pk);
    assert.equal(state.genesis?.registrar.hex, REGISTRAR.pk);
    assert.equal(state.genesis?.genesisHash, chain.events[0]?.hash);
    const s = state.issues.get(issue);
    assert.ok(s);
    assert.equal(s.choiceCount, 3);
    assert.equal(s.ballotBatchIntervalMs, 120000);
    assert.equal(s.ballotBatchMin, 4);
    assert.deepEqual([...s.usedInstants], [T(2), T(4)]);
    assert.deepEqual(s.currentBatch, { ts: T(4), size: 1 });
  });

  it("never mutates the input state, whether the line is accepted or refused", () => {
    const { chain, issue } = withIssue();
    const before = replay(chain.lines());
    assert.ok(before.ok);
    const snapshot = JSON.stringify(
      [...before.state.issues.values()].map((i) => [...i.usedInstants]),
    );
    const ok = checkLine(
      before.state,
      serializeLine(chain.vote(issue, 0, T(5))),
    );
    assert.ok(ok.ok);
    const bad = checkLine(
      before.state,
      serializeLine(chain.vote(issue, 9, T(5))),
    );
    assert.ok(!bad.ok);
    assert.equal(before.state.nextSeq, 3);
    assert.equal(before.state.issues.get(issue)?.currentBatch, null);
    assert.equal(
      JSON.stringify(
        [...before.state.issues.values()].map((i) => [...i.usedInstants]),
      ),
      snapshot,
    );
  });

  it("starts empty at seq 1 and the 64-zero anchor", () => {
    const s = initialState();
    assert.equal(s.nextSeq, 1);
    assert.equal(s.headHash, "0".repeat(64));
    assert.equal(s.genesis, null);
  });
});

describe("checker: Stage A", () => {
  it("refuses a seq gap, a repeat, a broken link and a bad hash", () => {
    const { chain } = withIssue();
    refuses(chain, chain.participant(ALICE, { seq: 5 }), "ES-7");
    refuses(chain, chain.participant(ALICE, { seq: 2 }), "ES-7");
    refuses(
      chain,
      chain.participant(ALICE, { prevHash: "ab".repeat(32) }),
      "ES-25",
    );
    const e = chain.participant(ALICE);
    refuses(chain, { ...e, hash: "cd".repeat(32) }, "HA-14");
  });

  it("refuses a first line that is not genesis, and a second genesis", () => {
    const chain = new TestChain();
    refuses(chain, chain.participant(ALICE), "ES-33");
    chain.add(chain.genesis());
    refuses(
      chain,
      chain.genesis({}, { seq: 2, prevHash: chain.head }),
      "ES-33",
    );
  });

  it("refuses an unregistered pair: PARTIAL elsewhere, INVALID at line 1 (EV-20, EV-26)", () => {
    const chain = new TestChain();
    const g2 = chain.genesis({}, { version: 2 });
    const r1 = check(chain, g2);
    assert.ok(
      !r1.ok && r1.refusal.kind === "invalid" && r1.refusal.rule === "EV-20",
    );
    chain.add(chain.genesis());
    for (const e of [
      chain.participant(ALICE, { version: 1000000 }),
      chain.make("x_future", {}, {}),
    ]) {
      const r = check(chain, e);
      assert.ok(!r.ok && r.refusal.kind === "unregistered");
    }
  });
});

describe("checker: genesis (ET-6..ET-9f)", () => {
  const genesis = (over: RawPayload, rule?: string): void => {
    const chain = new TestChain();
    if (rule === undefined) accepts(chain, chain.genesis(over));
    else refuses(chain, chain.genesis(over), rule);
  };
  const H1 = "11".repeat(32);
  const H2 = "22".repeat(32);

  it("accepts both optional ancestry keys together (ES-34, ET-9f)", () => {
    genesis({ ancestor_chain: H1, ancestor_head: H2 });
    genesis({ ancestor_chain: H1, ancestor_head: H1 });
  });
  it("refuses either ancestry key alone (ET-9f)", () => {
    genesis({ ancestor_chain: H1 }, "ET-9f");
    genesis({ ancestor_head: H2 }, "ET-9f");
  });
  it("refuses an ancestry value that is the anchor, uppercase or an integer (ET-9e)", () => {
    genesis({ ancestor_chain: "0".repeat(64), ancestor_head: H2 }, "ET-9e");
    genesis({ ancestor_chain: H1, ancestor_head: "AB".repeat(32) }, "ET-9e");
    genesis({ ancestor_chain: H1, ancestor_head: 7 }, "ES-18");
  });
  it("refuses uppercase keys, equal keys and an underived chain_id (ET-9b, ET-9d, ET-7)", () => {
    genesis({ registrar_pk: REGISTRAR.pk.toUpperCase() }, "ET-9b");
    genesis({ registrar_pk: OPERATOR.pk }, "ET-9d");
    genesis({ chain_id: "ab".repeat(32) }, "ET-7");
  });
  it("bounds contracts at 1-64 UTF-8 bytes of the decoded value (ET-9)", () => {
    genesis({ contracts: "c".repeat(64) });
    genesis({ contracts: "\u{1F600}".repeat(16) });
    genesis({ contracts: "\u0001" + "c".repeat(63) });
    genesis({ contracts: "" }, "ET-9");
    genesis({ contracts: "c".repeat(65) }, "ET-9");
    genesis({ contracts: "\u{1F600}".repeat(17) }, "ET-9");
  });
  it("checks registrar_pk's encoding and subgroup at genesis (ET-9c)", () => {
    genesis({ registrar_pk: IDENTITY_KEY }, "ET-4c");
  });
  it("refuses a genesis not self-signed by operator_pk, or with a key missing or extra (ET-8, ES-18)", () => {
    const chain = new TestChain();
    refuses(chain, chain.genesis({}, { signer: REGISTRAR }));
    const missing = genesisPayload();
    delete missing.registrar_pk;
    refuses(
      chain,
      chain.make("genesis", missing, { signer: OPERATOR, ts: GENESIS_TS }),
      "ES-18",
    );
    genesis({ note: "x" }, "ES-18");
  });
});

describe("checker: participant_registered and issue_created", () => {
  it("accepts a self-signed participant and refuses another signer or a bad key (ET-10, ET-4c)", () => {
    const { chain } = withIssue();
    accepts(chain, chain.participant(ALICE));
    accepts(chain, chain.participant(ALICE)); // no uniqueness on-log (ET-12)
    refuses(chain, chain.participant(ALICE, { signer: testKey(0x12) }), "ET-5");
    refuses(
      chain,
      chain.make(
        "participant_registered",
        { pubkey: IDENTITY_KEY },
        { signer: null, sig: "00".repeat(64) },
      ),
      "ET-4c",
    );
    refuses(
      chain,
      chain.make(
        "participant_registered",
        { pubkey: ALICE.pk, extra: 1 },
        { signer: ALICE },
      ),
      "ES-18",
    );
  });

  it("enforces title, choice_count and batching floors (ET-14, ET-14a, ET-14b)", () => {
    const { chain } = withIssue();
    const issue = (over: RawPayload, rule?: string): void => {
      if (rule === undefined) accepts(chain, chain.issue(over));
      else refuses(chain, chain.issue(over), rule);
    };
    issue({ title: "x" });
    issue({ title: "\u{1F600}".repeat(200) });
    issue({ title: "a\u0085b" }); // C1 is legal
    issue({
      choice_count: 2,
      ballot_batch_interval_ms: 60000,
      ballot_batch_min: 3,
    });
    issue({ choice_count: 64 });
    issue({ title: "" }, "ET-14");
    issue({ title: "\u{1F600}".repeat(201) }, "ET-14");
    issue({ title: "a\tb" }, "ET-14");
    issue({ title: "a\u007fb" }, "ET-14");
    issue({ choice_count: 1 }, "ET-14a");
    issue({ choice_count: 65 }, "ET-14a");
    issue({ ballot_batch_interval_ms: 59999 }, "ET-14b");
    issue({ ballot_batch_min: 2 }, "ET-14b");
    issue({ choice_count: "3" }, "ES-18");
    refuses(chain, chain.issue({}, { signer: REGISTRAR }), "ET-5");
  });
});

describe("checker: vote_cast (ET-17..ET-23)", () => {
  it("refuses an unknown issue, a non-issue hash and a malformed issue_id (ET-18, ID-8)", () => {
    const { chain } = withIssue();
    const p = chain.add(chain.participant(ALICE));
    refuses(chain, chain.vote("ab".repeat(32), 0, T(5)), "ET-18");
    refuses(chain, chain.vote(p.hash, 0, T(5)), "ET-18");
    refuses(chain, chain.vote(chain.events[0]?.hash ?? "", 0, T(5)), "ET-18");
    refuses(chain, chain.vote("AB".repeat(32), 0, T(5)), "ID-1");
  });

  it("bounds choice to the issue's choice_count (ET-18a, ET-19)", () => {
    const { chain, issue } = withIssue({ choice_count: 2 });
    accepts(chain, chain.vote(issue, 1, T(5)));
    refuses(chain, chain.vote(issue, 2, T(5)), "ET-18a");
    refuses(
      chain,
      chain.make(
        "vote_cast",
        { issue_id: issue, choice: "1" },
        { signer: REGISTRAR, ts: T(5) },
      ),
      "ES-18",
    );
  });

  it("requires the registrar's signature, not the operator's (ET-17)", () => {
    const { chain, issue } = withIssue();
    refuses(chain, chain.vote(issue, 0, T(5), { signer: OPERATOR }), "ET-5");
  });

  it("requires ts to be a multiple of the issue's interval, including before 1970 (ET-23)", () => {
    const { chain, issue } = withIssue({ ballot_batch_interval_ms: 120000 });
    refuses(chain, chain.vote(issue, 0, T(5)), "ET-23");
    refuses(chain, chain.vote(issue, 0, "2026-07-21T00:04:00.001Z"), "ET-23");
    accepts(chain, chain.vote(issue, 0, "1969-12-31T23:58:00.000Z"));
  });
});

describe("checker: batches (ET-24, ET-24a)", () => {
  it("refuses T1,T1,T2 with min 3 at the first T2 (ET-24 attribution)", () => {
    const { chain, issue } = withIssue();
    votes(chain, issue, [T(4), T(4)]);
    refuses(chain, chain.vote(issue, 0, T(6)), "ET-24");
  });

  it("refuses a return to a left instant at the returning ballot (ET-24a)", () => {
    const { chain, issue } = withIssue();
    votes(chain, issue, [T(4), T(4), T(4), T(6), T(6), T(6)]);
    refuses(chain, chain.vote(issue, 0, T(4)), "ET-24a");
  });

  it("allows an under-size last batch, and extending it at the same instant", () => {
    const { chain, issue } = withIssue();
    votes(chain, issue, [T(4), T(4), T(4), T(6)]);
    const other = chain.add(chain.issue({ title: "Other" }));
    votes(chain, other.hash, [T(6)]);
    votes(chain, issue, [T(6), T(6)]);
    votes(chain, issue, [T(8)]);
  });

  it("keeps each issue's batches separate when ballots interleave", () => {
    const { chain, issue } = withIssue();
    const b = chain.add(chain.issue({ title: "B", ballot_batch_min: 4 })).hash;
    votes(chain, issue, [T(4)]);
    votes(chain, b, [T(4), T(4)]);
    votes(chain, issue, [T(4), T(4)]);
    votes(chain, b, [T(4), T(4)]);
    votes(chain, issue, [T(6)]);
    votes(chain, b, [T(8)]);
    refuses(chain, chain.vote(b, 0, T(6)), "ET-24");
  });

  it("T1,T1,T2,T2,T2,T1 with min 3 is fatal at the first T2, not the returning T1", () => {
    const { chain, issue } = withIssue();
    const first = chain.events.length + 1;
    for (const ts of [T(4), T(4), T(6), T(6), T(6), T(4)]) {
      chain.add(chain.vote(issue, 0, ts)); // linked on, past the fault
    }
    const r = verifyExport(chain.exportBytes());
    assert.ok(!r.ok);
    assert.equal(r.line, first + 2);
    assert.equal(r.refusal.rule, "ET-24");
  });
});

describe("checker: verifyExport framing and replay", () => {
  it("accepts a valid export and returns the same state replay builds", () => {
    const { chain, issue } = withIssue();
    votes(chain, issue, [T(4), T(4), T(4)]);
    const r = verifyExport(chain.exportBytes());
    assert.ok(r.ok);
    assert.equal(r.lineCount, 5);
    const again = replay(chain.lines());
    assert.ok(again.ok);
    assert.equal(again.state.headHash, r.state.headHash);
  });

  it("replays a stored log that is not VALID to a refusal and no state (EV-26)", () => {
    const { chain } = withIssue();
    const lines = chain.lines();
    lines[1] = serializeLine(chain.issue({}, { seq: 2, sig: "00".repeat(64) }));
    const r = replay(lines);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.line === 2 && !("state" in r));
  });

  it("orders nothing by ts: an earlier ts after a later one is fine (ES-21)", () => {
    const chain = new TestChain();
    chain.add(chain.genesis());
    accepts(chain, chain.issue({}, { ts: minute(9) }));
    accepts(chain, chain.issue({}, { ts: minute(1) }));
  });

  it("refuses a sig that is not a string (ES-30)", () => {
    const { chain } = withIssue();
    const raw = JSON.parse(
      Buffer.from(serializeLine(chain.issue())).toString(),
    );
    raw.payload.sig = 7;
    delete raw.hash;
    refuses(chain, finish(raw, null), "ES-30");
  });

  it("attributes framing faults per EX-18 and EX-20", () => {
    const { chain } = withIssue();
    const bytes = chain.exportBytes();
    const lineOf = (b: Uint8Array): number | undefined => {
      const r = verifyExport(b);
      return r.ok ? undefined : r.line;
    };
    assert.equal(lineOf(new Uint8Array()), 1);
    assert.equal(lineOf(bytes.subarray(0, bytes.length - 1)), 2);
    assert.equal(lineOf(Buffer.concat([bytes, Buffer.from("\n")])), 3);
    const crlf = Buffer.from(bytes.toString("utf8").replace("\n", "\r\n"));
    assert.equal(lineOf(crlf), 1);
    assert.equal(
      lineOf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])),
      1,
    );
  });
});
