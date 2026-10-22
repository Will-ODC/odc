import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDevServer, devConfig } from "../src/dev-server.js";

const headers = { host: "localhost:5173", "sec-fetch-site": "same-origin" };

test("empty local inbox explains how to get a message and never caches", async (t) => {
  const { app } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  const inbox = await app.inject({ url: "/api/dev/mailbox", headers });
  assert.equal(inbox.statusCode, 200);
  assert.match(inbox.body, /No messages yet/);
  assert.match(String(inbox.headers["content-type"]), /text\/html/);
  assert.equal(inbox.headers["cache-control"], "no-store");
  assert.equal(inbox.headers["referrer-policy"], "no-referrer");
  assert.equal(inbox.headers["x-frame-options"], "DENY");
  assert.match(
    String(inbox.headers["content-security-policy"]),
    /default-src 'none'/,
  );
});

test("all accounts use actual captured mail, normal redemption and single-use tokens", async (t) => {
  const { app, mailer } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  const ids = new Set<string>();
  for (const email of [
    "alice@example.test",
    "bob@example.test",
    "demo@example.test",
  ]) {
    const asked = await app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email },
    });
    assert.equal(asked.json().status, "sent");
    assert.equal(asked.headers["set-cookie"], undefined);
    const inbox = await app.inject({ url: "/api/dev/mailbox", headers });
    const link = mailer.lastTo(email)?.body;
    assert.ok(link);
    assert.ok(inbox.body.includes(link));
    assert.match(inbox.body, new RegExp(`To: ${email}`));
    const token = new URL(link).searchParams.get("token");
    // Reading the mailbox did not spend it.
    const inspected = await app.inject({
      url: `/api/sign-in/redeem?token=${token}`,
    });
    assert.equal(inspected.statusCode, 200);
    const redeemed = await app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token },
    });
    assert.equal(redeemed.json().status, "signed_in");
    assert.equal(redeemed.json().voter.email, email);
    ids.add(redeemed.json().voter.id);
    const session = redeemed.cookies.find((c) => c.name === "pulse_session");
    assert.ok(session);
    const creation = await app.inject({
      url: "/api/poll-creation/context",
      headers: { cookie: `pulse_session=${session.value}` },
    });
    assert.equal(creation.statusCode, 200);
    const replay = await app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token },
    });
    assert.equal(replay.statusCode, 410);
  }
  assert.equal(ids.size, 3);
  const inbox = await app.inject({ url: "/api/dev/mailbox", headers });
  assert.ok(
    inbox.body.indexOf("demo@example.test") <
      inbox.body.indexOf("alice@example.test"),
  );
  const shortcut = await app.inject({
    method: "POST",
    url: "/api/dev/sign-in",
    payload: { email: "demo@example.test" },
  });
  assert.equal(shortcut.statusCode, 404);
});

test("mailbox rejects foreign origins, hosts, cross-site navigation and remote peers", async (t) => {
  const { app, mailer } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  mailer.sent.push({
    kind: "claim-link",
    to: "alice@example.test",
    body: "http://localhost:5173/sign-in?token=secret-test-token",
  });
  const cases = [
    { headers: { host: "evil.test" } },
    { headers: { ...headers, origin: "https://evil.test" } },
    { headers: { ...headers, "sec-fetch-site": "cross-site" } },
    { headers: { ...headers, "sec-fetch-site": "same-site" } },
    { headers, remoteAddress: "192.0.2.1" },
    { headers: { host: "evil.test", "x-forwarded-host": "localhost:5173" } },
  ];
  for (const options of cases) {
    const inbox = await app.inject({ url: "/api/dev/mailbox", ...options });
    assert.equal(inbox.statusCode, 403);
    assert.equal(inbox.json().error, "local_only");
    assert.ok(!inbox.body.includes("secret-test-token"));
  }
  // A normal direct address-bar navigation has no Origin.
  assert.equal(
    (
      await app.inject({
        url: "/api/dev/mailbox",
        headers: { host: "localhost:5173", "sec-fetch-site": "none" },
      })
    ).statusCode,
    200,
  );
});

test("mailbox refuses non-loopback configuration", async (t) => {
  const { app } = await buildDevServer(
    devConfig({ PULSE_WEB_ORIGIN: "https://pulse.example.org" }),
  );
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        url: "/api/dev/mailbox",
        headers: { host: "pulse.example.org" },
      })
    ).statusCode,
    403,
  );
});

test("captured HTML and unsafe links are displayed as inert text", async (t) => {
  const { app, mailer } = await buildDevServer(devConfig({}));
  t.after(() => app.close());
  mailer.sent.push({
    kind: "proof-of-action",
    to: '<img src=x onerror="bad()">',
    subject: "<script>bad()</script>",
    body: "<iframe src=evil></iframe>",
  });
  mailer.sent.push({
    kind: "claim-link",
    to: "alice@example.test",
    body: "javascript:alert(1)",
  });
  mailer.sent.push({
    kind: "claim-link",
    to: "bob@example.test",
    body: "https://evil.test/sign-in?token=other",
  });
  const inbox = await app.inject({ url: "/api/dev/mailbox", headers });
  assert.match(inbox.body, /&lt;script&gt;/);
  assert.match(inbox.body, /&lt;iframe/);
  assert.doesNotMatch(
    inbox.body,
    /<script|<iframe|<img|href="javascript:|href="https:\/\/evil/,
  );
});
