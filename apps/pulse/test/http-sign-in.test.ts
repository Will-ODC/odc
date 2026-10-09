import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DomainAllowlist,
  StaticDomainSource,
  type AllowedDomain,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer, MailSendError } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { createServer, type ServerDeps } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const SECRET = "test-secret-that-is-long-enough";
const START = new Date("2026-08-09T12:00:00.000Z");

async function setup(
  overrides: Partial<ServerDeps> = {},
  omitSecureFlag = false,
  rows: readonly AllowedDomain[] = [
    { community: "ubc-students", domain: "student.ubc.ca" },
  ],
) {
  let now = START;
  const clock = () => now;
  const mailer = new ConsoleMailer(() => {});
  const voters = new InMemoryVoterStore();
  const signer = new SessionSigner(SECRET, { ttlSeconds: 3600, clock });

  const claims = new ClaimService(
    {
      membership: new DomainAllowlist(new StaticDomainSource(rows)),
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
    votes: new InMemoryVotingStore(clock),
    suggestions: new InMemorySuggestionStore({ clock }),
    signer,
    clock,
    // Omitted in the one test that pins the safe default.
    ...(omitSecureFlag ? {} : { secureCookies: false }),
    ...overrides,
  });

  return {
    app,
    mailer,
    voters,
    signer,
    after(seconds: number) {
      now = new Date(now.getTime() + seconds * 1000);
    },
    tokenFor(email: string): string {
      const link = mailer.lastTo(email)?.body as string;
      return new URL(link).searchParams.get("token") as string;
    },
  };
}

test("asking_for_a_link_and_clicking_it_signs_you_in", async () => {
  const h = await setup();
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "Ada@student.ubc.ca" },
  });
  assert.equal(asked.statusCode, 200);
  assert.equal(h.mailer.sent.length, 1);

  const clicked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token: h.tokenFor("ada@student.ubc.ca") },
  });
  assert.equal(clicked.statusCode, 200);
  assert.equal(clicked.json().voter.email, "ada@student.ubc.ca");
  assert.equal(clicked.json().voter.community, "ubc-students");
  assert.equal(clicked.json().firstTime, true);
  assert.ok(clicked.cookies.find((c) => c.name === SESSION_COOKIE));
});

test("opening_the_link_does_not_spend_it_only_clicking_does", async () => {
  // A mail scanner following the URL must not burn the token before the person
  // gets there — they would be told it was already used, with no way to tell
  // that apart from actually reusing it.
  const h = await setup();
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  const token = h.tokenFor("ada@student.ubc.ca");

  for (let i = 0; i < 3; i++) {
    const looked = await h.app.inject({
      url: `/api/sign-in/redeem?token=${token}`,
    });
    assert.equal(looked.statusCode, 200);
    assert.equal(looked.json().status, "ready");
    assert.equal(looked.cookies.length, 0, "looking must not sign anyone in");
  }

  const clicked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token },
  });
  assert.equal(clicked.statusCode, 200);
  assert.equal(clicked.json().status, "signed_in");
});

test("a_link_can_only_be_clicked_once", async () => {
  const h = await setup();
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  const token = h.tokenFor("ada@student.ubc.ca");

  await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token },
  });
  const again = await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token },
  });
  assert.equal(again.statusCode, 410);
  assert.equal(again.json().error, "already_used");
  assert.equal(again.cookies.length, 0);

  // And looking at a spent link says the same thing rather than "ready".
  const looked = await h.app.inject({
    url: `/api/sign-in/redeem?token=${token}`,
  });
  assert.equal(looked.statusCode, 410);
});

test("an_expired_link_reads_the_same_way_from_both_verbs", async () => {
  // The two must never disagree. Without the expiry check in inspect(), GET
  // answers "ready" for a link POST refuses — a live-looking page whose button
  // fails. Every other test here uses a frozen clock, so nothing else expires
  // a link at the route layer.
  const h = await setup();
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  const token = h.tokenFor("ada@student.ubc.ca");

  h.after(14 * 60);
  assert.equal(
    (await h.app.inject({ url: `/api/sign-in/redeem?token=${token}` })).json()
      .status,
    "ready",
  );

  h.after(2 * 60);
  const looked = await h.app.inject({
    url: `/api/sign-in/redeem?token=${token}`,
  });
  assert.equal(looked.statusCode, 410);
  assert.equal(looked.json().error, "expired");

  const clicked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token },
  });
  assert.equal(clicked.statusCode, 410);
  assert.equal(clicked.json().error, "expired");
  assert.equal(clicked.cookies.length, 0);
});

