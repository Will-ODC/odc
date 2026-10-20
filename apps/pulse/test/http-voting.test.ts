import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
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
import { createServer, type ServerDeps } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import {
  InMemorySuggestionStore,
  type SuggestionStore,
} from "../src/voting/suggestions.js";
import { ConfirmationKey } from "../src/voting/confirmation.js";
import { InMemoryVotingStore, UnknownPollError } from "../src/voting/store.js";
import type { Publication } from "../src/voting/poll.js";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";

const SECRET = "test-secret-that-is-long-enough";
/** The confirmation key every server here is given (ADR-0040). */
const CONFIRMATION_KEY = "a-confirmation-key-for-tests-0123456789";
const START = new Date("2026-08-09T12:00:00.000Z");

async function setup(
  pollCloses?: Date,
  suggestions?: SuggestionStore,
  {
    withoutConfirmationKey = false,
    ...overrides
  }: Partial<ServerDeps> & {
    /** Build the server as a test client embedding it might: with no key. */
    withoutConfirmationKey?: boolean;
  } = {},
) {
  const now = START;
  // A test that needs time to pass hands in its own clock; every part of the
  // server — stores, signer, routes — then reads that one.
  const clock = overrides.clock ?? (() => now);
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
    suggestions: suggestions ?? new InMemorySuggestionStore({ clock }),
    signer,
    clock,
    secureCookies: false,
    ...(withoutConfirmationKey
      ? {}
      : { confirmationKey: new ConfirmationKey(CONFIRMATION_KEY) }),
    ...overrides,
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

  /**
   * Sign in on one browser: the link is asked for anywhere, but the click is
   * made by `visit`, so the server sees that browser's ballot cookie and the
   * session lands in its jar — as when a person who voted then signs in.
   */
  async function signInOn(
    visit: ReturnType<typeof browser>,
    email: string,
  ): Promise<{ voterId: string }> {
    await app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email },
    });
    const link = mailer.lastTo(email.toLowerCase())?.body as string;
    const token = new URL(link).searchParams.get("token") as string;
    const redeemed = await visit({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token },
    });
    assert.equal(redeemed.statusCode, 200);
    return { voterId: redeemed.json().voter.id as string };
  }

  return { app, signIn, signInOn, browser, votes, voters, clock };
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

// Public attribution (ADR-0037). Polls are published through the in-memory
// creation store, which shares the voting store as its database, exactly as
// the Postgres creation store writes the poll row GET then reads.

const AUTHOR_ID = "author-account-5c1e";
const AUTHOR_EMAIL = "author-5c1e@student.ubc.ca";

async function publishAs(
  context: Awaited<ReturnType<typeof setup>>,
  attribution?: unknown,
) {
  const { voters, votes, clock } = context;
  if (!(await voters.byId(AUTHOR_ID)))
    await voters.create(
      {
        id: AUTHOR_ID,
        community: "ubc-students",
        assurance: "email",
        claimedAt: START,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: AUTHOR_EMAIL, verifiedAt: START },
    );
  const creation = new InMemoryCreationStore(voters, votes, {
    clock,
    communityLabels: new Map([["ubc-students", "UBC students"]]),
  });
  const { poll } = await creation.publish(
    { voterId: AUTHOR_ID, sessionGeneration: 0 },
    randomUUID(),
    {
      question: "Open a community garden?",
      choices: ["Yes", "No"],
      method: "single",
      purposeAcknowledgement: "community-purpose-v1",
      ...(attribution === undefined ? {} : { attribution }),
    },
  );
  return poll;
}

test("an_anonymous_authored_poll_reads_with_kind_alone_and_its_community", async () => {
  const context = await setup();
  const published = await publishAs(context);
  const reply = await context.app.inject({ url: `/api/polls/${published.id}` });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json(), {
    id: published.id,
    question: "Open a community garden?",
    choices: ["Yes", "No"],
    method: "single",
    next: [null, null],
    acceptsSuggestions: false,
    closesAt: new Date(START.getTime() + 604_800_000).toISOString(),
    open: true,
    community: { id: "ubc-students", label: "UBC students" },
    attribution: { kind: "anonymous" },
  });
  // The creation response and the public read are one representation.
  assert.deepEqual(reply.json(), published);
  // Nothing beside the kind: no account, no name, no handle.
  assert.deepEqual(Object.keys(reply.json().attribution), ["kind"]);
  assert.doesNotMatch(reply.body, new RegExp(`${AUTHOR_ID}|${AUTHOR_EMAIL}`));
});

