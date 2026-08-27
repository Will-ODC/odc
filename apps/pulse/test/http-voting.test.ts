import assert from "node:assert/strict";
import { test } from "node:test";
import type { InjectOptions } from "fastify";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { createServer } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const SECRET = "test-secret-that-is-long-enough";
const START = new Date("2026-08-09T12:00:00.000Z");

async function setup(pollCloses?: Date) {
  const now = START;
  const clock = () => now;
  const mailer = new ConsoleMailer(() => {});
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore(clock);
  const signer = new SessionSigner(SECRET, { ttlSeconds: 3600, clock });

  const claims = new ClaimService(
    {
      membership: new DomainAllowlist(
        new StaticDomainSource([
          { community: "ubc-students", domain: "student.ubc.ca" },
        ]),
      ),
      voters,
      claims: new InMemoryClaimStore(),
      mailer,
      linkFor: (token) => `https://pulse.test/claim?token=${token}`,
    },
    { clock },
  );

  const app = await createServer({
    claims,
    voters,
    votes,
    suggestions: new InMemorySuggestionStore({ clock }),
    signer,
    clock,
    secureCookies: false,
  });

  await votes.createPoll({
    id: "p1",
    question: "Where next?",
    choices: ["Park", "Library", "Rink"],
    method: "approval",
    ...(pollCloses ? { closesAt: pollCloses } : {}),
  });

  // Sign a voter in through the real flow and keep the session cookie.
  async function signIn(email: string): Promise<string> {
    await app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email },
    });
    const link = mailer.lastTo(email.toLowerCase())?.body as string;
    const token = new URL(link).searchParams.get("token") as string;
    const redeemed = await app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token },
    });
    const cookie = redeemed.cookies.find((c) => c.name === SESSION_COOKIE);
    return `${SESSION_COOKIE}=${cookie?.value as string}`;
  }

  /**
   * One browser: it keeps whatever cookies the server sets and presents them
   * again, which is the whole of what makes two requests the same voter.
   * Votes are filed under the ballot cookie, so a test that forgets to carry it
   * is a test with a new person on every request.
   */
  function browser() {
    const jar = new Map<string, string>();
    return async (options: InjectOptions) => {
      // Joined, not overridden: a test that presents a session cookie of its
      // own must keep it, or it would silently be testing the jar alone.
      const presented = (options.headers as Record<string, string> | undefined)
        ?.cookie;
      const cookie = [presented, ...[...jar].map(([k, v]) => `${k}=${v}`)]
        .filter((one) => one !== undefined && one !== "")
        .join("; ");
      const reply = await app.inject({
        ...options,
        headers: {
          ...options.headers,
          ...(cookie === "" ? {} : { cookie }),
        },
      });
      for (const set of reply.cookies) jar.set(set.name, set.value);
      return reply;
    };
  }

  // A second poll that takes options of its own, and the graph edge to it.
  await votes.createPoll({
    id: "open-ended",
    question: "How else?",
    choices: ["This", "That"],
    method: "single",
    acceptsSuggestions: true,
    ...(pollCloses ? { closesAt: pollCloses } : {}),
  });

  return { app, signIn, browser, votes };
}

test("reads_a_poll_in_the_clients_wire_shape_without_a_session", async () => {
  const closesAt = new Date("2026-08-10T12:00:00.000Z");
  const { app } = await setup(closesAt);
  const reply = await app.inject({ url: "/api/polls/p1" });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json(), {
    id: "p1",
    question: "Where next?",
    choices: ["Park", "Library", "Rink"],
    method: "approval",
    next: [null, null, null],
    acceptsSuggestions: false,
    closesAt: "2026-08-10T12:00:00.000Z",
    open: true,
  });
});

test("a_poll_with_no_closing_time_serialises_closesAt_as_null", async () => {
  const { app } = await setup();
  const reply = await app.inject({ url: "/api/polls/p1" });
  assert.equal(reply.json().closesAt, null);
  assert.equal(reply.json().open, true);
});

