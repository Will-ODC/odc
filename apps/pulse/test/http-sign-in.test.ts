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
import { createServer, type ServerDeps } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const SECRET = "test-secret-that-is-long-enough";
const START = new Date("2026-08-09T12:00:00.000Z");

async function setup(
  overrides: Partial<ServerDeps> = {},
  omitSecureFlag = false,
) {
  let now = START;
  const clock = () => now;
  const mailer = new ConsoleMailer(() => {});
  const voters = new InMemoryVoterStore();
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

test("sign_in_refuses_an_unusable_address_and_a_domain_with_no_community", async () => {
  const h = await setup();
  assert.equal(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/sign-in",
        payload: { email: "nonsense" },
      })
    ).statusCode,
    400,
  );

  const outsider = await h.app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "someone@gmail.com" },
  });
  assert.equal(outsider.statusCode, 403);
  assert.match(outsider.json().message, /gmail\.com/);
  assert.equal(h.mailer.sent.length, 0);
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

  const voter = await h.voters.byEmail("ada@student.ubc.ca");
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
