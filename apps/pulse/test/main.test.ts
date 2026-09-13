import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  buildServer,
  serveConfig,
  stopOnSignals,
  type ServeConfig,
} from "../src/main.js";
import { ConsoleMailer, MailSendError } from "../src/identity/mailer.js";
import { allowDomain } from "../src/identity/pg-store.js";
import { databaseSkip, throwawaySchema } from "./support/database.js";

/** Everything a served pulse refuses to start without. */
const COMPLETE: NodeJS.ProcessEnv = {
  PULSE_SESSION_SECRET: "a-secret-that-is-long-enough",
  PULSE_DATABASE_URL: "postgres://pulse:pulse@127.0.0.1:5433/pulse_test",
  PULSE_WEB_ORIGIN: "https://pulse.example.org",
  PULSE_RESEND_API_KEY: "re_test_key",
  PULSE_MAIL_FROM: "pulse <sign-in@pulse.example.org>",
};

function without(...names: string[]): NodeJS.ProcessEnv {
  const env = { ...COMPLETE };
  for (const name of names) delete env[name];
  return env;
}

test("a_complete_environment_is_read_into_a_configuration", () => {
  const config = serveConfig(COMPLETE);

  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.host, DEFAULT_HOST);
  assert.equal(config.secret, "a-secret-that-is-long-enough");
  assert.equal(config.webOrigin, "https://pulse.example.org");
  assert.equal(config.databaseUrl, COMPLETE["PULSE_DATABASE_URL"]);
  // A real provider, never the one that prints to a terminal.
  assert.equal(config.mailer instanceof ConsoleMailer, false);
});

test("every_value_the_dev_server_may_invent_is_refused_here", () => {
  // Each of these has a default, a fallback or a generator in `dev-server.ts`.
  // A served pulse taking any of them would be the quiet failure: a secret
  // nobody chose, votes kept in memory, or sign-in links printed to a log.
  for (const name of [
    "PULSE_SESSION_SECRET",
    "PULSE_DATABASE_URL",
    "PULSE_WEB_ORIGIN",
    "PULSE_RESEND_API_KEY",
  ]) {
    assert.throws(
      () => serveConfig(without(name)),
      new RegExp(name),
      `${name} must be required`,
    );
  }
});

test("an_empty_value_is_as_missing_as_an_unset_one", () => {
  // `FOO=` in a shell, a blank secret in a deployment UI, and an unset
  // variable all mean the same thing to the person who typed them.
  for (const name of [
    "PULSE_SESSION_SECRET",
    "PULSE_DATABASE_URL",
    "PULSE_WEB_ORIGIN",
    "PULSE_RESEND_API_KEY",
  ]) {
    assert.throws(
      () => serveConfig({ ...COMPLETE, [name]: "   " }),
      new RegExp(name),
      `a blank ${name} must be refused`,
    );
  }
});

test("everything_missing_is_named_at_once_rather_than_one_per_restart", () => {
  // Reporting the first missing variable only would make configuring a new
  // deployment a sequence of failed boots, each revealing one more thing.
  let error: unknown;
  try {
    serveConfig({});
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof Error, "an empty environment must be refused");

  for (const name of [
    "PULSE_SESSION_SECRET",
    "PULSE_DATABASE_URL",
    "PULSE_WEB_ORIGIN",
    "PULSE_RESEND_API_KEY",
  ]) {
    assert.match(error.message, new RegExp(name));
  }
});

test("a_mail_key_without_a_sender_is_still_the_mailers_own_refusal", () => {
  // `resendConfig` throws its own, more specific error for this. It must not
  // be swallowed into "PULSE_RESEND_API_KEY is not set", which is false and
  // sends whoever reads it to check the one variable that IS set.
  assert.throws(
    () => serveConfig(without("PULSE_MAIL_FROM")),
    /PULSE_MAIL_FROM/,
  );
});

test("the_web_origin_must_be_an_origin_and_nothing_more", () => {
  // `linkFor` concatenates `/sign-in?token=…` onto this. A trailing slash or a
  // path makes every emailed link 404, and the first person to find out is
  // holding one that does not work.
  for (const bad of [
    "https://pulse.example.org/",
    "https://pulse.example.org/app",
    "pulse.example.org",
    "ftp://pulse.example.org",
    "not a url",
  ]) {
    assert.throws(
      () => serveConfig({ ...COMPLETE, PULSE_WEB_ORIGIN: bad }),
      /PULSE_WEB_ORIGIN/,
      `"${bad}" must be refused`,
    );
  }
});

test("a_port_is_a_port_or_the_start_fails", () => {
  assert.equal(serveConfig({ ...COMPLETE, PULSE_PORT: "3000" }).port, 3000);
  assert.equal(serveConfig({ ...COMPLETE, PULSE_PORT: "" }).port, DEFAULT_PORT);

  // Coercion is the trap: Number("") is 0, which binds a random port nothing
  // routes to, and Number("abc") is NaN, which surfaces much later.
  for (const bad of ["0", "abc", "-1", "70000", "8080.5"]) {
    assert.throws(
      () => serveConfig({ ...COMPLETE, PULSE_PORT: bad }),
      /PULSE_PORT/,
      `"${bad}" must be refused`,
    );
  }
});

test("the_default_host_is_reachable_from_outside_a_container", () => {
  // Loopback is `dev-server`'s default and is wrong here: a published port
  // reaches the process only if it listens on the container's own interface,
  // and bound to loopback the failure reads as the app being down.
  assert.equal(serveConfig(COMPLETE).host, "0.0.0.0");
  assert.equal(
    serveConfig({ ...COMPLETE, PULSE_HOST: "127.0.0.1" }).host,
    "127.0.0.1",
  );
});