test("an_unknown_poll_is_a_404_in_the_standard_shape", async () => {
  const { app } = await setup();
  const reply = await app.inject({ url: "/api/polls/nope" });
  assert.equal(reply.statusCode, 404);
  assert.equal(reply.json().error, "not_found");
  assert.equal(typeof reply.json().message, "string");
});

test("results_read_without_a_session_and_carry_voters_and_method", async () => {
  const { app, signIn } = await setup();
  const cookie = await signIn("ada@student.ubc.ca");
  await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
    payload: { ballot: [0, 1] },
  });

  const reply = await app.inject({ url: "/api/polls/p1/results" });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().voters, 1);
  assert.equal(reply.json().method, "approval");
});

test("casting_returns_counted_then_changed_with_the_fresh_results", async () => {
  const { browser } = await setup();
  const visit = browser();

  const first = await visit({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [0] },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, "counted");
  assert.deepEqual(first.json().ballot, [0]);
  assert.equal(first.json().results.voters, 1);
  assert.equal(first.json().results.choices[0].count, 1);

  const second = await visit({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [1, 2] },
  });
  assert.equal(second.json().status, "changed");
  assert.deepEqual(second.json().ballot, [1, 2]);
  // Still one voter, and the old choice no longer counts.
  assert.equal(second.json().results.voters, 1);
  assert.equal(second.json().results.choices[0].count, 0);
  assert.equal(second.json().results.choices[1].count, 1);
  assert.equal(second.json().results.choices[2].count, 1);
});

test("the_ballot_route_reports_this_browsers_current_ballot_or_null", async () => {
  const { browser } = await setup();
  const visit = browser();

  const before = await visit({ url: "/api/polls/p1/ballot" });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().ballot, null);

  await visit({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [2, 0] },
  });
  const after = await visit({ url: "/api/polls/p1/ballot" });
  assert.deepEqual(after.json().ballot, [2, 0]);
});

test("a_vote_counts_with_no_session_at_all", async () => {
  const { browser } = await setup();
  const reply = await browser()({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [0] },
  });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().status, "counted");
  assert.equal(reply.json().results.voters, 1);
});

test("two_browsers_are_two_voters_and_one_browser_is_one", async () => {
  const { app, browser } = await setup();
  const ada = browser();
  const bo = browser();

  await ada({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [0] },
  });
  await ada({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [1] },
  });
  await bo({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [1] },
  });

  const results = await app.inject({ url: "/api/polls/p1/results" });
  assert.equal(results.json().voters, 2);
});

test("signing_in_does_not_change_which_ballot_is_yours", async () => {
  // The vote is filed under the ballot cookie, not the address. Signing in is
  // how a person is verified; it is never how their vote is found.
  const { signIn, browser } = await setup();
  const visit = browser();
  await visit({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [0] },
  });

  const session = await signIn("ada@student.ubc.ca");
  const after = await visit({
    url: "/api/polls/p1/ballot",
    headers: { cookie: session },
  });
  assert.deepEqual(after.json().ballot, [0]);
});

test("a_malformed_ballot_body_is_a_400", async () => {
  const { app, signIn } = await setup();
  const cookie = await signIn("ada@student.ubc.ca");
  for (const payload of [
    {},
    { ballot: 0 },
    { ballot: ["a"] },
    { ballot: [1.5] },
  ]) {
    const reply = await app.inject({
      method: "POST",
      url: "/api/polls/p1/votes",
      headers: { cookie },
      payload,
    });
    assert.equal(reply.statusCode, 400, JSON.stringify(payload));
    assert.equal(reply.json().error, "bad_request");
  }
});

test("a_ballot_that_fails_validation_is_a_400_with_a_plain_message", async () => {
  const { app, signIn } = await setup();
  const cookie = await signIn("ada@student.ubc.ca");

  const empty = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
    payload: { ballot: [] },
  });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error, "bad_ballot");
  assert.equal(typeof empty.json().message, "string");

  const outOfRange = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
    payload: { ballot: [9] },
  });
  assert.equal(outOfRange.statusCode, 400);
  assert.equal(outOfRange.json().error, "bad_ballot");
});