test("an_invented_or_missing_token_signs_nobody_in", async () => {
  const h = await setup();
  assert.equal(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/sign-in/redeem",
        payload: { token: "made-up" },
      })
    ).statusCode,
    410,
  );
  assert.equal(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/sign-in/redeem",
        payload: {},
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await h.app.inject({ url: "/api/sign-in/redeem" })).statusCode,
    400,
  );
  assert.equal(
    (await h.app.inject({ url: "/api/sign-in/redeem?token=" })).statusCode,
    400,
  );
});

test("the_session_cookie_is_http_only_same_site_and_secure_by_default", async () => {
  // secure defaults to true; every other test passes secureCookies:false, so
  // without this case the safe default is unpinned.
  const h = await setup({}, true);
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  const redeemed = await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token: h.tokenFor("ada@student.ubc.ca") },
  });

  const cookie = redeemed.cookies.find((c) => c.name === SESSION_COOKIE);
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, "Lax");
  assert.equal(cookie?.secure, true);
  assert.equal(cookie?.path, "/");
});

test("sign_in_refuses_an_unusable_address", async () => {
  const h = await setup();
  const reply = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "nonsense" },
  });
  assert.equal(reply.statusCode, 400);
  assert.equal(reply.json().error, "invalid_email");
  assert.equal(h.mailer.sent.length, 0);
});