test("a_named_authored_poll_reads_with_exactly_kind_and_name", async () => {
  const context = await setup();
  const published = await publishAs(context, { kind: "named", name: " Ada " });
  const reply = await context.app.inject({ url: `/api/polls/${published.id}` });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json().attribution, { kind: "named", name: "Ada" });
  assert.deepEqual(reply.json().community, {
    id: "ubc-students",
    label: "UBC students",
  });
  assert.deepEqual(reply.json(), published);
  assert.doesNotMatch(
    reply.body,
    new RegExp(`${AUTHOR_ID}|${AUTHOR_EMAIL}|created_?[bB]y|voterId|email`),
  );
});

test("a_seed_poll_has_no_community_or_attribution_key_at_all", async () => {
  const { app } = await setup();
  const reply = await app.inject({ url: "/api/polls/p1" });
  assert.equal(reply.statusCode, 200);
  // Absent, not null: no author is invented for a poll that never had one.
  assert.equal("community" in reply.json(), false);
  assert.equal("attribution" in reply.json(), false);
  assert.doesNotMatch(reply.body, /community|attribution/);
});

test("the_public_read_copies_only_the_allow_listed_attribution_fields", async () => {
  // Whatever a store hands back, the projection copies kind and name by
  // name. A stored attribution carrying anything else — here, the author's
  // account and address — never reaches the wire.
  const { app, votes } = await setup();
  await votes.createPoll(
    { id: "smuggled", question: "Q", choices: ["A", "B"], method: "single" },
    {
      community: {
        id: "ubc-students",
        label: "UBC students",
        createdBy: AUTHOR_ID,
      },
      attribution: {
        kind: "named",
        name: "Ada",
        voterId: AUTHOR_ID,
        email: AUTHOR_EMAIL,
      },
    } as unknown as Publication,
  );
  const reply = await app.inject({ url: "/api/polls/smuggled" });
  assert.deepEqual(reply.json().attribution, { kind: "named", name: "Ada" });
  assert.deepEqual(reply.json().community, {
    id: "ubc-students",
    label: "UBC students",
  });
  assert.doesNotMatch(reply.body, new RegExp(`${AUTHOR_ID}|${AUTHOR_EMAIL}`));
});

test("an_anonymous_attribution_never_carries_a_stored_name", async () => {
  const { app, votes } = await setup();
  await votes.createPoll(
    { id: "anon-name", question: "Q", choices: ["A", "B"], method: "single" },
    {
      community: { id: "pulse-general", label: "General" },
      attribution: { kind: "anonymous", name: "Ada" },
    } as unknown as Publication,
  );
  const reply = await app.inject({ url: "/api/polls/anon-name" });
  assert.deepEqual(reply.json().attribution, { kind: "anonymous" });
  assert.doesNotMatch(reply.body, /Ada/);
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

  const cast = await visit({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [2, 0] },
  });
  // The cast's own reply names the stored ballot, in the same order.
  assert.deepEqual(cast.json().ballot, [0, 2]);
  const after = await visit({ url: "/api/polls/p1/ballot" });
  // In the poll's order, not the order cast: a ballot says which choices, and
  // a database store can only give them back in position order.
  assert.deepEqual(after.json().ballot, [0, 2]);
});

