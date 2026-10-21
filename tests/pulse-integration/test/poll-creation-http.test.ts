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

/**
 * Poll creation (ADR-0037) over a real socket: sign in through the real
 * client, publish a question with the creation route, then read it and vote
 * on it through the client exactly as for any other poll.
 *
 * The client has no creation call yet, so the publish is a plain `fetch`
 * carrying what a browser would: the session cookie from the jar, JSON, and
 * the page's `Origin`.
 */
function cookieJar(): { fetch: typeof fetch; header(): string | undefined } {
  const jar = new Map<string, string>();
  const header = () =>
    jar.size === 0
      ? undefined
      : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

  const doFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
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
      signer: new SessionSigner("a-test-secret-long-enough"),
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

  const publish = (body: unknown, key: string, origin = WEB_ORIGIN) =>
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
    method: "single",
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

    const context = await jar.fetch(`${baseUrl}/poll-creation/context`);
    expect(context.status).toBe(200);
    expect(await context.json()).toEqual({
      community: { id: "ubc-students", label: "ubc-students" },
      canPostUnlimited: false,
      purposeVersion: "community-purpose-v1",
      purposeAcknowledged: false,
    });

    const key = randomUUID();
    const created = await publish(question, key);
    expect(created.status).toBe(201);
    // Creation never hands out or clears a cookie, the ballot one included.
    expect(created.headers.getSetCookie()).toEqual([]);
    const body = (await created.json()) as {
      poll: { id: string; attribution: unknown };
      replayed: boolean;
    };
    expect(body.replayed).toBe(false);
    expect(body.poll.attribution).toEqual({ kind: "anonymous" });
    // No account id or address anywhere in what came back.
    expect(JSON.stringify(body)).not.toContain(me?.id ?? "");
    expect(JSON.stringify(body)).not.toContain("jo@student.ubc.ca");

    // A retry of the same request is the same question, not a second one.
    const replay = await publish(question, key);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { poll: { id: string } }).poll.id).toBe(
      body.poll.id,
    );

    // Public browse discovery reuses the server listing, without signing in or casting.
    const guest = new HttpPulseApi(baseUrl, cookieJar().fetch);
    const listing = await guest.listPolls("ubc-students");
    expect(listing.polls.map((p) => p.id)).toEqual([body.poll.id]);
    expect((await guest.listPolls("pulse-general")).polls).toEqual([]);
    expect((await guest.results(body.poll.id)).voters).toBe(0);

    // It is an ordinary poll now: the client reads it and votes on it.
    const poll = await api.poll(body.poll.id);
    expect(poll.question).toBe("Where should the new bike racks go?");
    expect(poll.choices).toEqual(["Library", "Gym", "Both"]);
    expect(poll.open).toBe(true);

    const outcome = await api.cast(body.poll.id, [2]);
    expect(outcome.status).toBe("counted");
    expect(await api.myBallot(body.poll.id)).toEqual([2]);
    expect((await api.results(body.poll.id)).choices[2]?.count).toBe(1);
  });

  it("refuses a publish from another origin or without a session", async () => {
    const signedOut = await publish(question, randomUUID());
    expect(signedOut.status).toBe(401);

    await api.requestLink("jo@student.ubc.ca", false);
    const token = new URL(
      mailer.lastTo("jo@student.ubc.ca")?.body ?? "",
    ).searchParams.get("token");
    await api.redeem(token ?? "");

    const foreign = await publish(
      question,
      randomUUID(),
      "https://elsewhere.example",
    );
    expect(foreign.status).toBe(403);
    expect(((await foreign.json()) as { error: string }).error).toBe(
      "origin_not_allowed",
    );
  });
});