test("an_address_no_community_claims_gets_a_link_and_signs_in_with_community_null", async () => {
  // ADR-0030: this was a 403 `not_a_member`. Now the domain is a label, not a
  // gate — the address is sent a link like anyone's, and the voter it makes
  // has community null. Null and present, on the redeem and on /api/me alike,
  // so a client reads one shape whether or not someone has a community.
  const h = await setup();
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "someone@gmail.com" },
  });
  assert.equal(asked.statusCode, 200);
  assert.deepEqual(asked.json(), {
    status: "sent",
    message: "Check your email for a link to sign in.",
  });
  assert.equal(h.mailer.sent.length, 1);

  const token = h.tokenFor("someone@gmail.com");
  const looked = await h.app.inject({
    url: `/api/sign-in/redeem?token=${encodeURIComponent(token)}`,
  });
  assert.equal(looked.statusCode, 200);
  assert.equal(looked.json().status, "ready");

  const clicked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token },
  });
  assert.equal(clicked.statusCode, 200);
  const voter = clicked.json().voter;
  assert.equal(voter.email, "someone@gmail.com");
  assert.ok("community" in voter, "community was left out of the voter");
  assert.equal(voter.community, null);
  const cookie = clicked.cookies.find((c) => c.name === SESSION_COOKIE);
  assert.ok(cookie, "no session cookie was set");

  const me = await h.app.inject({
    url: "/api/me",
    headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` },
  });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), {
    voter: { id: voter.id, email: "someone@gmail.com", community: null },
  });
});

test("sign_in_needs_an_email_and_a_real_answer_about_updates", async () => {
  const h = await setup();
  for (const payload of [{}, { email: 42 }]) {
    const reply = await h.app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload,
    });
    assert.equal(reply.statusCode, 400);
  }

  // "true" or 1 must not be read as "no". This is the proof-of-action opt-in,
  // and a wrong answer here is invisible to everyone.
  for (const proofEmailsOptIn of ["true", 1, null]) {
    const reply = await h.app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email: "ada@student.ubc.ca", proofEmailsOptIn },
    });
    assert.equal(
      reply.statusCode,
      400,
      `accepted proofEmailsOptIn: ${String(proofEmailsOptIn)}`,
    );
  }
  assert.equal(h.mailer.sent.length, 0);
});

test("the_opt_in_is_carried_through_to_the_voter", async () => {
  const h = await setup();
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca", proofEmailsOptIn: true },
  });
  await h.app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token: h.tokenFor("ada@student.ubc.ca") },
  });

  const voter = await h.voters.byCredential("email", "ada@student.ubc.ca");
  assert.equal(voter?.proofEmailsOptIn, true);
});

test("sign_in_is_rate_limited_per_client", async () => {
  // Without this, anyone can loop <anything>@student.ubc.ca and have pulse mail
  // every address at a member domain.
  const h = await setup({
    signInRateLimit: { max: 2, timeWindow: "1 minute" },
  });
  for (let i = 0; i < 2; i++) {
    const reply = await h.app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email: `person${i}@student.ubc.ca` },
    });
    assert.equal(reply.statusCode, 200);
  }

  const blocked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "person3@student.ubc.ca" },
  });
  assert.equal(blocked.statusCode, 429);
  assert.equal(h.mailer.sent.length, 2);
  // The body, not just the status. This 429 means NOTHING was sent, and it
  // must not wear the slug that means a link is on its way — a client that
  // cannot tell them apart tells this person to go and check their email.
  assert.deepEqual(blocked.json(), {
    error: "too_many_requests",
    message: "Too many tries just now. Try again a little later.",
  });
});

test("trusts_only_the_private_proxy_peer_and_one_forwarded_hop", async () => {
  const h = await setup({ trustProxy: 1 });
  h.app.get("/test/ip", (request) => ({ ip: request.ip }));

  const fromProxy = await h.app.inject({
    method: "GET",
    url: "/test/ip",
    remoteAddress: "172.20.0.4",
    headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.20" },
  });
  assert.deepEqual(fromProxy.json(), { ip: "198.51.100.20" });

  const direct = await h.app.inject({
    method: "GET",
    url: "/test/ip",
    remoteAddress: "198.51.100.30",
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  assert.deepEqual(direct.json(), { ip: "198.51.100.30" });
});

test("forged_forwarded_prefixes_share_the_observed_clients_sign_in_limit", async () => {
  const h = await setup({
    trustProxy: 1,
    signInRateLimit: { max: 2, timeWindow: "1 minute" },
  });

  for (let i = 0; i < 3; i++) {
    const reply = await h.app.inject({
      method: "POST",
      url: "/api/sign-in",
      remoteAddress: "172.20.0.4",
      headers: {
        "x-forwarded-for": `203.0.113.${i + 1}, 198.51.100.20`,
      },
      payload: { email: `person${i}@student.ubc.ca` },
    });
    assert.equal(reply.statusCode, i === 2 ? 429 : 200);
  }

  assert.equal(h.mailer.sent.length, 2);
});

test("a_second_link_for_one_address_says_a_link_is_already_coming", async () => {
  // The opposite fact to the test above, and the reason the two cannot share a
  // slug: here a link really is on its way, so the client is right to show the
  // same screen a first request shows.
  const h = await setup();
  for (let i = 0; i < 3; i++) {
    const reply = await h.app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email: "ada@student.ubc.ca" },
    });
    assert.equal(reply.statusCode, 200);
  }

  const capped = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });
  assert.equal(capped.statusCode, 429);
  assert.deepEqual(capped.json(), {
    error: "link_already_sent",
    message: "A link is already on its way. Check your email.",
  });
});

test("a_body_that_is_not_json_is_refused_in_the_same_shape", async () => {
  // Fastify signals this by throwing with a status. The error handler must keep
  // the status and still answer in { error, message } rather than 500.
  const h = await setup();
  const reply = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });

  assert.equal(reply.statusCode, 400);
  assert.equal(reply.json().error, "bad_request");
  assert.equal(typeof reply.json().message, "string");
});

test("an_unknown_path_answers_in_the_same_shape_as_everything_else", async () => {
  const h = await setup();
  const missing = await h.app.inject({ url: "/api/nothing-here" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, "not_found");
  assert.equal(typeof missing.json().message, "string");
});

test("a_mail_provider_that_is_down_answers_503_and_never_says_check_your_email", async () => {
  // ADR-0027: a provider outage is a refusal the person can retry, not a fault.
  // A 500 would be logged and alerted on as a bug in pulse, and — worse — the
  // screen would have to guess; a 503 says the email did not go.
  const failing = new ClaimService({
    membership: new DomainAllowlist(
      new StaticDomainSource([
        { community: "ubc-students", domain: "student.ubc.ca" },
      ]),
    ),
    voters: new InMemoryVoterStore(),
    claims: new InMemoryClaimStore(),
    mailer: {
      sendClaimLink: () => {
        throw new MailSendError("the mail provider could not be reached");
      },
      sendProofOfAction: async () => undefined,
    },
    linkFor: (token) => `https://pulse.test/claim?token=${token}`,
  });

  const h = await setup({ claims: failing });
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "ada@student.ubc.ca" },
  });

  assert.equal(asked.statusCode, 503);
  assert.equal(asked.json().error, "send_failed");
  // The sentence is the whole point of the status: it must not tell someone to
  // go and look for mail that was never sent.
  assert.doesNotMatch(String(asked.json().message), /check your email/i);
  assert.match(String(asked.json().message), /try again/i);
});

/** One domain serving two communities, as ADR-0023 lets it. */
const SHARED: readonly AllowedDomain[] = [
  { community: "ubc-staff", domain: "ubc.ca" },
  { community: "ubc-alumni", domain: "ubc.ca" },
  { community: "ubc-students", domain: "student.ubc.ca" },
];

function signIn(
  h: Awaited<ReturnType<typeof setup>>,
  payload: Record<string, unknown>,
) {
  return h.app.inject({ method: "POST", url: "/api/sign-in", payload });
}