test("old_format_ballot_cookie_still_reads_its_stored_ballot", async () => {
  const { app, votes } = await setup();
  const ballotId = "b:legacy-browser";
  await votes.castVote("p1", ballotId, [1]);
  const signer = new SessionSigner(SECRET, {
    ttlSeconds: 3600,
    clock: () => START,
  });
  const oldCookie = `pulse_ballot=${signer.sign(ballotId)}`;
  const reply = await app.inject({
    url: "/api/polls/p1/ballot",
    headers: { cookie: oldCookie },
  });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.json().ballot, [1]);
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

test("a_suggestion_store_without_the_poll_answers_404_rather_than_500", async () => {
  // The route read the poll a moment ago, but a store that keeps its own rows
  // checks again. If it has no such poll, that is a 404, as it is for a vote.
  const gone: SuggestionStore = {
    submit: async () => {
      throw new UnknownPollError("open-ended");
    },
    list: async () => [],
  };
  const { app } = await setup(undefined, gone);
  const reply = await app.inject({
    method: "POST",
    url: "/api/polls/open-ended/suggestions",
    payload: { text: "Charge the members" },
  });
  assert.equal(reply.statusCode, 404);
  assert.equal(reply.json().error, "not_found");
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

test("an_unplanned_fault_reaches_the_logger_it_was_given", async () => {
  // `createServer` hardcoded `logger: false`, so the `request.log.error` in the
  // catch-all handler wrote to nothing in every process that has ever served
  // this app. A 500 that leaves no trace is the one a deployment cannot debug.
  const logged: unknown[] = [];
  const sink = {
    error: (...args: unknown[]) => logged.push(args),
    fatal: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    child: () => sink,
  };
  const broken = {
    getPoll: () => Promise.reject(new Error("the store fell over")),
  } as unknown as ServerDeps["votes"];

  const h = await setup(undefined, undefined, {
    votes: broken,
    loggerInstance: sink as unknown as ServerDeps["loggerInstance"],
  });
  const reply = await h.app.inject({ method: "GET", url: "/api/polls/p1" });

  assert.equal(reply.statusCode, 500);
  // The sentence the person sees stays plain; the detail goes to the log.
  assert.deepEqual(reply.json(), {
    error: "server_error",
    message: "Something went wrong. Try again.",
  });
  assert.equal(logged.length, 1);
});

// Confirmed votes (ADR-0040, #352).

/** A clock a test moves by hand. */
function movableClock() {
  let now = START;
  return {
    clock: () => now,
    advance(seconds: number) {
      now = new Date(now.getTime() + seconds * 1000);
    },
  };
}

/** A ballot id factory that counts, so tie-breaks and lookups are readable. */
function countingBallots() {
  let n = 0;
  return () => `browser-${++n}`;
}

const castOn = (
  visit: (o: InjectOptions) => Promise<LightMyRequestResponse>,
  ballot: number[],
) => visit({ method: "POST", url: "/api/polls/p1/votes", payload: { ballot } });

test("results_carry_confirmed_numbers_and_they_are_zero_before_anyone_confirms", async () => {
  const { app, browser } = await setup();
  const empty = await app.inject({ url: "/api/polls/p1/results" });
  assert.equal(empty.json().confirmedVoters, 0);
  assert.deepEqual(
    empty
      .json()
      .choices.map((c: { confirmedCount: number; confirmedShare: number }) => [
        c.confirmedCount,
        c.confirmedShare,
      ]),
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  );

  // A vote with nobody signed in counts in the totals only.
  const cast = await castOn(browser(), [0]);
  assert.equal(cast.json().results.voters, 1);
  assert.equal(cast.json().results.confirmedVoters, 0);
});

test("a_vote_cast_while_signed_in_is_confirmed", async () => {
  const { browser, signInOn } = await setup();
  const visit = browser();
  await signInOn(visit, "ada@student.ubc.ca");

  const cast = await castOn(visit, [0, 2]);
  assert.equal(cast.json().status, "counted");
  const results = cast.json().results;
  assert.equal(results.voters, 1);
  assert.equal(results.confirmedVoters, 1);
  assert.deepEqual(
    results.choices.map((c: { confirmedCount: number }) => c.confirmedCount),
    [1, 0, 1],
  );
  assert.deepEqual(
    results.choices.map((c: { confirmedShare: number }) => c.confirmedShare),
    [100, 0, 100],
  );
});

test("a_vote_becomes_confirmed_when_its_browser_signs_in_afterwards", async () => {
  const { app, browser, signInOn } = await setup();
  const visit = browser();
  await castOn(visit, [1]);
  assert.equal(
    (await app.inject({ url: "/api/polls/p1/results" })).json().confirmedVoters,
    0,
  );

  await signInOn(visit, "ada@student.ubc.ca");
  const after = (await app.inject({ url: "/api/polls/p1/results" })).json();
  assert.equal(after.voters, 1);
  assert.equal(after.confirmedVoters, 1);
  assert.equal(after.choices[1].confirmedCount, 1);
});

test("signing_in_on_another_browser_does_not_confirm_this_ones_vote", async () => {
  // Only the ballot the clicking browser holds is confirmed.
  const { app, browser, signInOn } = await setup();
  await castOn(browser(), [1]);
  await signInOn(browser(), "ada@student.ubc.ca");
  assert.equal(
    (await app.inject({ url: "/api/polls/p1/results" })).json().confirmedVoters,
    0,
  );
});

test("one_person_on_two_browsers_counts_once_as_confirmed_and_their_latest_vote_is_the_one", async () => {
  const time = movableClock();
  const { app, browser, signInOn } = await setup(undefined, undefined, {
    clock: time.clock,
    newBallotId: countingBallots(),
  });
  const phone = browser();
  const laptop = browser();

  // The phone votes, then signs in: confirmed.
  await castOn(phone, [0]);
  await signInOn(phone, "ada@student.ubc.ca");

  // A minute later the same person votes differently on the laptop, signed in.
  time.advance(60);
  await signInOn(laptop, "ada@student.ubc.ca");
  const second = (await castOn(laptop, [1])).json().results;
  assert.equal(second.voters, 2);
  assert.equal(second.confirmedVoters, 1);
  assert.deepEqual(
    second.choices.map((c: { count: number }) => c.count),
    [1, 1, 0],
  );
  assert.deepEqual(
    second.choices.map((c: { confirmedCount: number }) => c.confirmedCount),
    [0, 1, 0],
  );

  // Then they change the phone's answer: it is their latest, so it is the
  // confirmed one now, and still one confirmed voter.
  time.advance(60);
  const third = (await castOn(phone, [2])).json();
  assert.equal(third.status, "changed");
  assert.equal(third.results.voters, 2);
  assert.equal(third.results.confirmedVoters, 1);
  assert.deepEqual(
    third.results.choices.map(
      (c: { confirmedCount: number }) => c.confirmedCount,
    ),
    [0, 0, 1],
  );

  const read = (await app.inject({ url: "/api/polls/p1/results" })).json();
  assert.deepEqual(read, third.results);
});

test("signing_out_does_not_remove_a_confirmation", async () => {
  const { app, browser, signInOn } = await setup();
  const visit = browser();
  await signInOn(visit, "ada@student.ubc.ca");
  await castOn(visit, [0]);

  const out = await visit({ method: "POST", url: "/api/sign-out" });
  assert.equal(out.statusCode, 200);

  const results = (await app.inject({ url: "/api/polls/p1/results" })).json();
  assert.equal(results.voters, 1);
  assert.equal(results.confirmedVoters, 1);
});

test("two_different_people_signed_in_are_two_confirmed_voters", async () => {
  const { browser, signInOn } = await setup();
  const ada = browser();
  const bo = browser();
  await signInOn(ada, "ada@student.ubc.ca");
  await signInOn(bo, "bo@example.org");
  await castOn(ada, [0]);
  const results = (await castOn(bo, [0])).json().results;
  assert.equal(results.voters, 2);
  assert.equal(results.confirmedVoters, 2);
  assert.equal(results.choices[0].confirmedCount, 2);
});

test("without_a_confirmation_key_no_vote_is_confirmed", async () => {
  // Only tests and embedding test clients leave the key out; `main.ts` refuses
  // to start without one. What it means is documented: confirmed reads 0.
  const { browser, signInOn } = await setup(undefined, undefined, {
    withoutConfirmationKey: true,
  });
  const visit = browser();
  await castOn(visit, [0]);
  await signInOn(visit, "ada@student.ubc.ca");
  const results = (await castOn(visit, [1])).json().results;
  assert.equal(results.voters, 1);
  assert.equal(results.confirmedVoters, 0);
});

test("the_code_the_account_id_and_the_key_never_reach_a_response_or_a_log_line", async () => {
  // ADR-0040 keeps the account id away from the answer and the code and key
  // inside the server. Every request of the flow is captured — status,
  // headers and body — and so is every line the logger writes, at its most
  // talkative level.
  const lines: string[] = [];
  const { app, browser, signInOn } = await setup(undefined, undefined, {
    logger: {
      level: "trace",
      stream: { write: (line: string) => void lines.push(line) },
    },
  });
  const replies: { url: string; text: string }[] = [];
  const raw = browser();
  const visit = async (options: InjectOptions) => {
    const reply = await raw(options);
    replies.push({
      url: String(options.url),
      text: JSON.stringify(reply.headers) + reply.body,
    });
    return reply;
  };

  await castOn(visit, [0]);
  const { voterId } = await signInOn(visit, "ada@student.ubc.ca");
  await castOn(visit, [1]);
  await visit({ url: "/api/polls/p1/ballot" });
  await visit({ url: "/api/polls/p1/results" });
  await visit({ url: "/api/me" });
  await visit({ method: "POST", url: "/api/sign-out" });
  await visit({ url: "/api/polls/p1/results" });

  const code = new ConfirmationKey(CONFIRMATION_KEY).codeFor(voterId, "p1");
  // Proof the capture is real: the flow was logged, and the vote confirmed.
  assert.ok(lines.length > 0, "the logger captured nothing");
  assert.equal(
    (await app.inject({ url: "/api/polls/p1/results" })).json().confirmedVoters,
    1,
  );

  for (const line of lines) {
    assert.ok(!line.includes(code), `a log line carries the code: ${line}`);
    assert.ok(!line.includes(CONFIRMATION_KEY), "a log line carries the key");
    assert.ok(
      !line.includes(voterId),
      `a log line carries the account id: ${line}`,
    );
  }
  for (const reply of replies) {
    assert.ok(
      !reply.text.includes(code),
      `${reply.url} answered with the code`,
    );
    assert.ok(
      !reply.text.includes(CONFIRMATION_KEY),
      `${reply.url} answered with the key`,
    );
  }
  // The account id is in exactly the answers that are about the account —
  // the sign-in click (its body and session cookie) and `/api/me` — and in
  // no answer about a poll, a ballot or a result.
  for (const reply of replies.filter((r) => r.url.startsWith("/api/polls/"))) {
    assert.ok(
      !reply.text.includes(voterId),
      `${reply.url} answered with the account id`,
    );
  }
});

test("a_session_copied_into_the_ballot_cookie_is_not_a_ballot_and_files_nothing_under_the_account", async () => {
  // A session cookie is validly signed by the same signer. Taken as a ballot,
  // it would file the vote under the account id — beside the answer, which
  // ADR-0040 promises never happens. It is ignored and a ballot is minted.
  const { app, signIn, votes } = await setup(undefined, undefined, {
    newBallotId: () => "fresh",
  });
  const session = await signIn("ada@student.ubc.ca");
  const me = await app.inject({ url: "/api/me", headers: { cookie: session } });
  const voterId = me.json().voter.id as string;
  const sessionValue = session.slice(session.indexOf("=") + 1);

  const cast = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie: `pulse_ballot=${sessionValue}` },
    payload: { ballot: [0] },
  });
  assert.equal(cast.statusCode, 200);
  assert.equal(cast.json().status, "counted");
  const minted = cast.cookies.find((c) => c.name === "pulse_ballot");
  assert.ok(minted, "a fresh ballot cookie is minted");
  assert.notEqual(minted.value, sessionValue);
  assert.equal(await votes.voteOf("p1", voterId), undefined);
  assert.deepEqual((await votes.voteOf("p1", "b:fresh"))?.choices, [0]);
});

test("signing_in_with_a_session_in_the_ballot_cookie_confirms_nothing", async () => {
  // The redeem side of the same guard: a vote somehow filed under the account
  // id (planted here directly) is not confirmed by presenting a session as
  // the ballot.
  const { app, signIn, votes, browser, signInOn } = await setup();
  const session = await signIn("ada@student.ubc.ca");
  const me = await app.inject({ url: "/api/me", headers: { cookie: session } });
  const voterId = me.json().voter.id as string;
  await votes.castVote("p1", voterId, [0]);

  const visit = browser();
  const sessionValue = session.slice(session.indexOf("=") + 1);
  await signInOn(
    (options) =>
      visit({
        ...options,
        headers: { ...options.headers, cookie: `pulse_ballot=${sessionValue}` },
      }),
    "ada@student.ubc.ca",
  );
  const results = (await app.inject({ url: "/api/polls/p1/results" })).json();
  assert.equal(results.voters, 1);
  assert.equal(results.confirmedVoters, 0);
});
