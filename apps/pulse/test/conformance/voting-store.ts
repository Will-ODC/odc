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
 * Stand-ins for `ConfirmationKey.codeFor` output (ADR-0040): the store only
 * ever sees codes, so the suite needs nothing but their shape. One per person.
 */
const ADA = "a".repeat(64);
const BO = "b".repeat(64);

/**
 * A cast by someone signed in: their code and, as every confirmation must
 * carry, their lock key (`ConfirmationKey.lockKeyFor`, ADR-0046). The in-memory
 * store only checks the key; the Postgres one locks on it.
 */
const asAda = { confirmation: ADA, lockKey: 1001n } as const;
const asBo = { confirmation: BO, lockKey: 1002n } as const;
/** Signing in, as `confirmVotes` is handed the person. */
const adaSignsIn = { codeFor: () => ADA, lockKey: asAda.lockKey };

/** `AT` plus some seconds, for tests where cast order is the point. */
const later = (seconds: number) => new Date(AT.getTime() + seconds * 1000);

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
      test("places_an_unattributed_seed_in_General_without_replacing_its_votes", async (t) => {
        const store = await storeAt(t);
        const before = await pollWith(store);
        await store.castVote("p1", "voter-a", [1]);
        await store.setSeedCommunity("p1", "pulse-general");
        await store.setSeedCommunity("p1", "pulse-general");
        assert.deepEqual(await store.getPoll("p1"), before);
        assert.equal((await store.results("p1")).voters, 1);
        const listed = await store.listPolls({
          community: "pulse-general",
          limit: 20,
        });
        assert.deepEqual(
          listed.map((poll) => poll.id),
          ["p1"],
        );
        await assert.rejects(
          store.setSeedCommunity("missing", "pulse-general"),
          /seed poll missing or authored/,
        );
      });

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

      test("vote history lists only this browser's ballots, newest cast first, a re-cast moving to the top", async (t) => {
        let now = AT;
        const store = await make(() => now, t);
        for (const id of ["p1", "p2", "p3"]) {
          await store.createPoll({
            id,
            question: `Question ${id}`,
            choices: ["Yes", "No", "Maybe"],
            method: id === "p3" ? "approval" : "single",
            ...(id === "p2" ? { closesAt: later(3600) } : {}),
          });
        }
        await store.castVote("p1", "browser-a", [0]);
        now = later(1);
        await store.castVote("p2", "browser-a", [1]);
        now = later(2);
        await store.castVote("p3", "browser-a", [2, 0]);
        await store.castVote("p3", "browser-b", [1]);
        // p1 has the smallest id and the oldest vote; changing it must lift it.
        now = later(3);
        await store.castVote("p1", "browser-a", [1]);

        assert.deepEqual(
          (await store.voteHistory("browser-b", 20)).map((v) => v.pollId),
          ["p3"],
        );
        const rows = await store.voteHistory("browser-a", 20);
        assert.deepEqual(
          rows.map((v) => v.pollId),
          ["p1", "p3", "p2"],
        );
        assert.deepEqual(rows[0], {
          pollId: "p1",
          castAt: later(3),
          ballot: [1],
          poll: { question: "Question p1", choices: ["No"] },
        });
        // Approval picks come back in position order, labels beside them.
        assert.deepEqual(rows[1]?.ballot, [0, 2]);
        assert.deepEqual(rows[1]?.poll?.choices, ["Yes", "Maybe"]);
        assert.deepEqual(rows[2]?.poll?.closesAt, later(3600));
      });

      test("vote history pages with one extra row and resumes after a cursor", async (t) => {
        let now = AT;
        const store = await make(() => now, t);
        for (const id of ["p1", "p2", "p3"]) {
          await store.createPoll({
            id,
            question: id,
            choices: ["Yes", "No"],
            method: "single",
          });
          await store.castVote(id, "browser-a", [0]);
          now = new Date(now.getTime() + 1000);
        }
        const first = await store.voteHistory("browser-a", 1);
        assert.deepEqual(
          first.map((v) => v.pollId),
          ["p3", "p2"],
          "one shown plus the probe row",
        );
        const second = await store.voteHistory("browser-a", 1, {
          castAt: first[0]!.castAt,
          pollId: first[0]!.pollId,
        });
        assert.deepEqual(
          second.map((v) => v.pollId),
          ["p2", "p1"],
        );
      });

      test("vote history breaks a cast-time tie by poll id, bytewise, descending", async (t) => {
        const store = await storeAt(t);
        for (const id of ["a", "B", "b"]) {
          await store.createPoll({
            id,
            question: id,
            choices: ["Yes", "No"],
            method: "single",
          });
          await store.castVote(id, "browser-a", [0]);
        }
        // Same cast time for all three: "b" > "a" > "B" in byte order.
        assert.deepEqual(
          (await store.voteHistory("browser-a", 20)).map((v) => v.pollId),
          ["b", "a", "B"],
        );
        const afterA = await store.voteHistory("browser-a", 20, {
          castAt: AT,
          pollId: "a",
        });
        assert.deepEqual(
          afterA.map((v) => v.pollId),
          ["B"],
        );
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

      test("confirmed_numbers_are_zero_when_nobody_has_confirmed", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        const empty = await store.results("p1");
        assert.equal(empty.confirmedVoters, 0);
        assert.deepEqual(
          empty.choices.map((c) => [c.confirmedCount, c.confirmedShare]),
          [
            [0, 0],
            [0, 0],
          ],
        );

        // Votes with no confirmation count in the totals only.
        await store.castVote("p1", "b:1", [0]);
        const unconfirmed = await store.results("p1");
        assert.equal(unconfirmed.voters, 1);
        assert.equal(unconfirmed.confirmedVoters, 0);
        assert.deepEqual(
          unconfirmed.choices.map((c) => c.confirmedCount),
          [0, 0],
        );
      });

      test("a_vote_cast_with_a_confirmation_counts_as_confirmed", async (t) => {
        const store = await storeAt(t);
        await pollWith(store, "approval", ["Park", "Library", "Rink"]);
        await store.castVote("p1", "b:1", [0, 2], asAda);
        await store.castVote("p1", "b:2", [0], asBo);
        await store.castVote("p1", "b:3", [1]);

        const results = await store.results("p1");
        assert.equal(results.voters, 3);
        assert.equal(results.confirmedVoters, 2);
        assert.deepEqual(
          results.choices.map((c) => [c.confirmedCount, c.confirmedShare]),
          [
            [2, 100],
            [0, 0],
            [1, 50],
          ],
        );
        // The full numbers are exactly what they were before confirmation.
        assert.deepEqual(
          results.choices.map((c) => [c.count, c.share]),
          [
            [2, 66.7],
            [1, 33.3],
            [1, 33.3],
          ],
        );
      });

      test("one_person_voting_from_two_browsers_keeps_one_ballot_the_latest", async (t) => {
        // ADR-0046: a cast while signed in replaces the person's ballot in
        // any other browser. The totals count them once, not twice.
        let now = AT;
        const store = await make(() => now, t);
        await pollWith(store);
        await store.castVote("p1", "b:phone", [0], asAda);
        now = later(60);
        const second = await store.castVote("p1", "b:laptop", [1], asAda);
        // A first ballot for this browser, whatever it replaced elsewhere.
        assert.equal(second.status, "counted");

        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.equal(results.confirmedVoters, 1);
        assert.deepEqual(
          results.choices.map((c) => [c.count, c.confirmedCount]),
          [
            [0, 0],
            [1, 1],
          ],
        );
        assert.equal(await store.voteOf("p1", "b:phone"), undefined);
        assert.deepEqual((await store.voteOf("p1", "b:laptop"))?.choices, [1]);
        assert.deepEqual(
          (await store.voteHistory("b:phone", 10)).map((v) => v.pollId),
          [],
        );
      });

      test("vote_signed_in_sign_out_sign_in_vote_again_is_one_ballot_with_the_latest_answer", async (t) => {
        // #532's case: signing out clears the ballot cookie, so the second
        // vote comes from a new ballot identity on the same browser.
        let now = AT;
        const store = await make(() => now, t);
        await pollWith(store);
        await store.castVote("p1", "b:first-cookie", [0], asAda);
        now = later(60);
        await store.castVote("p1", "b:second-cookie", [1], asAda);
        now = later(120);
        await store.castVote("p1", "b:second-cookie", [0], asAda);

        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.deepEqual(
          results.choices.map((c) => [c.count, c.confirmedCount]),
          [
            [1, 1],
            [0, 0],
          ],
        );
        assert.deepEqual(
          (await store.voteOf("p1", "b:second-cookie"))?.choices,
          [0],
        );
        assert.equal(await store.voteOf("p1", "b:first-cookie"), undefined);
      });

      test("a_cast_while_signed_in_replaces_even_a_ballot_stamped_later", async (t) => {
        // ADR-0046 decision 2: the cast is the person's latest answer by
        // definition, so it does not compare times. Another instance's clock
        // running ahead cannot make a new vote lose to an older one.
        let now = later(60);
        const store = await make(() => now, t);
        await pollWith(store);
        await store.castVote("p1", "b:laptop", [1], asAda);
        now = AT;
        await store.castVote("p1", "b:phone", [0], asAda);

        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.deepEqual(
          results.choices.map((c) => c.confirmedCount),
          [1, 0],
        );
        assert.equal(await store.voteOf("p1", "b:laptop"), undefined);
      });

      test("a_cast_while_signed_in_replaces_only_that_persons_ballot_on_that_poll", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await store.createPoll({
          id: "p2",
          question: "When?",
          choices: ["Fri", "Sat"],
          method: "single",
        });
        await store.castVote("p1", "b:ada-old", [0], asAda);
        await store.castVote("p2", "b:ada-old", [0], asAda);
        await store.castVote("p1", "b:bo", [0], asBo);
        await store.castVote("p1", "b:anonymous", [0]);

        await store.castVote("p1", "b:ada-new", [1], asAda);

        assert.equal(await store.voteOf("p1", "b:ada-old"), undefined);
        // Another poll, another person, and a vote nobody confirmed stay.
        assert.deepEqual((await store.voteOf("p2", "b:ada-old"))?.choices, [0]);
        assert.deepEqual((await store.voteOf("p1", "b:bo"))?.choices, [0]);
        assert.deepEqual(
          (await store.voteOf("p1", "b:anonymous"))?.choices,
          [0],
        );
        const results = await store.results("p1");
        assert.equal(results.voters, 3);
        assert.equal(results.confirmedVoters, 2);
      });

      test("votes_nobody_confirmed_still_count_once_per_browser", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await store.castVote("p1", "b:1", [0]);
        await store.castVote("p1", "b:2", [0]);
        await store.castVote("p1", "b:3", [1]);
        await store.castVote("p1", "b:1", [1]);

        const results = await store.results("p1");
        assert.equal(results.voters, 3);
        assert.deepEqual(
          results.choices.map((c) => c.count),
          [1, 2],
        );
      });

      test("changing_an_answer_while_signed_out_keeps_it_confirmed", async (t) => {
        let now = AT;
        const store = await make(() => now, t);
        await pollWith(store);
        await store.castVote("p1", "b:phone", [0], asAda);

        // The phone changes its answer with nobody signed in: it keeps its
        // confirmation, and replaces nothing.
        now = later(60);
        const changed = await store.castVote("p1", "b:phone", [1]);
        assert.equal(changed.status, "changed");
        await store.castVote("p1", "b:laptop", [0]);

        const results = await store.results("p1");
        assert.equal(results.voters, 2);
        assert.equal(results.confirmedVoters, 1);
        assert.deepEqual(
          results.choices.map((c) => c.confirmedCount),
          [0, 1],
        );
      });

      test("a_confirmation_needs_the_persons_lock_key", async (t) => {
        // Every confirming write is serialized on the person's lock
        // (ADR-0046); a store handed a code without one refuses to write.
        const store = await storeAt(t);
        await pollWith(store);
        await assert.rejects(
          () =>
            store.castVote("p1", "b:1", [0], {
              confirmation: ADA,
            } as unknown as typeof asAda),
          TypeError,
        );
        assert.equal((await store.results("p1")).voters, 0);
        await store.castVote("p1", "b:1", [0]);
        await assert.rejects(
          () =>
            store.confirmVotes("b:1", {
              codeFor: () => ADA,
            } as unknown as typeof adaSignsIn),
          TypeError,
        );
        assert.equal((await store.results("p1")).confirmedVoters, 0);
      });

      test("a_new_confirmation_replaces_the_one_a_vote_held", async (t) => {
        // A different person signed in on the same browser and voted again.
        const store = await storeAt(t);
        await pollWith(store);
        await store.castVote("p1", "b:shared", [0], asAda);
        await store.castVote("p1", "b:shared", [1], asBo);

        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.equal(results.confirmedVoters, 1);
        assert.deepEqual(
          results.choices.map((c) => c.confirmedCount),
          [0, 1],
        );
      });

      test("confirming_a_browser_confirms_its_votes_on_open_polls_only", async (t) => {
        let now = AT;
        const store = await make(() => now, t);
        await pollWith(store);
        await store.createPoll({
          id: "shut",
          question: "Closed already?",
          choices: ["Yes", "No"],
          method: "single",
          closesAt: later(30),
        });
        await store.createPoll({
          id: "p3",
          question: "Another?",
          choices: ["Yes", "No"],
          method: "single",
        });
        await store.castVote("p1", "b:1", [0]);
        await store.castVote("shut", "b:1", [0]);
        await store.castVote("p3", "b:other", [1]);

        // "shut" closes between the vote and the sign-in.
        now = later(60);
        const seen: string[] = [];
        const confirmed = await store.confirmVotes("b:1", {
          codeFor: (poll) => {
            seen.push(poll);
            return ADA;
          },
          lockKey: asAda.lockKey,
        });

        assert.equal(confirmed, 1);
        assert.deepEqual(seen, ["p1"]);
        assert.equal((await store.results("p1")).confirmedVoters, 1);
        // A closed poll's results do not change after it closed.
        assert.equal((await store.results("shut")).confirmedVoters, 0);
        // Another browser's vote is not touched.
        assert.equal((await store.results("p3")).confirmedVoters, 0);
        // A browser with no votes confirms nothing.
        assert.equal(await store.confirmVotes("b:nobody", adaSignsIn), 0);
      });

      test("signing_in_on_an_older_ballot_moves_the_newer_answer_to_this_browser", async (t) => {
        // ADR-0046 decision 4, option A: the person voted on b:new more
        // recently, then signs in on b:old. The later cast survives, and is
        // now filed under b:old with its own answer and cast time.
        let now = AT;
        const store = await make(() => now, t);
        await pollWith(store);
        await store.castVote("p1", "b:old", [0]);
        now = later(60);
        await store.castVote("p1", "b:new", [1], asAda);

        now = later(120);
        assert.equal(await store.confirmVotes("b:old", adaSignsIn), 1);

        const moved = await store.voteOf("p1", "b:old");
        assert.deepEqual(moved?.choices, [1]);
        assert.equal(moved?.castAt.getTime(), later(60).getTime());
        assert.equal(await store.voteOf("p1", "b:new"), undefined);
        assert.deepEqual(
          (await store.voteHistory("b:old", 10)).map((v) => [
            v.pollId,
            v.ballot,
          ]),
          [["p1", [1]]],
        );
        assert.deepEqual(await store.voteHistory("b:new", 10), []);

        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.equal(results.confirmedVoters, 1);
        assert.deepEqual(
          results.choices.map((c) => [c.count, c.confirmedCount]),
          [
            [0, 0],
            [1, 1],
          ],
        );

        // It is this browser's ballot now: changing it changes the one vote.
        now = later(180);
        assert.equal(
          (await store.castVote("p1", "b:old", [0])).status,
          "changed",
        );
        assert.equal((await store.results("p1")).confirmedVoters, 1);
      });

      test("signing_in_on_a_newer_ballot_deletes_the_older_one_elsewhere", async (t) => {
        let now = AT;
        const store = await make(() => now, t);
        await pollWith(store);
        await store.castVote("p1", "b:old", [0], asAda);
        now = later(60);
        await store.castVote("p1", "b:new", [1]);

        now = later(120);
        assert.equal(await store.confirmVotes("b:new", adaSignsIn), 1);

        assert.deepEqual((await store.voteOf("p1", "b:new"))?.choices, [1]);
        assert.equal(await store.voteOf("p1", "b:old"), undefined);
        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.deepEqual(
          results.choices.map((c) => [c.count, c.confirmedCount]),
          [
            [0, 0],
            [1, 1],
          ],
        );
      });

      test("signing_in_leaves_a_closed_polls_ballots_alone", async (t) => {
        // ADR-0040 decision 3: a closed poll's results stop changing. The
        // person's two ballots on it, one confirmed, both stay.
        let now = AT;
        const store = await make(() => now, t);
        await store.createPoll({
          id: "shut",
          question: "Closed already?",
          choices: ["Yes", "No"],
          method: "single",
          closesAt: later(90),
        });
        await store.castVote("shut", "b:old", [0]);
        now = later(60);
        await store.castVote("shut", "b:new", [1], asAda);

        now = later(120);
        assert.equal(await store.confirmVotes("b:old", adaSignsIn), 0);

        assert.deepEqual((await store.voteOf("shut", "b:old"))?.choices, [0]);
        assert.deepEqual((await store.voteOf("shut", "b:new"))?.choices, [1]);
        const results = await store.results("shut");
        assert.equal(results.voters, 2);
        assert.equal(results.confirmedVoters, 1);
      });

      test("a_same_millisecond_tie_at_sign_in_moves_the_greater_ballots_answer_here", async (t) => {
        // Ties go to the greater ballot identity (`moreRecent` in store.ts;
        // `collate "C"` in Postgres). Here the other browser's is greater, so
        // its answer moves to the browser signing in.
        const store = await storeAt(t);
        await pollWith(store);
        await store.castVote("p1", "b:2", [1], asAda);
        await store.castVote("p1", "b:1", [0]);

        await store.confirmVotes("b:1", adaSignsIn);

        assert.deepEqual((await store.voteOf("p1", "b:1"))?.choices, [1]);
        assert.equal(await store.voteOf("p1", "b:2"), undefined);
        assert.deepEqual(
          (await store.results("p1")).choices.map((c) => c.confirmedCount),
          [0, 1],
        );
      });

      test("a_same_millisecond_tie_at_sign_in_keeps_this_ballot_when_it_is_the_greater", async (t) => {
        // The mirror of the test above. Together they pin the tie-break
        // itself: a store that always keeps this browser's answer, or always
        // the other's, fails one of the two.
        const store = await storeAt(t);
        await pollWith(store);
        await store.castVote("p1", "b:1", [0], asAda);
        await store.castVote("p1", "b:2", [1]);

        await store.confirmVotes("b:2", adaSignsIn);

        assert.deepEqual((await store.voteOf("p1", "b:2"))?.choices, [1]);
        assert.equal(await store.voteOf("p1", "b:1"), undefined);
        assert.deepEqual(
          (await store.results("p1")).choices.map((c) => c.confirmedCount),
          [0, 1],
        );
      });

      test("confirming_a_browser_is_all_or_nothing_when_one_code_is_refused", async (t) => {
        // One good code and one bad: nothing may be left half-confirmed.
        const store = await storeAt(t);
        await pollWith(store);
        await store.createPoll({
          id: "p2",
          question: "When?",
          choices: ["Fri", "Sat"],
          method: "single",
        });
        await store.castVote("p1", "b:1", [0]);
        await store.castVote("p2", "b:1", [1]);

        await assert.rejects(
          () =>
            store.confirmVotes("b:1", {
              codeFor: (poll) => (poll === "p2" ? "voter-123" : ADA),
              lockKey: asAda.lockKey,
            }),
          TypeError,
        );
        assert.equal((await store.results("p1")).confirmedVoters, 0);
        assert.equal((await store.results("p2")).confirmedVoters, 0);
      });

      test("one_code_on_two_polls_is_counted_on_each_poll_separately", async (t) => {
        const store = await storeAt(t);
        await pollWith(store);
        await store.createPoll({
          id: "p2",
          question: "When?",
          choices: ["Fri", "Sat"],
          method: "single",
        });
        await store.castVote("p1", "b:1", [0], asAda);
        await store.castVote("p2", "b:1", [1], asAda);

        assert.equal((await store.results("p1")).confirmedVoters, 1);
        assert.equal((await store.results("p2")).confirmedVoters, 1);
      });

      test("a_confirmation_that_is_not_a_keyed_code_is_refused_and_nothing_is_written", async (t) => {
        // An account id or an address in place of the code would store the
        // very connection ADR-0040 keeps out of storage.
        const store = await storeAt(t);
        await pollWith(store);
        for (const bad of [
          "ada@example.org",
          "voter-123",
          "A".repeat(64),
          "",
        ]) {
          await assert.rejects(
            () =>
              store.castVote("p1", "b:1", [0], {
                confirmation: bad,
                lockKey: asAda.lockKey,
              }),
            TypeError,
          );
        }
        assert.equal((await store.results("p1")).voters, 0);

        await store.castVote("p1", "b:1", [0]);
        await assert.rejects(
          () =>
            store.confirmVotes("b:1", {
              codeFor: () => "ada@example.org",
              lockKey: asAda.lockKey,
            }),
          TypeError,
        );
        assert.equal((await store.results("p1")).confirmedVoters, 0);
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
