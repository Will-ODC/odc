import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PORT, buildDevServer, devConfig } from "../src/dev-server.js";

test("defaults to the port the client's dev proxy calls", () => {
  const config = devConfig({});
  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.port, 8080);
});

test("generates a session secret in development and says it did", () => {
  const config = devConfig({});
  assert.equal(config.secretSource, "generated");
  assert.ok(config.secret.length >= 16);
  assert.notEqual(devConfig({}).secret, config.secret);
});

test("refuses to invent a session secret outside development", () => {
  assert.throws(
    () => devConfig({ NODE_ENV: "production" }),
    /PULSE_SESSION_SECRET/,
  );
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
