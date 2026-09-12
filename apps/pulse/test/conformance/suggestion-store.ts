import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import { createPoll, type Poll } from "../../src/voting/poll.js";
import {
  MAX_SUGGESTION_LENGTH,
  SuggestionError,
  type SuggestionStore,
} from "../../src/voting/suggestions.js";
import type { SuiteOptions } from "./make.js";

const clock = () => new Date("2026-08-24T00:00:00.000Z");

/**
 * A poll to submit against. The default choices say nothing that any of the
 * suggestions in these tests say, so a test only meets the on-the-ballot rule
 * when it asks for it.
 */
const poll = (id: string, choices: readonly string[] = ["Yes", "No"]) =>
  createPoll(
    {
      id,
      question: "How do we pay for it?",
      choices,
      method: "single",
      acceptsSuggestions: true,
    },
    clock(),
  );

const p1 = poll("p1");

/** The seeded funding question, choices and all. */
const funding = () =>
  poll("funding", [
    "Members chip in",
    "One-off donations",
    "Grants",
    "A cut of what moves through it",
  ]);

/** Every poll the suite submits against. */
const POLLS: readonly Poll[] = [p1, funding()];

/**
 * A fresh, empty store for one test, as `MakeStore` — plus the polls the suite
 * will submit against. A store whose rows reference polls (the Postgres one:
 * `suggestion.poll_id` is a foreign key) writes them first; the in-memory
 * store has nothing to reference and ignores them.
 */
export type MakeSuggestionStore = (
  clock: () => Date,
  t: TestContext,
  polls: readonly Poll[],
) => Promise<SuggestionStore>;

/** What every `SuggestionStore` must do, whatever keeps its rows. */
export function suggestionStoreConformance(
  label: string,
  make: MakeSuggestionStore,
  options: SuiteOptions = {},
): void {
  const store = (t: TestContext) => make(clock, t, POLLS);

  describe(
    `SuggestionStore conformance: ${label}`,
    { skip: options.skip ?? false },
    () => {
      test("the first wording of an idea keeps the floor, and the count rises", async (t) => {
        const suggestions = await store(t);
        await suggestions.submit(p1, "Charge the members");
        const again = await suggestions.submit(p1, "we could charge members");

        assert.equal(again.status, "seconded");
        assert.equal(again.suggestion.text, "Charge the members");
        assert.equal(again.suggestion.count, 2);
        assert.equal((await suggestions.list("p1")).length, 1);
      });

      test("a new idea is added rather than folded into an old one", async (t) => {
        const suggestions = await store(t);
        await suggestions.submit(p1, "Charge the members");
        const other = await suggestions.submit(p1, "Apply for grants");

        assert.equal(other.status, "added");
        assert.equal(other.suggestion.count, 1);
        assert.equal((await suggestions.list("p1")).length, 2);
      });

      test("what came close is reported without being merged", async (t) => {
        const suggestions = await store(t);
        await suggestions.submit(p1, "Charge members a monthly fee");
        const next = await suggestions.submit(p1, "Charge members once a year");

        assert.equal(next.status, "added");
        assert.deepEqual(
          next.related.map((s) => s.text),
          ["Charge members a monthly fee"],
        );
      });

      test("suggestions are listed most-said first", async (t) => {
        const suggestions = await store(t);
        await suggestions.submit(p1, "Apply for grants");
        await suggestions.submit(p1, "Charge the members");
        await suggestions.submit(p1, "charge members");

        assert.deepEqual(
          (await suggestions.list("p1")).map((s) => s.count),
          [2, 1],
        );
      });

      test("one poll's suggestions never appear under another", async (t) => {
        const suggestions = await store(t);
        await suggestions.submit(p1, "Charge the members");
        assert.deepEqual(await suggestions.list("p2"), []);
      });

      test("an empty suggestion is refused with something to do about it", async (t) => {
        const suggestions = await store(t);
        await assert.rejects(
          () => suggestions.submit(p1, "   "),
          (error: unknown) =>
            error instanceof SuggestionError &&
            /what you would rather see/.test(error.message),
        );
      });

      test("a suggestion of nothing but filler is refused", async (t) => {
        const suggestions = await store(t);
        await assert.rejects(
          () => suggestions.submit(p1, "we should do it"),
          (error: unknown) => error instanceof SuggestionError,
        );
      });

      test("an over-long suggestion is refused, and the limit is named", async (t) => {
        const suggestions = await store(t);
        await assert.rejects(
          () => suggestions.submit(p1, "grants ".repeat(MAX_SUGGESTION_LENGTH)),
          (error: unknown) =>
            error instanceof SuggestionError &&
            error.message.includes(String(MAX_SUGGESTION_LENGTH)),
        );
      });

      test("surrounding and repeated whitespace is not what makes two ideas differ", async (t) => {
        const suggestions = await store(t);
        const first = await suggestions.submit(p1, "  Charge   the members  ");
        assert.equal(first.status, "added");
        assert.equal(first.suggestion.text, "Charge the members");
      });

      test("what the poll already offers is not added again, it is pointed at", async (t) => {
        const suggestions = await store(t);
        const result = await suggestions.submit(funding(), "Grants");

        assert.equal(result.status, "on_ballot");
        assert.deepEqual(result.choice, { index: 2, label: "Grants" });
        // Nothing was added: a suggestion cannot be voted for, and the choice can.
        assert.deepEqual(await suggestions.list("funding"), []);
      });

      test("a choice said in other words is still the choice", async (t) => {
        const suggestions = await store(t);
        const result = await suggestions.submit(
          funding(),
          "we could have members chip in",
        );

        assert.equal(result.status, "on_ballot");
        assert.equal(result.choice.label, "Members chip in");
        assert.deepEqual(await suggestions.list("funding"), []);
      });

      test("something merely near a choice is a proposal of its own", async (t) => {
        const suggestions = await store(t);
        const result = await suggestions.submit(
          funding(),
          "Grants from the council",
        );

        assert.equal(result.status, "added");
        assert.equal(result.suggestion.text, "Grants from the council");
        assert.equal((await suggestions.list("funding")).length, 1);
      });

      test("the ballot answers before an added option does, and no count moves", async (t) => {
        const suggestions = await store(t);
        await suggestions.submit(funding(), "Grants from the council");
        const result = await suggestions.submit(funding(), "grants");

        assert.equal(result.status, "on_ballot");
        assert.deepEqual(
          (await suggestions.list("funding")).map((one) => one.count),
          [1],
        );
      });
    },
  );
}
