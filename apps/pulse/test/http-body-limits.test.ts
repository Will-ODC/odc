import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { InMemoryCreationStore } from "../src/authoring/memory-store.js";
import { CREATION_BODY_LIMIT } from "../src/http/creation.js";
import { createServer } from "../src/http/server.js";
import { SESSION_COOKIE, SessionSigner } from "../src/http/session.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../src/identity/allowlist.js";
import { ClaimService } from "../src/identity/claim.js";
import { ConsoleMailer } from "../src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../src/identity/store.js";
import { InMemorySuggestionStore } from "../src/voting/suggestions.js";
import { InMemoryVotingStore } from "../src/voting/store.js";

const AT = new Date("2026-11-08T12:00:00.000Z");
const ORIGIN = "https://pulse.example.org";
const VOTER_ID = "body-limit-voter";
const DEFAULT_BODY_LIMIT = 1024 * 1024;
const MCP_BODY_LIMIT = 16 * 1024;
const PERMISSION_BODY_LIMIT = 1024;
const TOO_LARGE = {
  error: "body_too_large",
  message: "That request is too large to send.",
};

async function bodyLimitServer(t: TestContext) {
  const clock = () => AT;
  const voters = new InMemoryVoterStore();
  const votes = new InMemoryVotingStore(clock);
  await voters.create(
    {
      id: VOTER_ID,
      community: null,
      assurance: "email",
      claimedAt: AT,
      proofEmailsOptIn: false,
    },
    {
      kind: "email",
      value: "owner@example.test",
      verifiedAt: AT,
    },
  );
  const signer = new SessionSigner("body-limit-test-secret-long-enough", {
    clock,
  });
  const app = await createServer({
    claims: new ClaimService(
      {
        membership: new DomainAllowlist(new StaticDomainSource([])),
        voters,
        claims: new InMemoryClaimStore(),
        mailer: new ConsoleMailer(() => undefined),
        linkFor: (token) => `${ORIGIN}/sign-in?token=${token}`,
      },
      { clock },
    ),
    voters,
    votes,
    suggestions: new InMemorySuggestionStore({ clock }),
    signer,
    creation: new InMemoryCreationStore(voters, votes, {
      clock,
      ownerEmail: "owner@example.test",
    }),
    webOrigin: ORIGIN,
    secureCookies: false,
    clock,
  });
  t.after(() => app.close());
  return {
    app,
    cookie: `${SESSION_COOKIE}=${signer.sign(VOTER_ID, 0)}`,
  };
}

function oversizedJson(limit: number): string {
  const empty = JSON.stringify({ padding: "" });
  const body = JSON.stringify({
    padding: "x".repeat(limit + 1 - empty.length),
  });
  assert.equal(Buffer.byteLength(body), limit + 1);
  return body;
}

test("every_body_taking_route_returns_the_full_413_error", async (t) => {
  const { app, cookie } = await bodyLimitServer(t);
  const authenticated = {
    cookie,
    origin: ORIGIN,
    "content-type": "application/json",
  };
  // Sign-in and redemption refuse any other origin before reading the body.
  const fromTheWebOrigin = {
    origin: ORIGIN,
    "content-type": "application/json",
  };
  const routes: readonly {
    name: string;
    method: "POST" | "PUT";
    url: string;
    limit: number;
    headers?: Record<string, string>;
  }[] = [
    {
      name: "sign in",
      method: "POST",
      url: "/api/sign-in",
      limit: DEFAULT_BODY_LIMIT,
      headers: fromTheWebOrigin,
    },
    {
      name: "redeem",
      method: "POST",
      url: "/api/sign-in/redeem",
      limit: DEFAULT_BODY_LIMIT,
      headers: fromTheWebOrigin,
    },
    {
      name: "cast vote",
      method: "POST",
      url: "/api/polls/p1/votes",
      limit: DEFAULT_BODY_LIMIT,
    },
    {
      name: "add suggestion",
      method: "POST",
      url: "/api/polls/p1/suggestions",
      limit: DEFAULT_BODY_LIMIT,
    },
    {
      name: "MCP",
      method: "POST",
      url: "/api/mcp",
      limit: MCP_BODY_LIMIT,
    },
    {
      name: "publish poll",
      method: "POST",
      url: "/api/polls",
      limit: CREATION_BODY_LIMIT,
      headers: authenticated,
    },
    {
      name: "grant posting permission",
      method: "PUT",
      url: "/api/posting-permissions/target",
      limit: PERMISSION_BODY_LIMIT,
      headers: authenticated,
    },
  ];

  for (const route of routes) {
    await t.test(route.name, async () => {
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: route.headers ?? { "content-type": "application/json" },
        payload: oversizedJson(route.limit),
      });
      assert.equal(response.statusCode, 413, response.body);
      assert.deepEqual(response.json(), TOO_LARGE);
    });
  }
});
