import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
  type VoterStore,
} from "../src/identity/store.js";
import { createServer } from "../src/http/server.js";
import { SessionSigner } from "../src/http/session.js";
import {
  InMemoryMemberProfileStore,
  memoryDisplayNames,
} from "../src/profiles/memory-store.js";
import { PostgresMemberProfileStore } from "../src/profiles/pg-store.js";
import type { MemberProfileStore } from "../src/profiles/store.js";
import { ConfirmationKey } from "../src/voting/confirmation.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemoryVotingStore, type VotingStore } from "../src/voting/store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { databaseSkip, migratedSchema } from "./support/database.js";
import { sendOriginLikeABrowser } from "./support/origin.js";

// ADR-0048 step 2: the routes in front of the public-vote stores, run over
// both stores. Public-vote polls are made through the voting store here,
// because creation still refuses the setting (decision 14).

const SECRET = "test-secret-that-is-long-enough-x";
const CONFIRMATION_KEY = "a-confirmation-key-for-tests-0123456789";
const WEB_ORIGIN = "https://pulse.test";
const START = new Date("2026-11-19T12:00:00.000Z");
const HOUR = 3_600_000;
const SESSION = "pulse_session";
const BALLOT = "pulse_ballot";
const PRIVATE = "private, no-store";
const NO_STORE = "no-store";

interface Stores {
  voters: VoterStore;
  votes: VotingStore;
  profiles: MemberProfileStore;
  /** Postgres only: the in-memory store has no hidden polls. */
  hide?: (pollId: string) => Promise<void>;
}

const kinds: [string, string | false, typeof memoryStores][] = [
  ["memory", false, memoryStores],
  ["postgres", databaseSkip, postgresStores],
];

async function memoryStores(
  _t: TestContext,
  clock: () => Date,
): Promise<Stores> {
  const voters = new InMemoryVoterStore();
  return {
    voters,
    votes: new InMemoryVotingStore(clock, {
      displayNameOf: memoryDisplayNames(voters),
    }),
    profiles: new InMemoryMemberProfileStore(voters, { clock }),
  };
}

async function postgresStores(
  t: TestContext,
  clock: () => Date,
): Promise<Stores> {
  const pool = await migratedSchema(t);
  return {
    voters: new PostgresVoterStore(pool),
    votes: new PostgresVotingStore(pool, clock),
    profiles: new PostgresMemberProfileStore(pool, { clock }),
    async hide(pollId) {
      await pool.query("update polls set hidden = true where id = $1", [
        pollId,
      ]);
    },
  };
}

