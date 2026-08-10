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
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import { createServer } from "../src/http/server.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const SECRET = "test-secret-that-is-long-enough";

async function setup() {
  const mailer = new ConsoleMailer(() => {});
  const voters = new InMemoryVoterStore();
  const voting = new InMemoryVotingStore();
  const signer = new SessionSigner(SECRET);

  const claims = new ClaimService({
    membership: new DomainAllowlist(
      new StaticDomainSource([
        { community: "ubc-students", domain: "student.ubc.ca" },
      ]),
    ),
    voters,
    claims: new InMemoryClaimStore(),
    mailer,
    linkFor: (token) => `https://pulse.test/claim?token=${token}`,
  });

  await voting.createPoll({
    id: "p1",
    question: "Where next?",
    choices: ["Park", "Library"],
  });
  const app = createServer({
    claims,
    voters,
    voting,
    signer,
    secureCookies: false,
  });

  return {
    app,
    mailer,
    voting,
    /** Run the whole sign-in flow and return the session cookie it sets. */
    async signIn(email: string): Promise<string> {
      await app.inject({
        method: "POST",
        url: "/api/sign-in",
        payload: { email },
      });
      const link = mailer.lastTo(email.trim().toLowerCase())?.body as string;
      const token = new URL(link).searchParams.get("token");
      const redeemed = await app.inject({
        url: `/api/sign-in/redeem?token=${token}`,
      });
      const cookie = redeemed.cookies.find((c) => c.name === SESSION_COOKIE);
      assert.ok(cookie, "no session cookie was set");
      return `${SESSION_COOKIE}=${cookie.value}`;
    },
  };
}

test("sign_in_sends_a_link_and_redeeming_it_sets_a_session", async () => {
  const h = await setup();
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  assert.equal(asked.statusCode, 200);
  assert.equal(h.mailer.sent.length, 1);

  const cookie = await h.signIn("ada@student.ubc.ca");
  const me = await h.app.inject({ url: "/api/me", headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().voter.email, "ada@student.ubc.ca");
  assert.equal(me.json().voter.community, "ubc-students");
});

test("the_session_cookie_is_http_only_and_same_site", async () => {
  // The cookie is the whole of someone's identity here; script access to it
  // would be the one thing worth stealing.
  const h = await setup();
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  const link = h.mailer.lastTo("ada@student.ubc.ca")?.body as string;
  const token = new URL(link).searchParams.get("token");
  const redeemed = await h.app.inject({
    url: `/api/sign-in/redeem?token=${token}`,
  });

  const cookie = redeemed.cookies.find((c) => c.name === SESSION_COOKIE);
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, "Lax");
  assert.equal(cookie?.path, "/");
});

test("a_forged_or_tampered_cookie_is_not_signed_in", async () => {
  const h = await setup();
  const real = await h.signIn("ada@student.ubc.ca");
  const voterId = real.split("=")[1]?.split(".")[0];

  for (const forged of [
    `${SESSION_COOKIE}=${voterId}.not-a-signature`,
    `${SESSION_COOKIE}=${voterId}`,
    `${SESSION_COOKIE}=someone-else.${real.split(".")[1]}`,
    `${SESSION_COOKIE}=`,
  ]) {
    const me = await h.app.inject({
      url: "/api/me",
      headers: { cookie: forged },
    });
    assert.equal(me.statusCode, 401, `accepted a forged cookie: ${forged}`);
  }
});

test("a_cookie_signed_with_another_secret_is_not_signed_in", async () => {
  const h = await setup();
  const other = new SessionSigner("a-completely-different-secret");
  const me = await h.app.inject({
    url: "/api/me",
    headers: { cookie: `${SESSION_COOKIE}=${other.sign("some-voter-id")}` },
  });
  assert.equal(me.statusCode, 401);
});

test("sign_in_rejects_an_unusable_address_and_a_domain_with_no_community", async () => {
  const h = await setup();
  const bad = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "nonsense" },
  });
  assert.equal(bad.statusCode, 400);

  const outsider = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "someone@gmail.com" },
  });
  assert.equal(outsider.statusCode, 403);
  assert.match(outsider.json().message, /gmail\.com/);
  assert.equal(h.mailer.sent.length, 0);
});

test("sign_in_needs_an_email_field_at_all", async () => {
  const h = await setup();
  const empty = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: {},
  });
  assert.equal(empty.statusCode, 400);

  const wrongType = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: 42 },
  });
  assert.equal(wrongType.statusCode, 400);
});

