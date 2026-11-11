import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Test setup imports both apps directly; this workspace declares both dependencies.
// The production browser app uses only the public HTTP API.
import { InMemoryCreationStore } from "../../../apps/pulse/src/authoring/memory-store.js";
import {
  DomainAllowlist,
  StaticDomainSource,
} from "../../../apps/pulse/src/identity/allowlist.js";
import { ClaimService } from "../../../apps/pulse/src/identity/claim.js";
import { ConsoleMailer } from "../../../apps/pulse/src/identity/mailer.js";
import {
  InMemoryClaimStore,
  InMemoryVoterStore,
} from "../../../apps/pulse/src/identity/store.js";
import { InMemorySuggestionStore } from "../../../apps/pulse/src/voting/suggestions.js";
import { InMemoryVotingStore } from "../../../apps/pulse/src/voting/store.js";
import { createServer } from "../../../apps/pulse/src/http/server.js";
import { SessionSigner } from "../../../apps/pulse/src/http/session.js";
import { HttpPulseApi } from "../../../apps/pulse-web/src/api/http.js";

/** Fastify's own type, reached through `createServer` (see end-to-end.test.ts). */
type PulseServer = Awaited<ReturnType<typeof createServer>>;

/** The web origin the server trusts, and so the one a browser page would send. */
const WEB_ORIGIN = "http://localhost:5173";

function cookieJar(): { fetch: typeof fetch; header(): string | undefined } {
  const jar = new Map<string, string>();
  const header = () =>
    jar.size === 0
      ? undefined
      : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

  const doFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const method = init?.method?.toUpperCase() ?? "GET";
    if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) {
      headers.set("origin", WEB_ORIGIN);
    }
    const cookie = header();
    if (cookie !== undefined && init?.credentials !== "omit") {
      headers.set("cookie", cookie);
    }
    const response = await globalThis.fetch(input, { ...init, headers });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };

  return { fetch: doFetch, header };
}

/**
 * Poll creation (ADR-0037) over a real socket: sign in and publish through the
 * real client, then read the question and vote on it through that same client.
 */
describe("poll creation against the real server", () => {
  let app: PulseServer;
  let mailer: ConsoleMailer;
  let api: HttpPulseApi;
  let jar: ReturnType<typeof cookieJar>;
  let baseUrl: string;

  beforeEach(async () => {
    mailer = new ConsoleMailer(() => {});
    const voters = new InMemoryVoterStore();
    const votes = new InMemoryVotingStore();
    app = await createServer({
      claims: new ClaimService({
        membership: new DomainAllowlist(
          new StaticDomainSource([
            { community: "ubc-students", domain: "student.ubc.ca" },
          ]),
        ),
        voters,
        claims: new InMemoryClaimStore(),
        mailer,
        linkFor: (token) =>
          `${WEB_ORIGIN}/sign-in?token=${encodeURIComponent(token)}`,
      }),
      voters,
      votes,
      suggestions: new InMemorySuggestionStore(),
      signer: new SessionSigner("a-test-secret-long-enough-x-x-x-x"),
      creation: new InMemoryCreationStore(voters, votes),
      webOrigin: WEB_ORIGIN,
      secureCookies: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    jar = cookieJar();
    baseUrl = `http://127.0.0.1:${port}/api`;
    api = new HttpPulseApi(baseUrl, jar.fetch);
  });

  afterEach(async () => {
    await app.close();
  });

  const publishFrom = (origin: string, body: unknown, key: string) =>
    jar.fetch(`${baseUrl}/polls`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
        origin,
      },
      body: JSON.stringify(body),
    });

  const question = {
    question: "Where should the new bike racks go?",
    choices: ["Library", "Gym", "Both"],
    method: "single" as const,
    attribution: { kind: "anonymous" as const },
    purposeAcknowledgement: "community-purpose-v1",
  };

  it("signs in, publishes a question, then reads it and votes on it", async () => {
    await api.requestLink("jo@student.ubc.ca", false);
    const token = new URL(
      mailer.lastTo("jo@student.ubc.ca")?.body ?? "",
    ).searchParams.get("token");
    await api.redeem(token ?? "");
    const me = await api.me();
    expect(me?.community).toBe("ubc-students");

    expect(await api.creationContext()).toEqual({
      community: { id: "ubc-students", label: "ubc-students" },
      canPostUnlimited: false,
      purposeVersion: "community-purpose-v1",
      purposeAcknowledged: false,
    });

    const creationResponses: Response[] = [];
    api = new HttpPulseApi(baseUrl, async (input, init) => {
      const response = await jar.fetch(input, init);
      creationResponses.push(response.clone());
      return response;
    });
    const sessionCookie = jar.header();
    expect(sessionCookie).toBeDefined();
    const key = randomUUID();
    const created = await api.createPoll(key, question);
    expect(creationResponses[0]?.status).toBe(201);
    const createdBody: unknown = await creationResponses[0]?.json();
    expect(createdBody).toMatchObject({ replayed: false });
    expect(creationResponses[0]?.headers.getSetCookie()).toEqual([]);
    expect(jar.header()).toBe(sessionCookie);
    expect(created.attribution).toEqual({ kind: "anonymous" });
    // No account id or address anywhere in what came back.
    expect(JSON.stringify(createdBody)).not.toContain(me?.id ?? "");
    expect(JSON.stringify(createdBody)).not.toContain("jo@student.ubc.ca");

    // A retry of the same request is the same question, not a second one.
    const replay = await api.createPoll(key, question);
    expect(replay.id).toBe(created.id);
    expect(creationResponses[1]?.status).toBe(200);
    const replayBody: unknown = await creationResponses[1]?.json();
    expect(replayBody).toMatchObject({ replayed: true });
    expect(JSON.stringify(replayBody)).not.toContain(me?.id ?? "");
    expect(JSON.stringify(replayBody)).not.toContain("jo@student.ubc.ca");
    expect(creationResponses[1]?.headers.getSetCookie()).toEqual([]);
    expect(jar.header()).toBe(sessionCookie);

    // Public browse discovery reuses the server listing, without signing in or casting.
    const guest = new HttpPulseApi(baseUrl, cookieJar().fetch);
    const listing = await guest.listPolls("ubc-students");
    expect(listing.polls.map((p) => p.id)).toEqual([created.id]);
    expect((await guest.listPolls("pulse-general")).polls).toEqual([]);
    expect((await guest.results(created.id)).voters).toBe(0);
    expect((await guest.poll(created.id)).attribution).toEqual({
      kind: "anonymous",
    });

    // It is an ordinary poll now: the client reads it and votes on it.
    const poll = await api.poll(created.id);
    expect(poll.question).toBe("Where should the new bike racks go?");
    expect(poll.choices).toEqual(["Library", "Gym", "Both"]);
    expect(poll.open).toBe(true);

    const outcome = await api.cast(created.id, [2]);
    expect(outcome.status).toBe("counted");
    expect(await api.myBallot(created.id)).toEqual([2]);
    expect((await api.results(created.id)).choices[2]?.count).toBe(1);
  });

  it("refuses a publish from another origin or without a session", async () => {
    const signedOut = await publishFrom(WEB_ORIGIN, question, randomUUID());
    expect(signedOut.status).toBe(401);

    await api.requestLink("jo@student.ubc.ca", false);
    const token = new URL(
      mailer.lastTo("jo@student.ubc.ca")?.body ?? "",
    ).searchParams.get("token");
    await api.redeem(token ?? "");

    const foreign = await publishFrom(
      "https://elsewhere.example",
      question,
      randomUUID(),
    );
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: string }).error).toBe(
      "origin_not_allowed",
    );
  });
});
