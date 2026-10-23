// The odc-testing chain property test, at the checker: a random valid chain,
// then single-byte flips (any byte, LFs included), each refused at the line
// that holds it. A flipped LF belongs to the line it ends.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replay, verifyExport } from "../../src/chain/checker.js";
import { serializeLine } from "../../src/chain/canonical.js";
import { TestChain, minute, testKey } from "./support/builders.js";

const T = (n: number): string => minute(n);

describe("checker: chain property (odc-testing)", () => {
  function rng(seed: number): () => number {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 2 ** 32;
    };
  }

  function randomChain(rand: () => number): TestChain {
    const chain = new TestChain();
    chain.add(chain.genesis());
    const issues: string[] = [];
    let instant = 10;
    for (let i = 0; i < 12; i++) {
      const pick = rand();
      if (pick < 0.25) chain.add(chain.participant(testKey(0x20 + i)));
      else if (pick < 0.5 || issues.length === 0) {
        issues.push(chain.add(chain.issue({ title: `Issue ${i}` })).hash);
      } else {
        const issue = issues[Math.floor(rand() * issues.length)] ?? "";
        instant += 1;
        for (let k = 0; k < 3; k++)
          chain.add(chain.vote(issue, k % 3, T(instant)));
      }
    }
    return chain;
  }

  for (const seed of [1, 7, 42, 1234, 99991]) {
    it(`seed ${seed}: VALID, then one flipped byte is refused at its own line`, () => {
      const rand = rng(seed);
      const chain = randomChain(rand);
      const bytes = chain.exportBytes();
      assert.ok(verifyExport(bytes).ok);
      for (let trial = 0; trial < 20; trial++) {
        const pos = Math.floor(rand() * bytes.length);
        const mask = 1 + Math.floor(rand() * 255);
        const tampered = Buffer.from(bytes);
        tampered[pos] = (tampered[pos] ?? 0) ^ mask;
        // The line holding the byte; a flipped LF belongs to the line it ends.
        let line = 1;
        for (let i = 0; i < pos; i++) if (bytes[i] === 0x0a) line++;
        const r = verifyExport(tampered);
        assert.ok(!r.ok, `byte ${pos} ^ ${mask} went undetected`);
        assert.equal(
          r.line,
          line,
          `byte ${pos} ^ ${mask}: ${r.refusal.reason}`,
        );
      }
    });
  }
});

describe("checker: LF flips and PARTIAL replay", () => {
  it("refuses a flipped LF at the line it ends, for every LF", () => {
    const chain = new TestChain();
    chain.add(chain.genesis());
    for (let i = 0; i < 4; i++) chain.add(chain.issue({ title: `I${i}` }));
    const bytes = chain.exportBytes();
    let line = 0;
    for (let pos = 0; pos < bytes.length; pos++) {
      if (bytes[pos] !== 0x0a) continue;
      line++;
      const tampered = Buffer.from(bytes);
      tampered[pos] = 0x20;
      const r = verifyExport(tampered);
      assert.ok(!r.ok && r.line === line, `LF ending line ${line}`);
    }
    assert.equal(line, 5);
  });

  it("replays a PARTIAL log to an unregistered refusal and no state", () => {
    const chain = new TestChain();
    chain.add(chain.genesis());
    const future = chain.add(
      chain.make("issue_created", { title: "x" }, { version: 2 }),
    );
    const r = replay([...chain.lines().slice(0, 1), serializeLine(future)]);
    assert.ok(!r.ok);
    assert.equal(r.line, 2);
    assert.equal(r.refusal.kind, "unregistered");
    assert.ok(!("state" in r));
  });
});