test("a_used_expired_or_invented_link_says_so_and_signs_nobody_in", async () => {
  const h = await setup();
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  const link = h.mailer.lastTo("ada@student.ubc.ca")?.body as string;
  const token = new URL(link).searchParams.get("token");

  assert.equal(
    (await h.app.inject({ url: `/api/sign-in/redeem?token=${token}` }))
      .statusCode,
    200,
  );
  const again = await h.app.inject({
    url: `/api/sign-in/redeem?token=${token}`,
  });
  assert.equal(again.statusCode, 410);
  assert.equal(again.json().error, "already_used");

  const invented = await h.app.inject({
    url: "/api/sign-in/redeem?token=made-up",
  });
  assert.equal(invented.statusCode, 410);
  assert.equal(invented.cookies.length, 0);

  const missing = await h.app.inject({ url: "/api/sign-in/redeem" });
  assert.equal(missing.statusCode, 400);
});

test("voting_requires_being_signed_in", async () => {
  const h = await setup();
  const anonymous = await h.app.inject({
    method: "POST",
    url: "/api/polls/p1/vote",
    payload: { choice: 0 },
  });
  assert.equal(anonymous.statusCode, 401);
  assert.equal((await h.voting.results("p1")).total, 0);
});

test("a_signed_in_voter_votes_once_and_gets_the_results_back", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");

  const voted = await h.app.inject({
    method: "POST",
    url: "/api/polls/p1/vote",
    headers: { cookie },
    payload: { choice: 1 },
  });
  assert.equal(voted.statusCode, 200);
  assert.equal(voted.json().results.total, 1);
  assert.equal(voted.json().results.choices[1].count, 1);

  const twice = await h.app.inject({
    method: "POST",
    url: "/api/polls/p1/vote",
    headers: { cookie },
    payload: { choice: 0 },
  });
  assert.equal(twice.statusCode, 409);
  assert.equal(twice.json().yourChoice, 1);
  assert.equal((await h.voting.results("p1")).total, 1);
});

test("a_choice_that_is_not_one_of_the_choices_is_refused", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");

  for (const choice of [2, -1, 1.5, "1", null]) {
    const reply = await h.app.inject({
      method: "POST",
      url: "/api/polls/p1/vote",
      headers: { cookie },
      payload: { choice },
    });
    assert.equal(reply.statusCode, 400, `accepted choice ${String(choice)}`);
  }
  assert.equal((await h.voting.results("p1")).total, 0);
});

test("reading_a_poll_shows_your_own_choice_and_nobody_elses", async () => {
  const h = await setup();
  const ada = await h.signIn("ada@student.ubc.ca");
  const sam = await h.signIn("sam@student.ubc.ca");
  await h.app.inject({
    method: "POST",
    url: "/api/polls/p1/vote",
    headers: { cookie: ada },
    payload: { choice: 0 },
  });

  const adaSees = await h.app.inject({
    url: "/api/polls/p1",
    headers: { cookie: ada },
  });
  assert.equal(adaSees.json().yourChoice, 0);

  const samSees = await h.app.inject({
    url: "/api/polls/p1",
    headers: { cookie: sam },
  });
  assert.equal(samSees.json().yourChoice, null);

  const anonymous = await h.app.inject({ url: "/api/polls/p1" });
  assert.equal(anonymous.json().yourChoice, null);
  assert.equal(anonymous.json().poll.question, "Where next?");
});

test("an_unknown_poll_is_a_404_everywhere_it_can_be_named", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");

  assert.equal(
    (await h.app.inject({ url: "/api/polls/nope" })).statusCode,
    404,
  );
  assert.equal(
    (await h.app.inject({ url: "/api/polls/nope/results" })).statusCode,
    404,
  );
  const voted = await h.app.inject({
    method: "POST",
    url: "/api/polls/nope/vote",
    headers: { cookie },
    payload: { choice: 0 },
  });
  assert.equal(voted.statusCode, 404);
});

test("signing_out_ends_the_session", async () => {
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");
  const out = await h.app.inject({
    method: "POST",
    url: "/api/sign-out",
    headers: { cookie },
  });

  const cleared = out.cookies.find((c) => c.name === SESSION_COOKIE);
  assert.equal(cleared?.value, "");
  assert.equal((await h.app.inject({ url: "/api/me" })).statusCode, 401);
});

test("no_response_mentions_hashes_chains_or_how_anything_is_counted", async () => {
  // The product rule, enforced rather than trusted: pulse shows results and
  // never explains the machinery.
  const h = await setup();
  const cookie = await h.signIn("ada@student.ubc.ca");
  const bodies = [
    (await h.app.inject({ url: "/api/me", headers: { cookie } })).body,
    (await h.app.inject({ url: "/api/polls/p1" })).body,
    (await h.app.inject({ url: "/api/polls/p1/results" })).body,
    (
      await h.app.inject({
        method: "POST",
        url: "/api/polls/p1/vote",
        headers: { cookie },
        payload: { choice: 0 },
      })
    ).body,
  ].join(" ");

  for (const word of ["hash", "chain", "tally", "tabulat", "ledger", "verif"]) {
    assert.equal(
      bodies.toLowerCase().includes(word),
      false,
      `response mentions "${word}"`,
    );
  }
});
