import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PORT, buildDevServer, devConfig } from "../src/dev-server.js";

test("defaults to the port the client's dev proxy calls", () => {
  const config = devConfig({});
  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.port, 8080);
});

test("refuses a port that is not a port, rather than binding something else", () => {
  assert.throws(() => devConfig({ PULSE_PORT: "abc" }), /PULSE_PORT/);
  assert.throws(() => devConfig({ PULSE_PORT: "0" }), /PULSE_PORT/);
  assert.throws(() => devConfig({ PULSE_PORT: "70000" }), /PULSE_PORT/);
  // An unset variable is not a mistake; an empty one is the same as unset.
  assert.equal(devConfig({ PULSE_PORT: "" }).port, DEFAULT_PORT);
  assert.equal(devConfig({ PULSE_PORT: "9001" }).port, 9001);
});

test("generates a session secret in development and says it did", () => {
  const config = devConfig({});
  assert.equal(config.secretSource, "generated");
  assert.ok(config.secret.length >= 16);
  assert.notEqual(devConfig({}).secret, config.secret);
});

test("refuses to start anywhere but development, secret or no secret", () => {
  // Not only "production, and only when the secret is missing": a real secret
  // would not make the cookie Secure, and staging is not development either.
  for (const NODE_ENV of ["production", "staging"]) {
    assert.throws(() => devConfig({ NODE_ENV }), /only in development/);
    assert.throws(
      () =>
        devConfig({
          NODE_ENV,
          PULSE_SESSION_SECRET: "a-secret-long-enough-for-anyone",
        }),
      /only in development/,
    );
  }
  // The environments a developer actually runs in are fine.
  for (const NODE_ENV of ["development", "test"]) {
    assert.equal(devConfig({ NODE_ENV }).port, DEFAULT_PORT);
  }
});

test("sends its session cookie without Secure, which is why it is development-only", async () => {
  const { app, mailer } = await buildDevServer(
    devConfig({ PULSE_DOMAIN: "example.test" }),
  );
  await app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "jo@example.test" },
  });
  const token = new URL(mailer.sent[0]?.body ?? "").searchParams.get("token");
  const redeemed = await app.inject({
    method: "POST",
    url: "/api/sign-in/redeem",
    payload: { token },
  });

  assert.equal(redeemed.statusCode, 200);
  const setCookie = redeemed.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
  assert.match(String(header), /pulse_session=/);
  assert.doesNotMatch(String(header), /Secure/i);
  await app.close();
});

test("uses the secret it was given rather than one of its own", () => {
  const config = devConfig({ PULSE_SESSION_SECRET: "a-secret-long-enough" });
  assert.equal(config.secret, "a-secret-long-enough");
  assert.equal(config.secretSource, "env");
});

test("seeds the community, domain and poll from the environment", async () => {
  const config = devConfig({
    PULSE_COMMUNITY: "ubc-students",
    PULSE_DOMAIN: "Student.UBC.ca",
    PULSE_POLL_ID: "p9",
    PULSE_POLL_QUESTION: "Which one?",
    PULSE_POLL_CHOICES: "a, b , c",
    PULSE_POLL_METHOD: "approval",
  });
  assert.equal(config.domain, "student.ubc.ca");
  assert.deepEqual(config.poll.choices, ["a", "b", "c"]);
  assert.equal(config.poll.method, "approval");

  // The seeded poll is really there, and the seeded domain really admits people.
  const { app, mailer } = await buildDevServer(config);
  const poll = await app.inject({ method: "GET", url: "/api/polls/p9" });
  assert.equal(poll.statusCode, 200);
  assert.equal(poll.json().question, "Which one?");

  const signIn = await app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "jo@student.ubc.ca" },
  });
  assert.equal(signIn.statusCode, 200);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0]?.body ?? "", /sign-in\?token=/);
  await app.close();
});
