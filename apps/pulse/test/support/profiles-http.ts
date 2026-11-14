import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { z } from "zod";
import { PostgresContributionsStore } from "../../src/contributions/pg-store.js";
import { databaseUrl } from "../../src/db/config.js";
import { createPool } from "../../src/db/pool.js";
import { createServer } from "../../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../../src/http/session.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../../src/identity/allowlist.js";
import { ClaimService } from "../../src/identity/claim.js";
import { ConsoleMailer } from "../../src/identity/mailer.js";
import {
  PostgresClaimStore,
  PostgresVoterStore,
} from "../../src/identity/pg-store.js";
import { PostgresMemberProfileStore } from "../../src/profiles/pg-store.js";
import { PostgresVotingStore } from "../../src/voting/pg-store.js";
import { InMemorySuggestionStore } from "../../src/voting/suggestions.js";
import { migratedSchema } from "./database.js";

// Independent API.md wire schemas: strict projections also detect private leaks.
export const publicSchema = z
  .object({
    publicId: z.uuid(),
    displayName: z.string(),
    bio: z.string(),
    createdAt: z.iso.datetime({ precision: 3 }),
  })
  .strict();
export const ownerSchema = z
  .object({
    profile: publicSchema
      .extend({
        visible: z.boolean(),
        updatedAt: z.iso.datetime({ precision: 3 }),
      })
      .nullable(),
  })
  .strict();
export const owner = "private-profile-owner";
export const other = "private-profile-other";
export const webOrigin = "https://pulse.test";
const secret = "profiles-http-test-secret-long-enough";
export const draft = (ownerAccountId = owner) => ({
  ownerAccountId,
  displayName: "Ada",
  bio: "Neighbour",
  visible: true,
});

export async function response<T>(
  res: Response,
  status: number,
  schema: z.ZodType<T>,
): Promise<T> {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  return schema.parse(await res.json());
}
export async function errorResponse(
  res: Response,
  status: number,
  error: string,
) {
  return response(
    res,
    status,
    z.object({ error: z.literal(error), message: z.string().min(1) }).strict(),
  );
}

export async function fixture(
  t: TestContext,
  options: {
    storage?: boolean;
    /** Contribution storage, for the profile contribution lists (default on). */
    contributions?: boolean;
    /** The contribution store's clock, to publish past the hourly limit. */
    clock?: () => Date;
    rateLimit?: { max: number; timeWindow: string };
  } = {},
) {
  const pool = await migratedSchema(t);
  const voters = new PostgresVoterStore(pool);
  const schema = (
    await pool.query<{ name: string }>("select current_schema() as name")
  ).rows[0]!.name;
  const profilePool = createPool({ connectionString: databaseUrl()!, schema });
  let ended = false;
  async function stopStorage() {
    if (!ended) {
      ended = true;
      await profilePool.end();
    }
  }
  t.after(stopStorage);
  const signer = new SessionSigner(secret);
  const contributions =
    options.contributions === false
      ? undefined
      : new PostgresContributionsStore(pool, options.clock);
  const app = await createServer({
    voters,
    votes: new PostgresVotingStore(pool),
    suggestions: new InMemorySuggestionStore(),
    signer,
    webOrigin,
    ...(options.storage === false
      ? {}
      : { profiles: new PostgresMemberProfileStore(profilePool) }),
    ...(contributions ? { contributions } : {}),
    ...(options.rateLimit ? { profileRateLimit: options.rateLimit } : {}),
    claims: new ClaimService({
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new PostgresClaimStore(pool),
      mailer: new ConsoleMailer(() => {}),
      linkFor: () => webOrigin,
    }),
  });
  t.after(() => app.close());
  const server = await app.listen({ port: 0, host: "127.0.0.1" });
  for (const id of [owner, other]) {
    const now = new Date();
    await voters.create(
      {
        id,
        community: null,
        assurance: "email",
        claimedAt: now,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${id}@example.test`, verifiedAt: now },
    );
  }
  const cookie = (id = owner) => `${SESSION_COOKIE}=${signer.sign(id, 0)}`;
  const expiredCookie = `${SESSION_COOKIE}=${new SessionSigner(secret, { clock: () => new Date(0) }).sign(owner, 0)}`;
  function get(
    path = "/me/profile",
    headers: Record<string, string> = { cookie: cookie() },
  ) {
    return fetch(`${server}/api${path}`, { headers });
  }
  function raw(body: string | Buffer, headers: Record<string, string> = {}) {
    return fetch(`${server}/api/me/profile`, {
      method: "PUT",
      headers: {
        origin: webOrigin,
        cookie: cookie(),
        "content-type": "application/json",
        ...headers,
      },
      body,
    });
  }
  function put(body: unknown = draft(), headers: Record<string, string> = {}) {
    return raw(JSON.stringify(body), headers);
  }
  async function snapshot() {
    return (await pool.query("select * from member_profile order by voter_id"))
      .rows;
  }
  async function rejects(
    request: () => Promise<Response>,
    status: number,
    error: string,
  ) {
    const before = await snapshot();
    await errorResponse(await request(), status, error);
    assert.deepEqual(
      await snapshot(),
      before,
      "refused request changed profile storage",
    );
  }
  return {
    pool,
    voters,
    contributions,
    get,
    put,
    raw,
    cookie,
    expiredCookie,
    snapshot,
    rejects,
    stopStorage,
  };
}
