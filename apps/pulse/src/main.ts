import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { databaseUrl } from "./db/config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createServer } from "./http/server.js";
import { SessionSigner } from "./http/session.js";
import { DomainAllowlist } from "./identity/allowlist.js";
import { ClaimService } from "./identity/claim.js";
import type { Mailer } from "./identity/mailer.js";
import {
  PostgresClaimStore,
  PostgresDomainSource,
  PostgresVoterStore,
} from "./identity/pg-store.js";
import { ResendMailer, resendConfig } from "./identity/resend-mailer.js";
import { PostgresVotingStore } from "./voting/pg-store.js";
import { PostgresSuggestionStore } from "./voting/pg-suggestions.js";

/**
 * Serving pulse.
 *
 * The sibling of `dev-server.ts`, and deliberately never an edit to it. That
 * file refuses to start outside development, guarded twice, because it invents
 * a session secret, prints sign-in links to a terminal and sends its session
 * cookie without `Secure`. Anything that made it "production-capable" would be
 * undoing a safety property somebody chose. So this is a second entry point,
 * and the difference between them is the whole point of both.
 *
 * Where `dev-server` defaults, this refuses. Every value it needs is either
 * configured or the process does not start: there is no invented secret, no
 * in-memory fallback, no mailer that prints to stdout. A misconfiguration is
 * visible at boot, to the person who set the variables, instead of at the
 * first sign-in, to somebody who cannot do anything about it.
 */

/** Matches `dev-server`'s, so a container that publishes 8080 needs no thought. */
export const DEFAULT_PORT = 8080;

/**
 * Bound to every interface, unlike `dev-server`'s loopback.
 *
 * A container's port publishing reaches the process only if it is listening on
 * the container's external interface; bound to loopback it is unreachable from
 * outside the container, and the failure looks like the app is down.
 */
export const DEFAULT_HOST = "0.0.0.0";

export interface ServeConfig {
  port: number;
  host: string;
  /** Signs the session and ballot cookies. Never generated here. */
  secret: string;
  databaseUrl: string;
  /** Origin of the client, which is where an emailed sign-in link must land. */
  webOrigin: string;
  mailer: Mailer;
  /**
   * Put every table in this schema instead of the connection's default.
   *
   * `src/db/pool.ts` names this as the knob for deploying pulse beside
   * something else in one database, which is the ordinary shape of a managed
   * Postgres where you get one database and not one per app.
   */
  schema?: string;
}

/**
 * Read the environment into a configuration, or refuse to start.
 *
 * The refusals are the substance of this function. Each one is a value that
 * `dev-server` is allowed to invent and a served pulse is not:
 *
 * - **No session secret** — `dev-server` generates one per run, which signs
 *   everyone out on restart. Served, that would also mean a secret nobody can
 *   rotate deliberately and a restart silently voiding every ballot cookie.
 * - **No database** — `dev-server` falls back to memory so the demo runs with
 *   nothing installed. Served, that fallback is a site that loses every vote
 *   on deploy and gives no sign it has.
 * - **No mailer** — `ConsoleMailer` prints links to stdout. Served, that is
 *   both useless (nobody reads your logs) and a sign-in link in a log file.
 * - **No web origin** — the emailed link has to point somewhere real, and a
 *   guessed default would mail everyone a link to localhost.
 */
export function serveConfig(env: NodeJS.ProcessEnv = process.env): ServeConfig {
  const missing: string[] = [];

  const secret = env.PULSE_SESSION_SECRET?.trim();
  if (secret === undefined || secret === "")
    missing.push("PULSE_SESSION_SECRET");

  const url = databaseUrl(env);
  if (url === undefined) missing.push("PULSE_DATABASE_URL");

  const webOrigin = env.PULSE_WEB_ORIGIN?.trim();
  if (webOrigin === undefined || webOrigin === "")
    missing.push("PULSE_WEB_ORIGIN");

  // Read before the check below so a missing key joins the same list, rather
  // than being a second error someone only sees after fixing the first.
  const resend = resendConfig(env);
  if (resend === undefined) missing.push("PULSE_RESEND_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `pulse cannot start: ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } not set. ` +
        "Every one of these is a value the development server is allowed to " +
        "invent and a served one is not.",
    );
  }

  // Narrowed by the throw above; TypeScript cannot see through the array.
  const checked = {
    secret: secret as string,
    url: url as string,
    webOrigin: webOrigin as string,
  };

  assertOrigin(checked.webOrigin);

  const schema = env.PULSE_DATABASE_SCHEMA?.trim();
  return {
    port: port(env.PULSE_PORT),
    host: env.PULSE_HOST?.trim() || DEFAULT_HOST,
    secret: checked.secret,
    databaseUrl: checked.url,
    webOrigin: checked.webOrigin,
    mailer: new ResendMailer(resend as NonNullable<typeof resend>),
    ...(schema === undefined || schema === "" ? {} : { schema }),
  };
}

/**
 * The web origin has to be an origin, not a URL with a path.
 *
 * `linkFor` concatenates `/sign-in?token=…` onto it, so a trailing slash or a
 * path produces a link that 404s — and the first person to find out is
 * somebody holding a link that does not work, with no way to report it.
 */
function assertOrigin(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `PULSE_WEB_ORIGIN must be a URL like https://pulse.example.org, not "${value}"`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `PULSE_WEB_ORIGIN must be http or https, not "${parsed.protocol}"`,
    );
  }
  if (value !== parsed.origin) {
    throw new Error(
      `PULSE_WEB_ORIGIN must be a bare origin with no path or trailing slash: ` +
        `use "${parsed.origin}", not "${value}"`,
    );
  }
}

