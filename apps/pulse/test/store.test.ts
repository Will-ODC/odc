import assert from "node:assert/strict";
import { test } from "node:test";
import type { PollMethod } from "../src/voting/poll.js";
import {
  BallotError,
  InMemoryVotingStore,
  UnknownPollError,
} from "../src/voting/store.js";

const AT = new Date("2026-08-09T12:00:00.000Z");

function storeAt(now: Date = AT): InMemoryVotingStore {
  return new InMemoryVotingStore(() => now);
}

async function pollWith(
  store: InMemoryVotingStore,
  method: PollMethod = "single",
  choices: string[] = ["Park", "Library"],
  closesAt?: Date,
) {
  return store.createPoll({
    id: "p1",
    question: "Where next?",
    choices,
    method,
    ...(closesAt ? { closesAt } : {}),
  });
}

test("counts_a_ballot_and_returns_it", async () => {
  const store = storeAt();
  await pollWith(store);
  const result = await store.castVote("p1", "voter-a", [1]);
  assert.equal(result.status, "counted");
  assert.deepEqual(await store.voteOf("p1", "voter-a"), {
    pollId: "p1",
    voterId: "voter-a",
    choices: [1],
    castAt: AT,
  });
});

test("casting_again_before_close_changes_the_vote_and_the_count_follows", async () => {
  const store = storeAt();
  await pollWith(store);
  const first = await store.castVote("p1", "voter-a", [0]);
  assert.equal(first.status, "counted");

  const second = await store.castVote("p1", "voter-a", [1]);
  assert.equal(second.status, "changed");
  assert.deepEqual(
    second.status === "changed" ? second.vote.choices : undefined,
    [1],
  );

  // The result reflects the new ballot, not the old one, and still one voter.
  const results = await store.results("p1");
  assert.equal(results.voters, 1);
  assert.equal(results.choices[0]?.count, 0);
  assert.equal(results.choices[1]?.count, 1);
});

test("results_count_voters_not_selections", async () => {
  const store = storeAt();
  await pollWith(store);
  await store.castVote("p1", "voter-a", [0]);
  await store.castVote("p1", "voter-b", [0]);
  await store.castVote("p1", "voter-c", [1]);

  const results = await store.results("p1");
  assert.equal(results.voters, 3);
  assert.equal(results.method, "single");
  assert.deepEqual(
    results.choices.map((c) => [c.label, c.count, c.share]),
    [
      ["Park", 2, 66.7],
      ["Library", 1, 33.3],
    ],
  );
});

test("approval_shares_are_per_voter_and_can_sum_past_100", async () => {
  const store = storeAt();
  await pollWith(store, "approval", ["Park", "Library", "Rink"]);
  // Two voters; each approves two choices. Six selections over two voters.
  await store.castVote("p1", "voter-a", [0, 1]);
  await store.castVote("p1", "voter-b", [0, 2]);

  const results = await store.results("p1");
  assert.equal(results.voters, 2);
  assert.deepEqual(
    results.choices.map((c) => c.share),
    [100, 50, 50],
  );
  const sum = results.choices.reduce((acc, c) => acc + c.share, 0);
  assert.ok(sum > 100, `approval shares should sum past 100, got ${sum}`);
});

test("results_are_zero_and_share_free_before_anyone_votes", async () => {
  const store = storeAt();
  await pollWith(store);
  const results = await store.results("p1");
  assert.equal(results.voters, 0);
  assert.equal(results.question, "Where next?");
  assert.deepEqual(
    results.choices.map((c) => c.share),
    [0, 0],
  );
});

test("votes_for_one_poll_never_land_in_another_polls_results", async () => {
  const store = storeAt();
  await pollWith(store);
  await store.createPoll({
    id: "p2",
    question: "When?",
    choices: ["Fri", "Sat"],
    method: "single",
  });
  await store.castVote("p1", "voter-a", [0]);
  await store.castVote("p2", "voter-a", [1]);

  assert.equal((await store.results("p1")).voters, 1);
  assert.equal((await store.results("p2")).choices[1]?.count, 1);
});

test("rejects_a_choice_outside_the_polls_range", async () => {
  const store = storeAt();
  await pollWith(store);
  await assert.rejects(() => store.castVote("p1", "voter-a", [2]), BallotError);
  await assert.rejects(
    () => store.castVote("p1", "voter-a", [-1]),
    BallotError,
  );
  await assert.rejects(
    () => store.castVote("p1", "voter-a", [1.5]),
    BallotError,
  );
});

test("rejects_a_ballot_that_names_a_choice_twice", async () => {
  const store = storeAt();
  await pollWith(store, "approval", ["Park", "Library", "Rink"]);
  await assert.rejects(
    () => store.castVote("p1", "voter-a", [1, 1]),
    BallotError,
  );
});

test("rejects_an_empty_ballot_rather_than_reading_it_as_a_retraction", async () => {
  const store = storeAt();
  await pollWith(store, "approval", ["Park", "Library", "Rink"]);
  await assert.rejects(() => store.castVote("p1", "voter-a", []), BallotError);
});

test("a_single_choice_poll_refuses_more_than_one_selection", async () => {
  const store = storeAt();
  await pollWith(store, "single");
  await assert.rejects(
    () => store.castVote("p1", "voter-a", [0, 1]),
    BallotError,
  );
});

test("an_approval_poll_accepts_more_than_one_selection", async () => {
  const store = storeAt();
  await pollWith(store, "approval", ["Park", "Library", "Rink"]);
  const result = await store.castVote("p1", "voter-a", [0, 2]);
  assert.equal(result.status, "counted");
});

test("rejects_an_empty_voter_id", async () => {
  const store = storeAt();
  await pollWith(store);
  await assert.rejects(() => store.castVote("p1", "  ", [0]), TypeError);
});

test("refuses_a_vote_once_the_poll_has_closed", async () => {
  const closesAt = new Date("2026-08-09T11:00:00.000Z"); // already past at AT
  const store = storeAt();
  await pollWith(store, "single", ["Park", "Library"], closesAt);
  const result = await store.castVote("p1", "voter-a", [0]);

  assert.equal(result.status, "closed");
  assert.equal((await store.results("p1")).voters, 0);
});

test("an_unknown_poll_is_an_error_not_an_empty_result", async () => {
  const store = storeAt();
  await assert.rejects(() => store.results("nope"), UnknownPollError);
  await assert.rejects(
    () => store.castVote("nope", "voter-a", [0]),
    UnknownPollError,
  );
  assert.equal(await store.getPoll("nope"), undefined);
});

test("refuses_to_create_the_same_poll_id_twice", async () => {
  const store = storeAt();
  await pollWith(store);
  await assert.rejects(() => pollWith(store), TypeError);
});

test("two_pairs_that_would_collide_under_naive_concatenation_stay_distinct", async () => {
  // ("a", "b:c") and ("a:b", "c") both flatten to "a:b:c" if you just join with
  // a separator. Length-prefixing keeps them apart, so one voter's ballot can
  // never be read as another's.
  const store = storeAt();
  await store.createPoll({
    id: "a",
    question: "Q",
    choices: ["x", "y"],
    method: "single",
  });
  await store.createPoll({
    id: "a:b",
    question: "Q",
    choices: ["x", "y"],
    method: "single",
  });
  await store.castVote("a", "b:c", [0]);
  await store.castVote("a:b", "c", [1]);

  assert.deepEqual((await store.voteOf("a", "b:c"))?.choices, [0]);
  assert.deepEqual((await store.voteOf("a:b", "c"))?.choices, [1]);
});
