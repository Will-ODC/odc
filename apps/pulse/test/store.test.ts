import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryVotingStore, UnknownPollError } from "../src/voting/store.js";

const AT = new Date("2026-08-09T12:00:00.000Z");

function storeAt(now: Date = AT): InMemoryVotingStore {
  return new InMemoryVotingStore(() => now);
}

async function pollWithTwoChoices(store: InMemoryVotingStore, closesAt?: Date) {
  return store.createPoll({
    id: "p1",
    question: "Where next?",
    choices: ["Park", "Library"],
    ...(closesAt ? { closesAt } : {}),
  });
}

test("counts_a_vote_and_returns_it", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  const result = await store.castVote("p1", "voter-a", 1);
  assert.equal(result.status, "counted");
  assert.deepEqual(await store.voteOf("p1", "voter-a"), {
    pollId: "p1",
    voterId: "voter-a",
    choice: 1,
    castAt: AT,
  });
});

test("one_voter_votes_once_and_the_second_attempt_does_not_change_the_count", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  await store.castVote("p1", "voter-a", 0);
  const again = await store.castVote("p1", "voter-a", 1);

  assert.equal(again.status, "already_voted");
  assert.equal(
    again.status === "already_voted" ? again.vote.choice : undefined,
    0,
  );
  const results = await store.results("p1");
  assert.equal(results.total, 1);
  assert.equal(results.choices[0]?.count, 1);
  assert.equal(results.choices[1]?.count, 0);
});

test("different_voters_each_count_once", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  await store.castVote("p1", "voter-a", 0);
  await store.castVote("p1", "voter-b", 0);
  await store.castVote("p1", "voter-c", 1);

  const results = await store.results("p1");
  assert.equal(results.total, 3);
  assert.deepEqual(
    results.choices.map((c) => [c.label, c.count, c.share]),
    [
      ["Park", 2, 66.7],
      ["Library", 1, 33.3],
    ],
  );
});

test("results_are_zero_and_share_free_before_anyone_votes", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  const results = await store.results("p1");
  assert.equal(results.total, 0);
  assert.equal(results.question, "Where next?");
  assert.deepEqual(
    results.choices.map((c) => c.share),
    [0, 0],
  );
});

test("votes_for_one_poll_never_land_in_another_polls_results", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  await store.createPoll({
    id: "p2",
    question: "When?",
    choices: ["Fri", "Sat"],
  });
  await store.castVote("p1", "voter-a", 0);
  await store.castVote("p2", "voter-a", 1);

  assert.equal((await store.results("p1")).total, 1);
  assert.equal((await store.results("p2")).choices[1]?.count, 1);
});

test("rejects_a_choice_outside_the_polls_range", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  await assert.rejects(() => store.castVote("p1", "voter-a", 2), RangeError);
  await assert.rejects(() => store.castVote("p1", "voter-a", -1), RangeError);
  await assert.rejects(() => store.castVote("p1", "voter-a", 1.5), RangeError);
});

test("rejects_an_empty_voter_id", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  await assert.rejects(() => store.castVote("p1", "  ", 0), TypeError);
});

test("refuses_a_vote_once_the_poll_has_closed", async () => {
  const closesAt = new Date("2026-08-09T11:00:00.000Z"); // already past at AT
  const store = storeAt();
  await pollWithTwoChoices(store, closesAt);
  const result = await store.castVote("p1", "voter-a", 0);

  assert.equal(result.status, "closed");
  assert.equal((await store.results("p1")).total, 0);
});

test("an_unknown_poll_is_an_error_not_an_empty_result", async () => {
  const store = storeAt();
  await assert.rejects(() => store.results("nope"), UnknownPollError);
  await assert.rejects(
    () => store.castVote("nope", "voter-a", 0),
    UnknownPollError,
  );
  assert.equal(await store.getPoll("nope"), undefined);
});

test("refuses_to_create_the_same_poll_id_twice", async () => {
  const store = storeAt();
  await pollWithTwoChoices(store);
  await assert.rejects(() => pollWithTwoChoices(store), TypeError);
});
