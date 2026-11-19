import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import type { MemberProfileStore } from "../../src/profiles/store.js";
import type { VotePrivacy } from "../../src/voting/poll.js";
import {
  VotePrivacyError,
  type CastResult,
  type Vote,
  type VotingStore,
} from "../../src/voting/store.js";
import type { SuiteOptions } from "./make.js";

/** Milliseconds on purpose: a store that drops them fails the round trips. */
const AT = new Date("2026-11-18T12:00:00.123Z");
const later = (seconds: number) => new Date(AT.getTime() + seconds * 1000);

/**
 * Stand-ins for `ConfirmationKey.codeFor` and `lockKeyFor` (ADR-0040,
 * ADR-0046): the store sees only these, never derives them.
 */
const asAda = { confirmation: "a".repeat(64), lockKey: 1001n } as const;
const asBo = { confirmation: "b".repeat(64), lockKey: 1002n } as const;
const asCy = { confirmation: "c".repeat(64), lockKey: 1003n } as const;

/** The vote a cast on an open poll made. */
function made(result: CastResult): Vote {
  if (result.status === "closed") assert.fail("the poll is open");
  return result.vote;
}

/**
 * A voting store beside the accounts and profiles a public vote reads its
 * name from. `hide` is absent where the store has no hidden polls (memory).
 */
export interface PublicVoteWorld {
  store: VotingStore;
  profiles: MemberProfileStore;
  /** A signed-up account, with no profile. */
  account(id: string): Promise<void>;
  /** Set the account's profile name; `visible: false` hides the profile. */
  name(id: string, displayName: string, visible?: boolean): Promise<void>;
  hide?: (pollId: string) => Promise<void>;
}

export type MakeWorld = (
  clock: () => Date,
  t: TestContext,
) => Promise<PublicVoteWorld>;

/**
 * ADR-0048 decision 3's refusals and the store side of decisions 4, 6, 7, 8
 * and 10, run against every voting store. The Postgres-only SQL refusals are
 * in `vote-privacy-migration.test.ts`.
 */