test("casting_on_a_closed_poll_returns_closed", async () => {
  const closesAt = new Date("2026-08-09T11:00:00.000Z"); // past at START
  const { app, signIn } = await setup(closesAt);
  const cookie = await signIn("ada@student.ubc.ca");

  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
    payload: { ballot: [0] },
  });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json(), { status: "closed" });
});

test("casting_on_an_unknown_poll_is_a_404", async () => {
  const { app, signIn } = await setup();
  const cookie = await signIn("ada@student.ubc.ca");
  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/nope/votes",
    headers: { cookie },
    payload: { ballot: [0] },
  });
  assert.equal(reply.statusCode, 404);
  assert.equal(reply.json().error, "not_found");
});

test("a_poll_names_the_question_each_answer_opens", async () => {
  const { app, votes } = await setup();
  await votes.createPoll({
    id: "forked",
    question: "Which way?",
    choices: ["Left", "Right"],
    method: "single",
    next: ["open-ended", null],
  });

  const reply = await app.inject({ url: "/api/polls/forked" });
  assert.deepEqual(reply.json().next, ["open-ended", null]);
});

test("adding_an_option_reports_it_as_new_and_lists_it", async () => {
  const { app, browser } = await setup();
  const visit = browser();

  const added = await visit({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "Charge the members" },
  });
  assert.equal(added.statusCode, 200);
  assert.equal(added.json().status, "added");
  assert.equal(added.json().suggestion.count, 1);

  const listed = await app.inject({ url: "/api/polls/open-ended/suggestions" });
  assert.deepEqual(
    listed.json().suggestions.map((s: { text: string }) => s.text),
    ["Charge the members"],
  );
});

test("saying_what_someone_already_said_is_seconded_not_refused", async () => {
  const { browser } = await setup();
  const visit = browser();
  await visit({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "Charge the members" },
  });

  const again = await visit({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "we could charge members" },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().status, "seconded");
  assert.equal(again.json().suggestion.count, 2);
  assert.equal(again.json().suggestion.text, "Charge the members");
});

test("saying_what_the_poll_already_offers_points_at_that_answer", async () => {
  const { app, browser, votes } = await setup();
  await votes.createPoll({
    id: "funding",
    question: "How do we pay for it?",
    choices: ["Members chip in", "One-off donations", "Grants"],
    method: "single",
    acceptsSuggestions: true,
  });

  const reply = await browser()({
    method: "POST",
    url: "/api/polls/funding/suggestions",
    payload: { text: "Grants" },
  });
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.json().status, "on_ballot");
  assert.deepEqual(reply.json().choice, { index: 2, label: "Grants" });

  // Nothing was added: the answer is already there to be voted for.
  const listed = await app.inject({ url: "/api/polls/funding/suggestions" });
  assert.deepEqual(listed.json().suggestions, []);
});

test("a_suggestion_never_says_who_made_it", async () => {
  const { app, browser } = await setup();
  await browser()({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "Charge the members" },
  });
  const listed = await app.inject({ url: "/api/polls/open-ended/suggestions" });
  assert.deepEqual(Object.keys(listed.json().suggestions[0]).sort(), [
    "count",
    "id",
    "text",
  ]);
});

test("a_poll_with_a_fixed_set_of_answers_refuses_additions", async () => {
  const { app } = await setup();
  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/p1/suggestions",
    payload: { text: "Charge the members" },
  });
  assert.equal(reply.statusCode, 409);
  assert.equal(reply.json().error, "no_suggestions");
});

test("an_empty_suggestion_is_a_400_with_a_sentence_to_show", async () => {
  const { app } = await setup();
  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "  " },
  });
  assert.equal(reply.statusCode, 400);
  assert.equal(reply.json().error, "bad_suggestion");
  assert.equal(typeof reply.json().message, "string");
});

test("suggestions_on_an_unknown_poll_are_a_404", async () => {
  const { app } = await setup();
  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/nope/suggestions",
    payload: { text: "Charge the members" },
  });
  assert.equal(reply.statusCode, 404);
});

test("a_closed_poll_takes_no_more_options", async () => {
  const { app } = await setup(new Date("2026-08-08T12:00:00.000Z"));
  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "Charge the members" },
  });
  assert.equal(reply.statusCode, 409);
  assert.equal(reply.json().error, "closed");
});
