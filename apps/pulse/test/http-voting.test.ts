import assert from "node:assert/strict";
import { test } from "node:test";
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

  return { app, signIn };
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
  const { app, signIn } = await setup();
  const cookie = await signIn("ada@student.ubc.ca");

  const first = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
    payload: { ballot: [0] },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().status, "counted");
  assert.deepEqual(first.json().ballot, [0]);
  assert.equal(first.json().results.voters, 1);
  assert.equal(first.json().results.choices[0].count, 1);

  const second = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
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

test("the_ballot_route_reports_the_voters_current_ballot_or_null", async () => {
  const { app, signIn } = await setup();
  const cookie = await signIn("ada@student.ubc.ca");

  const before = await app.inject({
    url: "/api/polls/p1/ballot",
    headers: { cookie },
  });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().ballot, null);

  await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    headers: { cookie },
    payload: { ballot: [2, 0] },
  });
  const after = await app.inject({
    url: "/api/polls/p1/ballot",
    headers: { cookie },
  });
  assert.deepEqual(after.json().ballot, [2, 0]);
});

test("the_ballot_and_votes_routes_are_401_when_signed_out", async () => {
  const { app } = await setup();
  const ballot = await app.inject({ url: "/api/polls/p1/ballot" });
  assert.equal(ballot.statusCode, 401);
  assert.equal(ballot.json().error, "signed_out");

  const cast = await app.inject({
    method: "POST",
    url: "/api/polls/p1/votes",
    payload: { ballot: [0] },
  });
  assert.equal(cast.statusCode, 401);
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