/**
 * A port number, or the default. Refused rather than coerced, for the reason
 * `dev-server` gives: `Number("")` is 0, which binds a random port nothing is
 * routed to, and `Number("abc")` is NaN, which surfaces much later.
 */
function port(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `PULSE_PORT must be a port number between 1 and 65535, not "${raw}"`,
    );
  }
  return value;
}

/**
 * The served logger, which must never write a sign-in token down.
 *
 * `GET /api/sign-in/redeem?token=…` carries the token in the query string, and
 * Fastify's default request serializer logs the whole URL — so the default
 * would record a live credential for every sign-in. It stays live: that GET
 * deliberately does not consume the token (mail scanners follow every link), so
 * it is good for its full 15 minutes whether or not the person ever clicked.
 *
 * This is the same failure `serveConfig` refuses `ConsoleMailer` for, arriving
 * by another door — a sign-in link in a log file. nginx has the identical hole
 * in its default access log, and `apps/pulse-web/nginx.conf` closes it there.
 */
export const SERVED_LOGGER = {
  serializers: {
    req(request: { method: string; url: string }) {
      return {
        method: request.method,
        // The path only. `split` rather than `new URL`: this is a request
        // target, not an absolute URL, and it must not be able to throw inside
        // a log serializer.
        url: request.url.split("?")[0] ?? request.url,
      };
    },
  },
};

export interface ServeOptions {
  /** Where warnings go. Defaults to stderr, which is what a container collects. */
  log?: (message: string) => void;
}

/**
 * Wire the server up from a configuration. Does not listen.
 *
 * Exported so a test can drive the real production wiring through
 * `app.inject()` without binding a port — the same seam `buildDevServer` has.
 */
export async function buildServer(
  config: ServeConfig,
  options: ServeOptions = {},
): Promise<{ app: FastifyInstance; pool: Pool }> {
  const log = options.log ?? ((message: string) => console.error(message));

  const pool = createPool({
    connectionString: config.databaseUrl,
    ...(config.schema === undefined ? {} : { schema: config.schema }),
  });
  // An idle connection that fails emits "error" on the pool, and an "error"
  // nobody listens for is an uncaught exception that takes the server down.
  pool.on("error", (error) => {
    log(`pulse: an idle database connection failed: ${error.message}`);
  });

  try {
    // On every start. The runner takes an advisory lock and skips what has
    // already run, so several instances starting at once is fine — which is
    // the case it was built for.
    await migrate(pool);

    const claims = new ClaimService(
      {
        membership: new DomainAllowlist(new PostgresDomainSource(pool)),
        voters: new PostgresVoterStore(pool),
        claims: new PostgresClaimStore(pool),
        mailer: config.mailer,
        linkFor: (token) =>
          `${config.webOrigin}/sign-in?token=${encodeURIComponent(token)}`,
      },
      { log: (message, error) => log(`${message}: ${String(error)}`) },
    );

    const app = await createServer({
      claims,
      voters: new PostgresVoterStore(pool),
      votes: new PostgresVotingStore(pool),
      suggestions: new PostgresSuggestionStore(pool),
      signer: new SessionSigner(config.secret),
      // Not passed at all, so the default holds. `secureCookies` defaults to
      // true and `dev-server` is the only thing that sets it false; naming it
      // here would put the insecure value one edit away from the served path.
      logger: SERVED_LOGGER,
      // One nginx in front (`apps/pulse-web/nginx.conf`). Without this every
      // request carries the proxy's address and every rate limit in the server
      // becomes one bucket shared by everybody.
      trustProxy: 1,
    });

    app.addHook("onClose", async () => {
      await pool.end();
    });
    return { app, pool };
  } catch (error) {
    // A start that fails must not leave its pool open: nobody else holds it,
    // and its idle connections would keep the process alive. A failure to
    // close it must not replace the error that says why the start failed.
    await pool.end().catch(() => undefined);
    throw error;
  }
}

/**
 * Stop on the signals a container runtime actually sends.
 *
 * Docker and Kubernetes send SIGTERM and wait before SIGKILL. Without a
 * handler, node exits immediately on it: requests in flight are cut off and
 * the pool's connections are dropped rather than returned, which the database
 * sees as a client crash on every deploy.
 */
export function stopOnSignals(
  app: FastifyInstance,
  options: { log?: (message: string) => void } = {},
): void {
  const log = options.log ?? ((message: string) => console.error(message));
  let stopping = false;

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      // A second signal while the first is still draining must not start a
      // second close: `app.close()` twice races its own onClose hook.
      if (stopping) return;
      stopping = true;
      log(`pulse: ${signal} — finishing what is in flight, then stopping`);
      void app
        .close()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          log(`pulse: did not stop cleanly: ${String(error)}`);
          process.exit(1);
        });
    });
  }
}

async function main(): Promise<void> {
  const config = serveConfig(process.env);
  const { app } = await buildServer(config);
  // Before `listen`, not after: migrations are the slowest part of a boot and
  // the window a rolling deploy is most likely to send SIGTERM into. Registered
  // after, a signal arriving then kills the process outright.
  stopOnSignals(app);
  await app.listen({ port: config.port, host: config.host });
}

// Only when run directly, so importing this module in a test wires nothing up
// and listens on nothing.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    // The message, not a stack: these are configuration refusals meant for
    // whoever set the variables, and a stack buries the one sentence that says
    // which variable is missing.
    console.error(
      error instanceof Error
        ? `pulse could not start: ${error.message}`
        : String(error),
    );
    // But a refusal is not the only thing that reaches here. A dead database
    // throws `connect ECONNREFUSED …`, which alone names neither pulse nor the
    // database, and `MigrationError` keeps its real reason in `cause`. Dropping
    // it leaves an operator one context-free line to work from.
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause !== undefined) {
      console.error(
        `  caused by: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    process.exit(1);
  }
}
