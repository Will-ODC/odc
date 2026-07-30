import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serializeEvent } from "@odc/fixtures-gen/serialize";

import {
  assertTitleLegal,
  buildChain,
  DEFAULT_SHAPE,
  MAX_CHOICE_COUNT,
  MAX_TITLE_SCALARS,
  MIN_CHOICE_COUNT,
  TITLE_CHARS,
} from "../src/build.js";
import type { ChainShape } from "../src/build.js";

const SEEDS = [1, 2, 7, 42, 1337, 99991] as const;

/**
 * An explicit shape with literal counts, deliberately NOT `DEFAULT_SHAPE`.
 *
 * Building with `DEFAULT_SHAPE` and then asserting the result against
 * `DEFAULT_SHAPE` says only that the code agrees with itself: change the
 * constant and the assertions move with it, so a builder that silently ignored
 * its `shape` argument would stay green. These literals are the independent
 * side of the check. `DEFAULT_SHAPE` gets its own assertion below.
 */
const SHAPE: ChainShape = { participants: 12, issues: 5, votes: 40 };

function countByType(events: readonly { type: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return counts;
}

describe("TITLE_CHARS", () => {
  // Asserted on the pool rather than on a built title: every character is drawn
  // at random, so a chain-level assertion would be probabilistic. The pool is
  // fixed, so this is not.
  it("contains at least one astral scalar value, covering M34", () => {
    const astral = TITLE_CHARS.filter(
      (ch) => (ch.codePointAt(0) as number) > 0xffff,
    );
    assert.ok(
      astral.length > 0,
      "no character above U+FFFF: astral encoding is untested again",
    );
  });

  it("contains no character ET-14 forbids in a title", () => {
    for (const ch of TITLE_CHARS) {
      const c = ch.codePointAt(0) as number;
      assert.ok(c > 0x1f && c !== 0x7f, `U+${c.toString(16)} is forbidden`);
    }
  });

  it("contains the characters whose canonical line form is an escape", () => {
    for (const ch of ['"', "\\"]) assert.ok(TITLE_CHARS.includes(ch));
  });

  it("has no duplicate characters", () => {
    assert.equal(new Set(TITLE_CHARS).size, TITLE_CHARS.length);
  });
});

/**
 * The generator's bounds asserted against the SPEC's literals, not against
 * themselves.
 *
 * Without these, widening `MAX_CHOICE_COUNT` to 65 leaves the whole suite green:
 * the per-chain range check below only sees the values actually drawn, and
 * across six seeds and five issues each it takes a ~62% chance of never drawing
 * the illegal one. A bound that is only ever checked probabilistically is not
 * checked.
 */
describe("generator bounds match the contract", () => {
  it("uses ET-14a's 2 … 64 for choice_count", () => {
    assert.equal(MIN_CHOICE_COUNT, 2);
    assert.equal(MAX_CHOICE_COUNT, 64);
  });

  it("uses ET-14's 200 scalar values for the title ceiling", () => {
    assert.equal(MAX_TITLE_SCALARS, 200);
  });
});

/**
 * `assertTitleLegal` is a guard on generated titles, and every generated title
 * is legal by construction — so nothing in the chain tests ever makes it fire.
 * Deleting the call left the suite green. These exercise it directly, so the
 * guard is real coverage rather than an unreachable comment.
 */
describe("assertTitleLegal", () => {
  it("accepts a title at each end of ET-14's range", () => {
    assert.doesNotThrow(() => {
      assertTitleLegal("a");
    });
    assert.doesNotThrow(() => {
      assertTitleLegal("a".repeat(200));
    });
  });

  it("counts astral characters as ONE scalar value each, not two", () => {
    // 200 astral characters is 400 UTF-16 code units. Measuring with `.length`
    // would reject this legal title — the T5i distinction, in code.
    const astral = "𝄞".repeat(200);
    assert.equal(astral.length, 400);
    assert.doesNotThrow(() => {
      assertTitleLegal(astral);
    });
    assert.throws(() => {
      assertTitleLegal("𝄞".repeat(201));
    }, RangeError);
  });

  it("rejects an empty title", () => {
    assert.throws(() => {
      assertTitleLegal("");
    }, RangeError);
  });

  it("rejects a title over 200 scalar values", () => {
    assert.throws(() => {
      assertTitleLegal("a".repeat(201));
    }, RangeError);
  });

  it("rejects every C0 control character and U+007F (ET-14)", () => {
    for (const c of [0x00, 0x01, 0x09, 0x0a, 0x0d, 0x1f, 0x7f]) {
      assert.throws(
        () => {
          assertTitleLegal(`ok${String.fromCodePoint(c)}ok`);
        },
        RangeError,
        `U+${c.toString(16)} was accepted`,
      );
    }
  });

  it("accepts the characters just outside each banned range", () => {
    // U+0020 sits one above the C0 block, U+007E one below DEL, U+0080 one
    // above it. ET-14 bans U+0000-U+001F and U+007F and nothing else, so an
    // off-by-one in either bound shows up here. Written as code points rather
    // than literals: U+0080 is invisible in an editor, and an invisible
    // character in a test that is ABOUT invisible characters is a trap.
    for (const c of [0x20, 0x7e, 0x80]) {
      assert.doesNotThrow(
        () => {
          assertTitleLegal(`ok${String.fromCodePoint(c)}ok`);
        },
        `U+${c.toString(16)} was rejected`,
      );
    }
  });
});

describe("buildChain", () => {
  it("is byte-identical for the same seed", () => {
    const a = buildChain(42);
    const b = buildChain(42);
    assert.deepEqual(a.ndjson, b.ndjson);
    assert.equal(a.head, b.head);
  });

  it("differs between seeds", () => {
    assert.notDeepEqual(buildChain(1).ndjson, buildChain(2).ndjson);
  });

  it("honours a shape other than the default", () => {
    const chain = buildChain(1, { participants: 3, issues: 2, votes: 1 });
    const counts = countByType(chain.events);
    assert.equal(counts.get("participant_registered"), 3);
    assert.equal(counts.get("issue_created"), 2);
    assert.equal(counts.get("vote_cast"), 1);
    assert.equal(chain.events.length, 7);
  });

  it("builds a chain with no ballots at all", () => {
    const chain = buildChain(1, { participants: 1, issues: 1, votes: 0 });
    assert.equal(countByType(chain.events).get("vote_cast"), undefined);
    assert.equal(chain.events.length, 3);
  });

  it("uses the documented default shape", () => {
    assert.deepEqual(DEFAULT_SHAPE, {
      participants: 12,
      issues: 5,
      votes: 40,
    });
  });

  it("rejects a shape it cannot build", () => {
    const bad: ChainShape[] = [
      { participants: 0, issues: 1, votes: 0 },
      { participants: 254, issues: 1, votes: 0 },
      { participants: 1, issues: 0, votes: 0 },
      { participants: 1, issues: 1, votes: -1 },
      { participants: 1.5, issues: 1, votes: 0 },
    ];
    for (const shape of bad) {
      assert.throws(
        () => buildChain(1, shape),
        RangeError,
        JSON.stringify(shape),
      );
    }
  });

  for (const seed of SEEDS) {
    describe(`seed ${String(seed)}`, () => {
      const chain = buildChain(seed, SHAPE);

      it("builds exactly the requested shape, plus genesis", () => {
        const counts = countByType(chain.events);
        assert.equal(counts.get("genesis"), 1);
        assert.equal(counts.get("participant_registered"), 12);
        assert.equal(counts.get("issue_created"), 5);
        assert.equal(counts.get("vote_cast"), 40);
        assert.equal(chain.events.length, 58);
      });

      it("numbers seq 1…N with no gaps (ES-7)", () => {
        chain.events.forEach((e, i) => {
          assert.equal(e.seq, i + 1);
        });
      });

      it("opens with genesis at seq 1 anchored to the 64-zero prev_hash", () => {
        const first = chain.events[0];
        assert.equal(first?.type, "genesis");
        assert.equal(first?.prev_hash, "0".repeat(64));
      });

      it("gives every title a legal ET-14 length and no control characters", () => {
        for (const e of chain.events) {
          if (e.type !== "issue_created") continue;
          const scalars = [...String(e.payload["title"])];
          assert.ok(
            scalars.length >= 1 && scalars.length <= 200,
            `title is ${String(scalars.length)} scalar values`,
          );
          for (const ch of scalars) {
            const c = ch.codePointAt(0) as number;
            assert.ok(c > 0x1f && c !== 0x7f);
          }
        }
      });

      it("includes a title at ET-14's 200-scalar ceiling", () => {
        const lengths = chain.events
          .filter((e) => e.type === "issue_created")
          .map((e) => [...String(e.payload["title"])].length);
        assert.ok(
          lengths.includes(200),
          `no title reaches the bound: ${lengths.join(", ")}`,
        );
      });

      it("keeps every choice_count inside ET-14a's 2…64", () => {
        for (const e of chain.events) {
          if (e.type !== "issue_created") continue;
          const n = e.payload["choice_count"];
          assert.ok(
            typeof n === "number" && n >= 2 && n <= 64,
            `choice_count ${String(n)}`,
          );
        }
      });

      it("casts every ballot on a PRIOR issue with an in-range choice (ET-18, ET-18a)", () => {
        const choiceCounts = new Map<string, number>();
        for (const e of chain.events) {
          if (e.type === "issue_created") {
            choiceCounts.set(e.hash, e.payload["choice_count"] as number);
            continue;
          }
          if (e.type !== "vote_cast") continue;
          const issueId = String(e.payload["issue_id"]);
          const count = choiceCounts.get(issueId);
          assert.ok(
            count !== undefined,
            `seq ${String(e.seq)} votes on an issue not yet on the chain`,
          );
          const choice = e.payload["choice"];
          assert.ok(
            typeof choice === "number" && choice >= 0 && choice < count,
            `seq ${String(e.seq)} choice ${String(choice)} outside [0, ${String(count)})`,
          );
        }
      });

      it("carries no voter fingerprint on any ballot (ET-21)", () => {
        for (const e of chain.events) {
          if (e.type !== "vote_cast") continue;
          assert.deepEqual(Object.keys(e.payload).sort(), [
            "choice",
            "issue_id",
            "sig",
          ]);
        }
      });

      it("interleaves ballots with issue creation", () => {
        const types = chain.events.map((e) => e.type);
        const lastIssue = types.lastIndexOf("issue_created");
        const firstVote = types.indexOf("vote_cast");
        assert.ok(
          firstVote < lastIssue,
          "every issue precedes every ballot — the tidy ordering a verifier might assume",
        );
      });

      it("exports canonical NDJSON framing (EX-1, EX-3, EX-4)", () => {
        const text = chain.ndjson.toString("utf8");
        assert.ok(text.endsWith("\n"), "no final newline (EX-4)");
        assert.ok(!text.includes("\r"), "CR present (EX-3)");
        const lines = text.slice(0, -1).split("\n");
        assert.equal(lines.length, chain.events.length);
        assert.ok(!lines.includes(""), "blank line in the export (EX-5)");
      });

      it("exports each event as its canonical line form", () => {
        const lines = chain.ndjson.toString("utf8").slice(0, -1).split("\n");
        chain.events.forEach((e, i) => {
          assert.equal(lines[i], serializeEvent(e));
        });
      });

      it("reports the last line's hash as the head (EX-14)", () => {
        const last = chain.events[chain.events.length - 1];
        assert.equal(chain.head, last?.hash);
      });
    });
  }
});
