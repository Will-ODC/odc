import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import type { PollMethod } from "../../src/voting/poll.js";
import {
  BallotError,
  UnknownPollError,
  type VotingStore,
} from "../../src/voting/store.js";
import type { MakeStore, SuiteOptions } from "./make.js";

/** Milliseconds on purpose: a store that drops them fails the round trips. */
const AT = new Date("2026-08-09T12:00:00.123Z");

/**
 * What every `VotingStore` must do, whatever keeps its rows. An implementation
 * runs it with `votingStoreConformance("its name", make)`.
 */
export function votingStoreConformance(
  label: string,
  make: MakeStore<VotingStore>,
  options: SuiteOptions = {},
): void {
  const storeAt = (t: TestContext, now: Date = AT) => make(() => now, t);

  async function pollWith(
    store: VotingStore,
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

  describe(
    `VotingStore conformance: ${label}`,
    { skip: options.skip ?? false },
    () => {
      test("counts_a_ballot_and_returns_it", async (t) => {
        const store = await storeAt(t);
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

      test("casting_again_before_close_changes_the_vote_and_the_count_follows", async (t) => {
        const store = await storeAt(t);
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

      test("results_count_voters_not_selections", async (t) => {
        const store = await storeAt(t);
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

      test("approval_shares_are_per_voter_and_can_sum_past_100", async (t) => {
        const store = await storeAt(t);
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

      test("results_are_zero_and_share_free_before_anyone_votes", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        const results = await store.results("p1");
        assert.equal(results.voters, 0);
        assert.equal(results.question, "Where next?");
        assert.deepEqual(
          results.choices.map((c) => c.share),
          [0, 0],
        );
      });

      test("votes_for_one_poll_never_land_in_another_polls_results", async (t) => {
        const store = await storeAt(t);
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

      test("rejects_a_choice_outside_the_polls_range", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await assert.rejects(
          () => store.castVote("p1", "voter-a", [2]),
          BallotError,
        );
        await assert.rejects(
          () => store.castVote("p1", "voter-a", [-1]),
          BallotError,
        );
        await assert.rejects(
          () => store.castVote("p1", "voter-a", [1.5]),
          BallotError,
        );
      });

      test("rejects_a_ballot_that_names_a_choice_twice", async (t) => {
        const store = await storeAt(t);
        await pollWith(store, "approval", ["Park", "Library", "Rink"]);
        await assert.rejects(
          () => store.castVote("p1", "voter-a", [1, 1]),
          BallotError,
        );
      });

      test("rejects_an_empty_ballot_rather_than_reading_it_as_a_retraction", async (t) => {
        const store = await storeAt(t);
        await pollWith(store, "approval", ["Park", "Library", "Rink"]);
        await assert.rejects(
          () => store.castVote("p1", "voter-a", []),
          BallotError,
        );
      });

      test("a_single_choice_poll_refuses_more_than_one_selection", async (t) => {
        const store = await storeAt(t);
        await pollWith(store, "single");
        await assert.rejects(
          () => store.castVote("p1", "voter-a", [0, 1]),
          BallotError,
        );
      });

      test("an_approval_poll_accepts_more_than_one_selection", async (t) => {
        const store = await storeAt(t);
        await pollWith(store, "approval", ["Park", "Library", "Rink"]);
        const result = await store.castVote("p1", "voter-a", [0, 2]);
        assert.equal(result.status, "counted");
      });

      test("rejects_an_empty_voter_id", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await assert.rejects(() => store.castVote("p1", "  ", [0]), TypeError);
      });

      test("refuses_a_vote_once_the_poll_has_closed", async (t) => {
        const closesAt = new Date("2026-08-09T11:00:00.000Z"); // already past at AT
        const store = await storeAt(t);
        await pollWith(store, "single", ["Park", "Library"], closesAt);
        const result = await store.castVote("p1", "voter-a", [0]);

        assert.equal(result.status, "closed");
        assert.equal((await store.results("p1")).voters, 0);
      });

      test("a_cast_after_close_leaves_the_earlier_ballot_standing", async (t) => {
        // A late cast must not replace anything. A store that upserts first and
        // checks the close time second would pass the test above and fail this.
        const closesAt = new Date("2026-08-09T12:30:00.000Z");
        let now = AT; // before the close
        const store = await make(() => now, t);
        await pollWith(store, "single", ["Park", "Library"], closesAt);
        await store.castVote("p1", "voter-a", [0]);

        now = new Date("2026-08-09T13:00:00.000Z"); // after it
        const late = await store.castVote("p1", "voter-a", [1]);

        assert.equal(late.status, "closed");
        assert.deepEqual((await store.voteOf("p1", "voter-a"))?.choices, [0]);
        assert.equal((await store.results("p1")).choices[0]?.count, 1);
      });

      test("a_ballot_comes_back_in_choice_order_whatever_order_it_was_cast_in", async (t) => {
        // A single or approval ballot is WHICH choices, not an order, and
        // storage keeps only which. Every store returns them in the poll's own
        // order, rather than one echoing the request and another not.
        const store = await storeAt(t);
        await pollWith(store, "approval", ["Park", "Library", "Rink"]);
        const cast = await store.castVote("p1", "voter-a", [2, 0]);

        assert.deepEqual(
          cast.status === "counted" ? cast.vote.choices : undefined,
          [0, 2],
        );
        assert.deepEqual(
          (await store.voteOf("p1", "voter-a"))?.choices,
          [0, 2],
        );
      });

      test("a_ballot_counts_against_its_own_polls_choices_when_another_poll_was_written_first", async (t) => {
        // Nothing in the schema ties a vote's choices to the vote's own poll
        // (see `vote_choice` in 001_initial.sql), so the store is the only
        // guard. A store that finds a choice by its position alone picks up the
        // poll written first — this puts one there, with the same positions.
        const store = await storeAt(t);
        await store.createPoll({
          id: "first",
          question: "Q",
          choices: ["x", "y"],
          method: "single",
        });
        await pollWith(store);
        await store.castVote("p1", "voter-a", [1]);

        assert.deepEqual(
          (await store.results("p1")).choices.map((c) => c.count),
          [0, 1],
        );
        assert.equal((await store.results("first")).voters, 0);
        assert.deepEqual((await store.voteOf("p1", "voter-a"))?.choices, [1]);
      });

      test("an_unknown_poll_is_an_error_not_an_empty_result", async (t) => {
        const store = await storeAt(t);
        await assert.rejects(() => store.results("nope"), UnknownPollError);
        await assert.rejects(
          () => store.castVote("nope", "voter-a", [0]),
          UnknownPollError,
        );
        assert.equal(await store.getPoll("nope"), undefined);
      });

      test("returns_a_poll_exactly_as_it_was_created", async (t) => {
        // The round trip a database store can get wrong in the most ways: choice
        // order, the onward links (including one to a poll not written yet),
        // an optional close time, and the milliseconds on both timestamps. A poll
        // with no close time comes back with no `closesAt` key at all.
        const store = await storeAt(t);
        const full = await store.createPoll({
          id: "p1",
          question: "Where next?",
          choices: ["Park", "Library", "Rink"],
          method: "approval",
          next: ["p2", null, null],
          closesAt: new Date("2026-08-10T12:00:00.456Z"),
          acceptsSuggestions: true,
        });
        const bare = await store.createPoll({
          id: "p2",
          question: "When?",
          choices: ["Fri", "Sat"],
          method: "single",
        });

        assert.deepEqual(await store.getPoll("p1"), full);
        assert.deepEqual(await store.getPoll("p2"), bare);

        // And against the input itself, not only against what createPoll
        // handed back: a store that loses a field on the way in AND on the
        // way out would still pass the two lines above.
        const read = await store.getPoll("p1");
        assert.deepEqual(read?.choices, ["Park", "Library", "Rink"]);
        assert.equal(read?.method, "approval");
        assert.deepEqual(read?.next, ["p2", null, null]);
        assert.equal(
          read?.closesAt?.getTime(),
          Date.parse("2026-08-10T12:00:00.456Z"),
        );
        assert.equal(read?.acceptsSuggestions, true);
        assert.equal(read?.createdAt.getTime(), AT.getTime());
        const readBare = await store.getPoll("p2");
        assert.deepEqual(readBare?.next, [null, null]);
        assert.equal(readBare?.acceptsSuggestions, false);
        assert.equal(readBare !== undefined && "closesAt" in readBare, false);
      });

      test("a_voter_who_has_not_voted_has_no_ballot", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await store.castVote("p1", "voter-a", [0]);
        assert.equal(await store.voteOf("p1", "voter-b"), undefined);
      });

      test("refuses_to_create_the_same_poll_id_twice", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await assert.rejects(() => pollWith(store), TypeError);
      });

      test("two_pairs_that_would_collide_under_naive_concatenation_stay_distinct", async (t) => {
        // ("a", "b:c") and ("a:b", "c") both flatten to "a:b:c" if you just join
        // with a separator. Whatever a store keys ballots on, one voter's ballot
        // can never be read as another's.
        const store = await storeAt(t);
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
    },
  );
}