export function publicVoteConformance(
  label: string,
  make: MakeWorld,
  options: SuiteOptions = {},
): void {
  async function world(t: TestContext, clock: () => Date = () => AT) {
    const w = await make(clock, t);
    for (const id of ["ada", "bo", "cy"]) await w.account(id);
    return w;
  }

  function poll(
    store: VotingStore,
    votePrivacy: VotePrivacy = "public",
    extra: { id?: string; closesAt?: Date } = {},
  ) {
    return store.createPoll({
      id: extra.id ?? "p1",
      question: "Where next?",
      choices: ["Park", "Library", "Pool"],
      method: "approval",
      votePrivacy,
      ...(extra.closesAt ? { closesAt: extra.closesAt } : {}),
    });
  }

  describe(
    `Public-vote conformance: ${label}`,
    { skip: options.skip ?? false },
    () => {
      test("a_poll_is_anonymous_unless_created_public_and_says_so_when_read_and_listed", async (t) => {
        const { store } = await world(t);
        const seed = await store.createPoll({
          id: "seed",
          question: "Q?",
          choices: ["A", "B"],
          method: "single",
        });
        const pub = await poll(store);
        assert.equal(seed.votePrivacy, "anonymous");
        assert.equal(pub.votePrivacy, "public");
        assert.deepEqual(await store.getPoll("seed"), seed);
        assert.deepEqual(await store.getPoll("p1"), pub);
        await assert.rejects(
          store.createPoll({
            id: "odd",
            question: "Q?",
            choices: ["A", "B"],
            method: "single",
            votePrivacy: "secret" as VotePrivacy,
          }),
          /vote privacy must be one of/,
        );
        await store.setSeedCommunity("seed", "pulse-general");
        await store.setSeedCommunity("p1", "pulse-general");
        const listed = await store.listPolls({
          community: "pulse-general",
          limit: 20,
        });
        assert.deepEqual(
          listed.map((row) => [row.id, row.votePrivacy]).sort(),
          [
            ["p1", "public"],
            ["seed", "anonymous"],
          ],
        );
      });

      test("the_setting_is_fixed_a_poll_id_cannot_be_recreated_with_the_other_one", async (t) => {
        const { store } = await world(t);
        await poll(store, "anonymous");
        await assert.rejects(poll(store, "public"), /poll already exists/);
        assert.equal((await store.getPoll("p1"))?.votePrivacy, "anonymous");
      });

      test("a_first_public_cast_is_filed_under_a_fresh_pv_identity_and_found_by_account", async (t) => {
        const { store } = await world(t);
        await poll(store);
        const ada = await store.castPublic("p1", "ada", [2, 0], asAda);
        const bo = await store.castPublic("p1", "bo", [1], asBo);
        assert.equal(ada.status, "counted");
        assert.equal(bo.status, "counted");
        const adaVote = made(ada);
        assert.match(adaVote.voterId, /^pv:[0-9a-f-]{36}$/);
        assert.notEqual(adaVote.voterId, made(bo).voterId);
        assert.deepEqual(adaVote, {
          pollId: "p1",
          voterId: adaVote.voterId,
          choices: [0, 2],
          castAt: AT,
        });
        assert.deepEqual(await store.publicVoteOf("p1", "ada"), adaVote);
        assert.equal(await store.publicVoteOf("p1", "cy"), undefined);
        // Every public vote carries its code, so all of them are confirmed.
        const results = await store.results("p1");
        assert.equal(results.voters, 2);
        assert.equal(results.confirmedVoters, 2);
        assert.deepEqual(
          results.choices.map((c) => [c.count, c.confirmedCount]),
          [
            [1, 1],
            [1, 1],
            [1, 1],
          ],
        );
      });

      test("a_public_re_cast_replaces_the_answer_in_place_one_row_per_account", async (t) => {
        let now = AT;
        const { store } = await world(t, () => now);
        await poll(store);
        const first = made(await store.castPublic("p1", "ada", [0], asAda));
        now = later(5);
        const again = await store.castPublic("p1", "ada", [1, 2], asAda);
        assert.equal(again.status, "changed");
        assert.equal(made(again).voterId, first.voterId);
        assert.deepEqual(await store.publicVoteOf("p1", "ada"), {
          pollId: "p1",
          voterId: first.voterId,
          choices: [1, 2],
          castAt: later(5),
        });
        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.deepEqual(
          results.choices.map((c) => c.count),
          [0, 1, 1],
        );
      });

      test("refuses_an_account_on_an_anonymous_poll_and_a_ballot_identity_on_a_public_one", async (t) => {
        const { store } = await world(t);
        await poll(store, "anonymous", { id: "anon" });
        await poll(store, "public", { id: "pub" });
        await assert.rejects(
          store.castPublic("anon", "ada", [0], asAda),
          VotePrivacyError,
        );
        await assert.rejects(
          store.castVote("pub", "b:browser", [0]),
          VotePrivacyError,
        );
        await assert.rejects(
          store.castVote("pub", "b:browser", [0], asAda),
          VotePrivacyError,
        );
        // Nor a pv: identity on an anonymous poll, made up or real.
        await assert.rejects(
          store.castVote("anon", "pv:made-up", [0]),
          VotePrivacyError,
        );
        const real = made(await store.castPublic("pub", "ada", [0], asAda));
        await assert.rejects(
          store.castVote("anon", real.voterId, [0]),
          VotePrivacyError,
        );
        assert.equal((await store.results("anon")).voters, 0);
        assert.equal((await store.results("pub")).voters, 1);
        assert.equal(await store.voteOf("pub", "b:browser"), undefined);
      });

      test("a_public_cast_needs_a_code_and_a_lock_key_and_a_valid_ballot", async (t) => {
        const { store } = await world(t);
        await poll(store);
        const bad = [
          { confirmation: "not-a-code", lockKey: 1n },
          { confirmation: asAda.confirmation, lockKey: 2n ** 63n },
          { confirmation: asAda.confirmation } as never,
        ];
        for (const options of bad)
          await assert.rejects(
            store.castPublic("p1", "ada", [0], options),
            TypeError,
          );
        await assert.rejects(store.castPublic("p1", "", [0], asAda), TypeError);
        await assert.rejects(
          store.castPublic("p1", "ada", [9], asAda),
          /not one of this poll's choices/,
        );
        assert.equal((await store.results("p1")).voters, 0);
      });

      test("a_public_cast_after_close_is_closed_and_writes_nothing", async (t) => {
        let now = AT;
        const { store } = await world(t, () => now);
        await poll(store, "public", { closesAt: later(10) });
        await store.castPublic("p1", "ada", [0], asAda);
        now = later(10);
        assert.deepEqual(await store.castPublic("p1", "ada", [1], asAda), {
          status: "closed",
        });
        assert.deepEqual(await store.castPublic("p1", "bo", [1], asBo), {
          status: "closed",
        });
        assert.deepEqual((await store.publicVoteOf("p1", "ada"))?.choices, [0]);
        assert.equal((await store.results("p1")).voters, 1);
      });

      test("signing_in_never_moves_or_confirms_a_public_vote", async (t) => {
        const { store } = await world(t);
        await poll(store);
        const cast = made(await store.castPublic("p1", "ada", [0], asAda));
        // Even named by its own pv: identity, the linked row stays where it is.
        assert.equal(
          await store.confirmVotes(cast.voterId, {
            codeFor: () => asBo.confirmation,
            lockKey: asBo.lockKey,
          }),
          0,
        );
        assert.deepEqual(await store.publicVoteOf("p1", "ada"), cast);
        assert.equal((await store.results("p1")).confirmedVoters, 1);
      });

      test("removal_while_open_takes_the_answer_and_the_name_and_is_harmless_to_repeat", async (t) => {
        let now = AT;
        const w = await world(t, () => now);
        const { store } = w;
        await w.name("ada", "Ada");
        await poll(store, "public", { closesAt: later(60) });
        await store.castPublic("p1", "ada", [0, 1], asAda);
        await store.castPublic("p1", "bo", [1], asBo);
        assert.deepEqual(
          await store.removePublicVote("p1", "ada", asAda.lockKey),
          { status: "removed" },
        );
        assert.equal(await store.publicVoteOf("p1", "ada"), undefined);
        const results = await store.results("p1");
        assert.equal(results.voters, 1);
        assert.equal(results.confirmedVoters, 1);
        assert.deepEqual(
          results.choices.map((c) => c.count),
          [0, 1, 0],
        );
        assert.deepEqual(
          (await store.listPublicVotes("p1", 20))?.map((e) => e.name),
          [null],
        );
        assert.deepEqual(
          await store.removePublicVote("p1", "ada", asAda.lockKey),
          { status: "none" },
        );
        // They may vote again while it is open, and then it is fixed.
        assert.equal(
          (await store.castPublic("p1", "ada", [2], asAda)).status,
          "counted",
        );
        now = later(60);
        assert.deepEqual(
          await store.removePublicVote("p1", "ada", asAda.lockKey),
          { status: "closed" },
        );
        assert.deepEqual(
          await store.removePublicVote("p1", "cy", asCy.lockKey),
          { status: "closed" },
        );
        assert.deepEqual((await store.publicVoteOf("p1", "ada"))?.choices, [2]);
      });

      test("removal_is_refused_on_an_anonymous_poll_and_needs_a_lock_key", async (t) => {
        const { store } = await world(t);
        await poll(store, "anonymous");
        await store.castVote("p1", "b:browser", [0], asAda);
        await assert.rejects(
          store.removePublicVote("p1", "ada", asAda.lockKey),
          VotePrivacyError,
        );
        await poll(store, "public", { id: "p2" });
        await assert.rejects(
          store.removePublicVote("p2", "ada", 2n ** 63n),
          TypeError,
        );
        assert.equal((await store.results("p1")).voters, 1);
      });

      test("the_public_list_reads_names_live_in_list_key_order_and_pages", async (t) => {
        const w = await world(t);
        const { store } = w;
        await w.name("ada", "Ada");
        // A hidden profile still names its public votes (operator, 2026-11-15).
        await w.name("bo", "Bo", false);
        await poll(store);
        await poll(store, "public", { id: "other" });
        await store.castPublic("p1", "ada", [2, 0], asAda);
        await store.castPublic("p1", "bo", [1], asBo);
        await store.castPublic("p1", "cy", [0], asCy);
        await store.castPublic("other", "ada", [1], asAda);

        const all =
          (await store.listPublicVotes("p1", 20)) ?? assert.fail("listed");
        assert.equal(all.length, 3);
        for (const entry of all)
          assert.deepEqual(Object.keys(entry).sort(), [
            "choices",
            "listKey",
            "name",
          ]);
        assert.deepEqual(
          all.map((e) => e.listKey),
          all.map((e) => e.listKey).sort(),
        );
        assert.deepEqual(
          all.map((e) => [e.name, e.choices]).sort(),
          [
            ["Ada", [0, 2]],
            ["Bo", [1]],
            [null, [0]],
          ].sort(),
        );

        // Pages of one, then the end; limit + 1 rows say whether more follow.
        const first = await store.listPublicVotes("p1", 1);
        assert.deepEqual(first, all.slice(0, 2));
        const second = await store.listPublicVotes("p1", 1, all[0]?.listKey);
        assert.deepEqual(second, all.slice(1, 3));
        assert.deepEqual(
          await store.listPublicVotes("p1", 1, all[2]?.listKey),
          [],
        );

        // A rename relabels the vote, and a re-cast keeps its place.
        await w.name("ada", "Ada Lovelace");
        await store.castPublic("p1", "ada", [1], asAda);
        const renamed =
          (await store.listPublicVotes("p1", 20)) ?? assert.fail("listed");
        assert.deepEqual(
          renamed.map((e) => e.listKey),
          all.map((e) => e.listKey),
        );
        assert.ok(
          renamed.some(
            (e) => e.name === "Ada Lovelace" && e.choices.join() === "1",
          ),
        );
        await assert.rejects(
          store.listPublicVotes("p1", 20, "nope"),
          TypeError,
        );
      });

      test("the_public_list_is_undefined_for_anonymous_hidden_and_unknown_polls", async (t) => {
        const w = await world(t);
        const { store } = w;
        await poll(store, "anonymous", { id: "anon" });
        await store.castVote("anon", "b:browser", [0], asAda);
        assert.equal(await store.listPublicVotes("anon", 20), undefined);
        assert.equal(await store.listPublicVotes("missing", 20), undefined);
        // A listed poll with no votes is an empty page, not undefined.
        await poll(store, "public", { id: "empty" });
        assert.deepEqual(await store.listPublicVotes("empty", 20), []);
        if (!w.hide) return;
        await poll(store);
        await store.castPublic("p1", "ada", [0], asAda);
        await w.hide("p1");
        assert.equal(await store.listPublicVotes("p1", 20), undefined);
        await w.hide("empty");
        assert.equal(await store.listPublicVotes("empty", 20), undefined);
      });

      test("my_votes_holds_an_accounts_public_votes_beside_this_browsers", async (t) => {
        let now = AT;
        const { store } = await world(t, () => now);
        await poll(store, "anonymous", { id: "anon" });
        await poll(store, "public", { id: "pub" });
        await poll(store, "public", { id: "pub2" });
        await store.castVote("anon", "b:browser", [0]);
        now = later(1);
        await store.castPublic("pub", "ada", [1], asAda);
        now = later(2);
        await store.castPublic("pub2", "bo", [2], asBo);

        const ids = async (ballot: string | undefined, account?: string) =>
          (await store.voteHistory(ballot, 20, undefined, account)).map(
            (v) => v.pollId,
          );
        assert.deepEqual(await ids("b:browser"), ["anon"]);
        assert.deepEqual(await ids(undefined, "ada"), ["pub"]);
        assert.deepEqual(await ids("b:browser", "ada"), ["pub", "anon"]);
        assert.deepEqual(await ids(undefined), []);
        const [row] = await store.voteHistory(undefined, 20, undefined, "ada");
        assert.deepEqual(row, {
          pollId: "pub",
          castAt: later(1),
          ballot: [1],
          poll: { question: "Where next?", choices: ["Library"] },
        });
        // The same (cast_at, poll_id) cursor pages across both kinds.
        assert.deepEqual(
          (
            await store.voteHistory(
              "b:browser",
              20,
              {
                castAt: later(1),
                pollId: "pub",
              },
              "ada",
            )
          ).map((v) => v.pollId),
          ["anon"],
        );
      });

      test("the_name_verified_voter_is_reserved_in_any_case_or_spacing", async (t) => {
        const w = await world(t);
        for (const name of [
          "Verified voter",
          "VERIFIED   Voter",
          " verified  voter ",
          "Verified\u200D voter",
          "Verified \u200Cvoter",
        ])
          await assert.rejects(
            w.name("ada", name),
            /reserved|member_profile_name_not_reserved/,
          );
        await w.name("ada", "Verified voters");
      });
    },
  );
}