async function world(
  t: TestContext,
  stores: typeof memoryStores,
  {
    withoutKey = false,
    publicVotesRateLimit,
  }: {
    withoutKey?: boolean;
    publicVotesRateLimit?: { max: number; timeWindow: number };
  } = {},
) {
  let now = START;
  const clock = () => now;
  const { voters, votes, profiles, hide } = await stores(t, clock);
  // A day, not an hour: close() jumps the clock past the one-hour poll, and
  // a session must outlive that for the closed-poll removal tests.
  const signer = new SessionSigner(SECRET, { ttlSeconds: 86_400, clock });
  const claims = new ClaimService(
    {
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `https://pulse.test/claim?token=${token}`,
    },
    { clock },
  );
  const app = sendOriginLikeABrowser(
    await createServer({
      claims,
      voters,
      votes,
      profiles,
      suggestions: new InMemorySuggestionStore({ clock }),
      signer,
      clock,
      secureCookies: false,
      webOrigin: WEB_ORIGIN,
      ...(withoutKey
        ? {}
        : { confirmationKey: new ConfirmationKey(CONFIRMATION_KEY) }),
      ...(publicVotesRateLimit ? { publicVotesRateLimit } : {}),
    }),
    WEB_ORIGIN,
  );
  t.after(() => app.close());

  const closesAt = new Date(START.getTime() + HOUR);
  await votes.createPoll({
    id: "pub",
    question: "Which park?",
    choices: ["North", "South"],
    method: "single",
    votePrivacy: "public",
    closesAt,
  });
  await votes.createPoll({
    id: "anon",
    question: "Which rink?",
    choices: ["East", "West"],
    method: "single",
    votePrivacy: "anonymous",
    closesAt,
  });

  /** A signed-in account's session cookie, as a redeemed link would set. */
  async function account(id: string): Promise<string> {
    await voters.create(
      {
        id,
        community: null,
        assurance: "email",
        claimedAt: START,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${id}@example.test`, verifiedAt: START },
    );
    return `${SESSION}=${signer.sign(id, 0)}`;
  }

  const cast = (pollId: string, body: object, cookie?: string) => {
    const options: InjectOptions = {
      method: "POST",
      url: `/api/polls/${pollId}/votes`,
      payload: body,
      headers: cookie === undefined ? {} : { cookie },
    };
    return app.inject(options);
  };
  const get = (url: string, cookie?: string) =>
    app.inject({ url, headers: cookie === undefined ? {} : { cookie } });
  const voterCount = async (pollId: string) =>
    (await votes.results(pollId)).voters;

  /** Give an account a profile name; `visible: false` hides the profile. */
  async function name(id: string, displayName: string, visible = true) {
    await profiles.save(
      { voterId: id, sessionGeneration: 0 },
      { displayName, bio: "", visible },
    );
  }
  const remove = (pollId: string, cookie?: string, { noOrigin = false } = {}) =>
    app.inject({
      method: "DELETE",
      url: `/api/polls/${pollId}/votes/mine`,
      headers: {
        ...(cookie === undefined ? {} : { cookie }),
        ...(noOrigin ? { origin: undefined } : {}),
      },
    });

  return {
    app,
    votes,
    profiles,
    hide,
    account,
    name,
    cast,
    get,
    remove,
    voterCount,
    close: () => {
      now = new Date(closesAt.getTime() + 1);
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

function noCookieSet(reply: LightMyRequestResponse) {
  assert.deepEqual(
    reply.cookies.map((c) => c.name),
    [],
  );
}

function privateToCookies(reply: LightMyRequestResponse) {
  assert.equal(reply.headers["cache-control"], PRIVATE);
  assert.equal(reply.headers.vary, "Cookie");
}

for (const [kind, skip, stores] of kinds) {
  describe(`${kind}: public-vote routes`, { skip }, () => {
    it("reads_name_the_setting_on_poll_and_results", async (t) => {
      const w = await world(t, stores);
      for (const [id, privacy] of [
        ["pub", "public"],
        ["anon", "anonymous"],
      ]) {
        assert.equal(
          (await w.get(`/api/polls/${id}`)).json().votePrivacy,
          privacy,
        );
        const results = await w.get(`/api/polls/${id}/results`);
        assert.equal(results.json().votePrivacy, privacy);
        assert.equal(results.json().voters, 0);
      }
    });

    it("a_signed_in_public_cast_counts_then_changes_from_any_browser", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      const first = await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().status, "counted");
      assert.deepEqual(first.json().ballot, [1]);
      assert.equal(first.json().results.votePrivacy, "public");
      assert.equal(first.json().results.voters, 1);
      // Always confirmed: a public vote is cast with the person's code.
      assert.equal(first.json().results.confirmedVoters, 1);
      noCookieSet(first);

      // The same session from a browser with a stray ballot cookie: still
      // the account's one vote, found by account and not by the cookie.
      const again = await w.cast(
        "pub",
        { ballot: [0], publicVote: true },
        `${ada}; ${BALLOT}=whatever`,
      );
      assert.equal(again.json().status, "changed");
      assert.deepEqual(again.json().ballot, [0]);
      assert.equal(again.json().results.voters, 1);
      noCookieSet(again);
    });

    it("a_public_poll_cast_without_the_acknowledgement_is_409_before_sign_in_and_writes_nothing", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      for (const cookie of [undefined, ada]) {
        const reply = await w.cast("pub", { ballot: [0] }, cookie);
        assert.equal(reply.statusCode, 409);
        assert.equal(reply.json().error, "vote_privacy_mismatch");
        assert.match(reply.json().message, /Reload/);
        noCookieSet(reply);
      }
      assert.equal(await w.voterCount("pub"), 0);
    });

    it("an_anonymous_poll_cast_with_the_acknowledgement_is_409_and_mints_no_ballot", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      for (const cookie of [undefined, ada]) {
        const reply = await w.cast(
          "anon",
          { ballot: [0], publicVote: true },
          cookie,
        );
        assert.equal(reply.statusCode, 409);
        assert.equal(reply.json().error, "vote_privacy_mismatch");
        noCookieSet(reply);
      }
      assert.equal(await w.voterCount("anon"), 0);
    });

    it("a_publicVote_other_than_true_is_a_400_before_the_poll_is_read", async (t) => {
      const w = await world(t, stores);
      for (const publicVote of [false, "true", 1, null]) {
        for (const pollId of ["pub", "anon", "missing"]) {
          const reply = await w.cast(pollId, { ballot: [0], publicVote });
          assert.equal(reply.statusCode, 400, `${pollId} ${publicVote}`);
          assert.equal(reply.json().error, "bad_request");
          noCookieSet(reply);
        }
      }
    });

    it("an_unknown_poll_is_404_and_mints_no_ballot", async (t) => {
      const w = await world(t, stores);
      for (const body of [{ ballot: [0] }, { ballot: [0], publicVote: true }]) {
        const reply = await w.cast("missing", body);
        assert.equal(reply.statusCode, 404);
        assert.equal(reply.json().error, "not_found");
        noCookieSet(reply);
      }
    });

    it("a_signed_out_public_cast_is_401_sign_in_required_and_writes_nothing", async (t) => {
      const w = await world(t, stores);
      const reply = await w.cast("pub", { ballot: [0], publicVote: true });
      assert.equal(reply.statusCode, 401);
      assert.equal(reply.json().error, "sign_in_required");
      assert.match(reply.json().message, /profile name/);
      noCookieSet(reply);
      assert.equal(await w.voterCount("pub"), 0);
    });

    it("without_a_confirmation_key_a_public_cast_is_503_after_the_mismatch_check", async (t) => {
      const w = await world(t, stores, { withoutKey: true });
      const ada = await w.account("ada");
      const refused = await w.cast(
        "pub",
        { ballot: [0], publicVote: true },
        ada,
      );
      assert.equal(refused.statusCode, 503);
      assert.equal(refused.json().error, "public_votes_unavailable");
      noCookieSet(refused);
      const mismatch = await w.cast("pub", { ballot: [0] }, ada);
      assert.equal(mismatch.statusCode, 409);
      assert.equal(await w.voterCount("pub"), 0);
      // Anonymous polls still take votes without the key.
      const anonymous = await w.cast("anon", { ballot: [0] });
      assert.equal(anonymous.json().status, "counted");
    });

    it("a_closed_public_poll_answers_closed_before_sign_in_and_bad_ballot_after", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      const bad = await w.cast("pub", { ballot: [7], publicVote: true }, ada);
      assert.equal(bad.statusCode, 400);
      assert.equal(bad.json().error, "bad_ballot");
      // Bad ballot comes after sign-in: signed out it is the 401.
      const signedOut = await w.cast("pub", { ballot: [7], publicVote: true });
      assert.equal(signedOut.statusCode, 401);

      w.close();
      const closed = await w.cast("pub", { ballot: [0], publicVote: true });
      assert.equal(closed.statusCode, 200);
      assert.deepEqual(closed.json(), { status: "closed" });
      noCookieSet(closed);
      assert.equal(await w.voterCount("pub"), 0);
    });

    it("an_anonymous_cast_is_unchanged_and_its_results_say_anonymous", async (t) => {
      const w = await world(t, stores);
      const reply = await w.cast("anon", { ballot: [1] });
      assert.equal(reply.json().status, "counted");
      assert.equal(reply.json().results.votePrivacy, "anonymous");
      assert.deepEqual(
        reply.cookies.map((c) => c.name),
        [BALLOT],
      );
    });

    it("the_public_ballot_reads_the_session_and_never_the_ballot_cookie", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      const signedOut = await w.get("/api/polls/pub/ballot");
      assert.deepEqual(signedOut.json(), { ballot: null });
      noCookieSet(signedOut);
      privateToCookies(signedOut);

      assert.deepEqual((await w.get("/api/polls/pub/ballot", ada)).json(), {
        ballot: null,
      });
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      const mine = await w.get("/api/polls/pub/ballot", ada);
      assert.deepEqual(mine.json(), { ballot: [1] });
      noCookieSet(mine);
      privateToCookies(mine);

      // Another account sees its own (none), not Ada's.
      const bo = await w.account("bo");
      assert.deepEqual((await w.get("/api/polls/pub/ballot", bo)).json(), {
        ballot: null,
      });
    });

    it("every_ballot_answer_is_private_to_cookies_including_404_and_anonymous", async (t) => {
      const w = await world(t, stores);
      const anonymous = await w.get("/api/polls/anon/ballot");
      privateToCookies(anonymous);
      assert.deepEqual(
        anonymous.cookies.map((c) => c.name),
        [BALLOT],
      );
      const missing = await w.get("/api/polls/missing/ballot");
      assert.equal(missing.statusCode, 404);
      privateToCookies(missing);
    });

    it("my_votes_lists_the_accounts_public_votes_with_a_session_alone", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);

      const signedIn = await w.get("/api/my-votes", ada);
      assert.equal(signedIn.statusCode, 200);
      privateToCookies(signedIn);
      noCookieSet(signedIn);
      assert.deepEqual(
        signedIn
          .json()
          .votes.map((v: { pollId: string; ballot: number[] }) => [
            v.pollId,
            v.ballot,
          ]),
        [["pub", [1]]],
      );

      const signedOut = await w.get("/api/my-votes");
      assert.deepEqual(signedOut.json(), { votes: [], nextCursor: null });
      privateToCookies(signedOut);

      const bad = await w.get("/api/my-votes?limit=0", ada);
      assert.equal(bad.statusCode, 400);
      privateToCookies(bad);
    });

    it("my_votes_lists_both_ballots_newest_first_with_their_poll_privacy", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      const anonymous = await w.cast("anon", { ballot: [0] });
      const ballot = anonymous.cookies.find((c) => c.name === BALLOT)!;
      // The clock is fixed, so the two tie on time and order by poll id.
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      const both = await w.get(
        "/api/my-votes",
        `${ada}; ${BALLOT}=${ballot.value}`,
      );
      assert.deepEqual(
        both
          .json()
          .votes.map((v: { pollId: string; votePrivacy: string }) => [
            v.pollId,
            v.votePrivacy,
          ]),
        [
          ["pub", "public"],
          ["anon", "anonymous"],
        ],
      );
      // The cookie alone shows only the anonymous ballot.
      const cookieOnly = await w.get(
        "/api/my-votes",
        `${BALLOT}=${ballot.value}`,
      );
      assert.deepEqual(
        cookieOnly.json().votes.map((v: { pollId: string }) => v.pollId),
        ["anon"],
      );
    });

    it("a_profile_named_verified_voter_is_400_reserved_name_and_not_saved", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      for (const displayName of [
        "Verified voter",
        "  verified   VOTER ",
        "Verified\u200D voter",
        "Verified \u200Cvoter",
      ]) {
        const reply = await w.app.inject({
          method: "PUT",
          url: "/api/me/profile",
          headers: { cookie: ada },
          payload: {
            ownerAccountId: "ada",
            displayName,
            bio: "",
            visible: true,
          },
        });
        assert.equal(reply.statusCode, 400);
        assert.equal(reply.json().error, "reserved_name");
        assert.equal(reply.headers["cache-control"], "no-store");
      }
      assert.equal(
        await w.profiles.byOwner({ voterId: "ada", sessionGeneration: 0 }),
        undefined,
      );
      const fine = await w.app.inject({
        method: "PUT",
        url: "/api/me/profile",
        headers: { cookie: ada },
        payload: {
          ownerAccountId: "ada",
          displayName: "Verified voters club",
          bio: "",
          visible: true,
        },
      });
      assert.equal(fine.statusCode, 200, fine.body);
    });

    it("the_public_list_shows_live_names_with_null_for_no_profile_and_nothing_else", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      const bo = await w.account("bo");
      const cy = await w.account("cy");
      await w.name("ada", "Ada");
      // A hidden profile still names its public votes (decision 8).
      await w.name("cy", "Cy", false);
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      await w.cast("pub", { ballot: [0], publicVote: true }, bo);
      await w.cast("pub", { ballot: [0], publicVote: true }, cy);

      const reply = await w.get("/api/polls/pub/public-votes", ada);
      assert.equal(reply.statusCode, 200, reply.body);
      assert.equal(reply.headers["cache-control"], NO_STORE);
      noCookieSet(reply);
      const body = reply.json();
      assert.deepEqual(Object.keys(body).sort(), ["items", "nextCursor"]);
      assert.equal(body.nextCursor, null);
      for (const item of body.items)
        assert.deepEqual(Object.keys(item).sort(), ["choices", "name"]);
      assert.deepEqual(
        body.items
          .map((i: { name: string | null; choices: number[] }) => [
            i.name,
            i.choices,
          ])
          .sort(),
        [
          ["Ada", [1]],
          ["Cy", [0]],
          [null, [0]],
        ].sort(),
      );
      // Never the account, address, list key or cast time.
      const keys = (await w.votes.listPublicVotes("pub", 20))!.map(
        (e) => e.listKey,
      );
      for (const secret of ["ada", "bo", "example.test", ...keys])
        assert.ok(!reply.body.includes(`"${secret}`), secret);
      assert.ok(!reply.body.includes("2026-"));

      // Names are read live: a rename relabels the vote.
      await w.name("ada", "Ada Lovelace");
      const renamed = await w.get("/api/polls/pub/public-votes");
      assert.ok(
        renamed
          .json()
          .items.some((i: { name: string }) => i.name === "Ada Lovelace"),
      );
    });

    it("the_public_list_pages_with_sealed_cursors_that_never_repeat", async (t) => {
      const w = await world(t, stores);
      for (const id of ["ada", "bo", "cy"]) {
        const cookie = await w.account(id);
        await w.name(id, id.toUpperCase());
        await w.cast("pub", { ballot: [0], publicVote: true }, cookie);
      }
      const seen: string[] = [];
      let url = "/api/polls/pub/public-votes?limit=1";
      for (let page = 0; page < 3; page++) {
        const reply = await w.get(url);
        assert.equal(reply.statusCode, 200, reply.body);
        const body = reply.json();
        assert.equal(body.items.length, 1);
        seen.push(body.items[0].name);
        if (page < 2) {
          assert.equal(typeof body.nextCursor, "string");
          // Opaque: the cursor carries neither the poll nor a list key in the
          // clear, and the same position seals differently each time.
          const decoded = Buffer.from(body.nextCursor, "base64url").toString(
            "latin1",
          );
          assert.ok(!decoded.includes("pub"));
          const again = (await w.get(url)).json().nextCursor;
          assert.notEqual(again, body.nextCursor);
          url = `/api/polls/pub/public-votes?limit=1&cursor=${body.nextCursor}`;
        } else {
          assert.equal(body.nextCursor, null);
        }
      }
      assert.deepEqual([...seen].sort(), ["ADA", "BO", "CY"]);
    });

    it("a_tampered_foreign_or_malformed_list_query_is_400", async (t) => {
      const w = await world(t, stores);
      await w.votes.createPoll({
        id: "pub2",
        question: "Which pool?",
        choices: ["A", "B"],
        method: "single",
        votePrivacy: "public",
      });
      for (const id of ["ada", "bo"]) {
        const cookie = await w.account(id);
        await w.cast("pub", { ballot: [0], publicVote: true }, cookie);
        await w.cast("pub2", { ballot: [0], publicVote: true }, cookie);
      }
      const cursorOf = async (pollId: string) =>
        (await w.get(`/api/polls/${pollId}/public-votes?limit=1`)).json()
          .nextCursor as string;
      const good = await cursorOf("pub");
      const bytes = Buffer.from(good, "base64url");
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
      const tampered = bytes.toString("base64url");
      const foreign = await cursorOf("pub2");
      for (const query of [
        `cursor=${tampered}`,
        `cursor=${foreign}`,
        "cursor=AAAA",
        "cursor=not*base64",
        "limit=0",
        "limit=51",
        "limit=abc",
        "page=2",
      ]) {
        const reply = await w.get(`/api/polls/pub/public-votes?${query}`);
        assert.equal(reply.statusCode, 400, query);
        assert.deepEqual(
          reply.json(),
          {
            error: "bad_request",
            message: "Start again from the first page of votes.",
          },
          query,
        );
        assert.equal(reply.headers["cache-control"], NO_STORE, query);
      }
      assert.equal(
        (await w.get(`/api/polls/pub/public-votes?cursor=${good}`)).statusCode,
        200,
      );
    });

    it("the_public_list_is_404_unknown_409_anonymous_and_404_hidden", async (t) => {
      const w = await world(t, stores);
      const missing = await w.get("/api/polls/missing/public-votes");
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().error, "not_found");
      assert.equal(missing.headers["cache-control"], NO_STORE);

      const anonymous = await w.get("/api/polls/anon/public-votes");
      assert.equal(anonymous.statusCode, 409);
      assert.equal(anonymous.json().error, "anonymous_poll");
      assert.equal(anonymous.headers["cache-control"], NO_STORE);
      noCookieSet(anonymous);

      // A listed poll with no votes is an empty page.
      assert.deepEqual((await w.get("/api/polls/pub/public-votes")).json(), {
        items: [],
        nextCursor: null,
      });
      if (!w.hide) return;
      const ada = await w.account("ada");
      await w.cast("pub", { ballot: [0], publicVote: true }, ada);
      await w.hide("pub");
      const hidden = await w.get("/api/polls/pub/public-votes");
      assert.equal(hidden.statusCode, 404);
      assert.equal(hidden.json().error, "not_found");
    });

    it("a_closed_public_poll_stays_listed", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      w.close();
      const reply = await w.get("/api/polls/pub/public-votes");
      assert.deepEqual(reply.json(), {
        items: [{ name: null, choices: [1] }],
        nextCursor: null,
      });
    });

    it("without_a_confirmation_key_the_public_list_is_503", async (t) => {
      const w = await world(t, stores, { withoutKey: true });
      const reply = await w.get("/api/polls/pub/public-votes");
      assert.equal(reply.statusCode, 503);
      assert.equal(reply.json().error, "public_votes_unavailable");
      assert.equal(reply.headers["cache-control"], NO_STORE);
      // 409 still comes first for an anonymous poll.
      assert.equal(
        (await w.get("/api/polls/anon/public-votes")).statusCode,
        409,
      );
    });

    it("the_public_list_is_limited_per_address_in_one_bucket", async (t) => {
      const w = await world(t, stores, {
        publicVotesRateLimit: { max: 2, timeWindow: 60_000 },
      });
      const from = (remoteAddress: string, pollId = "pub") =>
        w.app.inject({
          url: `/api/polls/${pollId}/public-votes`,
          remoteAddress,
        });
      assert.equal((await from("10.0.0.1")).statusCode, 200);
      // Every answer counts, a 404 included, so probing costs the same.
      assert.equal((await from("10.0.0.1", "missing")).statusCode, 404);
      const over = await from("10.0.0.1");
      assert.equal(over.statusCode, 429);
      assert.equal(over.json().error, "too_many_requests");
      assert.equal(over.headers["cache-control"], NO_STORE);
      assert.equal(over.headers["retry-after"], "60");
      // Another address has its own bucket; other routes are not counted.
      assert.equal((await from("10.0.0.2")).statusCode, 200);
      assert.equal((await w.get("/api/polls/pub")).statusCode, 200);
      w.advance(60_000);
      assert.equal((await from("10.0.0.1")).statusCode, 200);
    });

    it("removing_ones_public_vote_takes_the_answer_and_the_name_and_may_vote_again", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      const bo = await w.account("bo");
      await w.name("ada", "Ada");
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      await w.cast("pub", { ballot: [0], publicVote: true }, bo);

      const removed = await w.remove("pub", ada);
      assert.equal(removed.statusCode, 200, removed.body);
      noCookieSet(removed);
      assert.equal(removed.json().status, "removed");
      assert.equal(removed.json().results.voters, 1);
      assert.equal(removed.json().results.confirmedVoters, 1);
      assert.equal(removed.json().results.votePrivacy, "public");
      assert.deepEqual(
        removed.json().results.choices.map((c: { count: number }) => c.count),
        [1, 0],
      );
      assert.deepEqual(
        (await w.get("/api/polls/pub/public-votes")).json().items,
        [{ name: null, choices: [0] }],
      );
      assert.deepEqual((await w.get("/api/polls/pub/ballot", ada)).json(), {
        ballot: null,
      });

      // Repeating it is harmless.
      const again = await w.remove("pub", ada);
      assert.equal(again.json().status, "none");
      assert.equal(again.json().results.voters, 1);

      const back = await w.cast("pub", { ballot: [0], publicVote: true }, ada);
      assert.equal(back.json().status, "counted");
      assert.equal(await w.voterCount("pub"), 2);
    });

    it("a_closed_poll_keeps_its_public_votes", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      w.close();
      const reply = await w.remove("pub", ada);
      assert.equal(reply.statusCode, 200);
      assert.deepEqual(reply.json(), { status: "closed" });
      assert.equal(await w.voterCount("pub"), 1);
      const none = await w.remove("pub", await w.account("bo"));
      assert.deepEqual(none.json(), { status: "closed" });
    });

    it("removal_refuses_in_order_403_404_409_503_401_and_writes_nothing", async (t) => {
      const w = await world(t, stores);
      const ada = await w.account("ada");
      await w.cast("pub", { ballot: [1], publicVote: true }, ada);
      const anonymous = await w.cast("anon", { ballot: [0] });
      const ballot = anonymous.cookies.find((c) => c.name === BALLOT)!;

      const foreign = await w.remove("pub", ada, { noOrigin: true });
      assert.equal(foreign.statusCode, 403);
      assert.equal(foreign.json().error, "origin_not_allowed");

      const missing = await w.remove("missing", ada);
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().error, "not_found");

      // An anonymous poll's ballot is never removed, cookie or session.
      for (const cookie of [
        `${ada}; ${BALLOT}=${ballot.value}`,
        `${BALLOT}=${ballot.value}`,
        undefined,
      ]) {
        const refused = await w.remove("anon", cookie);
        assert.equal(refused.statusCode, 409);
        assert.deepEqual(refused.json(), {
          error: "anonymous_poll",
          message:
            "This poll's votes are anonymous and cannot be removed. You can still change your answer.",
        });
        noCookieSet(refused);
      }
      assert.equal(await w.voterCount("anon"), 1);

      const signedOut = await w.remove("pub");
      assert.equal(signedOut.statusCode, 401);
      assert.equal(signedOut.json().error, "sign_in_required");
      // A ballot cookie is not a session.
      const cookieOnly = await w.remove("pub", `${BALLOT}=${ballot.value}`);
      assert.equal(cookieOnly.statusCode, 401);
      noCookieSet(cookieOnly);
      assert.equal(await w.voterCount("pub"), 1);
    });

    it("without_a_confirmation_key_removal_is_503_before_sign_in", async (t) => {
      const w = await world(t, stores, { withoutKey: true });
      for (const cookie of [undefined, await w.account("ada")]) {
        const reply = await w.remove("pub", cookie);
        assert.equal(reply.statusCode, 503);
        assert.equal(reply.json().error, "public_votes_unavailable");
      }
      assert.equal((await w.remove("anon")).statusCode, 409);
    });
  });
}
