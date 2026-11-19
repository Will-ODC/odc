import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import type { InjectOptions } from "fastify";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import { PostgresVoterStore } from "../src/identity/pg-store.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
  type VoterStore,
} from "../src/identity/store.js";
import { createServer } from "../src/http/server.js";
import { SessionSigner } from "../src/http/session.js";
import {
  InMemoryMemberProfileStore,
  memoryDisplayNames,
} from "../src/profiles/memory-store.js";
import { PostgresMemberProfileStore } from "../src/profiles/pg-store.js";
import type { MemberProfileStore } from "../src/profiles/store.js";
import { ConfirmationKey } from "../src/voting/confirmation.js";
import { PostgresVotingStore } from "../src/voting/pg-store.js";
import { InMemoryVotingStore, type VotingStore } from "../src/voting/store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { databaseSkip, migratedSchema } from "./support/database.js";
import { sendOriginLikeABrowser } from "./support/origin.js";

// ADR-0048 step 3 (decision 11): MCP's `get_public_votes` over the real list
// route, on both stores, and the one per-address bucket it shares with HTTP.
// Public-vote polls are made through the voting store, because creation
// still refuses the setting (decision 14).

const SECRET = "test-secret-that-is-long-enough-x";
const CONFIRMATION_KEY = "a-confirmation-key-for-tests-0123456789";
const WEB_ORIGIN = "https://pulse.test";
const START = new Date("2026-11-19T12:00:00.000Z");

interface Stores {
  voters: VoterStore;
  votes: VotingStore;
  profiles: MemberProfileStore;
}

const kinds: [string, string | false, typeof postgresStores][] = [
  ["memory", false, memoryStores],
  ["postgres", databaseSkip, postgresStores],
];

async function memoryStores(clock: () => Date): Promise<Stores> {
  const voters = new InMemoryVoterStore();
  return {
    voters,
    votes: new InMemoryVotingStore(clock, {
      displayNameOf: memoryDisplayNames(voters),
    }),
    profiles: new InMemoryMemberProfileStore(voters, { clock }),
  };
}

async function postgresStores(
  clock: () => Date,
  t: TestContext,
): Promise<Stores> {
  const pool = await migratedSchema(t);
  return {
    voters: new PostgresVoterStore(pool),
    votes: new PostgresVotingStore(pool, clock),
    profiles: new PostgresMemberProfileStore(pool, { clock }),
  };
}

async function world(
  t: TestContext,
  stores: typeof postgresStores,
  publicVotesRateLimit?: { max: number; timeWindow: number },
) {
  const clock = () => START;
  const { voters, votes, profiles } = await stores(clock, t);
  const signer = new SessionSigner(SECRET, { ttlSeconds: 86_400, clock });
  const claims = new ClaimService(
    {
      membership: new DomainAllowlist(new StaticDomainSource([])),
      voters,
      claims: new InMemoryClaimStore(),
      mailer: new ConsoleMailer(() => {}),
      linkFor: (token) => `${WEB_ORIGIN}/sign-in?token=${token}`,
    },
    { clock },
  );
  const app = sendOriginLikeABrowser(
    await createServer({
      claims,
      voters,
      votes,
      profiles,
      suggestions: new InMemorySuggestionStore({ clock }),
      signer,
      clock,
      secureCookies: false,
      webOrigin: WEB_ORIGIN,
      confirmationKey: new ConfirmationKey(CONFIRMATION_KEY),
      mcp: { publicOrigin: WEB_ORIGIN },
      ...(publicVotesRateLimit ? { publicVotesRateLimit } : {}),
    }),
    WEB_ORIGIN,
  );
  t.after(() => app.close());
  // MCP reads the list over this server's own loopback listener.
  await app.listen({ host: "127.0.0.1", port: 0 });

  for (const [id, votePrivacy] of [
    ["pub", "public"],
    ["anon", "anonymous"],
  ] as const) {
    await votes.createPoll({
      id,
      question: "Which park?",
      choices: ["North", "South"],
      method: "single",
      votePrivacy,
    });
  }

  /** A signed-in account casts publicly; `name` gives it a profile name. */
  async function vote(id: string, choice: number, name?: string) {
    await voters.create(
      {
        id,
        community: null,
        assurance: "email",
        claimedAt: START,
        proofEmailsOptIn: false,
      },
      { kind: "email", value: `${id}@example.test`, verifiedAt: START },
    );
    if (name !== undefined)
      await profiles.save(
        { voterId: id, sessionGeneration: 0 },
        { displayName: name, bio: "", visible: true },
      );
    const cast = await app.inject({
      method: "POST",
      url: "/api/polls/pub/votes",
      payload: { ballot: [choice], publicVote: true },
      headers: { cookie: `pulse_session=${signer.sign(id, 0)}` },
    });
    assert.equal(cast.statusCode, 200, cast.body);
  }

  /** The HTTP list, as a client at `remoteAddress` reads it. */
  const list = (remoteAddress: string, query = "", headers = {}) =>
    app.inject({
      url: `/api/polls/pub/public-votes${query}`,
      remoteAddress,
      headers,
    });

  /** One MCP tool call, as a client at `remoteAddress` makes it. */
  async function tool(
    remoteAddress: string,
    args: Record<string, unknown>,
    name = "get_public_votes",
  ) {
    const options: InjectOptions = {
      method: "POST",
      url: "/api/mcp",
      remoteAddress,
      headers: {
        host: new URL(WEB_ORIGIN).host,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      },
    };
    const reply = await app.inject(options);
    assert.equal(reply.statusCode, 200, reply.body);
    const data = reply.body
      .split("\n")
      .find((line) => line.startsWith("data: "));
    const message = JSON.parse(data ? data.slice(6) : reply.body) as {
      result: { isError?: boolean; structuredContent: Record<string, unknown> };
    };
    return message.result;
  }

  return { app, vote, list, tool };
}

