import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDevServer, devConfig } from "../src/dev-server.js";

const origin = "http://localhost:5173";

test("local account gets a normal session, creation access and repeat sign-in", async (t) => {
  const { app } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  const signIn = () =>
    app.inject({
      method: "POST",
      url: "/api/dev/sign-in",
      headers: { origin },
      payload: { email: " DEMO@example.test ", proofEmailsOptIn: true },
    });
  const signedIn = await signIn();
  assert.equal(signedIn.statusCode, 200);
  const data = signedIn.json();
  assert.equal(data.status, "signed_in");
  assert.equal(data.voter.email, "demo@example.test");
  assert.equal(data.voter.community, "demo-community");
  assert.equal(data.firstTime, true);
  assert.equal("token" in data, false);
  const session = signedIn.cookies.find((c) => c.name === "pulse_session");
  assert.ok(session);
  assert.match(String(signedIn.headers["set-cookie"]), /HttpOnly/);
  const cookie = `pulse_session=${session.value}`;
  const me = await app.inject({ url: "/api/me", headers: { cookie } });
  assert.equal(me.json().voter.id, data.voter.id);
  const context = await app.inject({
    url: "/api/poll-creation/context",
    headers: { cookie },
  });
  assert.equal(context.statusCode, 200);
  const again = await signIn();
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().voter.id, data.voter.id);
  assert.equal(again.json().firstTime, false);
  await app.inject({
    method: "POST",
    url: "/api/sign-out",
    headers: { cookie },
  });
  assert.equal(
    (await app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
    401,
  );
});

test("demo sign-in confirms the existing anonymous browser ballot", async (t) => {
  const { app } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  const vote = await app.inject({
    method: "POST",
    url: "/api/polls/ads-free/votes",
    payload: { ballot: [1] },
  });
  assert.equal(vote.statusCode, 200);
  const ballot = vote.cookies.find((c) => c.name === "pulse_ballot");
  assert.ok(ballot);
  const signedIn = await app.inject({
    method: "POST",
    url: "/api/dev/sign-in",
    headers: { origin, cookie: `pulse_ballot=${ballot.value}` },
    payload: { email: "demo@example.test" },
  });
  assert.equal(signedIn.statusCode, 200);
  const results = await app.inject({ url: "/api/polls/ads-free/results" });
  assert.equal(results.json().confirmedVoters, 1);
});

test("demo refuses foreign or missing origins, arbitrary accounts and malformed requests", async (t) => {
  const { app, mailer } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  for (const headers of [
    {},
    { origin: "http://evil.test" },
    { origin: "null" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/sign-in",
      headers,
      payload: { email: "demo@example.test" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "local_only");
    assert.equal(response.headers["set-cookie"], undefined);
  }
  for (const [payload, error] of [
    [{}, "bad_request"],
    [{ email: "someone@example.test" }, "demo_account_only"],
    [{ email: "demo@example.test", proofEmailsOptIn: "yes" }, "bad_request"],
    [{ email: "demo@example.test", community: 3 }, "bad_request"],
    [{ email: "demo@example.test", community: "other" }, "unknown_community"],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/api/dev/sign-in",
      headers: { origin },
      payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, error);
    assert.equal(response.headers["set-cookie"], undefined);
  }
  assert.equal(mailer.sent.length, 0);
});

test("demo refuses a non-loopback configured web origin even when Origin matches", async (t) => {
  const remoteOrigin = "https://pulse.example.org";
  const { app } = await buildDevServer(
    devConfig({ PULSE_WEB_ORIGIN: remoteOrigin }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/api/dev/sign-in",
    headers: { origin: remoteOrigin },
    payload: { email: "demo@example.test" },
  });
  assert.equal(response.statusCode, 403);
});

test("demo can redeem an already pending console link", async (t) => {
  const { app } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  await app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "demo@example.test" },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/dev/sign-in",
    headers: { origin },
    payload: { email: "demo@example.test" },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "signed_in");
});
