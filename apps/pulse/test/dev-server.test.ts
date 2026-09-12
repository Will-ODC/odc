import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { Pool } from "pg";
import { databaseUrl } from "../src/db/config.js";
import { migrate } from "../src/db/migrate.js";
import { DEFAULT_PORT, buildDevServer, devConfig } from "../src/dev-server.js";
import { databaseSkip, throwawaySchema } from "./support/database.js";

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
  const { app, mailer } = await buildDevServer(devConfig({}));
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

test("refuses to build the insecure server outside development too", async () => {
  // The guard has to sit on this function as well: it is exported, it takes any
  // config, and it is the one that sets `secureCookies: false`.
  await assert.rejects(
    () => buildDevServer(devConfig({}), { NODE_ENV: "production" }),
    /only in development/,
  );
});

test("seeds a run of polls and one domain, so the flow works the moment it starts", async () => {
  const { app, mailer } = await buildDevServer(devConfig({}));

  const poll = await app.inject({ method: "GET", url: "/api/polls/ads-free" });
  assert.equal(poll.statusCode, 200);
  // The shape the client's first screen can actually ask: one answer, two
  // sides. A third choice would leave that screen with nowhere to put it.
  assert.equal(poll.json().method, "single");
  // The graph, not a lone poll: each answer names the question it opens.
  assert.deepEqual(poll.json().next, ["ads-allowed", "pay-for-it"]);
  for (const id of poll.json().next) {
    const onward = await app.inject({ method: "GET", url: `/api/polls/${id}` });
    assert.equal(onward.statusCode, 200, `${id} should exist`);
    assert.equal(onward.json().acceptsSuggestions, true);
  }
  assert.deepEqual(poll.json().choices, ["No", "Yes"]);
  // Open when it starts, whenever that is — a seed that had gone stale would
  // open the demo on a poll nobody can answer.
  assert.equal(poll.json().open, true);
  assert.ok(new Date(poll.json().closesAt).getTime() > Date.now());

  const signIn = await app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "jo@example.test" },
  });
  assert.equal(signIn.statusCode, 200);
  assert.equal(mailer.sent.length, 1);
  assert.match(mailer.sent[0]?.body ?? "", /sign-in\?token=/);
  await app.close();
});

test("sends the link to the client origin it was told about", async () => {
  const { app, mailer } = await buildDevServer(
    devConfig({ PULSE_WEB_ORIGIN: "http://localhost:4321" }),
  );
  await app.inject({
    method: "POST",
    url: "/api/sign-in",
    payload: { email: "jo@example.test" },
  });
  assert.match(
    mailer.sent[0]?.body ?? "",
    /^http:\/\/localhost:4321\/sign-in\?token=/,
  );
  await app.close();
});

test("reads_the_database_url_and_treats_an_empty_one_as_none", () => {
  assert.equal(devConfig({}).databaseUrl, undefined);
  assert.equal(devConfig({ PULSE_DATABASE_URL: "   " }).databaseUrl, undefined);
  assert.equal(
    devConfig({ PULSE_DATABASE_URL: " postgres://pulse@localhost/pulse " })
      .databaseUrl,
    "postgres://pulse@localhost/pulse",
  );
});

test("without_a_database_it_keeps_everything_in_memory", async () => {
  const { app, storage, pool } = await buildDevServer(devConfig({}));
  assert.equal(storage, "memory");
  assert.equal(pool, undefined);
  await app.close();
});

/**
 * A connection string that puts the dev server in a schema of this test's own
 * — the real start-up path, its own pool, migrations and seed, with nothing
 * written anywhere another test or a developer's data could see — and a pool
 * on that schema for the test itself to look through. `appName` tags the dev
 * server's connections, so the test can find them in pg_stat_activity.
 */
async function databaseFor(
  t: TestContext,
  appName?: string,
): Promise<{ url: string; pool: Pool }> {
  const { schema, pool } = await throwawaySchema(t);
  const base = databaseUrl() ?? "";
  const params = [
    `options=${encodeURIComponent(`-c search_path=${schema}`)}`,
    ...(appName ? [`application_name=${encodeURIComponent(appName)}`] : []),
  ];
  const url = `${base}${base.includes("?") ? "&" : "?"}${params.join("&")}`;
  return { url, pool };
}