test("a_schema_is_carried_through_when_one_is_named", () => {
  assert.equal(serveConfig(COMPLETE).schema, undefined);
  assert.equal(
    serveConfig({ ...COMPLETE, PULSE_DATABASE_SCHEMA: "pulse" }).schema,
    "pulse",
  );
});

test("a_second_stop_signal_does_not_start_a_second_close", async () => {
  // Closing twice races the onClose hook that ends the pool.
  //
  // It must be two DIFFERENT signals. `process.once` already removes the
  // listener after the first call, so emitting SIGTERM twice exercises node
  // and not this code — with the guard deleted, that version stayed green.
  // SIGTERM then SIGINT is what the flag is actually for, and it is the
  // realistic case: a container runtime sends SIGTERM, and an impatient person
  // at a terminal sends SIGINT while it is still draining.
  let closes = 0;
  const app = {
    close: async () => {
      closes += 1;
    },
  };
  const exits: number[] = [];
  const realExit = process.exit;
  // @ts-expect-error — replaced for the duration of this test only.
  process.exit = (code?: number) => {
    exits.push(code ?? 0);
  };

  try {
    // @ts-expect-error — only `close` is used.
    stopOnSignals(app, { log: () => undefined });
    process.emit("SIGTERM");
    process.emit("SIGINT");
    // Let the close promise and its `then` settle.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.exit = realExit;
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  }

  assert.equal(closes, 1);
  assert.deepEqual(exits, [0]);
});

/**
 * The real production wiring, against a real database.
 *
 * `serveConfig` above is argument-checking; this is the half that could be
 * wired to the wrong store, skip its migrations, or answer with cookies a
 * browser would drop. It drives the built server through `app.inject()` — no
 * port, no container — with a stub mailer in place of the provider.
 */
test(
  "the_served_wiring_migrates_its_database_and_signs_somebody_in",
  {
    skip: databaseSkip,
  },
  async (t) => {
    const { schema } = await throwawaySchema(t);
    const sent: { to: string; link: string }[] = [];

    const config: ServeConfig = {
      port: 0,
      host: "127.0.0.1",
      secret: "a-secret-that-is-long-enough",
      databaseUrl: process.env["PULSE_DATABASE_URL"] as string,
      webOrigin: "https://pulse.example.org",
      schema,
      mailer: {
        sendClaimLink: async (to, link) => {
          sent.push({ to, link });
        },
        sendProofOfAction: async () => undefined,
      },
    };

    // No migration was run on this schema: buildServer owes that itself, because
    // nothing else runs before a container's first request.
    const { app, pool } = await buildServer(config, { log: () => undefined });
    t.after(async () => {
      await app.close();
    });

    // In the schema it was given, not wherever the connection happens to
    // point. Without this the tables could land in `public` and every
    // assertion below would still pass — while a deployment sharing one
    // database with something else had quietly written over it.
    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = $1",
      [schema],
    );
    const names = tables.rows.map((row) => row.table_name);
    assert.ok(
      names.includes("polls"),
      `polls not in ${schema}: ${String(names)}`,
    );
    assert.ok(
      names.includes("voter"),
      `voter not in ${schema}: ${String(names)}`,
    );

    // The allowlist is rows, so a community has to exist before anyone is a
    // member of one. This is the insert `CLAUDE.md` promises, standing in for
    // the bootstrap a deployment does not have yet.
    await allowDomain(pool, {
      community: "example-community",
      domain: "example.org",
    });

    const asked = await app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email: "ada@example.org" },
    });
    assert.equal(asked.statusCode, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, "ada@example.org");
    // The link points at the configured client origin, not at the API.
    assert.ok(
      sent[0]?.link.startsWith("https://pulse.example.org/sign-in?token="),
      `link was ${sent[0]?.link}`,
    );

    const token = new URL(sent[0].link).searchParams.get("token");
    const clicked = await app.inject({
      method: "POST",
      url: "/api/sign-in/redeem",
      payload: { token },
    });
    assert.equal(clicked.statusCode, 200);
    assert.equal(clicked.json().voter.email, "ada@example.org");

    // Secure, because this one is served over https and a cookie without it is
    // readable by anyone on the path. `dev-server` is the only thing that turns
    // this off, and only because local development is plain http.
    const cookie = clicked.headers["set-cookie"];
    const header = Array.isArray(cookie) ? cookie.join(";") : String(cookie);
    assert.match(header, /Secure/);
    assert.match(header, /HttpOnly/);
  },
);

test(
  "the_served_wiring_answers_a_mail_outage_as_a_refusal",
  {
    skip: databaseSkip,
  },
  async (t) => {
    // The whole of ADR-0027, end to end through the real production wiring:
    // a provider that will not take the message is a 503 somebody can retry,
    // never the 500 that would be logged and alerted on as a bug in pulse.
    const { schema } = await throwawaySchema(t);
    const config: ServeConfig = {
      port: 0,
      host: "127.0.0.1",
      secret: "a-secret-that-is-long-enough",
      databaseUrl: process.env["PULSE_DATABASE_URL"] as string,
      webOrigin: "https://pulse.example.org",
      schema,
      mailer: {
        sendClaimLink: () => {
          throw new MailSendError("the mail provider could not be reached");
        },
        sendProofOfAction: async () => undefined,
      },
    };

    const { app, pool } = await buildServer(config, { log: () => undefined });
    t.after(async () => {
      await app.close();
    });
    await allowDomain(pool, {
      community: "example-community",
      domain: "example.org",
    });

    const asked = await app.inject({
      method: "POST",
      url: "/api/sign-in",
      payload: { email: "ada@example.org" },
    });
    assert.equal(asked.statusCode, 503);
    assert.equal(asked.json().error, "send_failed");
  },
);
