import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { createServer } from "./http/server.js";
import { SessionSigner } from "./http/session.js";
import { DomainAllowlist, StaticDomainSource } from "./identity/allowlist.js";
import { ClaimService } from "./identity/claim.js";
import { ConsoleMailer } from "./identity/mailer.js";
import { InMemoryClaimStore, InMemoryVoterStore } from "./identity/store.js";
import type { PollMethod } from "./voting/poll.js";
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
 * mailbox until a mail provider exists.
 */

/** 8080, because `apps/pulse-web/vite.config.ts` proxies `/api` there. */
export const DEFAULT_PORT = 8080;

export interface DevConfig {
  port: number;
  secret: string;
  /** Where the secret came from, so the process can say so out loud. */
  secretSource: "env" | "generated";
  /** The one community and the one domain that proves membership of it. */
  community: string;
  domain: string;
  /** Origin of the client the emailed link should land on. */
  webOrigin: string;
  poll: {
    id: string;
    question: string;
    choices: string[];
    method: PollMethod;
  };
}

/**
 * Read the environment into a configuration, with defaults that make the flow
 * demonstrable the moment someone types `pnpm dev` — one community, one domain,
 * one poll.
 */
export function devConfig(env: NodeJS.ProcessEnv): DevConfig {
  const secretFromEnv = env.PULSE_SESSION_SECRET;
  // Never a hardcoded fallback: a default secret is a secret everyone has. In
  // development an ephemeral one is fine (it only means sessions end with the
  // process); anywhere else, refuse to start rather than pretend.
  if (secretFromEnv === undefined && env.NODE_ENV === "production") {
    throw new Error(
      "PULSE_SESSION_SECRET must be set when NODE_ENV=production; refusing to invent one.",
    );
  }

  const choices = (env.PULSE_POLL_CHOICES ?? "Park,Library,Rink")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");

  return {
    port: Number(env.PULSE_PORT ?? DEFAULT_PORT),
    secret: secretFromEnv ?? randomBytes(32).toString("base64url"),
    secretSource: secretFromEnv === undefined ? "generated" : "env",
    community: env.PULSE_COMMUNITY ?? "demo-community",
    domain: (env.PULSE_DOMAIN ?? "example.test").trim().toLowerCase(),
    webOrigin: env.PULSE_WEB_ORIGIN ?? "http://localhost:5173",
    poll: {
      id: env.PULSE_POLL_ID ?? "p1",
      question: env.PULSE_POLL_QUESTION ?? "Where should the next one be?",
      choices,
      method: env.PULSE_POLL_METHOD === "approval" ? "approval" : "single",
    },
  };
}

/** Wire the server up from a configuration. Does not listen. */
export async function buildDevServer(
  config: DevConfig,
): Promise<{ app: FastifyInstance; mailer: ConsoleMailer }> {
  const mailer = new ConsoleMailer();
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore();
  await votes.createPoll(config.poll);

  const claims = new ClaimService({
    membership: new DomainAllowlist(
      new StaticDomainSource([
        { community: config.community, domain: config.domain },
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
    secureCookies: false,
  });
  return { app, mailer };
}

async function main(): Promise<void> {
  const config = devConfig(process.env);
  const { app } = await buildDevServer(config);
  await app.listen({ port: config.port, host: "127.0.0.1" });

  console.log(
    [
      `pulse dev server on http://127.0.0.1:${config.port}`,
      config.secretSource === "generated"
        ? "  session secret: generated for this run — everyone is signed out when it stops"
        : "  session secret: from PULSE_SESSION_SECRET",
      `  community "${config.community}" admits @${config.domain} addresses`,
      `  poll "${config.poll.id}": ${config.poll.question}`,
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