const SECRET = "a-dev-secret-long-enough-for-anyone";

function tokenIn(body: string | undefined): string {
  return new URL(body ?? "").searchParams.get("token") ?? "";
}

test(
  "with_a_database_every_store_keeps_its_rows_across_a_restart",
  { skip: databaseSkip },
  async (t) => {
    // One start, then another on the same database: a vote, a voter, an
    // unused sign-in link and a suggestion from the first are all there for
    // the second. Any one store left in memory loses its part of this.
    const { url, pool } = await databaseFor(t);
    const config = devConfig({
      PULSE_DATABASE_URL: url,
      PULSE_SESSION_SECRET: SECRET,
    });

    const first = await buildDevServer(config);
    assert.equal(first.storage, "postgres");
    const cast = await first.app.inject({
      method: "POST",
      url: "/api/polls/ads-free/votes",
      payload: { ballot: [1] },
    });
    assert.equal(cast.statusCode, 200);
    // Two links: one to redeem now, one to leave unused across the restart.
    for (let link = 0; link < 2; link += 1) {
      await first.app.inject({
        method: "POST",
        url: "/api/sign-in",
        payload: { email: "jo@example.test" },
      });
    }
    const [used, unused] = first.mailer.sent.map((m) => tokenIn(m.body));
    const redeemed = await first.app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token: used },
    });
    const session = redeemed.cookies.find((c) => c.name === "pulse_session");
    assert.ok(session, "the first start signed jo in");
    const suggested = await first.app.inject({
      method: "POST",
      url: "/api/polls/pay-for-it/suggestions",
      payload: { text: "Charge the members" },
    });
    assert.equal(suggested.statusCode, 200);
    await first.app.close();

    // The seed polls are already there, and writing them twice must not stop
    // the server starting.
    const second = await buildDevServer(config);
    const results = await second.app.inject({
      url: "/api/polls/ads-free/results",
    });
    assert.equal(results.json().voters, 1);
    const me = await second.app.inject({
      url: "/api/me",
      headers: { cookie: `pulse_session=${session.value}` },
    });
    assert.equal(me.statusCode, 200, "the voter was forgotten");
    const later = await second.app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token: unused },
    });
    assert.equal(later.statusCode, 200, "the unused link was forgotten");
    assert.equal(later.json().firstTime, false);
    const listed = await second.app.inject({
      url: "/api/polls/pay-for-it/suggestions",
    });
    assert.deepEqual(
      listed.json().suggestions.map((s: { text: string }) => s.text),
      ["Charge the members"],
    );
    await second.app.close();

    // And all of it in this test's own schema.
    const { rows } = await pool.query<{ id: string }>(
      "select id from polls order by id",
    );
    assert.deepEqual(
      rows.map((row) => row.id),
      ["ads-allowed", "ads-free", "pay-for-it"],
    );
  },
);

test(
  "two_servers_starting_on_one_database_both_start",
  { skip: databaseSkip },
  async (t) => {
    // Each sees no seed poll, and one writes it first: the other must take
    // that as done, not fail to start on "poll already exists".
    const { url } = await databaseFor(t);
    const config = devConfig({
      PULSE_DATABASE_URL: url,
      PULSE_SESSION_SECRET: SECRET,
    });
    const both = await Promise.all([
      buildDevServer(config),
      buildDevServer(config),
    ]);
    for (const { app } of both) await app.close();
  },
);

test(
  "a_start_that_fails_closes_the_pool_it_opened",
  { skip: databaseSkip },
  async (t) => {
    // A table in the way, so the first migration fails after the pool is
    // open. Nobody else holds that pool: left open, its connections would
    // keep the process alive.
    const appName = `pulse_failed_start_${randomUUID().slice(0, 8)}`;
    const { url, pool } = await databaseFor(t, appName);
    await pool.query("create table polls (id integer)");
    await assert.rejects(
      buildDevServer(
        devConfig({ PULSE_DATABASE_URL: url, PULSE_SESSION_SECRET: SECRET }),
      ),
    );
    await until(async () => (await connectionsNamed(pool, appName)) === 0);
  },
);

