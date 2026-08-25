import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CHOICES, createPoll, isOpen } from "../src/voting/poll.js";

const AT = new Date("2026-08-09T12:00:00.000Z");

test("creates_a_poll_and_trims_question_and_choices", () => {
  const poll = createPoll(
    {
      id: "p1",
      question: "  Where next?  ",
      choices: [" Park ", "Library"],
      method: "single",
    },
    AT,
  );
  assert.equal(poll.question, "Where next?");
  assert.deepEqual(poll.choices, ["Park", "Library"]);
  assert.equal(poll.method, "single");
  assert.equal(poll.createdAt, AT);
  assert.equal(poll.closesAt, undefined);
});

test("keeps_the_approval_method", () => {
  const poll = createPoll(
    { id: "p", question: "Q", choices: ["a", "b"], method: "approval" },
    AT,
  );
  assert.equal(poll.method, "approval");
});

test("rejects_a_missing_or_unknown_method", () => {
  assert.throws(
    () =>
      createPoll(
        // @ts-expect-error method is required
        { id: "p", question: "Q", choices: ["a", "b"] },
        AT,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      createPoll(
        // @ts-expect-error "ranked" is not a method the server knows yet
        { id: "p", question: "Q", choices: ["a", "b"], method: "ranked" },
        AT,
      ),
    TypeError,
  );
});

test("rejects_empty_id_question_or_choice", () => {
  assert.throws(
    () =>
      createPoll(
        { id: " ", question: "Q", choices: ["a", "b"], method: "single" },
        AT,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      createPoll(
        { id: "p", question: "  ", choices: ["a", "b"], method: "single" },
        AT,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      createPoll(
        { id: "p", question: "Q", choices: ["a", " "], method: "single" },
        AT,
      ),
    TypeError,
  );
});

test("rejects_fewer_than_min_or_more_than_max_choices", () => {
  assert.throws(
    () =>
      createPoll(
        { id: "p", question: "Q", choices: ["only"], method: "single" },
        AT,
      ),
    TypeError,
  );
  const tooMany = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => `c${i}`);
  assert.throws(
    () =>
      createPoll(
        { id: "p", question: "Q", choices: tooMany, method: "single" },
        AT,
      ),
    TypeError,
  );
});

test("accepts_a_poll_with_the_maximum_number_of_choices", () => {
  const many = Array.from({ length: MAX_CHOICES }, (_, i) => `c${i}`);
  const poll = createPoll(
    { id: "p", question: "Q", choices: many, method: "single" },
    AT,
  );
  assert.equal(poll.choices.length, MAX_CHOICES);
});

test("rejects_duplicate_choices_including_after_trimming", () => {
  assert.throws(
    () =>
      createPoll(
        { id: "p", question: "Q", choices: ["a", " a "], method: "single" },
        AT,
      ),
    TypeError,
  );
});

test("is_open_until_the_closing_time_passes", () => {
  const closesAt = new Date("2026-08-09T13:00:00.000Z");
  const poll = createPoll(
    { id: "p", question: "Q", choices: ["a", "b"], method: "single", closesAt },
    AT,
  );
  assert.equal(isOpen(poll, AT), true);
  assert.equal(isOpen(poll, closesAt), false);
  assert.equal(isOpen(poll, new Date("2026-08-09T13:00:01.000Z")), false);
});

test("a_poll_with_no_closing_time_stays_open", () => {
  const poll = createPoll(
    { id: "p", question: "Q", choices: ["a", "b"], method: "single" },
    AT,
  );
  assert.equal(isOpen(poll, new Date("2099-01-01T00:00:00.000Z")), true);
});

test("next names one onward poll per choice, or is left out entirely", () => {
  assert.throws(
    () =>
      createPoll({
        id: "p",
        question: "Which way?",
        choices: ["Left", "Right"],
        method: "single",
        next: ["only-one"],
      }),
    /one onward poll per choice/,
  );
});

test("a poll with no onward links has one null per choice, not an empty list", () => {
  // Same length always, so a choice cannot silently lose its link when one is
  // added and the arrays drift apart.
  const poll = createPoll({
    id: "p",
    question: "Which way?",
    choices: ["Left", "Right"],
    method: "single",
  });
  assert.deepEqual(poll.next, [null, null]);
  assert.equal(poll.acceptsSuggestions, false);
});