test("an_address_proving_several_communities_is_asked_which_and_nothing_is_mailed", async () => {
  const h = await setup({}, false, SHARED);
  const asked = await signIn(h, { email: "ada@ubc.ca" });

  assert.equal(asked.statusCode, 422);
  assert.deepEqual(asked.json(), {
    error: "choose_community",
    message: "That address can sign in to more than one community. Choose one.",
    communities: [{ id: "ubc-alumni" }, { id: "ubc-staff" }],
  });
  assert.equal(h.mailer.sent.length, 0);
});

test("the_picked_community_is_the_one_the_voter_signs_in_with", async () => {
  // Each choice in turn, so a server that ignored the pick and took the first
  // (or the alphabetical) row fails on one of them.
  for (const pick of ["ubc-staff", "ubc-alumni"]) {
    const h = await setup({}, false, SHARED);
    const asked = await signIn(h, { email: "ada@ubc.ca", community: pick });
    assert.equal(asked.statusCode, 200, pick);
    assert.equal(asked.json().status, "sent");
    assert.equal(h.mailer.sent.length, 1);

    const clicked = await h.app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token: h.tokenFor("ada@ubc.ca") },
    });
    assert.equal(clicked.statusCode, 200);
    assert.equal(clicked.json().voter.community, pick);
    const cookie = clicked.cookies.find((c) => c.name === SESSION_COOKIE);
    assert.ok(cookie, "no session cookie was set");

    const me = await h.app.inject({
      url: "/api/me",
      headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` },
    });
    assert.equal(me.json().voter.community, pick);
  }
});

test("a_pick_the_address_does_not_prove_is_a_400_and_nothing_is_mailed", async () => {
  for (const [email, pick] of [
    ["ada@ubc.ca", "ubc-students"], // another domain's community
    ["ada@ubc.ca", "made-up"], // no such community
    ["ada@student.ubc.ca", "ubc-staff"], // one match, and it is not this
    ["someone@gmail.com", "ubc-staff"], // no match at all
  ] as const) {
    const h = await setup({}, false, SHARED);
    const reply = await signIn(h, { email, community: pick });
    assert.equal(reply.statusCode, 400, `${email} ${pick}`);
    assert.deepEqual(reply.json(), {
      error: "unknown_community",
      message: "That address cannot sign in to that community.",
    });
    assert.equal(h.mailer.sent.length, 0);
  }
});

test("a_community_that_is_not_a_string_is_a_bad_request", async () => {
  for (const community of [null, 3, ["ubc-staff"], { id: "ubc-staff" }]) {
    const h = await setup({}, false, SHARED);
    const reply = await signIn(h, { email: "ada@ubc.ca", community });
    assert.equal(reply.statusCode, 400);
    assert.equal(reply.json().error, "bad_request");
    assert.equal(h.mailer.sent.length, 0);
  }
});

test("one_match_or_none_answers_exactly_as_before_and_naming_the_one_is_harmless", async () => {
  const h = await setup({}, false, SHARED);
  for (const payload of [
    { email: "ada@student.ubc.ca" },
    { email: "sam@student.ubc.ca", community: "ubc-students" },
    { email: "someone@gmail.com" },
  ]) {
    const reply = await signIn(h, payload);
    assert.equal(reply.statusCode, 200, payload.email);
    assert.deepEqual(reply.json(), {
      status: "sent",
      message: "Check your email for a link to sign in.",
    });
  }
  assert.equal(h.mailer.sent.length, 3);
});

test("picking_is_still_throttled_per_address", async () => {
  // The cap is per address, not per (address, community): picking the other
  // community is not a fourth link.
  const h = await setup({}, false, SHARED);
  for (const pick of ["ubc-staff", "ubc-alumni", "ubc-staff"]) {
    const reply = await signIn(h, { email: "ada@ubc.ca", community: pick });
    assert.equal(reply.statusCode, 200);
  }
  const capped = await signIn(h, {
    email: "ada@ubc.ca",
    community: "ubc-alumni",
  });
  assert.equal(capped.statusCode, 429);
  assert.equal(capped.json().error, "link_already_sent");
  assert.equal(h.mailer.sent.length, 3);
});

test("being_asked_to_choose_counts_against_the_per_client_rate_limit", async () => {
  // A refusal that sends nothing is still a request: an address-guessing loop
  // must not be free just because every guess comes back as a question.
  const h = await setup(
    { signInRateLimit: { max: 2, timeWindow: "1 minute" } },
    false,
    SHARED,
  );
  assert.equal((await signIn(h, { email: "ada@ubc.ca" })).statusCode, 422);
  assert.equal((await signIn(h, { email: "sam@ubc.ca" })).statusCode, 422);
  const blocked = await signIn(h, { email: "kim@ubc.ca" });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error, "too_many_requests");
});
