import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_CHOICES, createPoll, isOpen } from "../src/voting/poll.js";

const AT = new Date("2026-08-09T12:00:00.000Z");

test("creates_a_poll_and_trims_question_and_choices", () => {
  const poll = createPoll(
    { id: "p1", question: "  Where next?  ", choices: [" Park ", "Library"] },
    AT,
  );
  assert.equal(poll.question, "Where next?");
  assert.deepEqual(poll.choices, ["Park", "Library"]);
  assert.equal(poll.createdAt, AT);
  assert.equal(poll.closesAt, undefined);
});

test("rejects_empty_id_question_or_choice", () => {
  assert.throws(
    () => createPoll({ id: " ", question: "Q", choices: ["a", "b"] }, AT),
    TypeError,
  );
  assert.throws(
    () => createPoll({ id: "p", question: "  ", choices: ["a", "b"] }, AT),
    TypeError,
  );
  assert.throws(
    () => createPoll({ id: "p", question: "Q", choices: ["a", " "] }, AT),
    TypeError,
  );
});

test("rejects_fewer_than_min_or_more_than_max_choices", () => {
  assert.throws(
    () => createPoll({ id: "p", question: "Q", choices: ["only"] }, AT),
    TypeError,
  );
  const tooMany = Array.from({ length: MAX_CHOICES + 1 }, (_, i) => `c${i}`);
  assert.throws(
    () => createPoll({ id: "p", question: "Q", choices: tooMany }, AT),
    TypeError,
  );
});

test("accepts_a_poll_with_the_maximum_number_of_choices", () => {
  const many = Array.from({ length: MAX_CHOICES }, (_, i) => `c${i}`);
  const poll = createPoll({ id: "p", question: "Q", choices: many }, AT);
  assert.equal(poll.choices.length, MAX_CHOICES);
});

test("rejects_duplicate_choices_including_after_trimming", () => {
  assert.throws(
    () => createPoll({ id: "p", question: "Q", choices: ["a", " a "] }, AT),
    TypeError,
  );
});

test("is_open_until_the_closing_time_passes", () => {
  const closesAt = new Date("2026-08-09T13:00:00.000Z");
  const poll = createPoll(
    { id: "p", question: "Q", choices: ["a", "b"], closesAt },
    AT,
  );
  assert.equal(isOpen(poll, AT), true);
  assert.equal(isOpen(poll, closesAt), false);
  assert.equal(isOpen(poll, new Date("2026-08-09T13:00:01.000Z")), false);
});

test("a_poll_with_no_closing_time_stays_open", () => {
  const poll = createPoll({ id: "p", question: "Q", choices: ["a", "b"] }, AT);
  assert.equal(isOpen(poll, new Date("2099-01-01T00:00:00.000Z")), true);
});
