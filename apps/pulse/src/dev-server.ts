import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { databaseUrl } from "./db/config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { createServer } from "./http/server.js";
import { SessionSigner } from "./http/session.js";
import {
  DomainAllowlist,
  StaticDomainSource,
  type AllowedDomainSource,
} from "./identity/allowlist.js";
import { ClaimService } from "./identity/claim.js";
import { ConsoleMailer } from "./identity/mailer.js";
import {
  PostgresClaimStore,
  PostgresDomainSource,
  PostgresVoterStore,
  allowDomain,
} from "./identity/pg-store.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
  type ClaimStore,
  type VoterStore,
} from "./identity/store.js";
import { PostgresVotingStore } from "./voting/pg-store.js";
import { PostgresSuggestionStore } from "./voting/pg-suggestions.js";
import type { NewPoll } from "./voting/poll.js";
import {
  InMemorySuggestionStore,
  type SuggestionStore,
} from "./voting/suggestions.js";
import { InMemoryVotingStore, type VotingStore } from "./voting/store.js";

/**
 * Running pulse on a laptop.
 *
 * This is for driving the real flow against the real server (the client's dev
 * proxy points at port 8080). With `PULSE_DATABASE_URL` set it keeps what it is
 * given in Postgres, migrated and seeded on every start. Without it everything
 * is in memory and dies with the process, so the demo still runs with nothing
 * installed. Every store is replaced, and the allowlist with them — five swaps,
 * not three.
 *
 * The sign-in link is printed to the terminal by `ConsoleMailer`: that is the
 * mailbox until a mail provider exists, and it is what makes the whole flow
 * demonstrable without one.
 */

/** 8080, because `apps/pulse-web/vite.config.ts` proxies `/api` there. */
export const DEFAULT_PORT = 8080;

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The seed: one community, one domain that proves membership of it, one poll.
 *
 * A literal, not configuration: a knob for the poll's wording would only be a
 * way to hand `createPoll` a shape it refuses, and every one of these values is
 * a two-line edit away for anyone who wants a different demo. With a database,
 * an edit reaches only polls not stored yet (see `seedPolls`). `satisfies
 * NewPoll` makes a bad seed a compile error rather than a crash on startup.
 */
const SEED = {
  community: "demo-community",
  domain: "example.test",
  /**
   * Three polls, wired as a graph: answering the first opens whichever of the
   * other two follows from the answer. That is the shape the product is about —
   * a run of quick questions where the answer decides what you are asked next —
   * and a single poll cannot demonstrate it.
   */
  polls: [
    {
      id: "ads-free",
      question: "Should the ODC stay free of paid ads?",
      // Two choices, in the order the ballot shows them: the opening screen is
      // a left/right swipe, and a third choice would have no side to land on.
      choices: ["No", "Yes"],
      method: "single",
      next: ["ads-allowed", "pay-for-it"],
      closesAt: new Date(Date.now() + THREE_DAYS_MS),
    },
    {
      id: "pay-for-it",
      question: "How do we pay for it?",
      choices: [
        "Members chip in",
        "One-off donations",
        "Grants",
        "A cut of what moves through it",
      ],
      method: "single",
      next: [null, null, null, null],
      acceptsSuggestions: true,
      closesAt: new Date(Date.now() + THREE_DAYS_MS),
    },
    {
      id: "ads-allowed",
      question: "Which ads are allowed?",
      choices: [
        "All of them",
        "Only ones members vote through",
        "Research and non-profits only",
        "Local organisations only",
      ],
      method: "single",
      next: [null, null, null, null],
      acceptsSuggestions: true,
      closesAt: new Date(Date.now() + THREE_DAYS_MS),
    },
  ] satisfies NewPoll[],
};

/** Where a run starts. The client opens this one when it is given no other. */
export const FIRST_POLL_ID = "ads-free";

/**
 * The only environments this entry point will start in.
 *
 * It is a development server in every part — a mailer that prints to a
 * terminal, a session secret it will invent, and a session cookie sent
 * without `Secure` because local development is plain http. Refusing to
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
        "it mails nothing and sends its session cookie without Secure.",
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
  /** Where to keep what it is given. Absent means in memory, lost on exit. */
  databaseUrl?: string;
}

/**
 * Read the environment into a configuration.
 *
 * Four variables, and each one is something a developer's machine genuinely
 * decides: which port is free, whether sessions should survive a restart,
 * where the client is being served, and whether to keep anything at all. The
 * seed data is not among them.
 */
