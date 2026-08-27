import assert from "node:assert/strict";
import test from "node:test";
import { createPoll } from "../src/voting/poll.js";
import {
  InMemorySuggestionStore,
  MAX_SUGGESTION_LENGTH,
  SuggestionError,
  keywords,
  overlap,
} from "../src/voting/suggestions.js";

const clock = () => new Date("2026-08-24T00:00:00.000Z");
const store = () => new InMemorySuggestionStore({ clock });

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

test("keywords keeps what a phrase is about and drops what every phrase has", () => {
  assert.deepEqual(
    [...keywords("We should charge the members a fee")],
    ["charge", "members", "fee"],
  );
});

test("keywords ignores punctuation, case and apostrophes", () => {
  assert.deepEqual([...keywords("Members' FEES!")], ["members", "fees"]);
});

test("overlap calls the same idea in different words the same idea", () => {
  assert.ok(overlap("charge the members", "we could charge members") >= 0.6);
});

test("overlap keeps different proposals apart", () => {
  assert.ok(overlap("charge the members", "apply for grants") < 0.3);
});

test("a phrase of nothing but filler matches nothing, rather than everything", () => {
  // Both sides reduce to no keywords. Calling that a perfect match would file
  // every empty phrase under whichever one was submitted first.
  assert.equal(overlap("should we do it", "can you get that"), 0);
});

test("the first wording of an idea keeps the floor, and the count rises", async () => {
  const suggestions = store();
  await suggestions.submit(p1, "Charge the members");
  const again = await suggestions.submit(p1, "we could charge members");

  assert.equal(again.status, "seconded");
  assert.equal(again.suggestion.text, "Charge the members");
  assert.equal(again.suggestion.count, 2);
  assert.equal((await suggestions.list("p1")).length, 1);
});

test("a new idea is added rather than folded into an old one", async () => {
  const suggestions = store();
  await suggestions.submit(p1, "Charge the members");
  const other = await suggestions.submit(p1, "Apply for grants");

  assert.equal(other.status, "added");
  assert.equal(other.suggestion.count, 1);
  assert.equal((await suggestions.list("p1")).length, 2);
});

test("what came close is reported without being merged", async () => {
  const suggestions = store();
  await suggestions.submit(p1, "Charge members a monthly fee");
  const next = await suggestions.submit(p1, "Charge members once a year");

  assert.equal(next.status, "added");
  assert.deepEqual(
    next.related.map((s) => s.text),
    ["Charge members a monthly fee"],
  );
});

test("suggestions are listed most-said first", async () => {
  const suggestions = store();
  await suggestions.submit(p1, "Apply for grants");
  await suggestions.submit(p1, "Charge the members");
  await suggestions.submit(p1, "charge members");

  assert.deepEqual(
    (await suggestions.list("p1")).map((s) => s.count),
    [2, 1],
  );
});

test("one poll's suggestions never appear under another", async () => {
  const suggestions = store();
  await suggestions.submit(p1, "Charge the members");
  assert.deepEqual(await suggestions.list("p2"), []);
});

test("an empty suggestion is refused with something to do about it", async () => {
  await assert.rejects(
    () => store().submit(p1, "   "),
    (error: unknown) =>
      error instanceof SuggestionError &&
      /what you would rather see/.test(error.message),
  );
});

test("a suggestion of nothing but filler is refused", async () => {
  await assert.rejects(
    () => store().submit(p1, "we should do it"),
    (error: unknown) => error instanceof SuggestionError,
  );
});

test("an over-long suggestion is refused, and the limit is named", async () => {
  await assert.rejects(
    () => store().submit(p1, "grants ".repeat(MAX_SUGGESTION_LENGTH)),
    (error: unknown) =>
      error instanceof SuggestionError &&
      error.message.includes(String(MAX_SUGGESTION_LENGTH)),
  );
});

test("surrounding and repeated whitespace is not what makes two ideas differ", async () => {
  const suggestions = store();
  const first = await suggestions.submit(p1, "  Charge   the members  ");
  assert.equal(first.status, "added");
  assert.equal(first.suggestion.text, "Charge the members");
});

test("what the poll already offers is not added again, it is pointed at", async () => {
  const suggestions = store();
  const result = await suggestions.submit(funding(), "Grants");

  assert.equal(result.status, "on_ballot");
  assert.deepEqual(result.choice, { index: 2, label: "Grants" });
  // Nothing was added: a suggestion cannot be voted for, and the choice can.
  assert.deepEqual(await suggestions.list("funding"), []);
});

test("a choice said in other words is still the choice", async () => {
  const suggestions = store();
  const result = await suggestions.submit(
    funding(),
    "we could have members chip in",
  );

  assert.equal(result.status, "on_ballot");
  assert.equal(result.choice.label, "Members chip in");
  assert.deepEqual(await suggestions.list("funding"), []);
});

test("something merely near a choice is a proposal of its own", async () => {
  const suggestions = store();
  const result = await suggestions.submit(funding(), "Grants from the council");

  assert.equal(result.status, "added");
  assert.equal(result.suggestion.text, "Grants from the council");
  assert.equal((await suggestions.list("funding")).length, 1);
});

test("the ballot answers before an added option does, and no count moves", async () => {
  const suggestions = store();
  await suggestions.submit(funding(), "Grants from the council");
  const result = await suggestions.submit(funding(), "grants");

  assert.equal(result.status, "on_ballot");
  assert.deepEqual(
    (await suggestions.list("funding")).map((one) => one.count),
    [1],
  );
});