test(
  "a_start_that_fails_after_migrating_closes_its_pool_too",
  { skip: databaseSkip },
  async (t) => {
    // Migrated, but no poll may be written: the seed fails later than the
    // migration above did, after the stores are built on the open pool.
    const appName = `pulse_failed_seed_${randomUUID().slice(0, 8)}`;
    const { url, pool } = await databaseFor(t, appName);
    await migrate(pool);
    await pool.query(
      "alter table polls add constraint no_polls_here check (false)",
    );
    await assert.rejects(
      buildDevServer(
        devConfig({ PULSE_DATABASE_URL: url, PULSE_SESSION_SECRET: SECRET }),
      ),
    );
    await until(async () => (await connectionsNamed(pool, appName)) === 0);
  },
);

test(
  "with_a_database_and_no_session_secret_it_warns_that_restarts_lose_ballots",
  { skip: databaseSkip },
  async (t) => {
    const { url } = await databaseFor(t);
    const warned: string[] = [];
    const generated = await buildDevServer(
      devConfig({ PULSE_DATABASE_URL: url }),
      {},
      { log: (message) => warned.push(message) },
    );
    await generated.app.close();
    assert.match(warned.join("\n"), /PULSE_SESSION_SECRET/);

    const quiet: string[] = [];
    const given = await buildDevServer(
      devConfig({ PULSE_DATABASE_URL: url, PULSE_SESSION_SECRET: SECRET }),
      {},
      { log: (message) => quiet.push(message) },
    );
    await given.app.close();
    assert.deepEqual(quiet, []);
  },
);

test(
  "closing_the_server_closes_the_database_pool_it_opened",
  { skip: databaseSkip },
  async (t) => {
    const { app, pool } = await buildDevServer(
      devConfig({ PULSE_DATABASE_URL: (await databaseFor(t)).url }),
    );
    assert.ok(pool, "a database start opens a pool");
    await app.close();
    assert.equal((pool as unknown as { ended: boolean }).ended, true);
  },
);

test(
  "a_failed_idle_database_connection_is_reported_rather_than_a_crash",
  { skip: databaseSkip },
  async (t) => {
    // Unheard, the pool's "error" event is an uncaught exception: a database
    // restart would take the dev server down with it.
    const messages: string[] = [];
    const { app, pool } = await buildDevServer(
      devConfig({ PULSE_DATABASE_URL: (await databaseFor(t)).url }),
      {},
      { log: (message) => messages.push(message) },
    );
    pool?.emit("error", new Error("the database went away"));
    assert.match(messages.join("\n"), /the database went away/);
    await app.close();
  },
);

test(
  "with_a_database_the_allowlist_is_the_table",
  { skip: databaseSkip },
  async (t) => {
    // The start-up writes the demo's domain into the table, so the seeded
    // community can sign in; and a domain inserted there by hand counts too,
    // which a list held in memory would not see.
    const { url, pool } = await databaseFor(t);
    const { app, mailer } = await buildDevServer(
      devConfig({ PULSE_DATABASE_URL: url, PULSE_SESSION_SECRET: SECRET }),
    );
    await pool.query(
      "insert into allowed_domain (community, domain, include_subdomains)" +
        " values ('elsewhere', 'other.test', false)",
    );
    for (const email of ["jo@example.test", "sam@other.test"]) {
      const signIn = await app.inject({
        method: "POST",
        url: "/api/sign-in",
        payload: { email },
      });
      assert.equal(signIn.statusCode, 200, `${email} was not admitted`);
    }
    assert.equal(mailer.sent.length, 2);
    await app.close();
  },
);

/** Open connections the dev server tagged with `appName`. */
async function connectionsNamed(pool: Pool, appName: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    "select count(*)::int as n from pg_stat_activity" +
      " where application_name = $1",
    [appName],
  );
  return rows[0]?.n ?? 0;
}

async function until(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