export function devConfig(env: NodeJS.ProcessEnv): DevConfig {
  assertDevelopment(env);

  const secretFromEnv = env.PULSE_SESSION_SECRET;
  // Read by the one function that decides what "unset" means (src/db/config.ts).
  const url = databaseUrl(env);
  return {
    port: port(env.PULSE_PORT),
    // Never a hardcoded fallback: a default secret is a secret everyone has.
    secret: secretFromEnv ?? randomBytes(32).toString("base64url"),
    secretSource: secretFromEnv === undefined ? "generated" : "env",
    webOrigin: env.PULSE_WEB_ORIGIN ?? "http://localhost:5173",
    ...(url === undefined ? {} : { databaseUrl: url }),
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

/** Everything the server keeps rows in, and whose addresses count. */
interface Storage {
  kind: "postgres" | "memory";
  voters: VoterStore;
  votes: VotingStore;
  suggestions: SuggestionStore;
  claims: ClaimStore;
  domains: AllowedDomainSource;
  /** Only when the rows are in Postgres. */
  pool?: Pool;
}

export interface DevServerOptions {
  /**
   * Where the server's warnings go: a failed idle database connection, and a
   * database run without PULSE_SESSION_SECRET. Defaults to stderr.
   */
  log?: (message: string) => void;
}

/** Wire the server up from a configuration. Does not listen. */
export async function buildDevServer(
  config: DevConfig,
  env: NodeJS.ProcessEnv = process.env,
  options: DevServerOptions = {},
): Promise<{
  app: FastifyInstance;
  mailer: ConsoleMailer;
  storage: Storage["kind"];
  /** The pool it opened, when it opened one. Closing `app` closes it. */
  pool?: Pool;
}> {
  // Guarded here too: this is the function that sets `secureCookies: false`,
  // and it is exported and takes any config, so a hand-built one must not be a
  // way around the refusal in `devConfig`.
  assertDevelopment(env);

  const log = options.log ?? ((message: string) => console.error(message));
  if (config.databaseUrl !== undefined && config.secretSource === "generated") {
    // The ballot cookie is signed with the session secret. A new secret on
    // every start orphans every stored ballot, so the same browser comes back
    // as a new voter and can vote again — a tally the database was meant to
    // keep, inflated by each restart.
    log(
      "pulse: PULSE_DATABASE_URL is set but PULSE_SESSION_SECRET is not. " +
        "Every restart will sign everyone out and let each browser vote " +
        "again; set PULSE_SESSION_SECRET to keep ballots across restarts.",
    );
  }
  const storage =
    config.databaseUrl === undefined
      ? inMemory()
      : await inPostgres(config.databaseUrl, log);

  const { pool } = storage;
  try {
    await seedPolls(storage.votes);

    const mailer = new ConsoleMailer();
    const claims = new ClaimService({
      membership: new DomainAllowlist(storage.domains),
      voters: storage.voters,
      claims: storage.claims,
      mailer,
      linkFor: (token) =>
        `${config.webOrigin}/sign-in?token=${encodeURIComponent(token)}`,
    });

    const app = await createServer({
      claims,
      voters: storage.voters,
      votes: storage.votes,
      suggestions: storage.suggestions,
      signer: new SessionSigner(config.secret),
      // Local development is http://, and a Secure cookie would never be
      // stored. Safe only because of the guard above — see DEV_ENVIRONMENTS.
      secureCookies: false,
      // Generous, because the person hitting this limit is a developer
      // clicking through the flow for the tenth time, not someone mining.
      signInRateLimit: { max: 100, timeWindow: "1 minute" },
    });
    if (pool) {
      // This server opened the pool, so closing the server closes it.
      app.addHook("onClose", async () => {
        await pool.end();
      });
    }
    return { app, mailer, storage: storage.kind, ...(pool ? { pool } : {}) };
  } catch (error) {
    // A start that fails must not leave its pool open: nobody else holds it,
    // and its idle connections would keep the process alive. A failure to
    // close it must not replace the error that says why the start failed.
    await pool?.end().catch(() => undefined);
    throw error;
  }
}

function inMemory(): Storage {
  return {
    kind: "memory",
    voters: new InMemoryVoterStore(),
    votes: new InMemoryVotingStore(),
    suggestions: new InMemorySuggestionStore(),
    claims: new InMemoryClaimStore(),
    domains: new StaticDomainSource([
      { community: SEED.community, domain: SEED.domain },
    ]),
  };
}

async function inPostgres(
  url: string,
  log: (message: string) => void,
): Promise<Storage> {
  const pool = createPool({ connectionString: url });
  // An idle connection that fails — the database restarting, say — emits
  // "error" on the pool, and an "error" nobody listens for is an uncaught
  // exception that takes the server down. Report it; the pool drops the
  // connection by itself.
  pool.on("error", (error) => {
    log(`pulse: an idle database connection failed: ${error.message}`);
  });
  try {
    // On every start. Harmless when nothing is new: the runner skips what ran.
    await migrate(pool);
    // The allowlist is rows, as CLAUDE.md promises; this is the insert.
    await allowDomain(pool, { community: SEED.community, domain: SEED.domain });
  } catch (error) {
    // Closed so nothing keeps the process alive; the error explaining why the
    // start failed is the one to report, not a failure to close.
    await pool.end().catch(() => undefined);
    throw error;
  }
  return {
    kind: "postgres",
    voters: new PostgresVoterStore(pool),
    votes: new PostgresVotingStore(pool),
    suggestions: new PostgresSuggestionStore(pool),
    claims: new PostgresClaimStore(pool),
    domains: new PostgresDomainSource(pool),
    pool,
  };
}

/**
 * Write the seed polls that are not there yet. A database keeps the last
 * run's, and writing one again would stop the server starting ("poll already
 * exists"). A poll already there is left exactly as it is — including its
 * close time, three days after the start that first wrote it, and its wording
 * even if the seed has since been edited. To start the demo fresh, empty the
 * database: `docker compose … down` does, since it keeps nothing.
 */
async function seedPolls(votes: VotingStore): Promise<void> {
  for (const poll of SEED.polls) {
    if (await votes.getPoll(poll.id)) continue;
    try {
      await votes.createPoll(poll);
    } catch (error) {
      // Another server starting on the same database wrote it first.
      if (!(await votes.getPoll(poll.id))) throw error;
    }
  }
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
      config.databaseUrl === undefined
        ? "  storage: in memory — everything is lost when it stops"
        : "  storage: Postgres (PULSE_DATABASE_URL) — kept across restarts",
      `  community "${SEED.community}" admits @${SEED.domain} addresses`,
      ...SEED.polls.map((poll) => `  poll "${poll.id}": ${poll.question}`),
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