for (const [kind, skip, stores] of kinds) {
  describe(`${kind}: MCP get_public_votes`, { skip }, () => {
    it("returns_the_same_page_as_the_list_route_and_follows_its_cursor", async (t) => {
      const w = await world(t, stores);
      await w.vote("ada", 1, "Ada");
      await w.vote("bea", 0);
      for (let i = 0; i < 20; i++) await w.vote(`v${i}`, i % 2, `Voter ${i}`);

      const direct = (await w.list("192.0.2.1")).json();
      const first = await w.tool("192.0.2.2", { pollId: "pub" });
      assert.notEqual(first.isError, true);
      const page = first.structuredContent as {
        items: { name: string | null; choices: number[] }[];
        nextCursor: string | null;
      };
      // Same entries; cursors are sealed with a fresh nonce, so they differ.
      assert.deepEqual(page.items, direct.items);
      assert.equal(page.items.length, 20);
      assert.ok(page.nextCursor);
      for (const item of page.items)
        assert.deepEqual(Object.keys(item).sort(), ["choices", "name"]);

      const second = await w.tool("192.0.2.2", {
        pollId: "pub",
        cursor: page.nextCursor,
      });
      const rest = second.structuredContent as typeof page;
      assert.equal(rest.items.length, 2);
      assert.equal(rest.nextCursor, null);
      const all = [...page.items, ...rest.items];
      assert.deepEqual(
        all.map((item) => item.name ?? "(none)").sort(),
        [
          "(none)",
          "Ada",
          ...Array.from({ length: 20 }, (_, i) => `Voter ${i}`),
        ].sort(),
      );
      assert.deepEqual(all.find((item) => item.name === "Ada")?.choices, [1]);
      assert.doesNotMatch(
        JSON.stringify(all),
        /example\.test|ada"|listKey|list_key|voterId/,
      );
    });

    it("an_anonymous_or_missing_poll_and_a_bad_cursor_are_tool_errors", async (t) => {
      const w = await world(t, stores);
      for (const [args, code] of [
        [{ pollId: "anon" }, "anonymous_poll"],
        [{ pollId: "missing" }, "not_found"],
        [
          { pollId: "pub", cursor: "bm90LWEtc2VhbGVkLWN1cnNvci1hdC1hbGw" },
          "invalid_cursor",
        ],
      ] as const) {
        const result = await w.tool("192.0.2.3", args);
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent.error, code);
      }
    });

    it("get_poll_and_get_results_name_the_setting", async (t) => {
      const w = await world(t, stores);
      for (const [id, privacy] of [
        ["pub", "public"],
        ["anon", "anonymous"],
      ]) {
        for (const name of ["get_poll", "get_results"]) {
          const result = await w.tool("192.0.2.4", { pollId: id }, name);
          assert.equal(result.structuredContent.votePrivacy, privacy);
        }
      }
    });

    it("one_address_has_one_allowance_across_HTTP_and_MCP_and_addresses_do_not_share", async (t) => {
      const w = await world(t, stores, { max: 2, timeWindow: 60_000 });
      const a = "198.51.100.1";
      const b = "198.51.100.2";
      // A spends its allowance over HTTP; its MCP call is then refused.
      assert.equal((await w.list(a)).statusCode, 200);
      assert.equal((await w.list(a)).statusCode, 200);
      const refused = await w.tool(a, { pollId: "pub" });
      assert.equal(refused.isError, true);
      assert.equal(refused.structuredContent.error, "too_many_requests");
      // B is untouched by A. Its MCP call takes exactly one of its two: the
      // route's own loopback read is not counted a second time.
      const allowed = await w.tool(b, { pollId: "pub" });
      assert.notEqual(allowed.isError, true);
      assert.equal((await w.list(b)).statusCode, 200);
      assert.equal((await w.list(b)).statusCode, 429);
      // A second MCP caller from another address has its own bucket too.
      const c = "198.51.100.3";
      assert.notEqual((await w.tool(c, { pollId: "pub" })).isError, true);
      assert.notEqual((await w.tool(c, { pollId: "pub" })).isError, true);
      assert.equal(
        (await w.tool(c, { pollId: "pub" })).structuredContent.error,
        "too_many_requests",
      );
      // Loopback, where MCP's own reads arrive, has spent nothing.
      assert.equal((await w.list("127.0.0.1")).statusCode, 200);
    });

    it("a_guessed_internal_header_is_counted_like_any_request", async (t) => {
      const w = await world(t, stores, { max: 1, timeWindow: 60_000 });
      const forged = { "x-pulse-internal": "a".repeat(43) };
      assert.equal((await w.list("203.0.113.9", "", forged)).statusCode, 200);
      assert.equal((await w.list("203.0.113.9", "", forged)).statusCode, 429);
    });
  });
}
