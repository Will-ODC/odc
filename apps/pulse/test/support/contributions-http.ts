import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { z } from "zod";
import { createPool } from "../../src/db/pool.js";
import { databaseUrl } from "../../src/db/config.js";
import { PostgresContributionsStore } from "../../src/contributions/pg-store.js";
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
import { PostgresVotingStore } from "../../src/voting/pg-store.js";
import { InMemorySuggestionStore } from "../../src/voting/suggestions.js";
import { migratedSchema } from "./database.js";

// Independent response schemas transcribed from API.md. Do not reuse the
// server's input parsers: these assert the public wire shape, including privacy.
const timestamp = z.iso.datetime({ precision: 3 });
const status = z.enum(["open", "in_progress", "completed", "cancelled"]);
export const summarySchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(4000),
    organizerName: z.string().min(1).max(80),
    kind: z.enum(["project", "fundraiser", "group_buy", "offer"]),
    communityBenefit: z.string().max(2000),
    needs: z.string().max(2000),
    pollId: z.string().nullable(),
    commercial: z
      .object({
        currency: z.enum(["CAD", "USD", "GBP", "EUR"]),
        regularPriceMinor: z.number().int().min(1).max(1_000_000_000),
        offeredPriceMinor: z.number().int().min(0).max(1_000_000_000),
        referenceUrl: z.url(),
        terms: z.string().min(1).max(2000),
      })
      .strict()
      .nullable(),
    fund: z
      .object({
        name: z.string().min(1).max(160),
        percentage: z.number().int().min(1).max(100),
      })
      .strict()
      .nullable(),
    community: z.object({ id: z.string(), label: z.string() }).strict(),
    status,
    createdAt: timestamp,
  })
  .strict();
export const participationSchema = z
  .object({
    id: z.uuid(),
    createdAt: timestamp,
    displayName: z.string().min(1).max(80),
    kind: z.enum(["help", "pledge", "report"]),
    message: z.string().min(1).max(2000),
  })
  .strict();
export const updateSchema = z
  .object({
    id: z.uuid(),
    createdAt: timestamp,
    status,
    message: z.string().min(1).max(2000),
    evidenceUrl: z.url().nullable(),
  })
  .strict();
export const contributionSchema = summarySchema.extend({
  participations: z.array(participationSchema),
  updates: z.array(updateSchema),
});
export const mutationSchema = z
  .object({ contribution: contributionSchema, replayed: z.boolean() })
  .strict();
export const detailSchema = z
  .object({ contribution: contributionSchema, canManage: z.boolean() })
  .strict();
export const pageSchema = z
  .object({
    contributions: z.array(summarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const messageSchema = z
  .object({ id: z.uuid(), replayed: z.boolean() })
  .strict();
export const inboxSchema = z
  .object({
    messages: z.array(
      z
        .object({
          id: z.uuid(),
          message: z.string().min(1).max(2000),
          createdAt: timestamp,
        })
        .strict(),
    ),
  })
  .strict();

export const project = {
  kind: "project",
  title: "Plant a community garden",
  description: "Build two shared garden beds.",
  organizerName: "Garden group",
};
export const participation = {
  kind: "help",
  displayName: "Sam",
  message: "I can dig.",
};
export const update = {
  status: "in_progress",
  message: "Started.",
  evidenceUrl: "https://example.test/progress",
};
export const message = { message: "Can I bring tools on Saturday?" };
export const webOrigin = "https://pulse.test";
export const organizer = "private-organizer";
export const sender = "private-sender";

export async function response<T>(
  res: Response,
  code: number,
  schema: z.ZodType<T>,
): Promise<T> {
  assert.equal(res.status, code, await res.clone().text());
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  return schema.parse(await res.json());
}
export async function errorResponse(
  res: Response,
  code: number,
  error: string,
) {
  return response(
    res,
    code,
    z.object({ error: z.literal(error), message: z.string().min(1) }).strict(),
  );
}

export async function fixture(t: TestContext, storage = true) {
  const pool = await migratedSchema(t);
  const voters = new PostgresVoterStore(pool);
  const votes = new PostgresVotingStore(pool);
  const schema = (
    await pool.query<{ name: string }>("select current_schema() as name")
  ).rows[0]!.name;
  const contributionPool = createPool({
    connectionString: databaseUrl()!,
    schema,
  });
  let ended = false;
  async function stopStorage() {
    if (!ended) {
      ended = true;
      await contributionPool.end();
    }
  }
  t.after(stopStorage);
  const signer = new SessionSigner(
    "contributions-http-test-secret-long-enough",
  );
  const app = await createServer({
    voters,
    votes,
    signer,
    webOrigin,
    suggestions: new InMemorySuggestionStore(),
    ...(storage
      ? { contributions: new PostgresContributionsStore(contributionPool) }
      : {}),
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
  for (const id of [organizer, sender]) {
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
  const cookie = (id: string) => `${SESSION_COOKIE}=${signer.sign(id, 0)}`;
  const root = `${server}/api/contributions`;
  function get(path = "", actor?: string) {
    return fetch(`${root}${path}`, {
      headers: actor ? { cookie: cookie(actor) } : {},
    });
  }
  function post(
    path: string,
    body: unknown,
    actor: string | null = organizer,
    key: string | null = randomUUID(),
    headers: Record<string, string> = {},
  ) {
    return fetch(`${root}${path}`, {
      method: "POST",
      headers: {
        origin: webOrigin,
        "content-type": "application/json",
        ...(actor ? { cookie: cookie(actor) } : {}),
        ...(key === null ? {} : { "idempotency-key": key }),
        ...headers,
      },
      body: JSON.stringify(
        body && typeof body === "object" && !Array.isArray(body)
          ? { accountId: actor, ...body }
          : body,
      ),
    });
  }
  async function snapshot() {
    return {
      records: (await pool.query("select * from contribution order by id"))
        .rows,
      replays: (
        await pool.query(
          "select * from contribution_replay order by voter_id, request_key",
        )
      ).rows,
    };
  }
  async function rejects(
    request: () => Promise<Response>,
    code: number,
    error: string,
  ) {
    const before = await snapshot();
    await errorResponse(await request(), code, error);
    assert.deepEqual(
      await snapshot(),
      before,
      "rejected request changed contribution storage or replay keys",
    );
  }
  async function create() {
    return (await response(await post("", project), 201, mutationSchema))
      .contribution;
  }
  return {
    pool,
    voters,
    votes,
    app,
    root,
    server,
    signer,
    cookie,
    get,
    post,
    snapshot,
    rejects,
    create,
    stopStorage,
  };
}
