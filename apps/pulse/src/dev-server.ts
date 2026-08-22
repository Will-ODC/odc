import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { createServer } from "./http/server.js";
import { SessionSigner } from "./http/session.js";
import { DomainAllowlist, StaticDomainSource } from "./identity/allowlist.js";
import { ClaimService } from "./identity/claim.js";
import { ConsoleMailer } from "./identity/mailer.js";
import { InMemoryClaimStore, InMemoryVoterStore } from "./identity/store.js";
import type { NewPoll } from "./voting/poll.js";
import { InMemoryVotingStore } from "./voting/store.js";

/**
 * Running pulse on a laptop.
 *
 * Everything is in memory and dies with the process — this is for driving the
 * real flow against the real server (the client's dev proxy points at port
 * 8080), not for keeping anything. The database-backed stores replace the three
 * in-memory ones here and nothing else changes.
 *
 * The sign-in link is printed to the terminal by `ConsoleMailer`: that is the
 * mailbox until a mail provider exists, and it is what makes the whole flow
 * demonstrable without one.
 */

/** 8080, because `apps/pulse-web/vite.config.ts` proxies `/api` there. */
export const DEFAULT_PORT = 8080;

/**
 * The seed: one community, one domain that proves membership of it, one poll.
 *
 * A literal, not configuration. This process keeps nothing, so a knob for the
 * poll's wording would only be a way to hand `createPoll` a shape it refuses —
 * and every one of these values is a two-line edit away for anyone who wants a
 * different demo. `satisfies NewPoll` makes a bad seed a compile error rather
 * than a crash on startup.
 */
const SEED = {
  community: "demo-community",
  domain: "example.test",
  poll: {
    id: "p1",
    question: "Where should the next one be?",
    choices: ["Park", "Library", "Rink"],
    method: "single",
  } satisfies NewPoll,
};

/**
 * The only environments this entry point will start in.
 *
 * It is a development server in every part — in-memory stores that lose every
 * vote on restart, a mailer that prints to a terminal, and a session cookie
 * sent without `Secure` because local development is plain http. Refusing to
 * start anywhere else is what keeps that last one from becoming a stealable
 * session on a real network: there is no configuration that turns this into a
 * production server, so there is none to get wrong.
 */
const DEV_ENVIRONMENTS: readonly string[] = ["development", "test"];

/**
 * Refuse to be anywhere but a development machine.
 *
 * Called by both exported functions, because either one alone is enough to
 * produce the insecure server: `devConfig` invents a session secret, and
 * `buildDevServer` is what actually sets `secureCookies: false`. A guard on
 * only the first would sit one function away from the invariant it protects.
 */
function assertDevelopment(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== undefined && !DEV_ENVIRONMENTS.includes(env.NODE_ENV)) {
    throw new Error(
      `the pulse dev server runs only in development (NODE_ENV=${env.NODE_ENV}): ` +
        "it keeps nothing, mails nothing, and sends its session cookie without Secure.",
    );
  }
}

export interface DevConfig {
  port: number;
  secret: string;
  /** Where the secret came from, so the process can say so out loud. */
  secretSource: "env" | "generated";
  /** Origin of the client the emailed link should land on. */
  webOrigin: string;
}

/**
 * Read the environment into a configuration.
 *
 * Three variables, and each one is something a developer's machine genuinely
 * decides: which port is free, whether sessions should survive a restart, and
 * where the client is being served. The seed data is not among them.
 */
export function devConfig(env: NodeJS.ProcessEnv): DevConfig {
  assertDevelopment(env);

  const secretFromEnv = env.PULSE_SESSION_SECRET;
  return {
    port: port(env.PULSE_PORT),
    // Never a hardcoded fallback: a default secret is a secret everyone has.
    secret: secretFromEnv ?? randomBytes(32).toString("base64url"),
    secretSource: secretFromEnv === undefined ? "generated" : "env",
    webOrigin: env.PULSE_WEB_ORIGIN ?? "http://localhost:5173",
  };
}

/**
 * A port number, or the default. Refused rather than coerced: `Number("")` is
 * 0, which quietly binds a random port the dev proxy will never find, and
 * `Number("abc")` is NaN, which surfaces much later as `ERR_SOCKET_BAD_PORT`.
 */
function port(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(
      `PULSE_PORT must be a port number between 1 and 65535, not "${raw}"`,
    );
  }
  return value;
}

/** Wire the server up from a configuration. Does not listen. */
export async function buildDevServer(
  config: DevConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ app: FastifyInstance; mailer: ConsoleMailer }> {
  // Guarded here too: this is the function that sets `secureCookies: false`,
  // and it is exported and takes any config, so a hand-built one must not be a
  // way around the refusal in `devConfig`.
  assertDevelopment(env);

  const mailer = new ConsoleMailer();
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore();
  await votes.createPoll(SEED.poll);

  const claims = new ClaimService({
    membership: new DomainAllowlist(
      new StaticDomainSource([
        { community: SEED.community, domain: SEED.domain },
      ]),
    ),
    voters,
    claims: new InMemoryClaimStore(),
    mailer,
    linkFor: (token) =>
      `${config.webOrigin}/sign-in?token=${encodeURIComponent(token)}`,
  });

  const app = await createServer({
    claims,
    voters,
    votes,
    signer: new SessionSigner(config.secret),
    // Local development is http://, and a Secure cookie would never be stored.
    // Safe only because of the guard above — see DEV_ENVIRONMENTS.
    secureCookies: false,
    // Generous, because the person hitting this limit is a developer clicking
    // through the flow for the tenth time, not someone mining addresses.
    signInRateLimit: { max: 100, timeWindow: "1 minute" },
  });
  return { app, mailer };
}

async function main(): Promise<void> {
  const config = devConfig(process.env);
  const { app } = await buildDevServer(config);
  await app.listen({ port: config.port, host: "127.0.0.1" });

  // The bound port, not the requested one: they differ whenever port 0 was
  // asked for, and a banner naming a port nothing is listening on is worse
  // than no banner.
  const address = app.server.address();
  const bound =
    typeof address === "object" && address ? address.port : config.port;

  console.log(
    [
      `pulse dev server on http://127.0.0.1:${bound}`,
      config.secretSource === "generated"
        ? "  session secret: generated for this run — everyone is signed out when it stops"
        : "  session secret: from PULSE_SESSION_SECRET",
      `  community "${SEED.community}" admits @${SEED.domain} addresses`,
      `  poll "${SEED.poll.id}": ${SEED.poll.question}`,
      "  sign-in links are printed here; paste one into the browser",
    ].join("\n"),
  );
}

// Only when run directly, so importing this module in a test wires nothing up
// and listens on nothing.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
